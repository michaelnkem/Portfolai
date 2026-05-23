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

      // ── ATTRIBUTE RECOVERY v1.0 ────────────────────────────────────────────────
      const resolvedEpcR = resolvedEpc as Record<string, unknown> | null
      // Always check EPC Open Data subject first — Homedata EPC often lacks total_floor_area
      const epcOpenSub   = epcOpenData.subjectEpc as Record<string, unknown> | null
      const epcFloorAreaN = Number(
        epcOpenSub?.total_floor_area ||      // EPC Open Data register — highest priority
        resolvedEpcR?.epc_floor_area ||      // Homedata EpcData field
        resolvedEpcR?.total_floor_area ||    // EPC Open Data via resolvedEpc
        propRecord.internal_area_sqm || propRecord.epc_floor_area || 0
      )
      const epcFloorArea = epcFloorAreaN > 0 ? epcFloorAreaN : null
      const attrs = enrichAttributes(propRecord, epcFloorArea, postcode)

      // Pass resolved floor area and bedrooms into valuation — always override Homedata 0-values
      const valuationProp = {
        ...propRecord,
        last_sold_price: lastSoldPrice,
        last_sold_date:  lastSoldDate,
        ...(epcFloorArea ? { epc_floor_area: epcFloorArea } : {}),
        ...(attrs.bedrooms != null ? { bedrooms: attrs.bedrooms } : {}),
      }

      // ── HYBRID VALUATION ENGINE v1.0 ───────────────────────────────────────────
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

      const floodRisk  = (risks || []).find((r: Record<string,unknown>) => r.risk_type === 'flood_rivers_sea')

      // EPC rating: efficiency score → letter; fallback to letter from EPC Open Data or property record
      const epcScore = Number(resolvedEpcR?.current_energy_efficiency ?? 0)
      const epcRating = epcScore > 0
        ? efficiencyToRating(epcScore)
        : resolvedEpcR?.current_energy_rating
          ? String(resolvedEpcR.current_energy_rating)
          : epcOpenSub?.current_energy_rating
            ? String(epcOpenSub.current_energy_rating)
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

// ── Address search ────────────────────────────────────────────────────────────
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

  if (outward.startsWith('NE') || outward.startsWith('SR') || outward.startsWith('TS') ||
      outward.startsWith('DL') || outward.startsWith('DH')) return 'Sheffield'
  if (outward.startsWith('WA') || outward.startsWith('CH') || outward.startsWith('PR') ||
      outward.startsWith('BB') || outward.startsWith('FY') || outward.startsWith('WN') ||
      outward.startsWith('LA')) return 'Manchester'
  if (outward.startsWith('BD') || outward.startsWith('HX') || outward.startsWith('WF') ||
      outward.startsWith('YO') || outward.startsWith('HU') || outward.startsWith('DN')) return 'Leeds'
  if (outward.startsWith('CV') || outward.startsWith('LE') || outward.startsWith('DE') ||
      outward.startsWith('NN') || outward.startsWith('MK') || outward.startsWith('PE') ||
      outward.startsWith('WV') || outward.startsWith('WS') || outward.startsWith('WR')) return 'Birmingham'
  if (outward.startsWith('SO') || outward.startsWith('PO') || outward.startsWith('BN')) return 'Bristol'
  if (outward.startsWith('CF') || outward.startsWith('SA') || outward.startsWith('NP') ||
      outward.startsWith('LL') || outward.startsWith('LD') || outward.startsWith('SY')) return 'Bristol'
  if (outward.startsWith('RG') || outward.startsWith('SL') || outward.startsWith('HP') ||
      outward.startsWith('LU') || outward.startsWith('GU') || outward.startsWith('RH') ||
      outward.startsWith('TN') || outward.startsWith('CT') || outward.startsWith('ME') ||
      outward.startsWith('CB') || outward.startsWith('IP') || outward.startsWith('NR') ||
      outward.startsWith('CO') || outward.startsWith('OX')) return 'London'
  if ((outward.startsWith('G') && !outward.startsWith('GU')) ||
      outward.startsWith('EH') || outward.startsWith('AB') || outward.startsWith('DD') ||
      outward.startsWith('PA') || outward.startsWith('KA') || outward.startsWith('KY') ||
      outward.startsWith('FK') || outward.startsWith('PH') || outward.startsWith('IV')) return 'Leeds'

  if (t.includes('london'))     return 'London'
  if (t.includes('manchester') || t.includes('salford') || t.includes('stockport')) return 'Manchester'
  if (t.includes('birmingham') || t.includes('solihull') || t.includes('wolverhampton')) return 'Birmingham'
  if (t.includes('liverpool'))  return 'Liverpool'
  if (t.includes('leeds'))      return 'Leeds'
  if (t.includes('sheffield'))  return 'Sheffield'
  if (t.includes('bristol'))    return 'Bristol'
  if (t.includes('nottingham')) return 'Nottingham'
  if (t.includes('bradford') || t.includes('wakefield') || t.includes('york') || t.includes('hull')) return 'Leeds'
  if (t.includes('newcastle') || t.includes('sunderland') || t.includes('middlesbrough')) return 'Sheffield'
  if (t.includes('glasgow') || t.includes('edinburgh') || t.includes('aberdeen')) return 'Leeds'
  if (t.includes('cardiff') || t.includes('swansea') || t.includes('newport')) return 'Bristol'

  const londonPrefixes = [
    'EC','WC','SW','SE','NW',
    'W1','W2','W3','W4','W5','W6','W7','W8','W9',
    'N1','N2','N3','N4','N5','N6','N7','N8','N9',
    'E1','E2','E3','E4','E5','E6','E7','E8','E9',
    'BR','CR','DA','EN','HA','IG','KT','RM','SM','TW','UB','WD',
  ]
  if (londonPrefixes.some(p => outward.startsWith(p))) return 'London'
  if (['E','N','W'].some(p => outward === p || (outward.startsWith(p) && /^[ENW]\d/.test(outward)))) return 'London'

  if (outward.startsWith('BS')) return 'Bristol'
  if (outward.startsWith('NG')) return 'Nottingham'
  if (outward.startsWith('LS')) return 'Leeds'
  if (outward.startsWith('SK')) return 'Manchester'
  if (outward.startsWith('L') && !outward.startsWith('LS') && !outward.startsWith('LL') && !outward.startsWith('LD')) return 'Liverpool'
  if (outward.startsWith('B') && !outward.startsWith('BR') && !outward.startsWith('BS') && !outward.startsWith('BB') && !outward.startsWith('BN')) return 'Birmingham'
  if (outward.startsWith('M')) return 'Manchester'
  if (outward.startsWith('S') && !outward.startsWith('SK') && !outward.startsWith('SM')) return 'Sheffield'

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

// ── ATTRIBUTE RECOVERY ENGINE v1.0 ───────────────────────────────────────────
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

function inferBedroomsFromArea(area: number, propertyType: string, isEnfield = false): { beds: number; confidence: number } {
  const t = normPropertyType(propertyType)
  if (t === 'flat') {
    if (area < 40)  return { beds: 0, confidence: 78 }
    if (area < 60)  return { beds: 1, confidence: 78 }
    if (area < 80)  return { beds: 2, confidence: 72 }
    if (area < 100) return { beds: 3, confidence: 65 }
    return          { beds: 4, confidence: 60 }
  }
  if (t === 'terraced') {
    // Enfield terraced houses are typically larger family homes — tighter thresholds
    if (isEnfield) {
      if (area < 70)  return { beds: 2, confidence: 75 }
      if (area < 100) return { beds: 3, confidence: 78 }
      if (area < 140) return { beds: 4, confidence: 73 }
      return          { beds: 5, confidence: 65 }
    }
    if (area < 75)  return { beds: 2, confidence: 72 }
    if (area < 110) return { beds: 3, confidence: 78 }
    if (area < 140) return { beds: 4, confidence: 73 }
    return          { beds: 5, confidence: 65 }
  }
  if (t === 'semi') {
    if (isEnfield) {
      if (area < 90)  return { beds: 3, confidence: 73 }
      if (area < 135) return { beds: 4, confidence: 72 }
      return          { beds: 5, confidence: 65 }
    }
    if (area < 95)  return { beds: 3, confidence: 73 }
    if (area < 130) return { beds: 4, confidence: 72 }
    return          { beds: 5, confidence: 65 }
  }
  // detached
  if (area < 120) return { beds: 4, confidence: 65 }
  if (area < 160) return { beds: 5, confidence: 65 }
  return          { beds: 6, confidence: 60 }
}

function bedroomConflictsWithArea(beds: number, area: number, propertyType: string, isEnfield = false): boolean {
  const t = normPropertyType(propertyType)
  if (t === 'flat') {
    if (area < 45  && beds > 1)  return true
    if (area > 95  && beds < 3)  return true
    if (area > 120 && beds < 4)  return true
  }
  if (t === 'terraced') {
    if (isEnfield) {
      if (area < 65   && beds > 2)  return true
      if (area >= 70  && beds < 3)  return true
      if (area >= 100 && beds < 4)  return true
      if (area >= 140 && beds < 5)  return true
    } else {
      if (area < 65  && beds > 2)  return true
      if (area > 75  && beds < 3)  return true
      if (area > 110 && beds < 4)  return true
      if (area > 140 && beds < 5)  return true
    }
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
  // Detect Enfield (EN1/EN2/EN3 and any EN outward code) for Enfield-specific inference
  const pcNorm       = postcode.replace(/\s+/g, '').toUpperCase()
  const isEnfield    = /^EN\d/.test(pcNorm)
  // Homedata returns 0 for unknown bedrooms — treat 0 as null so inference can run
  const statedBeds   = (prop.bedrooms != null && Number(prop.bedrooms) > 0) ? Number(prop.bedrooms) : null
  const statedBaths  = prop.bathrooms != null ? Number(prop.bathrooms) : null
  const statedTenure = String(prop.tenure || '').trim()
  const statedGarden = prop.has_garden

  let beds = statedBeds
  let bedroomsLabel      = beds != null ? String(beds) : 'Unknown'
  let bedroomsConfidence = 100
  let bedroomsInferred   = false

  if (floorArea && floorArea > 0) {
    if (beds == null) {
      const inf = inferBedroomsFromArea(floorArea, propertyType, isEnfield)
      beds = inf.beds
      bedroomsLabel      = inf.beds === 0 ? 'Studio' : String(inf.beds)
      bedroomsConfidence = inf.confidence
      bedroomsInferred   = true
    } else if (bedroomConflictsWithArea(beds, floorArea, propertyType, isEnfield)) {
      const inf = inferBedroomsFromArea(floorArea, propertyType, isEnfield)
      beds = inf.beds
      bedroomsLabel      = inf.beds === 0 ? 'Studio' : String(inf.beds)
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
    bathroomsLabel = String(inf)
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
      hasGarden  = false
      gardenLabel = 'Likely No Garden'
    } else {
      hasGarden  = true
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

// ── HYBRID VALUATION ENGINE v1.0 ─────────────────────────────────────────────
interface LaHpi { la: string; det: number; semi: number; ter: number; flat: number }
const LA_HPI: Record<string, LaHpi> = {
  // Outer London
  'EN': { la:'Enfield',      det:20.0, semi:22.0, ter:21.0, flat: 8.0 },
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
  // Inner London — specific districts
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
  // Inner London — generic prefix fallbacks
  'E':  { la:'East London',  det:18.0, semi:17.0, ter:16.0, flat: 3.0 },
  'N':  { la:'North London', det:17.0, semi:16.0, ter:15.0, flat: 2.0 },
  'SW': { la:'South West',   det:13.0, semi:12.0, ter:11.0, flat: 0.5 },
  'SE': { la:'South East',   det:16.0, semi:15.0, ter:14.0, flat: 2.0 },
  'W':  { la:'West London',  det:10.0, semi: 9.0, ter: 8.0, flat:-0.5 },
  'NW': { la:'North West',   det:13.0, semi:12.0, ter:11.0, flat: 1.0 },
  'EC': { la:'City',         det: 5.0, semi: 4.0, ter: 4.0, flat:-2.0 },
  'WC': { la:'West Central', det: 5.0, semi: 4.0, ter: 4.0, flat:-2.0 },
  // Northern England
  'M':  { la:'Manchester',   det:35.0, semi:33.0, ter:32.0, flat:28.0 },
  'SK': { la:'Stockport',    det:28.0, semi:26.0, ter:25.0, flat:20.0 },
  'B':  { la:'Birmingham',   det:28.0, semi:27.0, ter:25.0, flat:20.0 },
  'L':  { la:'Liverpool',    det:34.0, semi:33.0, ter:32.0, flat:25.0 },
  'LS': { la:'Leeds',        det:29.0, semi:28.0, ter:27.0, flat:21.0 },
  'S':  { la:'Sheffield',    det:27.0, semi:26.0, ter:25.0, flat:19.0 },
  'NG': { la:'Nottingham',   det:25.0, semi:24.0, ter:23.0, flat:18.0 },
  'BS': { la:'Bristol',      det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  // Yorkshire
  'BD': { la:'Bradford',     det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'HX': { la:'Halifax',      det:17.0, semi:16.0, ter:15.0, flat:12.0 },
  'WF': { la:'Wakefield',    det:19.0, semi:18.0, ter:17.0, flat:13.0 },
  'YO': { la:'York',         det:24.0, semi:23.0, ter:22.0, flat:18.0 },
  'HU': { la:'Hull',         det:22.0, semi:21.0, ter:20.0, flat:15.0 },
  'DN': { la:'Doncaster',    det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  // East / West Midlands
  'DE': { la:'Derby',        det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'LE': { la:'Leicester',    det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'CV': { la:'Coventry',     det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  'NN': { la:'Northampton',  det:17.0, semi:16.0, ter:15.0, flat:11.0 },
  'MK': { la:'Milton Keynes',det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'PE': { la:'Peterborough', det:19.0, semi:18.0, ter:17.0, flat:13.0 },
  'WV': { la:'Wolverhampton',det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'WS': { la:'Walsall',      det:19.0, semi:18.0, ter:17.0, flat:13.0 },
  // North East England
  'NE': { la:'Newcastle',    det:25.0, semi:24.0, ter:23.0, flat:18.0 },
  'SR': { la:'Sunderland',   det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'TS': { la:'Teesside',     det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'DL': { la:'Darlington',   det:17.0, semi:16.0, ter:15.0, flat:11.0 },
  'DH': { la:'Durham',       det:16.0, semi:15.0, ter:14.0, flat:10.0 },
  // North West extras
  'WA': { la:'Warrington',   det:27.0, semi:26.0, ter:25.0, flat:20.0 },
  'CH': { la:'Chester',      det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  'PR': { la:'Preston',      det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  'BB': { la:'Blackburn',    det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'FY': { la:'Blackpool',    det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'LA': { la:'Lancaster',    det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'WN': { la:'Wigan',        det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  // South England
  'SO': { la:'Southampton',  det:14.0, semi:13.0, ter:12.0, flat: 8.0 },
  'PO': { la:'Portsmouth',   det:12.0, semi:11.0, ter:10.0, flat: 7.0 },
  'BN': { la:'Brighton',     det:10.0, semi: 9.0, ter: 8.0, flat: 4.0 },
  'RG': { la:'Reading',      det:12.0, semi:11.0, ter:10.0, flat: 6.0 },
  'OX': { la:'Oxford',       det: 8.0, semi: 7.0, ter: 6.0, flat: 2.0 },
  'SL': { la:'Slough',       det:10.0, semi: 9.0, ter: 8.0, flat: 4.0 },
  'HP': { la:'Hemel/Wycombe',det:10.0, semi: 9.0, ter: 8.0, flat: 4.0 },
  'LU': { la:'Luton',        det:14.0, semi:13.0, ter:12.0, flat: 8.0 },
  'GU': { la:'Guildford',    det: 6.0, semi: 5.0, ter: 4.0, flat: 1.0 },
  'RH': { la:'Redhill',      det: 8.0, semi: 7.0, ter: 6.0, flat: 2.0 },
  'TN': { la:'Tunbridge',    det: 7.0, semi: 6.0, ter: 5.0, flat: 1.0 },
  'CT': { la:'Canterbury',   det:10.0, semi: 9.0, ter: 8.0, flat: 4.0 },
  'ME': { la:'Medway',       det:12.0, semi:11.0, ter:10.0, flat: 6.0 },
  'CB': { la:'Cambridge',    det: 6.0, semi: 5.0, ter: 4.0, flat: 0.0 },
  'IP': { la:'Ipswich',      det:14.0, semi:13.0, ter:12.0, flat: 8.0 },
  'NR': { la:'Norwich',      det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'CO': { la:'Colchester',   det:13.0, semi:12.0, ter:11.0, flat: 7.0 },
  // Scotland
  'G':  { la:'Glasgow',      det:30.0, semi:28.0, ter:27.0, flat:22.0 },
  'EH': { la:'Edinburgh',    det:28.0, semi:26.0, ter:25.0, flat:20.0 },
  'AB': { la:'Aberdeen',     det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'DD': { la:'Dundee',       det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'PA': { la:'Paisley',      det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  'KA': { la:'Kilmarnock',   det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'KY': { la:'Kirkcaldy',    det:16.0, semi:15.0, ter:14.0, flat:10.0 },
  'FK': { la:'Falkirk',      det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'PH': { la:'Perth',        det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'IV': { la:'Inverness',    det:12.0, semi:11.0, ter:10.0, flat: 7.0 },
  // Wales
  'CF': { la:'Cardiff',      det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'SA': { la:'Swansea',      det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'NP': { la:'Newport',      det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'LL': { la:'N Wales',      det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'SY': { la:'Shrewsbury',   det:14.0, semi:13.0, ter:12.0, flat: 8.0 },
  'LD': { la:'Mid Wales',    det:12.0, semi:11.0, ter:10.0, flat: 6.0 },
}

interface CalibBand {
  psqmMin: number
  psqmMax: number
  anchors: Partial<Record<'studio'|'1bed'|'2bed'|'3bed'|'4bed', { min:number; max:number }>>
}
const CALIBRATION: Record<string, CalibBand> = {
  // Inner London
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
  // Outer London — Enfield districts
  'EN1': { psqmMin:4500, psqmMax:5800, anchors:{'2bed':{min:340000,max:420000},'3bed':{min:450000,max:560000},'4bed':{min:580000,max:700000}} },
  'EN2': { psqmMin:4800, psqmMax:6200, anchors:{'2bed':{min:370000,max:460000},'3bed':{min:490000,max:600000},'4bed':{min:620000,max:760000}} },
  'EN3': { psqmMin:4200, psqmMax:5600, anchors:{'2bed':{min:300000,max:380000},'3bed':{min:430000,max:530000},'4bed':{min:550000,max:670000}} },
  'EN4': { psqmMin:5200, psqmMax:6800, anchors:{'3bed':{min:550000,max:700000},'4bed':{min:700000,max:900000}} },
  'RM1': { psqmMin:4000, psqmMax:5200, anchors:{'2bed':{min:280000,max:360000},'3bed':{min:380000,max:480000}} },
  'RM3': { psqmMin:4200, psqmMax:5400, anchors:{'2bed':{min:290000,max:370000},'3bed':{min:400000,max:500000}} },
  // Northern cities
  'M1':  { psqmMin:3800, psqmMax:5500, anchors:{'studio':{min:110000,max:160000},'1bed':{min:160000,max:230000},'2bed':{min:230000,max:320000}} },
  'M14': { psqmMin:2800, psqmMax:4200, anchors:{'2bed':{min:200000,max:280000},'3bed':{min:250000,max:340000}} },
  'M20': { psqmMin:3000, psqmMax:4500, anchors:{'2bed':{min:220000,max:310000},'3bed':{min:280000,max:380000}} },
  'M21': { psqmMin:2900, psqmMax:4300, anchors:{'2bed':{min:
