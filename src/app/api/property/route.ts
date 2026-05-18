import { NextRequest, NextResponse } from 'next/server'
import {
  searchAddress, getProperty, getEpc, getTransactions, getRisks
} from '@/lib/homedata'
import { MARKET_DATA, calcGrossYield, calcNetYield, calcNetMonthlyIncome } from '@/lib/market-data'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')
  const uprn = searchParams.get('uprn')

  if (!process.env.HOMEDATA_API_KEY) {
    return NextResponse.json({ error: 'HOMEDATA_API_KEY not configured' }, { status: 500 })
  }

  // Phase 1: address search — returns suggestions list
  if (q && !uprn) {
    try {
      const raw = await searchAddressRaw(q)
      // Normalise whatever Homedata returns into a consistent shape
      const suggestions = normalise(raw)
      return NextResponse.json({ suggestions })
    } catch (e) {
      console.error('Search error:', e)
      return NextResponse.json({ suggestions: [] })
    }
  }

  // Phase 2: full property fetch by UPRN
  if (uprn) {
    try {
      const [property, epc, transactions, risks] = await Promise.all([
        getProperty(uprn),
        getEpc(uprn).catch(() => null),
        getTransactions(uprn).catch(() => []),
        getRisks(uprn).catch(() => []),
      ])

      // Build a property object even if the API returned minimal data
      const prop = property || { uprn, full_address: `UPRN ${uprn}`, address: `UPRN ${uprn}` }

      const cityName = detectCity(
        String((prop as Record<string,unknown>).town_name || ''),
        String((prop as Record<string,unknown>).postcode || '')
      )
      const cityData = MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities]
        || MARKET_DATA.cities.London

      const propRecord = prop as Record<string, unknown>
      const postcode = String(propRecord.postcode || '')
      const outcode = postcode.split(' ')[0] // e.g. "EN3" from "EN3 5NX"

      const defaults = {
        serviceCharge: String(propRecord.property_type || '').toLowerCase().includes('flat') ? 2000 : 0,
        groundRent: String(propRecord.tenure || '').toLowerCase().includes('leasehold') ? 200 : 0,
        managementFee: 10,
        maintenanceAllowance: 1.5,
        voidWeeks: 2,
      }

      const estimatedRent = estimateRent(
        String(propRecord.property_type || ''),
        Number(propRecord.bedrooms || 1),
        cityData.avgRent,
      )

      const price = Number(propRecord.last_sold_price || 0)

      // ── COMPARABLE-BASED VALUATION ENGINE ────────────────────────────────────
      // Methodology: weighted £/sqm from comparable sold prices
      // Based on RICS/AVM methodology from valuation instructions
      const valuation = await calcComparableValuation(
        uprn,
        propRecord,
        cityData,
        process.env.HOMEDATA_API_KEY!
      )

      const grossYield = price ? calcGrossYield(price, estimatedRent) : 0
      const netYield = price ? calcNetYield(
        price, estimatedRent,
        defaults.serviceCharge, defaults.groundRent,
        defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
      ) : 0

      const floodRisk = (risks || []).find((r: Record<string,unknown>) => r.risk_type === 'flood_rivers_sea')

      return NextResponse.json({
        uprn,
        property: prop,
        epc,
        transactions: (transactions || []).slice(0, 20),
        risks: risks || [],
        cityData,
        cityName,
        enriched: {
          estimatedRent,
          estimatedCurrentValue: valuation.fairValue,
          valuationLow: valuation.lowValue,
          valuationHigh: valuation.highValue,
          valuationConfidence: valuation.confidence,
          valuationCompsUsed: valuation.compsUsed,
          grossYield,
          netYield,
          netMonthly: price ? calcNetMonthlyIncome(
            price, estimatedRent,
            defaults.serviceCharge, defaults.groundRent,
            defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
          ) : 0,
          capitalGrowth: cityData.capitalGrowth1yr,
          totalROI: parseFloat((netYield + cityData.capitalGrowth1yr).toFixed(1)),
          floodRisk: floodRisk ? String((floodRisk as Record<string,unknown>).label) : 'Unknown',
          epcRating: epc?.current_energy_efficiency
            ? efficiencyToRating(epc.current_energy_efficiency)
            : String(propRecord.current_energy_rating || 'Unknown'),
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

// ── Raw address search ────────────────────────────────────────────────────────
// Public endpoint — no API key needed. Returns suggestions[]{uprn, address, postcode, town}
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

// ── Normalise Homedata suggestions into consistent shape ──────────────────────
// Homedata returns: { suggestions: [{uprn, address, postcode, town}], count }
// We normalise to: { uprn, full_address, address, postcode }
function normalise(raw: unknown): Array<{ uprn: string; full_address: string; address: string; postcode: string }> {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>

  let items: unknown[] = []

  if (Array.isArray(obj)) {
    items = obj
  } else if (Array.isArray(obj.suggestions)) {
    items = obj.suggestions as unknown[]
  } else if (Array.isArray(obj.results)) {
    items = obj.results as unknown[]
  } else if (Array.isArray(obj.addresses)) {
    items = obj.addresses as unknown[]
  } else if (Array.isArray(obj.data)) {
    items = obj.data as unknown[]
  }

  return items
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const i = item as Record<string, unknown>
      const uprn = String(i.uprn ?? i.UPRN ?? i.id ?? '')
      // Homedata uses "address" field — combine with town for full address
      const address = String(i.address ?? i.full_address ?? i.display_address ?? i.line1 ?? '')
      const town = String(i.town ?? i.town_name ?? '')
      const postcode = String(i.postcode ?? i.post_code ?? '')
      // Build full address: "14 DOWNING STREET, LONDON, SW1A 2AA"
      const full_address = address || `${town} ${postcode}`.trim()
      return { uprn, full_address, address: full_address, postcode }
    })
    .filter(s => s.uprn && s.full_address)
}


function detectCity(town: string, postcode: string): string {
  const t = (town || '').toLowerCase()
  const pc = (postcode || '').toUpperCase().trim()

  // Extract outward code (first part before space e.g. "SW1A" from "SW1A 1AA")
  const outward = pc.split(' ')[0]

  // London MUST be checked first — its prefixes overlap with other cities
  // London outward codes: E, EC, N, NW, SE, SW, W, WC, BR, CR, DA, EN, HA, IG, KT, RM, SM, TN, TW, UB, WD
  const londonPrefixes = ['EC','WC','SW','SE','NW','W1','W2','W3','W4','W5','W6','W7','W8','W9','N1','N2','N3','N4','N5','N6','N7','N8','N9','E1','E2','E3','E4','E5','E6','E7','E8','E9','BR','CR','DA','EN','HA','IG','KT','RM','SM','TW','UB','WD']
  const londonSinglePrefixes = ['E','N','W']

  if (
    t.includes('london') ||
    londonPrefixes.some(p => outward.startsWith(p)) ||
    londonSinglePrefixes.some(p => outward.startsWith(p) && outward.length >= 2)
  ) return 'London'

  // Bristol — BS postcodes
  if (t.includes('bristol') || outward.startsWith('BS')) return 'Bristol'

  // Nottingham — NG postcodes
  if (t.includes('nottingham') || outward.startsWith('NG')) return 'Nottingham'

  // Leeds — LS postcodes (must be before Sheffield S check)
  if (t.includes('leeds') || outward.startsWith('LS')) return 'Leeds'

  // Sheffield — S postcodes (after Leeds LS check)
  if (t.includes('sheffield') || (outward.startsWith('S') && !outward.startsWith('SK') && !outward.startsWith('SM'))) return 'Sheffield'

  // Liverpool — L postcodes (must be before London check caught it)
  if (t.includes('liverpool') || (outward.startsWith('L') && !outward.startsWith('LS'))) return 'Liverpool'

  // Birmingham — B postcodes
  if (t.includes('birmingham') || t.includes('solihull') || t.includes('wolverhampton') ||
    (outward.startsWith('B') && !outward.startsWith('BR') && !outward.startsWith('BS'))) return 'Birmingham'

  // Manchester — M and SK postcodes
  if (t.includes('manchester') || t.includes('salford') || t.includes('stockport') ||
    outward.startsWith('M') || outward.startsWith('SK')) return 'Manchester'

  // Default — use London if postcode unrecognised (safer for unknown UK properties)
  return 'London'
}

function estimateRent(propertyType: string, beds: number, cityAvgRent: number): number {
  // Relative rent multipliers by bed count
  const bedMultiplier: Record<number, number> = {
    0: 0.55, // studio
    1: 0.75,
    2: 1.00,
    3: 1.35,
    4: 1.70,
    5: 2.10,
  }
  const isHmo = propertyType?.toLowerCase().includes('hmo')
  const multiplier = isHmo ? (beds * 0.55) : (bedMultiplier[beds] || 1)
  return Math.round(cityAvgRent * multiplier / 50) * 50 // round to £50
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

// ── COMPARABLE VALUATION ENGINE ───────────────────────────────────────────────
// Methodology: weighted £/sqm from comparable sold prices
// Based on RICS/AVM valuation methodology
interface ValuationResult {
  fairValue: number
  lowValue: number
  highValue: number
  confidence: number
  compsUsed: number
  method: string
}

async function calcComparableValuation(
  uprn: string,
  prop: Record<string, unknown>,
  cityData: Record<string, number>,
  apiKey: string
): Promise<ValuationResult> {

  const subjectArea   = Number(prop.internal_area_sqm || prop.epc_floor_area || 0)
  const subjectType   = String(prop.property_type || '').toLowerCase()
  const subjectBeds   = Number(prop.bedrooms || 2)
  const subjectTenure = String(prop.tenure || '').toLowerCase()
  const subjectEpc    = String(prop.current_energy_rating || 'D')
  const hasParking    = Boolean(prop.has_parking)
  const hasGarden     = Boolean(prop.has_garden)

  // ── FALLBACK: growth-rate method (used when comparables unavailable) ─────────
  const fallback = (): ValuationResult => {
    const price = Number(prop.last_sold_price || 0)
    if (!price) return { fairValue: 0, lowValue: 0, highValue: 0, confidence: 0, compsUsed: 0, method: 'none' }
    const soldYear = Number(String(prop.last_sold_date || '2015').slice(0, 4))
    const yearsHeld = Math.max(0, 2026 - soldYear)
    const annualRate = Math.max(0.01, Math.min(0.08, (cityData.capitalGrowth5yr / 5) / 100))
    const fair = Math.round(price * Math.pow(1 + annualRate, yearsHeld))
    return {
      fairValue: fair,
      lowValue: Math.round(fair * 0.95),
      highValue: Math.round(fair * 1.05),
      confidence: 45,
      compsUsed: 0,
      method: 'growth_rate_fallback',
    }
  }

  try {
    // ── FETCH COMPARABLES ──────────────────────────────────────────────────────
    // Filter to same property type, 18 month window, 1 mile radius
    const typeParam = subjectType.includes('flat') ? 'Flat'
      : subjectType.includes('detached') && !subjectType.includes('semi') ? 'Detached'
      : subjectType.includes('semi') ? 'Semi-Detached'
      : subjectType.includes('terrace') ? 'Terraced'
      : subjectType.includes('bungalow') ? 'Detached'
      : ''

    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - 18)
    const startDateStr = startDate.toISOString().slice(0, 10)

    const params = new URLSearchParams({
      reference_uprn: uprn,
      radius: '1600', // ~1 mile in metres
      count: '20',
      start_date: startDateStr,
      event_type: 'sale',
    })
    if (typeParam) params.set('property_type', typeParam)

    const compRes = await fetch(
      `https://api.homedata.co.uk/api/comparables/?${params}`,
      { headers: { Authorization: `Api-Key ${apiKey}` }, cache: 'no-store' }
    )

    if (!compRes.ok) {
      console.log('Comparables fetch failed:', compRes.status)
      return fallback()
    }

    const compData = await compRes.json()
    const rawComps: Record<string, unknown>[] = compData.comparables || compData.results || []

    if (rawComps.length < 2) {
      console.log(`Only ${rawComps.length} comparables — using fallback`)
      return fallback()
    }

    // ── SCORE & FILTER COMPARABLES ────────────────────────────────────────────
    const now = Date.now()

    interface ScoredComp {
      pricePerSqm: number
      soldPrice: number
      floorArea: number
      score: number
      distanceM: number
      beds: number
    }

    const scored: ScoredComp[] = []

    for (const c of rawComps) {
      const soldPrice = Number(c.sold_let_price || c.last_sold_price || 0)
      const floorArea = Number(c.epc_floor_area || c.internal_area_sqm || 0)
      const soldDate  = String(c.sold_let_date || c.last_sold_date || '')
      const distanceM = Number(c.distance_meters || c.distance_m || 999)
      const compBeds  = Number(c.bedrooms || 0)
      const compType  = String(c.property_type || '').toLowerCase()

      // Must have price and floor area for £/sqm calculation
      if (!soldPrice || !floorArea || soldPrice < 10000) continue

      // Exclude unlike property types
      const typeMatch =
        (subjectType.includes('flat') && compType.includes('flat')) ||
        (subjectType.includes('terrace') && compType.includes('terrace')) ||
        (subjectType.includes('semi') && compType.includes('semi')) ||
        (subjectType.includes('detached') && !subjectType.includes('semi') && compType.includes('detached') && !compType.includes('semi')) ||
        (subjectType.includes('bungalow') && compType.includes('bungalow'))

      if (!typeMatch && typeParam) continue

      const pricePerSqm = soldPrice / floorArea

      // Sanity check £/sqm — reject obvious outliers (< £500 or > £25,000)
      if (pricePerSqm < 500 || pricePerSqm > 25000) continue

      // ── SIMILARITY SCORING (matches the methodology from instructions) ───────
      // Size similarity (35%) — closer floor area = higher score
      const areaRatio = subjectArea > 0 ? Math.min(subjectArea, floorArea) / Math.max(subjectArea, floorArea) : 0.5
      const sizeSimilarity = areaRatio // 0–1

      // Distance (25%) — same street highest, 1 mile lowest
      const distanceScore = Math.max(0, 1 - distanceM / 1600)

      // Recency (25%) — more recent = higher score
      const soldMs = soldDate ? new Date(soldDate).getTime() : now - 86400000 * 365
      const ageMs = now - soldMs
      const maxAgeMs = 18 * 30 * 86400000
      const recencyScore = Math.max(0, 1 - ageMs / maxAgeMs)

      // Property match (15%) — beds, type
      const bedDiff = Math.abs(subjectBeds - compBeds)
      const propertyMatch = bedDiff === 0 ? 1 : bedDiff === 1 ? 0.7 : 0.4

      const score =
        (sizeSimilarity * 0.35) +
        (distanceScore  * 0.25) +
        (recencyScore   * 0.25) +
        (propertyMatch  * 0.15)

      scored.push({ pricePerSqm, soldPrice, floorArea, score, distanceM, beds: compBeds })
    }

    if (scored.length < 2) {
      console.log('Too few valid comps after filtering — using fallback')
      return fallback()
    }

    // ── WEIGHTED £/SQM ────────────────────────────────────────────────────────
    const totalScore   = scored.reduce((s, c) => s + c.score, 0)
    const weightedPsm  = scored.reduce((s, c) => s + c.pricePerSqm * c.score, 0) / totalScore

    // ── BASE VALUE ────────────────────────────────────────────────────────────
    // Use subject floor area if available, otherwise estimate from beds
    const effectiveArea = subjectArea > 0 ? subjectArea : estimateFloorArea(subjectBeds, subjectType)
    let baseValue = Math.round(weightedPsm * effectiveArea)

    // ── FEATURE ADJUSTMENTS ───────────────────────────────────────────────────
    let adjustment = 1.0

    // EPC adjustment
    if (subjectEpc === 'A' || subjectEpc === 'B') adjustment += 0.02
    else if (subjectEpc === 'E') adjustment -= 0.02
    else if (subjectEpc === 'F') adjustment -= 0.04
    else if (subjectEpc === 'G') adjustment -= 0.05

    // Parking
    if (hasParking) adjustment += 0.03

    // Garden
    if (hasGarden) adjustment += 0.02

    // Leasehold short lease risk (if leasehold, apply slight discount)
    if (subjectTenure.includes('leasehold')) adjustment -= 0.01

    const adjustedValue = Math.round(baseValue * adjustment)

    // ── CONFIDENCE SCORE ──────────────────────────────────────────────────────
    let confidence = 50
    if (scored.length >= 5)  confidence += 15
    if (scored.length >= 10) confidence += 10
    if (subjectArea > 0)     confidence += 15 // have actual floor area
    const avgDistance = scored.reduce((s, c) => s + c.distanceM, 0) / scored.length
    if (avgDistance < 400)   confidence += 10 // very local comps
    if (scored.some(c => c.beds === subjectBeds)) confidence += 5
    confidence = Math.min(92, confidence)

    // ── VALUATION RANGE ───────────────────────────────────────────────────────
    // Tighter range for higher confidence
    const spread = confidence >= 75 ? 0.04 : confidence >= 60 ? 0.06 : 0.08
    const lowValue  = Math.round(adjustedValue * (1 - spread) / 1000) * 1000
    const highValue = Math.round(adjustedValue * (1 + spread) / 1000) * 1000
    const fairValue = Math.round(adjustedValue / 1000) * 1000

    console.log(`Valuation: £${fairValue.toLocaleString()} (${scored.length} comps, ${confidence}% confidence, £${Math.round(weightedPsm)}/sqm)`)

    return { fairValue, lowValue, highValue, confidence, compsUsed: scored.length, method: 'comparable_psm' }

  } catch (e) {
    console.error('Valuation engine error:', e)
    return fallback()
  }
}

// Estimate floor area from beds when not provided
function estimateFloorArea(beds: number, type: string): number {
  const t = type.toLowerCase()
  const base: Record<number, number> = { 0: 35, 1: 50, 2: 70, 3: 90, 4: 115, 5: 140 }
  const area = base[Math.min(beds, 5)] || 70
  // Detached properties tend to be larger
  if (t.includes('detached') && !t.includes('semi')) return Math.round(area * 1.2)
  return area
}
