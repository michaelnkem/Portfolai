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

      const prop = property || { uprn, full_address: `UPRN ${uprn}`, address: `UPRN ${uprn}` }

      const cityName = detectCity(
        String((prop as Record<string, unknown>).town_name || ''),
        String((prop as Record<string, unknown>).postcode || '')
      )
      const cityData = MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities]
        || MARKET_DATA.cities.London

      const propRecord = prop as Record<string, unknown>
      const postcode = String(propRecord.postcode || '')

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

      // ── LAND REGISTRY TRANSACTION HISTORY ────────────────────────────────────
      const lrHistory = await fetchLrHistory(
        postcode,
        String(propRecord.full_address || propRecord.address || ''),
        String(propRecord.property_type || '')
      )

      const lrLastSold = lrHistory.length > 0 ? lrHistory[0] : null
      const lastSoldPrice = lrLastSold ? lrLastSold.price : price
      const lastSoldDate = lrLastSold ? lrLastSold.date : String(propRecord.last_sold_date || '')

      const allTransactions = lrHistory.length > 0
        ? lrHistory.map(t => ({ price: t.price, date: t.date, transaction_type: t.type }))
        : (transactions || []).slice(0, 20)

      // ── GROWTH PLAN COMPARABLE VALUATION ENGINE ───────────────────────────────
      // Uses Homedata /api/comparables/ — available on Growth plan
      // Fetches real nearby sold prices with actual EPC floor areas
      // RICS/AVM weighted £/sqm methodology
      const valuation = await calcComparableValuation(
        uprn,
        propRecord,
        epc,
        cityData,
        process.env.HOMEDATA_API_KEY!
      )

      const grossYield = price ? calcGrossYield(price, estimatedRent) : 0
      const netYield = price ? calcNetYield(
        price, estimatedRent,
        defaults.serviceCharge, defaults.groundRent,
        defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
      ) : 0

      const floodRisk = (risks || []).find((r: Record<string, unknown>) => r.risk_type === 'flood_rivers_sea')

      return NextResponse.json({
        uprn,
        property: {
          ...prop,
          last_sold_price: lastSoldPrice,
          last_sold_date: lastSoldDate,
        },
        epc,
        transactions: allTransactions,
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
          valuationMethod: valuation.method,
          valuationPsm: valuation.psm,
          grossYield,
          netYield,
          netMonthly: price ? calcNetMonthlyIncome(
            price, estimatedRent,
            defaults.serviceCharge, defaults.groundRent,
            defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
          ) : 0,
          capitalGrowth: cityData.capitalGrowth1yr,
          totalROI: parseFloat((netYield + cityData.capitalGrowth1yr).toFixed(1)),
          floodRisk: floodRisk ? String((floodRisk as Record<string, unknown>).label) : 'Unknown',
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
  console.log('Homedata search keys:', Object.keys(data), 'count:', data.count)
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
  const t = (town || '').toLowerCase()
  const pc = (postcode || '').toUpperCase().trim()
  const outward = pc.split(' ')[0]
  const londonPrefixes = ['EC','WC','SW','SE','NW','W1','W2','W3','W4','W5','W6','W7','W8','W9','N1','N2','N3','N4','N5','N6','N7','N8','N9','E1','E2','E3','E4','E5','E6','E7','E8','E9','BR','CR','DA','EN','HA','IG','KT','RM','SM','TW','UB','WD']
  const londonSinglePrefixes = ['E','N','W']
  if (t.includes('london') || londonPrefixes.some(p => outward.startsWith(p)) || londonSinglePrefixes.some(p => outward.startsWith(p) && outward.length >= 2)) return 'London'
  if (t.includes('bristol') || outward.startsWith('BS')) return 'Bristol'
  if (t.includes('nottingham') || outward.startsWith('NG')) return 'Nottingham'
  if (t.includes('leeds') || outward.startsWith('LS')) return 'Leeds'
  if (t.includes('sheffield') || (outward.startsWith('S') && !outward.startsWith('SK') && !outward.startsWith('SM'))) return 'Sheffield'
  if (t.includes('liverpool') || (outward.startsWith('L') && !outward.startsWith('LS'))) return 'Liverpool'
  if (t.includes('birmingham') || t.includes('solihull') || t.includes('wolverhampton') || (outward.startsWith('B') && !outward.startsWith('BR') && !outward.startsWith('BS'))) return 'Birmingham'
  if (t.includes('manchester') || t.includes('salford') || t.includes('stockport') || outward.startsWith('M') || outward.startsWith('SK')) return 'Manchester'
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

function estimateFloorArea(beds: number, type: string): number {
  const t = type.toLowerCase()
  const base: Record<number, number> = { 0: 35, 1: 50, 2: 70, 3: 90, 4: 115, 5: 140 }
  const area = base[Math.min(beds, 5)] || 70
  return t.includes('detached') && !t.includes('semi') ? Math.round(area * 1.2) : area
}

// ── VALUATION RESULT INTERFACE ────────────────────────────────────────────────
interface ValuationResult {
  fairValue: number
  lowValue: number
  highValue: number
  confidence: number
  compsUsed: number
  method: string
  psm: number
}

// ── GROWTH PLAN COMPARABLE VALUATION ENGINE ───────────────────────────────────
// Calls Homedata /api/comparables/ — Growth plan required
// Each comparable includes: sold_price, epc_floor_area, property_type, distance, date
// Methodology: weighted £/sqm → base value → EPC/feature adjustments → range
async function calcComparableValuation(
  uprn: string,
  prop: Record<string, unknown>,
  epc: Record<string, unknown> | null,
  cityData: Record<string, number>,
  apiKey: string
): Promise<ValuationResult> {

  // Subject property attributes
  // Prefer EPC floor area (actual surveyor measurement) over Homedata estimate
  const epcFloorArea = epc
    ? Number(epc.total_floor_area || epc.totalFloorArea || epc.epc_floor_area || 0)
    : 0
  const homedataArea = Number(prop.internal_area_sqm || prop.epc_floor_area || 0)
  const subjectArea  = epcFloorArea > 0 ? epcFloorArea : homedataArea

  const subjectType   = String(prop.property_type || '').toLowerCase()
  const subjectBeds   = Number(prop.bedrooms || 2)
  const subjectTenure = String(prop.tenure || '').toLowerCase()
  const subjectEpc    = String(
    epc?.current_energy_rating ||
    prop.current_energy_rating ||
    'D'
  ).trim().toUpperCase().charAt(0) || 'D'
  const hasParking    = Boolean(prop.has_parking)
  const hasGarden     = Boolean(prop.has_garden)
  const postcode      = String(prop.postcode || '')
  const outcode       = postcode.split(' ')[0]

  // ── FALLBACK: city growth-rate ────────────────────────────────────────────────
  const fallback = (reason: string): ValuationResult => {
    console.log(`Valuation fallback: ${reason}`)
    const price = Number(prop.last_sold_price || 0)
    if (!price) return { fairValue: 0, lowValue: 0, highValue: 0, confidence: 0, compsUsed: 0, method: 'none', psm: 0 }
    const soldYear  = Number(String(prop.last_sold_date || '2015').slice(0, 4))
    const yearsHeld = Math.max(0, 2026 - soldYear)
    const annualRate = Math.max(0.01, Math.min(0.08, (cityData.capitalGrowth5yr / 5) / 100))
    const fair = Math.round(price * Math.pow(1 + annualRate, yearsHeld))
    return {
      fairValue: fair,
      lowValue: Math.round(fair * 0.95),
      highValue: Math.round(fair * 1.05),
      confidence: 40,
      compsUsed: 0,
      method: 'growth_rate_fallback',
      psm: 0,
    }
  }

  if (!uprn || !outcode) return fallback('no uprn or outcode')

  try {
    // ── CALL HOMEDATA COMPARABLES ENDPOINT ────────────────────────────────────
    // Growth plan endpoint — returns nearby sold properties with floor areas
    // Docs: /api/comparables/?reference_uprn={uprn}&radius={m}&count={n}&event_type=sale
    const cutoffDate = new Date()
    cutoffDate.setMonth(cutoffDate.getMonth() - 18)
    const cutoffStr = cutoffDate.toISOString().slice(0, 10)

    // Map property type to Homedata's expected type string
    const typeParam = subjectType.includes('flat') || subjectType.includes('apartment') ? 'Flat'
      : subjectType.includes('semi') ? 'Semi-Detached'
      : subjectType.includes('terrace') ? 'Terraced'
      : subjectType.includes('detached') || subjectType.includes('bungalow') ? 'Detached'
      : ''

    const params = new URLSearchParams({
      reference_uprn: uprn,
      radius: '1600',       // 1 mile in metres
      count: '25',
      start_date: cutoffStr,
      event_type: 'sale',
    })
    if (typeParam) params.set('property_type', typeParam)

    console.log(`Comparables: /api/comparables/?${params}`)

    const compRes = await fetch(
      `https://api.homedata.co.uk/api/comparables/?${params}`,
      {
        headers: { Authorization: `Api-Key ${apiKey}` },
        cache: 'no-store',
      }
    )

    if (!compRes.ok) {
      const errText = await compRes.text()
      console.log(`Comparables failed: ${compRes.status} — ${errText.slice(0, 200)}`)
      return fallback(`comparables API ${compRes.status}`)
    }

    const compData = await compRes.json()

    // Homedata may return results in different keys — handle both
    const rawComps: Record<string, unknown>[] =
      compData.comparables ||
      compData.results ||
      compData.data ||
      []

    console.log(`Comparables: ${rawComps.length} results for ${uprn} (${outcode})`)

    if (rawComps.length < 2) {
      return fallback(`only ${rawComps.length} comparables returned`)
    }

    // ── SCORE AND FILTER COMPARABLES ──────────────────────────────────────────
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
      const soldPrice  = Number(c.sold_let_price || c.last_sold_price || c.price || 0)
      // Prefer actual EPC floor area from comparable — this is the key Growth plan advantage
      const compEpcArea = Number(c.epc_floor_area || c.internal_area_sqm || c.total_floor_area || 0)
      const floorArea  = compEpcArea > 0 ? compEpcArea : 0
      const soldDate   = String(c.sold_let_date || c.last_sold_date || c.date || '')
      const distanceM  = Number(c.distance_meters || c.distance_m || c.distance || 999)
      const compBeds   = Number(c.bedrooms || 0)
      const compType   = String(c.property_type || '').toLowerCase()

      // Must have actual floor area for accurate £/sqm — this is the core of the Growth plan advantage
      // Without floor area we cannot calculate a reliable £/sqm
      if (!soldPrice || !floorArea || soldPrice < 10000 || floorArea < 20) continue

      const pricePerSqm = soldPrice / floorArea

      // Sanity check — reject clear outliers
      if (pricePerSqm < 500 || pricePerSqm > 30000) continue

      // ── WEIGHTED SIMILARITY SCORING ──────────────────────────────────────────
      // Size similarity (35%) — actual floor area comparison
      const effectiveSubjectArea = subjectArea > 0 ? subjectArea : estimateFloorArea(subjectBeds, subjectType)
      const areaRatio = Math.min(effectiveSubjectArea, floorArea) / Math.max(effectiveSubjectArea, floorArea)
      const sizeSimilarity = areaRatio // 0–1, 1 = identical size

      // Distance (25%) — closer = higher score, 1600m = 0
      const distanceScore = Math.max(0, 1 - distanceM / 1600)

      // Recency (25%) — more recent = higher score
      const soldMs = soldDate ? new Date(soldDate).getTime() : now - 86400000 * 365
      const ageMs = now - soldMs
      const maxAgeMs = 18 * 30 * 86400000
      const recencyScore = Math.max(0, 1 - ageMs / maxAgeMs)

      // Property match (15%) — bedrooms and type
      const bedDiff = subjectBeds > 0 && compBeds > 0 ? Math.abs(subjectBeds - compBeds) : 1
      const typeMatch = typeParam
        ? compType.includes(typeParam.toLowerCase().split('-')[0]) ? 1 : 0.5
        : 0.75
      const propertyMatch = (bedDiff === 0 ? 1 : bedDiff === 1 ? 0.7 : 0.4) * typeMatch

      const score =
        (sizeSimilarity * 0.35) +
        (distanceScore  * 0.25) +
        (recencyScore   * 0.25) +
        (propertyMatch  * 0.15)

      scored.push({ pricePerSqm, soldPrice, floorArea, score, distanceM, beds: compBeds })
    }

    if (scored.length < 2) {
      return fallback(`only ${scored.length} valid comps after filtering (need floor area data)`)
    }

    // ── WEIGHTED £/SQM ────────────────────────────────────────────────────────
    const totalScore  = scored.reduce((s, c) => s + c.score, 0)
    const weightedPsm = scored.reduce((s, c) => s + c.pricePerSqm * c.score, 0) / totalScore

    console.log(`Weighted £/sqm: £${Math.round(weightedPsm)} from ${scored.length} comps (avg distance ${Math.round(scored.reduce((s, c) => s + c.distanceM, 0) / scored.length)}m)`)

    // ── BASE VALUE ────────────────────────────────────────────────────────────
    // Use EPC floor area if available — most accurate
    // Fall back to Homedata area, then bedroom-count estimate
    const effectiveArea = subjectArea > 0
      ? subjectArea
      : estimateFloorArea(subjectBeds, subjectType)

    const baseValue = Math.round(weightedPsm * effectiveArea)

    // ── FEATURE ADJUSTMENTS ───────────────────────────────────────────────────
    let adjustment = 1.0

    // EPC rating adjustment
    if      (subjectEpc === 'A' || subjectEpc === 'B') adjustment += 0.025
    else if (subjectEpc === 'C')                        adjustment += 0.01
    else if (subjectEpc === 'E')                        adjustment -= 0.02
    else if (subjectEpc === 'F')                        adjustment -= 0.04
    else if (subjectEpc === 'G')                        adjustment -= 0.06

    // Parking adds value
    if (hasParking) adjustment += 0.03

    // Garden adds value
    if (hasGarden) adjustment += 0.02

    // Leasehold slight discount
    if (subjectTenure.includes('leasehold')) adjustment -= 0.015

    const adjustedValue = Math.round(baseValue * adjustment)

    // ── CONFIDENCE SCORE ──────────────────────────────────────────────────────
    let confidence = 55

    // More comps = more confidence
    if (scored.length >= 5)  confidence += 10
    if (scored.length >= 10) confidence += 8
    if (scored.length >= 15) confidence += 5

    // Actual floor area = more confidence (Growth plan advantage)
    if (subjectArea > 0 && epcFloorArea > 0) confidence += 12 // EPC actual area
    else if (subjectArea > 0)                confidence += 6  // Homedata area

    // Close comparables = more confidence
    const avgDistance = scored.reduce((s, c) => s + c.distanceM, 0) / scored.length
    if (avgDistance < 400) confidence += 8
    else if (avgDistance < 800) confidence += 4

    // Bed-matched comps = more confidence
    if (scored.some(c => c.beds === subjectBeds)) confidence += 5

    confidence = Math.min(92, Math.max(50, confidence))

    // ── VALUATION RANGE ───────────────────────────────────────────────────────
    // Tighter range for higher confidence
    const spread    = confidence >= 80 ? 0.04 : confidence >= 70 ? 0.06 : 0.08
    const lowValue  = Math.round(adjustedValue * (1 - spread) / 1000) * 1000
    const highValue = Math.round(adjustedValue * (1 + spread) / 1000) * 1000
    const fairValue = Math.round(adjustedValue / 1000) * 1000

    console.log(`Valuation: £${fairValue.toLocaleString()} | ${scored.length} comps | £${Math.round(weightedPsm)}/sqm | ${effectiveArea}sqm | ${confidence}% confidence | method: comparables_psm`)

    return {
      fairValue,
      lowValue,
      highValue,
      confidence,
      compsUsed: scored.length,
      method: 'homedata_comparables_psm',
      psm: Math.round(weightedPsm),
    }

  } catch (e) {
    console.error('Valuation engine error:', e)
    return fallback(`exception: ${String(e).slice(0, 100)}`)
  }
}

// ── LAND REGISTRY TRANSACTION HISTORY ────────────────────────────────────────
interface LrTransaction {
  price: number
  date: string
  type: string
  address: string
}

async function fetchLrHistory(
  postcode: string,
  address: string,
  _propertyType: string
): Promise<LrTransaction[]> {
  if (!postcode) return []
  try {
    const url = `http://landregistry.data.gov.uk/data/ppi/address.json?postcode=${encodeURIComponent(postcode)}&_pageSize=50`
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    const addresses: Record<string, unknown>[] = (data?.result as Record<string, unknown>)?.items || []
    console.log(`LR history: ${addresses.length} addresses for postcode ${postcode}`)
    const houseNumber = address.trim().split(' ')[0].replace(/\D/g, '')
    const results: LrTransaction[] = []
    for (const addr of addresses) {
      const paon = String(addr.paon || '')
      if (houseNumber && paon && !paon.includes(houseNumber)) continue
      const addrUrl = String(addr._about || '')
      if (!addrUrl) continue
      try {
        const txRes = await fetch(`${addrUrl}.json`, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
        if (!txRes.ok) continue
        const txData = await txRes.json()
        const topic = (txData?.result as Record<string, unknown>)?.primaryTopic as Record<string, unknown>
        const soldDates = topic?.soldDate
        if (!soldDates) continue
        const txList = Array.isArray(soldDates) ? soldDates : [soldDates]
        for (const tx of txList) {
          if (!tx) continue
          const price = Number((tx as Record<string, unknown>).pricePaid || 0)
          const date  = String((tx as Record<string, unknown>).transactionDate || '')
          const type  = String((tx as Record<string, unknown>).propertyType || '').split('/').pop() || ''
          if (price > 0) results.push({ price, date, type, address: paon })
        }
      } catch { continue }
    }
    results.sort((a, b) => b.date.localeCompare(a.date))
    return results
  } catch (e) {
    console.error('LR history error:', e)
    return []
  }
}
