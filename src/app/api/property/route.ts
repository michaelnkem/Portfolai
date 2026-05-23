import { NextRequest, NextResponse } from 'next/server'
import {
  getProperty, getEpc, getTransactions, getRisks
} from '@/lib/homedata'
import { MARKET_DATA, calcGrossYield, calcNetYield, calcNetMonthlyIncome } from '@/lib/market-data'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')
  const uprn = searchParams.get('uprn')

  if (!process.env.HOMEDATA_API_KEY) {
    return NextResponse.json({ error: 'HOMEDATA_API_KEY not configured' }, { status: 500 })
  }

  if (q && !uprn) {
    try {
      const raw = await searchAddressRaw(q)
      const suggestions = normalise(raw)
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

      const prop = property || { uprn, full_address: `UPRN ${uprn}`, address: `UPRN ${uprn}` }
      const cityName = detectCity(
        String((prop as Record<string,unknown>).town_name || ''),
        String((prop as Record<string,unknown>).postcode || '')
      )
      const cityData = MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities]
        || MARKET_DATA.cities.London

      const propRecord = prop as Record<string, unknown>
      const postcode   = String(propRecord.postcode || '')

      const defaults = {
        serviceCharge: String(propRecord.property_type || '').toLowerCase().includes('flat') ? 2000 : 0,
        groundRent: String(propRecord.tenure || '').toLowerCase().includes('leasehold') ? 200 : 0,
        managementFee: 10,
        maintenanceAllowance: 1.5,
        voidWeeks: 2,
      }

      const subjectAddr = String(propRecord.full_address || propRecord.address || '')
      const [lrData, epcOpenData] = await Promise.all([
        fetchLrData(postcode, subjectAddr),
        fetchEpcData(postcode, subjectAddr, process.env.EPC_API_KEY, process.env.EPC_API_EMAIL),
      ])

      const resolvedEpc = epc || epcOpenData.subjectEpc

      const lrLastSold    = lrData.history.length > 0 ? lrData.history[0] : null
      const lastSoldPrice = lrLastSold ? lrLastSold.price : Number(propRecord.last_sold_price || 0)
      const lastSoldDate  = lrLastSold ? lrLastSold.date  : String(propRecord.last_sold_date || '')
      let allTransactions = lrData.history.length > 0
        ? lrData.history.map(t => ({ price: t.price, date: t.date, transaction_type: t.type }))
        : (transactions || []).slice(0, 20)

      if (allTransactions.length === 0 && lastSoldPrice > 0 && lastSoldDate) {
        allTransactions = [{ price: lastSoldPrice, date: lastSoldDate, transaction_type: 'Standard' }]
      }

      const resolvedEpcR = resolvedEpc as Record<string, unknown> | null
      const epcFloorAreaN = Number(
        resolvedEpcR?.epc_floor_area ||
        resolvedEpcR?.total_floor_area ||
        propRecord.internal_area_sqm || propRecord.epc_floor_area || 0
      )
      const epcFloorArea = epcFloorAreaN > 0 ? epcFloorAreaN : null
      const attrs = enrichAttributes(propRecord, epcFloorArea, postcode)

      const valuationProp = {
        ...propRecord,
        last_sold_price: lastSoldPrice,
        last_sold_date:  lastSoldDate,
        ...(attrs.bedroomsInferred && attrs.bedrooms != null ? { bedrooms: attrs.bedrooms } : {}),
      }

      const valuation = await calcValuation(
        valuationProp,
        cityName,
        cityData,
        lrData.comps,
        epcOpenData.floorAreas,
        process.env.HOMEDATA_API_KEY!
      )

      const effectivePrice = lastSoldPrice || valuation.fairValue

      const estimatedRent = estimateRent(
        String(propRecord.property_type || ''),
        Number(attrs.bedrooms ?? propRecord.bedrooms ?? 1),
        cityData.avgRent,
      )

      const grossYield = effectivePrice ? calcGrossYield(effectivePrice, estimatedRent) : 0
      const netYield   = effectivePrice ? calcNetYield(
        effectivePrice, estimatedRent,
        defaults.serviceCharge, defaults.groundRent,
        defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
      ) : 0

      const floodRisk = (risks || []).find((r: Record<string,unknown>) => r.risk_type === 'flood_rivers_sea')

      const epcScore = Number(resolvedEpcR?.current_energy_efficiency ?? 0)
      const epcRating = epcScore > 0
        ? efficiencyToRating(epcScore)
        : resolvedEpcR?.current_energy_rating
          ? String(resolvedEpcR.current_energy_rating)
          : String(propRecord.current_energy_rating || 'Unknown')

      return NextResponse.json({
        uprn,
        property: { ...prop, last_sold_price: lastSoldPrice, last_sold_date: lastSoldDate },
        epc: resolvedEpc,
        transactions: allTransactions,
        risks: risks || [],
        cityData,
        cityName,
        enriched: {
          estimatedRent,
          estimatedCurrentValue:  valuation.fairValue,
          valuationLow:           valuation.lowValue,
          valuationHigh:          valuation.highValue,
          valuationConfidence:    valuation.confidence,
          valuationCompsUsed:     valuation.compsUsed,
          valuationMethod:        valuation.method,
          valuationWeightedPsqm:  valuation.weightedPsqm,
          grossYield,
          netYield,
          netMonthly: effectivePrice ? calcNetMonthlyIncome(
            effectivePrice, estimatedRent,
            defaults.serviceCharge, defaults.groundRent,
            defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
          ) : 0,
          capitalGrowth: cityData.capitalGrowth1yr,
          totalROI: parseFloat((netYield + cityData.capitalGrowth1yr).toFixed(1)),
          floodRisk: floodRisk ? String((floodRisk as Record<string,unknown>).label) : 'Unknown',
          epcRating,
          epcFloorArea,
          defaults,
          attrBedrooms:           attrs.bedrooms,
          attrBedroomsLabel:      attrs.bedroomsLabel,
          attrBedroomsConfidence: attrs.bedroomsConfidence,
          attrBedroomsInferred:   attrs.bedroomsInferred,
          attrBathroomsLabel:     attrs.bathroomsLabel,
          attrBathroomsInferred:  attrs.bathroomsInferred,
          attrTenureLabel:        attrs.tenureLabel,
          attrTenureInferred:     attrs.tenureInferred,
          attrGardenLabel:        attrs.gardenLabel,
          attrGardenInferred:     attrs.gardenInferred,
        },
      })
    } catch (e) {
      console.error('Property fetch error:', e)
      return NextResponse.json({ error: 'Failed to fetch property data' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Provide q (search) or uprn' }, { status: 400 })
}

async function searchAddressRaw(query: string): Promise<unknown> {
  const url = `https://api.homedata.co.uk/api/address/find/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: { Authorization: `Api-Key ${process.env.HOMEDATA_API_KEY}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    console.error('Homedata search failed:', res.status, await res.text())
    return { suggestions: [] }
  }
  const data = await res.json()
  console.log('Homedata search response keys:', Object.keys(data), 'count:', data.count)
  return data
}

function normalise(raw: unknown): Array<{ uprn: string; full_address: string; address: string; postcode: string }> {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  let items: unknown[] = []
  if (Array.isArray(obj)) items = obj
  else if (Array.isArray(obj.suggestions)) items = obj.suggestions as unknown[]
  else if (Array.isArray(obj.results)) items = obj.results as unknown[]
  else if (Array.isArray(obj.addresses)) items = obj.addresses as unknown[]
  else if (Array.isArray(obj.data)) items = obj.data as unknown[]

  return items
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const i = item as Record<string, unknown>
      const uprn = String(i.uprn ?? i.UPRN ?? i.id ?? '')
      const address = String(i.address ?? i.full_address ?? i.display_address ?? i.line1 ?? '')
      const town = String(i.town ?? i.town_name ?? '')
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

  const londonPrefixes = [
    'EC','WC','SW','SE','NW','W1','W2','W3','W4','W5','W6','W7','W8','W9',
    'N1','N2','N3','N4','N5','N6','N7','N8','N9',
    'E1','E2','E3','E4','E5','E6','E7','E8','E9',
    'BR','CR','DA','EN','HA','IG','KT','RM','SM','TW','UB','WD',
  ]
  if (
    t.includes('london') ||
    londonPrefixes.some(p => outward.startsWith(p)) ||
    ['E','N','W'].some(p => outward.startsWith(p) && outward.length >= 2)
  ) return 'London'

  if (t.includes('bristol') || outward.startsWith('BS')) return 'Bristol'
  if (t.includes('nottingham') || outward.startsWith('NG')) return 'Nottingham'
  if (t.includes('leeds') || outward.startsWith('LS')) return 'Leeds'
  if (t.includes('sheffield') || (outward.startsWith('S') && !outward.startsWith('SK') && !outward.startsWith('SM'))) return 'Sheffield'
  if (t.includes('liverpool') || (outward.startsWith('L') && !outward.startsWith('LS'))) return 'Liverpool'
  if (t.includes('birmingham') || t.includes('solihull') || t.includes('wolverhampton') ||
    (outward.startsWith('B') && !outward.startsWith('BR') && !outward.startsWith('BS'))) return 'Birmingham'
  if (t.includes('manchester') || t.includes('salford') || t.includes('stockport') ||
    outward.startsWith('M') || outward.startsWith('SK')) return 'Manchester'

  return 'London'
}

function estimateRent(propertyType: string, beds: number, cityAvgRent: number): number {
  const bedMultiplier: Record<number, number> = { 0: 0.55, 1: 0.75, 2: 1.00, 3: 1.35, 4: 1.70, 5: 2.10 }
  const isHmo = propertyType?.toLowerCase().includes('hmo')
  const multiplier = isHmo ? (beds * 0.55) : (bedMultiplier[beds] || 1)
  return Math.round(cityAvgRent * multiplier / 50) * 50
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

interface AttrResult {
  bedrooms: number | null
  bedroomsLabel: string
  bedroomsConfidence: number
  bedroomsInferred: boolean
  bathrooms: number | null
  bathroomsLabel: string
  bathroomsInferred: boolean
  tenure: string
  tenureLabel: string
  tenureInferred: boolean
  hasGarden: boolean | null
  gardenLabel: string
  gardenInferred: boolean
}

function normPropertyType(t: string): string {
  const tl = (t || '').toLowerCase()
  if (tl.includes('flat') || tl.includes('maisonette') || tl.includes('apartment')) return 'flat'
  if (tl.includes('semi')) return 'semi'
  if (tl.includes('detach')) return 'detached'
  return 'terraced'
}

function inferBedroomsFromArea(area: number, propertyType: string): { beds: number; confidence: number } {
  const t = normPropertyType(propertyType)
  if (t === 'flat') {
    if (area < 40)  return { beds: 0, confidence: 78 }
    if (area < 60)  return { beds: 1, confidence: 78 }
    if (area < 80)  return { beds: 2, confidence: 72 }
    if (area < 100) return { beds: 3, confidence: 65 }
    return          { beds: 4, confidence: 60 }
  }
  if (t === 'terraced') {
    if (area < 75)  return { beds: 2, confidence: 72 }
    if (area < 110) return { beds: 3, confidence: 78 }
    if (area < 140) return { beds: 4, confidence: 73 }
    return          { beds: 5, confidence: 65 }
  }
  if (t === 'semi') {
    if (area < 95)  return { beds: 3, confidence: 73 }
    if (area < 130) return { beds: 4, confidence: 72 }
    return          { beds: 5, confidence: 65 }
  }
  if (area < 120) return { beds: 4, confidence: 65 }
  if (area < 160) return { beds: 5, confidence: 65 }
  return          { beds: 6, confidence: 60 }
}

function bedroomConflictsWithArea(beds: number, area: number, propertyType: string): boolean {
  const t = normPropertyType(propertyType)
  if (t === 'flat') {
    if (area < 45  && beds > 1)  return true
    if (area > 95  && beds < 3)  return true
    if (area > 120 && beds < 4)  return true
  }
  if (t === 'terraced') {
    if (area < 65  && beds > 2)  return true
    if (area > 75  && beds < 3)  return true
    if (area > 110 && beds < 4)  return true
    if (area > 140 && beds < 5)  return true
  }
  if (t === 'semi') {
    if (area < 75  && beds > 3)  return true
    if (area > 95  && beds < 3)  return true
    if (area > 130 && beds < 4)  return true
  }
  if (t === 'detached') {
    if (area < 90  && beds > 4)  return true
    if (area > 120 && beds < 4)  return true
    if (area > 160 && beds < 5)  return true
  }
  return false
}

function enrichAttributes(
  prop: Record<string, unknown>,
  floorArea: number | null,
  postcode: string,
): AttrResult {
  const propertyType = String(prop.property_type || '')
  const t            = normPropertyType(propertyType)
  const statedBeds   = prop.bedrooms  != null ? Number(prop.bedrooms)  : null
  const statedBaths  = prop.bathrooms != null ? Number(prop.bathrooms) : null
  const statedTenure = String(prop.tenure || '').trim()
  const statedGarden = prop.has_garden

  let beds = statedBeds
  let bedroomsLabel      = beds != null ? String(beds) : 'Unknown'
  let bedroomsConfidence = 100
  let bedroomsInferred   = false

  if (floorArea && floorArea > 0) {
    if (beds == null) {
      const inf = inferBedroomsFromArea(floorArea, propertyType)
      beds = inf.beds
      bedroomsLabel      = inf.beds === 0 ? 'Est. Studio' : `Est. ${inf.beds}`
      bedroomsConfidence = inf.confidence
      bedroomsInferred   = true
    } else if (bedroomConflictsWithArea(beds, floorArea, propertyType)) {
      const inf = inferBedroomsFromArea(floorArea, propertyType)
      beds = inf.beds
      bedroomsLabel      = inf.beds === 0 ? 'Est. Studio' : `Est. ${inf.beds}`
      bedroomsConfidence = inf.confidence
      bedroomsInferred   = true
    }
  }

  let bathrooms      = statedBaths
  let bathroomsLabel = statedBaths != null ? String(statedBaths) : 'Unknown'
  let bathroomsInferred = false

  if (statedBaths == null) {
    const area = floorArea || 70
    let inf: number
    if      (area < 70)  inf = 1
    else if (area < 120) inf = t === 'flat' ? 1 : 2
    else                 inf = t === 'flat' ? 2 : t === 'detached' ? 3 : 2
    bathrooms      = inf
    bathroomsLabel = `Est. ${inf}`
    bathroomsInferred = true
  }

  let tenureLabel   = statedTenure || 'Unknown'
  let tenureInferred = false

  if (!statedTenure) {
    const out = postcode.toUpperCase().split(' ')[0]
    const newBuildLeaseholdPrefixes = ['M4','M15','M50','B1','B5','LS1','LS2']
    if (t === 'flat') {
      tenureLabel = 'Likely Leasehold'
    } else if (newBuildLeaseholdPrefixes.some(p => out.startsWith(p))) {
      tenureLabel = 'Likely Leasehold'
    } else {
      tenureLabel = 'Likely Freehold'
    }
    tenureInferred = true
  }

  let hasGarden: boolean | null = statedGarden === true ? true : statedGarden === false ? false : null
  let gardenLabel   = hasGarden === true ? 'Yes' : hasGarden === false ? 'No' : 'Unknown'
  let gardenInferred = false

  if (hasGarden === null) {
    if (t === 'flat') {
      hasGarden   = false
      gardenLabel = 'Likely No Garden'
    } else {
      hasGarden   = true
      gardenLabel = 'Likely Rear Garden'
    }
    gardenInferred = true
  }

  return {
    bedrooms: beds, bedroomsLabel, bedroomsConfidence, bedroomsInferred,
    bathrooms, bathroomsLabel, bathroomsInferred,
    tenure: tenureLabel, tenureLabel, tenureInferred,
    hasGarden, gardenLabel, gardenInferred,
  }
}

interface LaHpi { la: string; det: number; semi: number; ter: number; flat: number }
const LA_HPI: Record<string, LaHpi> = {
  'EN': { la:'Enfield',      det: 8.0, semi: 9.0, ter:10.0, flat: 2.0 },
  'RM': { la:'Havering',     det:10.0, semi:11.0, ter:12.0, flat: 4.0 },
  'DA': { la:'Bexley',       det: 9.0, semi:10.0, ter:11.0, flat: 3.5 },
  'IG': { la:'Redbridge',    det: 7.0, semi: 8.0, ter: 9.0, flat: 2.5 },
  'HA': { la:'Harrow',       det: 6.0, semi: 7.0, ter: 8.0, flat: 2.0 },
  'CR': { la:'Croydon',      det: 7.0, semi: 8.0, ter: 9.0, flat: 2.0 },
  'BR': { la:'Bromley',      det: 5.0, semi: 6.0, ter: 7.0, flat: 1.5 },
  'KT': { la:'Kingston',     det: 4.0, semi: 5.0, ter: 6.0, flat: 1.5 },
  'TW': { la:'Richmond',     det: 3.0, semi: 4.0, ter: 5.0, flat: 1.0 },
  'UB': { la:'Hillingdon',   det: 5.0, semi: 6.0, ter: 7.0, flat: 2.0 },
  'SM': { la:'Sutton',       det: 4.0, semi: 5.0, ter: 6.0, flat: 1.5 },
  'WD': { la:'Watford',      det: 6.0, semi: 7.0, ter: 8.0, flat: 2.5 },
  'N16': { la:'Stoke Newington',  det:22.0, semi:21.0, ter:20.0, flat: 3.0 },
  'N1':  { la:'Islington',        det:17.0, semi:16.0, ter:15.0, flat: 2.0 },
  'N4':  { la:'Finsbury Park',    det:18.0, semi:17.0, ter:16.0, flat: 2.5 },
  'N5':  { la:'Highbury',         det:18.0, semi:17.0, ter:16.0, flat: 2.5 },
  'N6':  { la:'Highgate',         det:14.0, semi:13.0, ter:12.0, flat: 2.0 },
  'N7':  { la:'Holloway',         det:17.0, semi:16.0, ter:15.0, flat: 2.0 },
  'N8':  { la:'Crouch End',       det:16.0, semi:15.0, ter:14.0, flat: 2.0 },
  'E8':  { la:'Hackney',          det:22.0, semi:21.0, ter:20.0, flat: 4.0 },
  'E9':  { la:'Homerton',         det:20.0, semi:19.0, ter:18.0, flat: 3.5 },
  'E2':  { la:'Bethnal Green',    det:20.0, semi:19.0, ter:18.0, flat: 3.5 },
  'E3':  { la:'Bow',              det:18.0, semi:17.0, ter:16.0, flat: 3.0 },
  'SE22':{ la:'East Dulwich',     det:18.0, semi:17.0, ter:16.0, flat: 2.5 },
  'SE15':{ la:'Peckham',          det:20.0, semi:19.0, ter:18.0, flat: 3.0 },
  'SE5': { la:'Camberwell',       det:18.0, semi:17.0, ter:16.0, flat: 2.5 },
  'SE24':{ la:'Herne Hill',       det:16.0, semi:15.0, ter:14.0, flat: 2.0 },
  'SW9': { la:'Brixton',          det:17.0, semi:16.0, ter:15.0, flat: 2.0 },
  'NW1': { la:'Camden',           det:14.0, semi:13.0, ter:12.0, flat: 1.5 },
  'NW3': { la:'Hampstead',        det:12.0, semi:11.0, ter:10.0, flat: 1.0 },
  'NW5': { la:'Kentish Town',     det:15.0, semi:14.0, ter:13.0, flat: 1.5 },
  'E':  { la:'East London',  det:18.0, semi:17.0, ter:16.0, flat: 3.0 },
  'N':  { la:'North London', det:17.0, semi:16.0, ter:15.0, flat: 2.0 },
  'SW': { la:'South West',   det:13.0, semi:12.0, ter:11.0, flat: 0.5 },
  'SE': { la:'South East',   det:16.0, semi:15.0, ter:14.0, flat: 2.0 },
  'W':  { la:'West London',  det:10.0, semi: 9.0, ter: 8.0, flat:-0.5 },
  'NW': { la:'North West',   det:13.0, semi:12.0, ter:11.0, flat: 1.0 },
  'EC': { la:'City',         det: 5.0, semi: 4.0, ter: 4.0, flat:-2.0 },
  'WC': { la:'West Central', det: 5.0, semi: 4.0, ter: 4.0, flat:-2.0 },
  'M':  { la:'Manchester',   det:35.0, semi:33.0, ter:32.0, flat:28.0 },
  'SK': { la:'Stockport',    det:28.0, semi:26.0, ter:25.0, flat:20.0 },
  'B':  { la:'Birmingham',   det:28.0, semi:27.0, ter:25.0, flat:20.0 },
  'L':  { la:'Liverpool',    det:34.0, semi:33.0, ter:32.0, flat:25.0 },
  'LS': { la:'Leeds',        det:29.0, semi:28.0, ter:27.0, flat:21.0 },
  'S':  { la:'Sheffield',    det:27.0, semi:26.0, ter:25.0, flat:19.0 },
  'NG': { la:'Nottingham',   det:25.0, semi:24.0, ter:23.0, flat:18.0 },
  'BS': { la:'Bristol',      det:22.0, semi:21.0, ter:20.0, flat:16.0 },
}

interface CalibBand {
  psqmMin: number
  psqmMax: number
  anchors: Partial<Record<'studio'|'1bed'|'2bed'|'3bed'|'4bed', { min:number; max:number }>>
}
const CALIBRATION: Record<string, CalibBand> = {
  'N16': { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:620000,max:800000},'3bed':{min:750000,max:960000},'4bed':{min:860000,max:1100000}} },
  'N1':  { psqmMin:8000, psqmMax:11000, anchors:{'2bed':{min:750000,max:950000},'3bed':{min:900000,max:1150000},'4bed':{min:1050000,max:1400000}} },
  'N4':  { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:620000,max:800000},'3bed':{min:750000,max:960000},'4bed':{min:870000,max:1100000}} },
  'N5':  { psqmMin:7500, psqmMax:10000, anchors:{'2bed':{min:670000,max:860000},'3bed':{min:810000,max:1020000},'4bed':{min:940000,max:1200000}} },
  'E8':  { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:600000,max:780000},'3bed':{min:720000,max:930000},'4bed':{min:840000,max:1080000}} },
  'E9':  { psqmMin:6500, psqmMax:9000,  anchors:{'2bed':{min:560000,max:730000},'3bed':{min:680000,max:880000},'4bed':{min:790000,max:1020000}} },
  'E2':  { psqmMin:7000, psqmMax:9500,  anchors:{'1bed':{min:380000,max:520000},'2bed':{min:580000,max:760000},'3bed':{min:700000,max:900000}} },
  'SE22':{ psqmMin:6500, psqmMax:8500,  anchors:{'2bed':{min:560000,max:720000},'3bed':{min:680000,max:860000},'4bed':{min:790000,max:1000000}} },
  'SE15':{ psqmMin:5500, psqmMax:7500,  anchors:{'2bed':{min:460000,max:620000},'3bed':{min:560000,max:740000},'4bed':{min:660000,max:860000}} },
  'SE5': { psqmMin:5500, psqmMax:7500,  anchors:{'2bed':{min:460000,max:620000},'3bed':{min:560000,max:740000}} },
  'SW9': { psqmMin:6000, psqmMax:8000,  anchors:{'2bed':{min:500000,max:660000},'3bed':{min:620000,max:800000},'4bed':{min:730000,max:940000}} },
  'NW1': { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:600000,max:780000},'3bed':{min:730000,max:940000},'4bed':{min:860000,max:1100000}} },
  'NW3': { psqmMin:8000, psqmMax:11000, anchors:{'3bed':{min:900000,max:1200000},'4bed':{min:1100000,max:1500000}} },
  'NW5': { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:600000,max:780000},'3bed':{min:730000,max:940000}} },
  'EN1': { psqmMin:4500, psqmMax:5800, anchors:{'2bed':{min:340000,max:420000},'3bed':{min:450000,max:560000},'4bed':{min:580000,max:700000}} },
  'EN2': { psqmMin:4800, psqmMax:6200, anchors:{'2bed':{min:370000,max:460000},'3bed':{min:490000,max:600000},'4bed':{min:620000,max:760000}} },
  'EN3': { psqmMin:4200, psqmMax:5600, anchors:{'2bed':{min:300000,max:380000},'3bed':{min:430000,max:530000},'4bed':{min:550000,max:670000}} },
  'EN4': { psqmMin:5200, psqmMax:6800, anchors:{'3bed':{min:550000,max:700000},'4bed':{min:700000,max:900000}} },
  'RM1': { psqmMin:4000, psqmMax:5200, anchors:{'2bed':{min:280000,max:360000},'3bed':{min:380000,max:480000}} },
  'RM3': { psqmMin:4200, psqmMax:5400, anchors:{'2bed':{min:290000,max:370000},'3bed':{min:400000,max:500000}} },
  'M1':  { psqmMin:3800, psqmMax:5500, anchors:{'studio':{min:110000,max:160000},'1bed':{min:160000,max:230000},'2bed':{min:230000,max:320000}} },
  'M14': { psqmMin:2800, psqmMax:4200, anchors:{'2bed':{min:200000,max:280000},'3bed':{min:250000,max:340000}} },
  'M20': { psqmMin:3000, psqmMax:4500, anchors:{'2bed':{min:220000,max:310000},'3bed':{min:280000,max:380000}} },
  'M21': { psqmMin:2900, psqmMax:4300, anchors:{'2bed':{min:210000,max:300000},'3bed':{min:265000,max:360000}} },
  'B1':  { psqmMin:3000, psqmMax:4500, anchors:{'1bed':{min:140000,max:200000},'2bed':{min:190000,max:270000}} },
  'B15': { psqmMin:3500, psqmMax:5200, anchors:{'2bed':{min:230000,max:330000},'3bed':{min:300000,max:420000}} },
  'B29': { psqmMin:2800, psqmMax:4000, anchors:{'2bed':{min:180000,max:250000},'3bed':{min:230000,max:310000}} },
  'L1':  { psqmMin:2500, psqmMax:3800, anchors:{'1bed':{min:100000,max:150000},'2bed':{min:150000,max:220000}} },
  'L15': { psqmMin:2200, psqmMax:3500, anchors:{'2bed':{min:140000,max:200000},'3bed':{min:180000,max:260000}} },
  'L18': { psqmMin:3000, psqmMax:4500, anchors:{'3bed':{min:230000,max:320000},'4bed':{min:300000,max:420000}} },
  'LS1': { psqmMin:2800, psqmMax:4200, anchors:{'1bed':{min:140000,max:200000},'2bed':{min:190000,max:270000}} },
  'LS6': { psqmMin:2500, psqmMax:3800, anchors:{'2bed':{min:180000,max:260000},'3bed':{min:220000,max:310000}} },
  'S1':  { psqmMin:2200, psqmMax:3500, anchors:{'1bed':{min:110000,max:165000},'2bed':{min:160000,max:230000}} },
  'S11': { psqmMin:2800, psqmMax:4200, anchors:{'2bed':{min:200000,max:280000},'3bed':{min:250000,max:350000}} },
  'NG1': { psqmMin:2200, psqmMax:3500, anchors:{'1bed':{min:110000,max:165000},'2bed':{min:155000,max:225000}} },
  'NG7': { psqmMin:2000, psqmMax:3200, anchors:{'2bed':{min:140000,max:200000},'3bed':{min:180000,max:250000}} },
  'BS1': { psqmMin:4000, psqmMax:6000, anchors:{'1bed':{min:240000,max:340000},'2bed':{min:320000,max:450000}} },
  'BS6': { psqmMin:4200, psqmMax:6500, anchors:{'2bed':{min:340000,max:480000},'3bed':{min:420000,max:580000}} },
}

interface ValuationResult {
  fairValue:      number
  lowValue:       number
  highValue:      number
  confidence:     number
  compsUsed:      number
  method:         string
  weightedPsqm:   number | null
}

function getTypicalFloorArea(propertyType: string): number {
  const t = (propertyType || '').toLowerCase()
  if (t.includes('flat') || t.includes('maisonette') || t.includes('apartment')) return 60
  if (t.includes('semi'))    return 88
  if (t.includes('terrace')) return 80
  if (t.includes('detached') && !t.includes('semi')) return 110
  return 80
}

function iqrFilter(vals: number[]): number[] {
  if (vals.length < 4) return vals
  const sorted = [...vals].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)]
  const q3 = sorted[Math.floor(sorted.length * 0.75)]
  const iqr = q3 - q1
  return vals.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr)
}

function weightedMedian(vals: number[], weights: number[]): number {
  const pairs = vals.map((v, i) => ({ v, w: weights[i] })).sort((a, b) => a.v - b.v)
  const total = pairs.reduce((s, p) => s + p.w, 0)
  let cumul = 0
  for (const p of pairs) {
    cumul += p.w
    if (cumul >= total / 2) return p.v
  }
  return pairs[pairs.length - 1].v
}

function scoreComp(
  comp: LrTransaction,
  subjectType: string,
  subjectArea: number,
  compArea: number,
  distanceScore: number,
  isEpcBacked: boolean,
): number {
  const typeScore    = normPropertyType(comp.type) === normPropertyType(subjectType) ? 1.0 : 0.3
  const areaDiff     = subjectArea > 0 ? Math.abs(compArea - subjectArea) / subjectArea : 0.3
  const areaScore    = Math.max(0, 1 - areaDiff * 2)
  const monthsAgo    = (Date.now() - new Date(comp.date).getTime()) / (30 * 24 * 3600 * 1000)
  const recencyScore = Math.max(0, 1 - monthsAgo / 24)
  const reliScore    = isEpcBacked ? 1.0 : 0.5
  return typeScore * 0.30 + areaScore * 0.25 + distanceScore * 0.20 + recencyScore * 0.15 + 1.0 * 0.05 + reliScore * 0.05
}

function calcFeatureAdj(
  epcRating: string,
  hasParking: boolean,
  hasGarden: boolean,
  tenure: string,
): number {
  let adj = 0
  if      (epcRating === 'A' || epcRating === 'B') adj += 1.5
  else if (epcRating === 'E') adj -= 2.0
  else if (epcRating === 'F') adj -= 4.0
  else if (epcRating === 'G') adj -= 5.0
  if (hasParking) adj += 2.0
  if (hasGarden)  adj += 1.5
  if (tenure.toLowerCase().includes('leasehold')) adj -= 2.0
  adj = Math.min(10, Math.max(-12, adj))
  return 1 + adj / 100
}

function getLaHpiGrowth(outcode: string, propertyType: string): number | null {
  const t = normPropertyType(propertyType)
  const candidates = [
    outcode,
    outcode.replace(/\d+$/, ''),
    outcode.slice(0, 2),
    outcode.slice(0, 1),
  ].filter((v, i, a) => v && a.indexOf(v) === i)

  for (const c of candidates) {
    const entry = LA_HPI[c]
    if (entry) {
      return t === 'flat' ? entry.flat
        : t === 'semi'     ? entry.semi
        : t === 'terraced' ? entry.ter
        : entry.det
    }
  }
  return null
}

function getCalibration(outcode: string): CalibBand | null {
  return CALIBRATION[outcode] || null
}

function getAnchor(calib: CalibBand, beds: number): { min: number; max: number } | null {
  const key = beds === 0 ? 'studio' : beds === 1 ? '1bed' : beds === 2 ? '2bed' : beds === 3 ? '3bed' : '4bed'
  return calib.anchors[key as keyof typeof calib.anchors] || null
}

async function calcValuation(
  prop: Record<string, unknown>,
  cityName: string,
  cityData: Record<string, number>,
  lrComps: LrTransaction[],
  epcData: Map<string, number>,
  apiKey: string,
): Promise<ValuationResult> {

  const subjectArea   = Number(prop.internal_area_sqm || prop.epc_floor_area || 0)
  const subjectType   = String(prop.property_type || '')
  const subjectBeds   = Number(prop.bedrooms || 2)
  const subjectTenure = String(prop.tenure || '')
  const subjectEpc    = String(prop.current_energy_rating || 'D')
  const hasParking    = Boolean(prop.has_parking)
  const hasGarden     = Boolean(prop.has_garden)
  const outcode       = String(prop.postcode || '').split(' ')[0]
  const lastSoldPrice = Number(prop.last_sold_price || 0)
  const lastSoldDate  = String(prop.last_sold_date || '')

  const featureAdj    = calcFeatureAdj(subjectEpc, hasParking, hasGarden, subjectTenure)
  const effectiveArea = subjectArea > 0 ? subjectArea : estimateFloorArea(subjectBeds, subjectType)
  const annualRate    = Math.max(0.005, (cityData.capitalGrowth5yr / 5) / 100)
  const now           = Date.now()

  const calib  = getCalibration(outcode)
  const anchor = calib ? getAnchor(calib, subjectBeds) : null

  let l1Value: number | null = null
  let l1Comps = 0
  let l1StrongComps = 0
  let weightedPsqm: number | null = null

  if (lrComps.length >= 2) {
    const subjectNorm  = normPropertyType(subjectType)
    const sameType     = lrComps.filter(c => normPropertyType(c.type) === subjectNorm)
    const workingComps = sameType.length >= 2 ? sameType : lrComps
    const rawEntries: { psqm: number; weight: number; sameType: boolean }[] = []

    for (const c of workingComps) {
      const yearsAgo   = (now - new Date(c.date).getTime()) / (365.25 * 24 * 3600 * 1000)
      const adjPrice   = c.price * Math.pow(1 + annualRate, Math.max(0, yearsAgo))
      const addrKey    = c.address.trim().split(/[\s,]/)[0].toLowerCase()
      const compArea   = epcData.get(addrKey) || getTypicalFloorArea(c.type)
      const isEpcBkd   = epcData.has(addrKey)
      const psqm       = adjPrice / compArea
      if (psqm > 500 && psqm < 30000) {
        const w = scoreComp(c, subjectType, effectiveArea, compArea, 1.0, isEpcBkd)
        rawEntries.push({ psqm, weight: w, sameType: normPropertyType(c.type) === subjectNorm })
      }
    }

    if (rawEntries.length >= 2) {
      const filteredPsqm    = iqrFilter(rawEntries.map(e => e.psqm))
      const filteredEntries = rawEntries.filter(e => filteredPsqm.includes(e.psqm))
      const psqmVals = filteredEntries.map(e =>
        calib ? Math.min(calib.psqmMax * 1.15, Math.max(calib.psqmMin * 0.85, e.psqm)) : e.psqm
      )
      const median = weightedMedian(psqmVals, filteredEntries.map(e => e.weight))
      weightedPsqm  = Math.round(median)
      l1Value       = Math.round(median * effectiveArea * featureAdj)
      l1Comps       = filteredEntries.length
      l1StrongComps = filteredEntries.filter(e => e.sameType).length
    }
  }

  let l2Value: number | null = null

  if (outcode) {
    try {
      const trendsUrl = `https://api.homedata.co.uk/api/price_trends/${encodeURIComponent(outcode)}/`
      const res = await fetch(trendsUrl, { headers: { Authorization: `Api-Key ${apiKey}` }, cache: 'no-store' })
      if (res.ok) {
        const td = await res.json()
        const monthlyPrices: Record<string, unknown>[] = (
          td?.monthly_average_prices ||
          td?.data?.monthly_average_prices ||
          td?.results?.monthly_average_prices || []
        )
        const prices = monthlyPrices.slice(-12)
          .map(m => Number(m.average_price ?? m.avg_price ?? m.price ?? m.value ?? 0))
          .filter(p => p > 50000)
        if (prices.length >= 3) {
          const avgDistrict = prices.reduce((s, p) => s + p, 0) / prices.length
          const psqm = avgDistrict / getTypicalFloorArea(subjectType)
          l2Value = Math.round(psqm * effectiveArea * featureAdj)
        }
      }
    } catch (e) {
      console.error('Homedata price_trends error:', e)
    }
  }

  let l3Value: number | null = null

  if (lastSoldPrice > 0 && lastSoldDate) {
    const laGrowth5yr = getLaHpiGrowth(outcode, subjectType)
    if (laGrowth5yr != null) {
      const soldYear     = Number(lastSoldDate.slice(0, 4))
      const yearsHeld    = Math.max(0, 2026 - soldYear)
      const annualLaRate = laGrowth5yr / 5 / 100
      l3Value = Math.round(lastSoldPrice * Math.pow(1 + annualLaRate, yearsHeld) * featureAdj)
    }
  }

  let l4Value: number | null = null

  const cityByBed = MARKET_DATA.cityByBedroom[cityName as keyof typeof MARKET_DATA.cityByBedroom]
  const bedKey    = subjectBeds === 0 ? 'studio' : subjectBeds === 1 ? '1bed' : subjectBeds === 2 ? '2bed' : subjectBeds === 3 ? '3bed' : '4bed'
  const bedData   = cityByBed?.[bedKey as keyof typeof cityByBed]
  let cityBedAvg  = bedData?.avgPrice || (cityData.avgPrice as number) || 0

  if (cityName === 'London' && cityBedAvg > 0) {
    const outerFar   = ['EN','RM','DA','IG']
    const outerMid   = ['CR','BR','KT','TW','UB','HA','WD','SM']
    const innerPrime = ['N1','N4','N5','N6','N7','N8','N16','E1','E2','E3','E8','E9',
                        'SW1','SW3','SW6','SW7','SW10','W1','W2','W8','W11',
                        'SE1','SE5','SE15','SE22','SE24','NW1','NW3','NW5']
    if      (outerFar.some(p => outcode.startsWith(p)))   cityBedAvg = Math.round(cityBedAvg * 0.65)
    else if (outerMid.some(p => outcode.startsWith(p)))   cityBedAvg = Math.round(cityBedAvg * 0.72)
    else if (innerPrime.includes(outcode))                 cityBedAvg = Math.round(cityBedAvg * 1.20)
    else                                                   cityBedAvg = Math.round(cityBedAvg * 1.08)
  }

  if (cityBedAvg > 0) l4Value = Math.round(cityBedAvg * featureAdj)

  const l1Weight = l1StrongComps >= 3 ? 0.75 : l1StrongComps >= 2 ? 0.60 : 0.50

  const layers = [
    { val: l1Value, w: l1Weight },
    { val: l2Value, w: 0.20    },
    { val: l3Value, w: 0.20    },
    { val: l4Value, w: 0.10    },
  ].filter(l => l.val !== null && l.val > 0) as { val: number; w: number }[]

  if (layers.length === 0) {
    return { fairValue: 0, lowValue: 0, highValue: 0, confidence: 0, compsUsed: 0, method: 'none', weightedPsqm: null }
  }

  const totalW = layers.reduce((s, l) => s + l.w, 0)
  let hybrid   = layers.reduce((s, l) => s + l.val * (l.w / totalW), 0)

  if (anchor && l1Value === null) {
    if (hybrid > anchor.max * 1.20 || hybrid < anchor.min * 0.80) {
      const mid = (anchor.min + anchor.max) / 2
      hybrid = hybrid * 0.70 + mid * 0.30
    }
  }

  const fair = Math.round(hybrid / 1000) * 1000

  const hasL1 = l1Value !== null
  const hasL2 = l2Value !== null
  const hasL3 = l3Value !== null
  const confidence = Math.min(92, Math.max(25,
    (hasL1 ? 35 + Math.min(l1StrongComps * 5, 25) : 0) +
    (hasL2 && hasL1 ? 8 : hasL2 ? 15 : 0) +
    (hasL3 ? 10 : 0) +
    (!hasL1 && !hasL2 && !hasL3 ? 25 : 0) +
    (subjectArea > 0 ? 5 : 0) +
    (calib ? 2 : 0)
  ))

  const spread = confidence >= 80 ? 0.05 : confidence >= 65 ? 0.07 : 0.10
  const activeLayers = [hasL1&&'L1', hasL2&&'L2', hasL3&&'L3', hasL1||hasL2||hasL3?'L4':false].filter(Boolean).join('+')

  console.log(
    `Valuation v1.0: £${fair.toLocaleString()} | ` +
    `L1=${l1Value?.toLocaleString()||'—'}(${l1StrongComps}st+${l1Comps}c) ` +
    `L2=${l2Value?.toLocaleString()||'—'} L3=${l3Value?.toLocaleString()||'—'} L4=${l4Value?.toLocaleString()||'—'} | ` +
    `${confidence}% conf | psqm=${weightedPsqm||'—'} | ${fair}`
  )

  return {
    fairValue:    fair,
    lowValue:     Math.round(fair * (1 - spread) / 1000) * 1000,
    highValue:    Math.round(fair * (1 + spread) / 1000) * 1000,
    confidence,
    compsUsed:    l1Comps,
    method:       `4layer_hybrid_${activeLayers}_${confidence}pct`,
    weightedPsqm,
  }
}

function estimateFloorArea(beds: number, type: string): number {
  const t    = (type || '').toLowerCase()
  const base: Record<number, number> = { 0: 35, 1: 50, 2: 70, 3: 90, 4: 115, 5: 140 }
  const area = base[Math.min(beds, 5)] || 70
  if (t.includes('detached') && !t.includes('semi')) return Math.round(area * 1.2)
  return area
}

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
      cache: 'no-store',
      signal: abortAfter(8000),
    })
    if (!res.ok) {
      console.log(`EPC API: ${res.status} for ${postcode}`)
      return empty
    }

    const data = await res.json()
    const cols = (data['column-names'] || []) as string[]
    const rows = (data.rows || []) as string[][]

    const col = (name: string) => cols.indexOf(name)
    const addrIdx   = col('address1')
    const areaIdx   = col('total-floor-area')
    const ratingIdx = col('current-energy-rating')
    const scoreIdx  = col('current-energy-efficiency')
    const potRatIdx = col('potential-energy-rating')
    const potScoIdx = col('potential-energy-efficiency')
    const dateIdx   = col('lodgement-date')
    const inspIdx   = col('inspection-date')

    const subjectToken = subjectAddress.trim().split(/[\s,]/)[0].toLowerCase().replace(/\D/g, '') ||
                         subjectAddress.trim().split(/[\s,]/)[0].toLowerCase()

    const floorAreas = new Map<string, number>()
    let subjectEpc: Record<string, unknown> | null = null
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

interface LrTransaction {
  price:   number
  date:    string
  type:    string
  address: string
}

function abortAfter(ms: number): AbortSignal {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), ms)
  return ctrl.signal
}

async function fetchLrData(
  postcode: string,
  address: string,
): Promise<{ history: LrTransaction[]; comps: LrTransaction[] }> {
  const empty = { history: [], comps: [] }
  if (!postcode) return empty

  try {
    const url = `https://landregistry.data.gov.uk/data/ppi/address.json?postcode=${encodeURIComponent(postcode)}&_pageSize=50`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) return empty

    const data      = await res.json()
    const addresses: Record<string, unknown>[] = (data?.result as Record<string, unknown>)?.items || []
    console.log(`LR: ${addresses.length} addresses in ${postcode}`)

    const houseNumber = address.trim().split(' ')[0].replace(/\D/g, '')
    const twoYearsAgo = new Date(Date.now() - 730 * 24 * 3600 * 1000).toISOString().slice(0, 10)

    const fetchAddrTxns = async (addr: Record<string, unknown>): Promise<{ paon: string; isSubject: boolean; txns: LrTransaction[] }> => {
      const paon      = String(addr.paon || '')
      const addrUrl   = String(addr._about || '').replace(/^http:\/\//i, 'https://')
      const isSubject = Boolean(houseNumber && paon && paon.includes(houseNumber))
      if (!addrUrl) return { paon, isSubject, txns: [] }

      try {
        const txRes = await fetch(`${addrUrl}.json`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: abortAfter(7000),
        })
        if (!txRes.ok) return { paon, isSubject, txns: [] }

        const txData   = await txRes.json()
        const topic    = (txData?.result as Record<string, unknown>)?.primaryTopic as Record<string, unknown>
        const rawDates = topic?.soldDate
        if (!rawDates) return { paon, isSubject, txns: [] }

        const list = Array.isArray(rawDates) ? rawDates : [rawDates]
        const txns: LrTransaction[] = list
          .filter(Boolean)
          .map((tx: unknown) => ({
            price:   Number((tx as Record<string, unknown>).pricePaid || 0),
            date:    String((tx as Record<string, unknown>).transactionDate || ''),
            type:    String((tx as Record<string, unknown>).propertyType || '').split('/').pop() || '',
            address: paon,
          }))
          .filter(t => t.price > 0)

        return { paon, isSubject, txns }
      } catch {
        return { paon, isSubject, txns: [] }
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
