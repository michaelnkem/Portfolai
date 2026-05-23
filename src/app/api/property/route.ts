import { NextRequest, NextResponse } from 'next/server'
import { getProperty, getEpc, getTransactions, getRisks } from '@/lib/homedata'
import { MARKET_DATA, calcGrossYield, calcNetYield, calcNetMonthlyIncome } from '@/lib/market-data'

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTION-GRADE UK PROPERTY VALUATION ENGINE — v1.0
// Methodology: RICS-aligned 4-layer hybrid AVM
// Regions: England & Wales
// Layers: Comparable Engine | District Trends | Regional Calibration | Historical Fallback
// ═══════════════════════════════════════════════════════════════════════════════

// ── LOCAL AUTHORITY HPI — 5yr growth (%) by property type ────────────────────
// Source: ONS UK HPI Local Authority Series to Jan 2026
// Keyed by postcode area prefix. Used for time-adjusting comps + Layer 4 fallback.
interface LaHpi { la: string; det: number; semi: number; ter: number; flat: number }

const LA_HPI: Record<string, LaHpi> = {
  // Outer London — North
  'EN': { la:'Enfield',            det:8.0,  semi:9.0,  ter:10.0, flat:2.0  },
  'N':  { la:'Haringey/Islington', det:4.0,  semi:5.0,  ter:6.0,  flat:1.0  },
  'NW': { la:'Camden/Barnet',      det:3.0,  semi:4.0,  ter:4.0,  flat:0.5  },
  // Outer London — East
  'E':  { la:'Newham/Hackney',     det:8.0,  semi:8.0,  ter:7.0,  flat:3.0  },
  'IG': { la:'Redbridge',          det:9.0,  semi:10.0, ter:10.0, flat:3.0  },
  'RM': { la:'Havering',           det:10.0, semi:11.0, ter:12.0, flat:4.0  },
  // Outer London — South East
  'DA': { la:'Bexley',             det:10.0, semi:9.0,  ter:9.0,  flat:3.0  },
  'SE': { la:'Lewisham/Southwark', det:5.0,  semi:6.0,  ter:6.0,  flat:2.0  },
  'BR': { la:'Bromley',            det:7.0,  semi:7.0,  ter:8.0,  flat:3.0  },
  // Outer London — South
  'CR': { la:'Croydon',            det:9.0,  semi:9.0,  ter:9.0,  flat:4.0  },
  'SM': { la:'Sutton',             det:8.0,  semi:8.0,  ter:9.0,  flat:3.0  },
  // Outer London — South West
  'KT': { la:'Kingston',           det:5.0,  semi:5.0,  ter:6.0,  flat:2.0  },
  'TW': { la:'Richmond/Hounslow',  det:5.0,  semi:5.0,  ter:5.5,  flat:2.0  },
  'SW': { la:'Wandsworth/Lambeth', det:2.0,  semi:2.0,  ter:3.0,  flat:-0.5 },
  // Outer London — West
  'UB': { la:'Hillingdon/Ealing',  det:6.0,  semi:6.0,  ter:6.0,  flat:2.0  },
  'HA': { la:'Harrow',             det:7.0,  semi:8.0,  ter:8.0,  flat:3.0  },
  'WD': { la:'Watford/Hertsmere',  det:12.0, semi:12.0, ter:12.0, flat:5.0  },
  'W':  { la:'Ealing/Hamm/Fulham', det:3.0,  semi:3.0,  ter:4.0,  flat:0.5  },
  // Inner London
  'EC': { la:'City of London',     det:1.0,  semi:1.0,  ter:1.0,  flat:-1.0 },
  'WC': { la:'Westminster',        det:1.0,  semi:1.0,  ter:1.0,  flat:-1.0 },
  // Greater Manchester
  'M':  { la:'Manchester City',    det:35.0, semi:33.0, ter:32.0, flat:28.0 },
  'SK': { la:'Stockport',          det:25.0, semi:24.0, ter:23.0, flat:20.0 },
  // West Midlands
  'B':  { la:'Birmingham',         det:30.0, semi:29.0, ter:28.0, flat:22.0 },
  // Merseyside
  'L':  { la:'Liverpool',          det:40.0, semi:38.0, ter:38.0, flat:30.0 },
  // West Yorkshire
  'LS': { la:'Leeds',              det:32.0, semi:30.0, ter:29.0, flat:24.0 },
  // South Yorkshire
  'S':  { la:'Sheffield',          det:30.0, semi:28.0, ter:27.0, flat:22.0 },
  // Bristol
  'BS': { la:'Bristol',            det:24.0, semi:22.0, ter:21.0, flat:18.0 },
  // Nottinghamshire
  'NG': { la:'Nottingham',         det:27.0, semi:25.0, ter:24.0, flat:20.0 },
}
const LA_HPI_DEFAULT: LaHpi = { la:'National', det:9.0, semi:8.0, ter:8.0, flat:3.0 }

// ── POSTCODE DISTRICT CALIBRATION ────────────────────────────────────────────
// Expected £/sqm ranges + bedroom anchor price ranges per outcode district.
// Source: LR PPD analysis, Zoopla HPI, REalyse — calibrated to Jan 2026.
interface CalibBand {
  psqmMin: number
  psqmMax: number
  anchors: Partial<Record<'studio'|'1bed'|'2bed'|'3bed'|'4bed', { min:number; max:number }>>
}

const CALIBRATION: Record<string, CalibBand> = {
  // ── Enfield ──────────────────────────────────────────────────────────────
  'EN1': { psqmMin:4800, psqmMax:6200, anchors:{'2bed':{min:350000,max:430000},'3bed':{min:480000,max:570000},'4bed':{min:610000,max:750000}} },
  'EN2': { psqmMin:5000, psqmMax:6500, anchors:{'2bed':{min:370000,max:460000},'3bed':{min:500000,max:600000},'4bed':{min:640000,max:780000}} },
  'EN3': { psqmMin:4200, psqmMax:5600, anchors:{'2bed':{min:300000,max:380000},'3bed':{min:430000,max:530000},'4bed':{min:550000,max:670000}} },
  'EN4': { psqmMin:5200, psqmMax:6800, anchors:{'2bed':{min:390000,max:490000},'3bed':{min:520000,max:630000},'4bed':{min:670000,max:820000}} },
  // ── Havering ─────────────────────────────────────────────────────────────
  'RM1': { psqmMin:3800, psqmMax:5000, anchors:{'2bed':{min:270000,max:350000},'3bed':{min:370000,max:470000},'4bed':{min:480000,max:590000}} },
  'RM3': { psqmMin:3500, psqmMax:4800, anchors:{'2bed':{min:250000,max:330000},'3bed':{min:350000,max:445000},'4bed':{min:450000,max:550000}} },
  'RM7': { psqmMin:3600, psqmMax:4800, anchors:{'2bed':{min:260000,max:340000},'3bed':{min:360000,max:455000},'4bed':{min:460000,max:565000}} },
  'RM11':{ psqmMin:3800, psqmMax:5000, anchors:{'2bed':{min:275000,max:355000},'3bed':{min:375000,max:475000},'4bed':{min:480000,max:600000}} },
  // ── Redbridge / Ilford ───────────────────────────────────────────────────
  'IG1': { psqmMin:3800, psqmMax:5200, anchors:{'2bed':{min:280000,max:370000},'3bed':{min:385000,max:485000},'4bed':{min:490000,max:610000}} },
  'IG3': { psqmMin:3600, psqmMax:4900, anchors:{'2bed':{min:265000,max:350000},'3bed':{min:365000,max:460000},'4bed':{min:460000,max:570000}} },
  'IG6': { psqmMin:3600, psqmMax:4900, anchors:{'2bed':{min:265000,max:350000},'3bed':{min:360000,max:460000},'4bed':{min:460000,max:570000}} },
  // ── Bexley ───────────────────────────────────────────────────────────────
  'DA5': { psqmMin:3400, psqmMax:4600, anchors:{'2bed':{min:245000,max:325000},'3bed':{min:335000,max:425000},'4bed':{min:430000,max:540000}} },
  'DA15':{ psqmMin:3600, psqmMax:4900, anchors:{'2bed':{min:260000,max:345000},'3bed':{min:355000,max:450000},'4bed':{min:455000,max:565000}} },
  // ── Bromley ──────────────────────────────────────────────────────────────
  'BR1': { psqmMin:4000, psqmMax:5500, anchors:{'2bed':{min:295000,max:390000},'3bed':{min:405000,max:510000},'4bed':{min:520000,max:650000}} },
  'BR2': { psqmMin:3800, psqmMax:5200, anchors:{'2bed':{min:280000,max:375000},'3bed':{min:385000,max:490000},'4bed':{min:495000,max:620000}} },
  // ── Croydon ──────────────────────────────────────────────────────────────
  'CR0': { psqmMin:3400, psqmMax:4800, anchors:{'2bed':{min:245000,max:340000},'3bed':{min:340000,max:440000},'4bed':{min:435000,max:555000}} },
  'CR2': { psqmMin:3600, psqmMax:5000, anchors:{'2bed':{min:260000,max:360000},'3bed':{min:360000,max:460000},'4bed':{min:460000,max:580000}} },
  // ── Sutton ───────────────────────────────────────────────────────────────
  'SM1': { psqmMin:3600, psqmMax:5000, anchors:{'2bed':{min:265000,max:360000},'3bed':{min:365000,max:465000},'4bed':{min:465000,max:580000}} },
  'SM4': { psqmMin:3800, psqmMax:5200, anchors:{'2bed':{min:275000,max:375000},'3bed':{min:375000,max:480000},'4bed':{min:480000,max:600000}} },
  // ── Kingston ─────────────────────────────────────────────────────────────
  'KT1': { psqmMin:4300, psqmMax:6000, anchors:{'2bed':{min:310000,max:415000},'3bed':{min:425000,max:540000},'4bed':{min:545000,max:680000}} },
  'KT3': { psqmMin:4800, psqmMax:6600, anchors:{'2bed':{min:350000,max:470000},'3bed':{min:480000,max:610000},'4bed':{min:620000,max:775000}} },
  // ── Harrow ───────────────────────────────────────────────────────────────
  'HA1': { psqmMin:3800, psqmMax:5300, anchors:{'2bed':{min:280000,max:380000},'3bed':{min:385000,max:490000},'4bed':{min:495000,max:620000}} },
  'HA3': { psqmMin:3600, psqmMax:5000, anchors:{'2bed':{min:265000,max:360000},'3bed':{min:365000,max:465000},'4bed':{min:465000,max:585000}} },
  // ── Watford ──────────────────────────────────────────────────────────────
  'WD17':{ psqmMin:3400, psqmMax:4800, anchors:{'2bed':{min:245000,max:340000},'3bed':{min:340000,max:435000},'4bed':{min:435000,max:550000}} },
  'WD23':{ psqmMin:3800, psqmMax:5200, anchors:{'2bed':{min:275000,max:375000},'3bed':{min:375000,max:480000},'4bed':{min:480000,max:600000}} },
  // ── Manchester ───────────────────────────────────────────────────────────
  'M1':  { psqmMin:2600, psqmMax:4000, anchors:{'studio':{min:95000,max:145000},'1bed':{min:130000,max:195000},'2bed':{min:180000,max:260000}} },
  'M2':  { psqmMin:2800, psqmMax:4200, anchors:{'1bed':{min:140000,max:210000},'2bed':{min:195000,max:280000}} },
  'M4':  { psqmMin:2800, psqmMax:4000, anchors:{'1bed':{min:140000,max:200000},'2bed':{min:190000,max:270000}} },
  'M14': { psqmMin:2400, psqmMax:3600, anchors:{'2bed':{min:165000,max:240000},'3bed':{min:240000,max:320000},'4bed':{min:320000,max:420000}} },
  'M20': { psqmMin:3000, psqmMax:4400, anchors:{'2bed':{min:220000,max:320000},'3bed':{min:320000,max:430000},'4bed':{min:440000,max:565000}} },
  'M21': { psqmMin:2800, psqmMax:4100, anchors:{'2bed':{min:205000,max:300000},'3bed':{min:295000,max:395000},'4bed':{min:400000,max:520000}} },
  // ── Birmingham ───────────────────────────────────────────────────────────
  'B1':  { psqmMin:2000, psqmMax:3300, anchors:{'1bed':{min:110000,max:170000},'2bed':{min:155000,max:230000}} },
  'B15': { psqmMin:2800, psqmMax:4300, anchors:{'2bed':{min:205000,max:300000},'3bed':{min:295000,max:400000}} },
  'B17': { psqmMin:2600, psqmMax:3800, anchors:{'2bed':{min:185000,max:270000},'3bed':{min:265000,max:360000}} },
  'B29': { psqmMin:2200, psqmMax:3300, anchors:{'2bed':{min:155000,max:230000},'3bed':{min:225000,max:310000}} },
  // ── Liverpool ────────────────────────────────────────────────────────────
  'L1':  { psqmMin:1400, psqmMax:2600, anchors:{'1bed':{min:75000,max:135000},'2bed':{min:105000,max:180000}} },
  'L15': { psqmMin:1600, psqmMax:2600, anchors:{'2bed':{min:115000,max:190000},'3bed':{min:165000,max:250000}} },
  'L18': { psqmMin:2200, psqmMax:3500, anchors:{'3bed':{min:240000,max:360000},'4bed':{min:360000,max:500000}} },
  // ── Leeds ────────────────────────────────────────────────────────────────
  'LS1': { psqmMin:2000, psqmMax:3300, anchors:{'1bed':{min:120000,max:190000},'2bed':{min:165000,max:250000}} },
  'LS7': { psqmMin:2000, psqmMax:3000, anchors:{'2bed':{min:140000,max:215000},'3bed':{min:200000,max:285000}} },
  'LS17':{ psqmMin:2600, psqmMax:4000, anchors:{'3bed':{min:280000,max:400000},'4bed':{min:395000,max:555000}} },
  // ── Sheffield ────────────────────────────────────────────────────────────
  'S1':  { psqmMin:1600, psqmMax:2800, anchors:{'1bed':{min:90000,max:155000},'2bed':{min:130000,max:210000}} },
  'S10': { psqmMin:2200, psqmMax:3600, anchors:{'3bed':{min:255000,max:365000},'4bed':{min:365000,max:505000}} },
  // ── Bristol ──────────────────────────────────────────────────────────────
  'BS1': { psqmMin:3300, psqmMax:4800, anchors:{'1bed':{min:190000,max:270000},'2bed':{min:265000,max:365000}} },
  'BS6': { psqmMin:3600, psqmMax:5200, anchors:{'2bed':{min:265000,max:385000},'3bed':{min:375000,max:505000}} },
  'BS7': { psqmMin:3400, psqmMax:5000, anchors:{'2bed':{min:250000,max:365000},'3bed':{min:355000,max:480000}} },
  // ── Nottingham ───────────────────────────────────────────────────────────
  'NG1': { psqmMin:1600, psqmMax:2800, anchors:{'1bed':{min:90000,max:155000},'2bed':{min:130000,max:210000}} },
  'NG7': { psqmMin:1600, psqmMax:2600, anchors:{'2bed':{min:115000,max:185000},'3bed':{min:165000,max:245000}} },
}

// ── GET HANDLER ───────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q    = searchParams.get('q')
  const uprn = searchParams.get('uprn')

  if (!process.env.HOMEDATA_API_KEY) {
    return NextResponse.json({ error: 'HOMEDATA_API_KEY not configured' }, { status: 500 })
  }

  if (q && !uprn) {
    try {
      const suggestions = normalise(await searchAddressRaw(q))
      return NextResponse.json({ suggestions })
    } catch (e) {
      console.error('Search error:', e)
      return NextResponse.json({ suggestions: [] })
    }
  }

  if (uprn) {
    try {
      const [property, epc, transactions, risks] = await Promise.all([
        getProperty(uprn),
        getEpc(uprn).catch(() => null),
        getTransactions(uprn).catch(() => []),
        getRisks(uprn).catch(() => []),
      ])

      const prop       = property || { uprn, full_address: `UPRN ${uprn}`, address: `UPRN ${uprn}` }
      const propRecord = prop as Record<string, unknown>
      const postcode   = String(propRecord.postcode || '')
      const outcode    = postcode.split(' ')[0]

      const cityName = detectCity(
        String(propRecord.town_name || ''),
        postcode
      )
      const cityData = MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities]
        || MARKET_DATA.cities.London

      const defaults = {
        serviceCharge:        String(propRecord.property_type || '').toLowerCase().includes('flat') ? 2000 : 0,
        groundRent:           String(propRecord.tenure || '').toLowerCase().includes('leasehold') ? 200 : 0,
        managementFee:        10,
        maintenanceAllowance: 1.5,
        voidWeeks:            2,
      }

      const estimatedRent = estimateRent(
        String(propRecord.property_type || ''),
        Number(propRecord.bedrooms || 1),
        cityData.avgRent,
      )

      const price = Number(propRecord.last_sold_price || 0)

      const subjectAddr = String(propRecord.full_address || propRecord.address || '')
      const [lrData, epcOpenData] = await Promise.all([
        fetchLrData(postcode, subjectAddr),
        fetchEpcData(postcode, subjectAddr, process.env.EPC_API_KEY, process.env.EPC_API_EMAIL),
      ])

      const resolvedEpc    = epc || epcOpenData.subjectEpc
      const lrLastSold     = lrData.history.length > 0 ? lrData.history[0] : null
      const lastSoldPrice  = lrLastSold ? lrLastSold.price : price
      const lastSoldDate   = lrLastSold ? lrLastSold.date  : String(propRecord.last_sold_date || '')
      const allTransactions = lrData.history.length > 0
        ? lrData.history.map(t => ({ price: t.price, date: t.date, transaction_type: t.type }))
        : (transactions || []).slice(0, 20)

      const valuation = await calcValuation(
        propRecord,
        cityName,
        cityData,
        lrData.comps,
        epcOpenData.floorAreas,
        process.env.HOMEDATA_API_KEY!
      )

      const effectivePrice = price || valuation.fairValue
      const grossYield = effectivePrice ? calcGrossYield(effectivePrice, estimatedRent) : 0
      const netYield   = effectivePrice ? calcNetYield(
        effectivePrice, estimatedRent,
        defaults.serviceCharge, defaults.groundRent,
        defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
      ) : 0

      const floodRisk = (risks || []).find((r: Record<string,unknown>) => r.risk_type === 'flood_rivers_sea')

      return NextResponse.json({
        uprn,
        property: { ...prop, last_sold_price: lastSoldPrice, last_sold_date: lastSoldDate },
        epc:          resolvedEpc,
        transactions: allTransactions,
        risks:        risks || [],
        cityData,
        cityName,
        enriched: {
          estimatedRent,
          estimatedCurrentValue:  valuation.fairValue,
          valuationLow:           valuation.lowValue,
          valuationHigh:          valuation.highValue,
          valuationConfidence:    valuation.confidence,
          valuationCompsUsed:     valuation.compsUsed,
          valuationPsqm:          valuation.psqm,
          valuationMethod:        valuation.method,
          valuationCalibZone:     valuation.calibZone,
          grossYield,
          netYield,
          netMonthly: effectivePrice ? calcNetMonthlyIncome(
            effectivePrice, estimatedRent,
            defaults.serviceCharge, defaults.groundRent,
            defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
          ) : 0,
          capitalGrowth: cityData.capitalGrowth1yr,
          totalROI:      parseFloat((netYield + cityData.capitalGrowth1yr).toFixed(1)),
          floodRisk:     floodRisk ? String((floodRisk as Record<string,unknown>).label) : 'Unknown',
          epcRating: resolvedEpc?.current_energy_efficiency
            ? efficiencyToRating(resolvedEpc.current_energy_efficiency as number)
            : resolvedEpc?.current_energy_rating
              ? String(resolvedEpc.current_energy_rating)
              : String(propRecord.current_energy_rating || 'Unknown'),
          epcFloorArea: resolvedEpc?.total_floor_area
            || propRecord.internal_area_sqm
            || propRecord.epc_floor_area
            || null,
          defaults,
        },
      })
    } catch (e) {
      console.error('Property fetch error:', e)
      return NextResponse.json({ error: 'Failed to fetch property data' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Provide q (search) or uprn' }, { status: 400 })
}

// ── UTILITY FUNCTIONS ─────────────────────────────────────────────────────────
async function searchAddressRaw(query: string): Promise<unknown> {
  const url = `https://api.homedata.co.uk/api/address/find/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: { Authorization: `Api-Key ${process.env.HOMEDATA_API_KEY}` },
    cache: 'no-store',
  })
  if (!res.ok) { console.error('Homedata search failed:', res.status); return { suggestions: [] } }
  const data = await res.json()
  console.log('Homedata search:', Object.keys(data), 'count:', data.count)
  return data
}

function normalise(raw: unknown): Array<{ uprn:string; full_address:string; address:string; postcode:string }> {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  let items: unknown[] = []
  if      (Array.isArray(obj))             items = obj
  else if (Array.isArray(obj.suggestions)) items = obj.suggestions as unknown[]
  else if (Array.isArray(obj.results))     items = obj.results     as unknown[]
  else if (Array.isArray(obj.addresses))   items = obj.addresses   as unknown[]
  else if (Array.isArray(obj.data))        items = obj.data        as unknown[]
  return items
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const i = item as Record<string, unknown>
      const uprn     = String(i.uprn ?? i.UPRN ?? i.id ?? '')
      const address  = String(i.address ?? i.full_address ?? i.display_address ?? i.line1 ?? '')
      const town     = String(i.town ?? i.town_name ?? '')
      const postcode = String(i.postcode ?? i.post_code ?? '')
      const full_address = address || `${town} ${postcode}`.trim()
      return { uprn, full_address, address: full_address, postcode }
    })
    .filter(s => s.uprn && s.full_address)
}

function detectCity(town: string, postcode: string): string {
  const t  = (town || '').toLowerCase()
  const pc = (postcode || '').toUpperCase().trim()
  const outward = pc.split(' ')[0]

  const londonPrefixes = ['EC','WC','SW','SE','NW','W1','W2','W3','W4','W5','W6','W7','W8','W9',
    'N1','N2','N3','N4','N5','N6','N7','N8','N9','E1','E2','E3','E4','E5','E6','E7','E8','E9',
    'BR','CR','DA','EN','HA','IG','KT','RM','SM','TW','UB','WD']
  const londonSingle = ['E','N','W']

  if (t.includes('london') ||
    londonPrefixes.some(p => outward.startsWith(p)) ||
    londonSingle.some(p => outward.startsWith(p) && outward.length >= 2)) return 'London'

  if (t.includes('bristol')      || outward.startsWith('BS')) return 'Bristol'
  if (t.includes('nottingham')   || outward.startsWith('NG')) return 'Nottingham'
  if (t.includes('leeds')        || outward.startsWith('LS')) return 'Leeds'
  if (t.includes('sheffield')    || (outward.startsWith('S') && !outward.startsWith('SK') && !outward.startsWith('SM'))) return 'Sheffield'
  if (t.includes('liverpool')    || (outward.startsWith('L') && !outward.startsWith('LS'))) return 'Liverpool'
  if (t.includes('birmingham')   || t.includes('solihull') ||
    (outward.startsWith('B') && !outward.startsWith('BR') && !outward.startsWith('BS'))) return 'Birmingham'
  if (t.includes('manchester')   || t.includes('salford') || outward.startsWith('M') || outward.startsWith('SK')) return 'Manchester'
  return 'London'
}

function estimateRent(propertyType: string, beds: number, cityAvgRent: number): number {
  const bedMult: Record<number,number> = { 0:0.55, 1:0.75, 2:1.00, 3:1.35, 4:1.70, 5:2.10 }
  const isHmo   = propertyType?.toLowerCase().includes('hmo')
  const mult    = isHmo ? beds * 0.55 : (bedMult[beds] || 1)
  return Math.round(cityAvgRent * mult / 50) * 50
}

function efficiencyToRating(score: number): string {
  if (score >= 92) return 'A'
  if (score >= 81) return 'B'
  if (score >= 69) return 'C'
  if (score >= 55) return 'D'
  if (score >= 39) return 'E'
  if (score >= 21) return 'F'
  return 'G'
}

function normPropertyType(t: string): string {
  const tl = t.toLowerCase()
  if (tl.includes('flat') || tl.includes('maisonette') || tl.includes('apartment')) return 'flat'
  if (tl.includes('semi'))   return 'semi'
  if (tl.includes('detach')) return 'detached'
  return 'terraced'
}

function typicalFloorArea(propertyType: string): number {
  const t = propertyType.toLowerCase()
  if (t.includes('flat') || t.includes('maisonette') || t.includes('apartment')) return 60
  if (t.includes('semi'))   return 88
  if (t.includes('terrace')) return 80
  if (t.includes('detach') && !t.includes('semi')) return 110
  return 80
}

function estimateFloorArea(beds: number, type: string): number {
  const base: Record<number,number> = { 0:35, 1:50, 2:70, 3:90, 4:115, 5:140 }
  const area = base[Math.min(beds, 5)] || 70
  return type.toLowerCase().includes('detach') && !type.toLowerCase().includes('semi')
    ? Math.round(area * 1.2) : area
}

// ── VALUATION HELPERS ─────────────────────────────────────────────────────────
function getLaHpi(outcode: string): LaHpi {
  const two = ['EC','WC','SW','SE','NW','SK','BS','LS','NG','RM','IG','DA','BR','CR','SM','KT','TW','UB','HA','WD','EN']
  for (const p of two)   { if (outcode.startsWith(p)) return LA_HPI[p] ?? LA_HPI_DEFAULT }
  for (const p of ['E','N','W','S','M','B','L']) { if (outcode.startsWith(p)) return LA_HPI[p] ?? LA_HPI_DEFAULT }
  return LA_HPI_DEFAULT
}

function laAnnualRate(laHpi: LaHpi, propertyType: string): number {
  const t = normPropertyType(propertyType)
  const fiveYr = t === 'detached' ? laHpi.det : t === 'semi' ? laHpi.semi : t === 'flat' ? laHpi.flat : laHpi.ter
  return Math.max(0.005, fiveYr / 5 / 100)
}

function getCalibBand(outcode: string): CalibBand | null {
  // Try longest match first (e.g. "RM11" before "RM")
  for (let len = outcode.length; len >= 2; len--) {
    const key = outcode.slice(0, len)
    if (CALIBRATION[key]) return CALIBRATION[key]
  }
  return null
}

function bedKey(beds: number): 'studio'|'1bed'|'2bed'|'3bed'|'4bed' {
  if (beds === 0) return 'studio'
  if (beds === 1) return '1bed'
  if (beds === 2) return '2bed'
  if (beds === 3) return '3bed'
  return '4bed'
}

// Weighted median: sort by value, accumulate weights, return value at 50% cumulative weight
function weightedMedian(vals: number[], weights: number[]): number {
  if (vals.length === 0) return 0
  const pairs = vals.map((v, i) => ({ v, w: weights[i] })).sort((a, b) => a.v - b.v)
  const total  = pairs.reduce((s, p) => s + p.w, 0)
  let   cumul  = 0
  for (const p of pairs) {
    cumul += p.w
    if (cumul >= total / 2) return p.v
  }
  return pairs[pairs.length - 1].v
}

// Comparable similarity score (0–1) per RICS weighting formula
function scoreComp(
  comp:         { type: string; date: string },
  subjectType:  string,
  subjectArea:  number,
  compArea:     number,
  isEpcBacked:  boolean,
): number {
  const typeScore     = normPropertyType(comp.type) === normPropertyType(subjectType) ? 1.0 : 0.3
  const areaDiff      = subjectArea > 0 ? Math.abs(compArea - subjectArea) / subjectArea : 0.3
  const areaScore     = Math.max(0, 1 - areaDiff * 2)
  const monthsAgo     = (Date.now() - new Date(comp.date).getTime()) / (30 * 24 * 3600 * 1000)
  const recencyScore  = Math.max(0, 1 - monthsAgo / 24)
  const reliScore     = isEpcBacked ? 1.0 : 0.5
  // Distance and tenure both score 1.0 (same postcode; tenure not in LR data)
  return typeScore * 0.30 + areaScore * 0.25 + 1.0 * 0.20 + recencyScore * 0.15 + 1.0 * 0.05 + reliScore * 0.05
}

// Feature adjustment capped at +6% / -12% per spec
function featureAdj(epcRating: string, hasParking: boolean, hasGarden: boolean, tenure: string): number {
  let adj = 0
  if      (epcRating === 'A' || epcRating === 'B') adj += 1.5
  else if (epcRating === 'E') adj -= 2.0
  else if (epcRating === 'F') adj -= 4.0
  else if (epcRating === 'G') adj -= 5.0
  if (hasParking) adj += 2.0
  if (hasGarden)  adj += 1.5
  if (tenure.toLowerCase().includes('leasehold')) adj -= 2.0
  adj = Math.min(6, Math.max(-12, adj))  // cap: +6% / -12%
  return 1 + adj / 100
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4-LAYER HYBRID VALUATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
interface ValuationResult {
  fairValue:  number
  lowValue:   number
  highValue:  number
  confidence: number
  compsUsed:  number
  method:     string
  psqm:       number
  calibZone:  string
}

interface LrTransaction { price: number; date: string; type: string; address: string }

async function calcValuation(
  prop:     Record<string, unknown>,
  cityName: string,
  cityData: Record<string, number>,
  lrComps:  LrTransaction[],
  epcData:  Map<string, number>,
  apiKey:   string,
): Promise<ValuationResult> {

  const subjectType   = String(prop.property_type || '')
  const subjectBeds   = Number(prop.bedrooms || 2)
  const subjectTenure = String(prop.tenure || '')
  const subjectEpc    = String(prop.current_energy_rating || 'D')
  const hasParking    = Boolean(prop.has_parking)
  const hasGarden     = Boolean(prop.has_garden)
  const outcode       = String(prop.postcode || '').split(' ')[0]
  const laHpi         = getLaHpi(outcode)
  const annualRate    = laAnnualRate(laHpi, subjectType)
  const fAdj          = featureAdj(subjectEpc, hasParking, hasGarden, subjectTenure)
  const calibBand     = getCalibBand(outcode)
  const calibZone     = calibBand ? outcode : 'city_avg'
  const now           = Date.now()

  // Known subject floor area (EPC priority)
  const knownSubjectArea = Number(prop.internal_area_sqm || prop.epc_floor_area || 0)
  const subjectArea = knownSubjectArea > 0
    ? knownSubjectArea
    : estimateFloorArea(subjectBeds, subjectType)
  const areaIsEstimated = knownSubjectArea === 0

  let l1Value: number | null = null
  let l1Psqm  = 0
  let l1Comps = 0
  let l1SameType  = false
  let l1EpcHits   = 0
  let l1OldComps  = false

  // ── LAYER 1: COMPARABLE SOLD PRICE ENGINE ────────────────────────────────
  // Weighted-median £/sqm from LR postcode comparables, time-adjusted by LA+type HPI
  if (lrComps.length >= 2) {
    const sameType    = lrComps.filter(c => normPropertyType(c.type) === normPropertyType(subjectType))
    const workingComps = sameType.length >= 2 ? sameType : lrComps
    l1SameType        = sameType.length >= 2

    // Filter: reject distressed/shared-ownership by extreme low price (< £800/sqm)
    const psqmEntries: Array<{ psqm: number; weight: number; isEpc: boolean; isOld: boolean }> = []

    for (const c of workingComps) {
      const yearsAgo  = (now - new Date(c.date).getTime()) / (365.25 * 24 * 3600 * 1000)
      const adjPrice  = c.price * Math.pow(1 + annualRate, Math.max(0, yearsAgo))

      const addrToken = c.address.trim().split(/[\s,]/)[0].toLowerCase()
      const epcArea   = epcData.get(addrToken)
      const compArea  = epcArea ?? typicalFloorArea(c.type)
      const isEpc     = !!epcArea
      const psqm      = adjPrice / compArea

      // Reject implausible values: < £800/sqm (distressed/shared ownership) or > £30k/sqm (data error)
      if (psqm < 800 || psqm > 30000) continue

      const weight = scoreComp(c, subjectType, subjectArea, compArea, isEpc)
      const isOld  = yearsAgo > 1.5

      psqmEntries.push({ psqm, weight, isEpc, isOld })
      if (isEpc) l1EpcHits++
    }

    if (psqmEntries.length >= 2) {
      const medianPsqm = weightedMedian(
        psqmEntries.map(e => e.psqm),
        psqmEntries.map(e => e.weight),
      )
      l1OldComps = psqmEntries.some(e => e.isOld)
      l1Comps    = psqmEntries.length
      l1Psqm     = Math.round(medianPsqm)
      l1Value    = Math.round((medianPsqm * subjectArea * fAdj) / 1000) * 1000

      console.log(`L1 Comps: £${l1Value.toLocaleString()} (${l1Comps} comps, ${l1EpcHits} EPC-backed, £${l1Psqm}/sqm × ${subjectArea}sqm, LA:${laHpi.la})`)
    }
  }

  // ── LAYER 2: DISTRICT TREND ENGINE ───────────────────────────────────────
  // Homedata outcode price_trends → district £/sqm
  let l2Value: number | null = null
  if (outcode) {
    try {
      const url = `https://api.homedata.co.uk/api/price_trends/${encodeURIComponent(outcode)}/`
      const res = await fetch(url, { headers: { Authorization: `Api-Key ${apiKey}` }, cache: 'no-store' })
      if (res.ok) {
        const td = await res.json()
        const monthly: Record<string,unknown>[] = (
          td?.monthly_average_prices ||
          td?.data?.monthly_average_prices ||
          td?.results?.monthly_average_prices || []
        )
        const prices = monthly.slice(-12)
          .map(m => Number(m.average_price ?? m.avg_price ?? m.price ?? m.value ?? 0))
          .filter(p => p > 50000)
        if (prices.length >= 3) {
          const avgDistrict = prices.reduce((s, p) => s + p, 0) / prices.length
          const distPsqm    = avgDistrict / typicalFloorArea(subjectType)
          l2Value           = Math.round((distPsqm * subjectArea * fAdj) / 1000) * 1000
          console.log(`L2 District: £${l2Value.toLocaleString()} (${prices.length}mo data, ${outcode})`)
        }
      }
    } catch (e) {
      console.error('L2 district trends error:', e)
    }
  }

  // ── LAYER 3: REGIONAL CALIBRATION ENGINE ─────────────────────────────────
  // Postcode district bedroom anchor midpoint — prevents unrealistic valuations
  let l3Value: number | null = null
  if (calibBand) {
    const bk     = bedKey(subjectBeds)
    const anchor = calibBand.anchors[bk]
    if (anchor) {
      l3Value = Math.round((anchor.min + anchor.max) / 2 / 1000) * 1000
    } else if (subjectArea > 0) {
      const psqmMid = (calibBand.psqmMin + calibBand.psqmMax) / 2
      l3Value = Math.round(psqmMid * subjectArea / 1000) * 1000
    }
    if (l3Value) console.log(`L3 Calibration: £${l3Value.toLocaleString()} (${outcode} anchor)`)
  }

  // ── LAYER 4: HISTORICAL SALE FALLBACK ────────────────────────────────────
  // Last sold price × LA+type HPI growth; or city bedroom average if no history
  let l4Value: number | null = null
  const soldPrice = Number(prop.last_sold_price || 0)
  if (soldPrice > 0) {
    const soldYear  = Number(String(prop.last_sold_date || '2015').slice(0, 4))
    const yearsHeld = Math.max(0, 2026 - soldYear)
    l4Value = Math.round(soldPrice * Math.pow(1 + annualRate, yearsHeld) / 1000) * 1000
    console.log(`L4 Historical: £${l4Value.toLocaleString()} (sold £${soldPrice.toLocaleString()} in ${soldYear}, ${laHpi.la} ${(annualRate*100).toFixed(1)}%/yr)`)
  } else {
    // No sale history: city bedroom average with outer London calibration
    const cityByBed = MARKET_DATA.cityByBedroom[cityName as keyof typeof MARKET_DATA.cityByBedroom]
    const bk        = bedKey(subjectBeds)
    const bedData   = cityByBed?.[bk as keyof typeof cityByBed]
    let fallback    = bedData?.avgPrice || (cityData.avgPrice as number) || 0
    if (cityName === 'London' && fallback > 0) {
      const outerFar = ['EN','RM','DA','IG']
      const outerMid = ['CR','BR','KT','TW','UB','HA','WD','SM']
      if (outerFar.some(p => outcode.startsWith(p)))      fallback = Math.round(fallback * 0.65)
      else if (outerMid.some(p => outcode.startsWith(p))) fallback = Math.round(fallback * 0.72)
    }
    if (fallback > 0) {
      l4Value = Math.round(fallback / 1000) * 1000
      console.log(`L4 City avg: £${l4Value.toLocaleString()} (${cityName} ${bk} regional anchor)`)
    }
  }

  // ── HYBRID COMBINATION — weighted, dynamic redistribution ─────────────────
  // Weights: L1=50%, L2=20%, L3=20%, L4=10%
  // Unavailable layers → weight redistributed proportionally across active layers
  const layers = [
    { val: l1Value, w: 0.50 },
    { val: l2Value, w: 0.20 },
    { val: l3Value, w: 0.20 },
    { val: l4Value, w: 0.10 },
  ].filter(l => l.val !== null && l.val > 0) as Array<{ val: number; w: number }>

  if (layers.length === 0) {
    return { fairValue:0, lowValue:0, highValue:0, confidence:0, compsUsed:0, method:'none', psqm:0, calibZone }
  }

  const totalW  = layers.reduce((s, l) => s + l.w, 0)
  let   hybrid  = layers.reduce((s, l) => s + l.val * (l.w / totalW), 0)

  // ── LAYER 3 CALIBRATION CONSTRAINT ───────────────────────────────────────
  // If result is >15% outside bedroom anchor AND Layer 1 confidence is weak,
  // blend toward anchor midpoint to prevent unrealistic valuations
  if (calibBand && l3Value) {
    const bk     = bedKey(subjectBeds)
    const anchor = calibBand.anchors[bk]
    if (anchor) {
      const upperBound = anchor.max * 1.15
      const lowerBound = anchor.min * 0.85
      const weakEvidence = (l1Value === null) || (l1Comps < 3 && !l1SameType)
      if (weakEvidence && (hybrid > upperBound || hybrid < lowerBound)) {
        const anchorMid = (anchor.min + anchor.max) / 2
        hybrid = hybrid * 0.65 + anchorMid * 0.35  // blend toward anchor
        console.log(`Calibration constraint applied: blended toward ${outcode} anchor £${Math.round(anchorMid).toLocaleString()}`)
      }
    }
  }

  const fairValue = Math.round(hybrid / 1000) * 1000

  // ── CONFIDENCE SCORING ────────────────────────────────────────────────────
  let conf = 50
  if (l1Value !== null) {
    conf += l1Comps * 4                       // +4% per strong comparable
    if (l1SameType)     conf += 5             // +5% same-type comps
    if (l1EpcHits > 0)  conf += Math.min(l1EpcHits * 3, 12) // +3% per EPC-backed (max +12%)
    if (soldPrice > 0)  conf += 4             // +4% subject has recent sale history
  }
  if (!areaIsEstimated) conf += 8             // +8% known subject floor area
  else                  conf -= 10            // -10% estimated floor area
  if (l1Value === null && l2Value !== null) conf -= 8  // -8% district-only data
  if (!l1SameType && l1Comps > 0)           conf -= 5  // -5% mixed property types
  if (l1OldComps)                           conf -= 5  // -5% comps older than 18mo

  conf = Math.min(90, Math.max(25, conf))

  // ── VALUATION RANGE ───────────────────────────────────────────────────────
  const spread = conf >= 80 ? 0.05 : conf >= 65 ? 0.07 : 0.10

  const layerNames = layers.map(l => {
    if (l.val === l1Value && l1Value !== null) return 'L1:Comparables'
    if (l.val === l2Value && l2Value !== null) return 'L2:District'
    if (l.val === l3Value && l3Value !== null) return 'L3:Calibration'
    return 'L4:Historical'
  }).join('+')

  return {
    fairValue,
    lowValue:   Math.round(fairValue * (1 - spread) / 1000) * 1000,
    highValue:  Math.round(fairValue * (1 + spread) / 1000) * 1000,
    confidence: conf,
    compsUsed:  l1Comps,
    method:     layerNames,
    psqm:       l1Psqm || Math.round(fairValue / subjectArea),
    calibZone,
  }
}

// ── EPC OPEN DATA ─────────────────────────────────────────────────────────────
interface EpcResult {
  floorAreas: Map<string, number>
  subjectEpc: Record<string, unknown> | null
}

async function fetchEpcData(
  postcode: string,
  subjectAddress: string,
  apiKey?: string,
  apiEmail?: string,
): Promise<EpcResult> {
  const empty: EpcResult = { floorAreas: new Map(), subjectEpc: null }
  if (!postcode || !apiKey || !apiEmail) return empty
  try {
    const url  = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode)}&size=50`
    const auth = Buffer.from(`${apiEmail}:${apiKey}`).toString('base64')
    const res  = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      cache:   'no-store',
      signal:  abortAfter(8000),
    })
    if (!res.ok) { console.log(`EPC API: ${res.status} for ${postcode}`); return empty }

    const data  = await res.json()
    const cols  = (data['column-names'] || []) as string[]
    const rows  = (data.rows || []) as string[][]
    const col   = (name: string) => cols.indexOf(name)

    const addrIdx   = col('address1')
    const areaIdx   = col('total-floor-area')
    const ratingIdx = col('current-energy-rating')
    const scoreIdx  = col('current-energy-efficiency')
    const potRatIdx = col('potential-energy-rating')
    const potScoIdx = col('potential-energy-efficiency')
    const dateIdx   = col('lodgement-date')
    const inspIdx   = col('inspection-date')

    const subjectToken = subjectAddress.trim().split(/[\s,]/)[0].toLowerCase().replace(/\D/g, '')
      || subjectAddress.trim().split(/[\s,]/)[0].toLowerCase()

    const floorAreas = new Map<string, number>()
    let subjectEpc:     Record<string, unknown> | null = null
    let subjectEpcDate = ''

    for (const row of rows) {
      const addr = String(row[addrIdx] || '').trim()
      const area = Number(row[areaIdx] || 0)
      if (!addr) continue

      const key = addr.split(/[\s,]/)[0].toLowerCase()
      if (area > 0) floorAreas.set(key, area)

      const rowToken  = key.replace(/\D/g, '') || key
      const isSubject = subjectToken && (rowToken === subjectToken || key === subjectToken)
      const rowDate   = String(row[dateIdx] || row[inspIdx] || '')

      if (isSubject && (!subjectEpc || rowDate > subjectEpcDate)) {
        subjectEpcDate = rowDate
        subjectEpc = {
          current_energy_rating:       String(row[ratingIdx] || ''),
          current_energy_efficiency:   Number(row[scoreIdx]  || 0),
          potential_energy_rating:     String(row[potRatIdx] || ''),
          potential_energy_efficiency: Number(row[potScoIdx] || 0),
          total_floor_area:            area,
          inspection_date:             rowDate,
          source:                      'epc_open_data',
        }
      }
    }

    console.log(`EPC: ${floorAreas.size} floor areas, subject matched: ${!!subjectEpc}`)
    return { floorAreas, subjectEpc }
  } catch (e) {
    console.error('EPC fetch error:', e)
    return empty
  }
}

// ── LAND REGISTRY DATA ────────────────────────────────────────────────────────
function abortAfter(ms: number): AbortSignal {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), ms)
  return ctrl.signal
}

async function fetchLrData(
  postcode: string,
  address:  string,
): Promise<{ history: LrTransaction[]; comps: LrTransaction[] }> {
  const empty = { history: [], comps: [] }
  if (!postcode) return empty
  try {
    const url = `http://landregistry.data.gov.uk/data/ppi/address.json?postcode=${encodeURIComponent(postcode)}&_pageSize=50`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) return empty

    const data      = await res.json()
    const addresses = ((data?.result as Record<string,unknown>)?.items || []) as Record<string,unknown>[]
    console.log(`LR: ${addresses.length} addresses in ${postcode}`)

    const houseNumber = address.trim().split(' ')[0].replace(/\D/g, '')
    const twoYearsAgo = new Date(Date.now() - 730 * 24 * 3600 * 1000).toISOString().slice(0, 10)

    const fetchAddrTxns = async (addr: Record<string,unknown>) => {
      const paon      = String(addr.paon || '')
      const addrUrl   = String(addr._about || '')
      const isSubject = Boolean(houseNumber && paon && paon.includes(houseNumber))
      if (!addrUrl) return { paon, isSubject, txns: [] as LrTransaction[] }
      try {
        const txRes = await fetch(`${addrUrl}.json`, {
          headers: { Accept: 'application/json' }, cache: 'no-store', signal: abortAfter(7000),
        })
        if (!txRes.ok) return { paon, isSubject, txns: [] as LrTransaction[] }
        const txData = await txRes.json()
        const topic  = (txData?.result as Record<string,unknown>)?.primaryTopic as Record<string,unknown>
        const rawD   = topic?.soldDate
        if (!rawD) return { paon, isSubject, txns: [] as LrTransaction[] }
        const list = Array.isArray(rawD) ? rawD : [rawD]
        const txns: LrTransaction[] = list
          .filter(Boolean)
          .map((tx: unknown) => ({
            price:   Number((tx as Record<string,unknown>).pricePaid || 0),
            date:    String((tx as Record<string,unknown>).transactionDate || ''),
            type:    String((tx as Record<string,unknown>).propertyType || '').split('/').pop() || '',
            address: paon,
          }))
          .filter(t => t.price > 0)
        return { paon, isSubject, txns }
      } catch {
        return { paon, isSubject, txns: [] as LrTransaction[] }
      }
    }

    const settled = await Promise.allSettled(addresses.slice(0, 25).map(fetchAddrTxns))
    const history: LrTransaction[] = []
    const comps:   LrTransaction[] = []

    for (const r of settled) {
      if (r.status !== 'fulfilled') continue
      const { isSubject, txns } = r.value
      if (isSubject) history.push(...txns)
      else           comps.push(...txns.filter(t => t.date >= twoYearsAgo))
    }

    history.sort((a, b) => b.date.localeCompare(a.date))
    console.log(`LR: ${history.length} subject txns, ${comps.length} postcode comps (last 24mo)`)
    return { history, comps }
  } catch (e) {
    console.error('LR data error:', e)
    return empty
  }
}
