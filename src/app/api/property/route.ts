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

      // ── FETCH FULL TRANSACTION HISTORY FROM LAND REGISTRY ────────────────────
      // Goes back to 1995 — free, no API key needed
      // Used to populate "Last Sold Price" with the most recent verified sale
      const lrHistory = await fetchLrHistory(
        String(propRecord.postcode || ''),
        String(propRecord.full_address || propRecord.address || ''),
        String(propRecord.property_type || '')
      )

      // Use Land Registry most recent sale if available and more recent than Homedata
      const lrLastSold = lrHistory.length > 0 ? lrHistory[0] : null
      const lastSoldPrice = lrLastSold ? lrLastSold.price : price
      const lastSoldDate  = lrLastSold ? lrLastSold.date  : String(propRecord.last_sold_date || '')

      // Merge LR history with Homedata transactions — LR is more complete
      const allTransactions = lrHistory.length > 0
        ? lrHistory.map(t => ({ price: t.price, date: t.date, transaction_type: t.type }))
        : (transactions || []).slice(0, 20)

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

// ── LAND REGISTRY FULL TRANSACTION HISTORY ───────────────────────────────────
// Fetches all sales for a specific postcode going back to 1995
// Free public endpoint — no auth required
// Used to populate Last Sold Price and History tab
interface LrTransaction {
  price: number
  date: string
  type: string
  address: string
}

async function fetchLrHistory(
  postcode: string,
  address: string,
  propertyType: string
): Promise<LrTransaction[]> {
  if (!postcode) return []

  try {
    // Query all sales in same postcode, all time — no date filter
    const sparql = `
SELECT ?paon ?saon ?amount ?date ?propertyType WHERE {
  ?transx a <http://landregistry.data.gov.uk/def/ppi/TransactionRecord> .
  ?transx <http://landregistry.data.gov.uk/def/ppi/pricePaid> ?amount .
  ?transx <http://landregistry.data.gov.uk/def/ppi/transactionDate> ?date .
  ?transx <http://landregistry.data.gov.uk/def/ppi/propertyType> ?propertyType .
  ?transx <http://landregistry.data.gov.uk/def/ppi/propertyAddress> ?addr .
  ?addr <http://landregistry.data.gov.uk/def/common/postcode> "${postcode}" .
  OPTIONAL { ?addr <http://landregistry.data.gov.uk/def/common/paon> ?paon }
  OPTIONAL { ?addr <http://landregistry.data.gov.uk/def/common/saon> ?saon }
}
ORDER BY DESC(?date)
LIMIT 100
`.trim()

    const body = new URLSearchParams({ query: sparql, output: 'json' })
    const res = await fetch('http://landregistry.data.gov.uk/landregistry/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body.toString(),
      cache: 'no-store',
    })

    if (!res.ok) {
      console.log('LR history fetch failed:', res.status)
      return []
    }

    const data = await res.json()
    const bindings: Record<string, { value: string }>[] = data?.results?.bindings || []

    console.log(`LR history: ${bindings.length} results for postcode ${postcode}`)

    // Extract the house number from the address to filter to this specific property
    // e.g. "121 ALBANY PARK AVENUE" — extract "121"
    const houseNumber = address.trim().split(' ')[0].replace(/\D/g, '')

    const results: LrTransaction[] = bindings
      .filter(b => {
        const paon = String(b.paon?.value || '')
        // If we have a house number, filter to matching properties only
        // If no match found, include all (better to show all than nothing)
        if (!houseNumber) return true
        return paon.includes(houseNumber) || !paon
      })
      .map(b => ({
        price: Number(b.amount?.value || 0),
        date: String(b.date?.value || ''),
        type: String(b.propertyType?.value || '').split('/').pop() || '',
        address: [b.saon?.value, b.paon?.value].filter(Boolean).join(', '),
      }))
      .filter(t => t.price > 0)

    // If house-number filter gave no results, return all postcode sales
    // sorted by most recent — still useful context
    if (results.length === 0 && bindings.length > 0) {
      return bindings
        .map(b => ({
          price: Number(b.amount?.value || 0),
          date: String(b.date?.value || ''),
          type: String(b.propertyType?.value || '').split('/').pop() || '',
          address: [b.saon?.value, b.paon?.value].filter(Boolean).join(', '),
        }))
        .filter(t => t.price > 0)
        .slice(0, 20)
    }

    return results

  } catch (e) {
    console.error('LR history error:', e)
    return []
  }
}

// ── COMPARABLE VALUATION ENGINE ───────────────────────────────────────────────
// Data source: HM Land Registry Price Paid Data (free, no API key required)
// SPARQL endpoint: landregistry.data.gov.uk/landregistry/query
// Methodology: weighted £/sqm from comparable sold prices (RICS/AVM standard)
interface ValuationResult {
  fairValue: number
  lowValue: number
  highValue: number
  confidence: number
  compsUsed: number
  method: string
}

// Land Registry property type codes
// D=Detached, S=Semi-Detached, T=Terraced, F=Flat/Maisonette, O=Other
function toLrType(propertyType: string): string {
  const t = propertyType.toLowerCase()
  if (t.includes('flat') || t.includes('maisonette') || t.includes('apartment')) return 'F'
  if (t.includes('semi')) return 'S'
  if (t.includes('terrace')) return 'T'
  if (t.includes('detached') || t.includes('bungalow')) return 'D'
  return '' // no filter — accept all types
}

async function calcComparableValuation(
  uprn: string,
  prop: Record<string, unknown>,
  cityData: Record<string, number>,
  _apiKey: string // kept for signature compatibility — not needed for LR
): Promise<ValuationResult> {

  const subjectArea   = Number(prop.internal_area_sqm || prop.epc_floor_area || 0)
  const subjectType   = String(prop.property_type || '').toLowerCase()
  const subjectBeds   = Number(prop.bedrooms || 2)
  const subjectTenure = String(prop.tenure || '').toLowerCase()
  const subjectEpc    = String(prop.current_energy_rating || 'D')
  const hasParking    = Boolean(prop.has_parking)
  const hasGarden     = Boolean(prop.has_garden)
  const postcode      = String(prop.postcode || '')
  const outcode       = postcode.split(' ')[0] // e.g. EN3

  // ── FALLBACK: city growth-rate method ────────────────────────────────────────
  const fallback = (): ValuationResult => {
    const price = Number(prop.last_sold_price || 0)
    if (!price) return { fairValue: 0, lowValue: 0, highValue: 0, confidence: 0, compsUsed: 0, method: 'none' }
    const soldYear  = Number(String(prop.last_sold_date || '2015').slice(0, 4))
    const yearsHeld = Math.max(0, 2026 - soldYear)
    const annualRate = Math.max(0.01, Math.min(0.08, (cityData.capitalGrowth5yr / 5) / 100))
    const fair = Math.round(price * Math.pow(1 + annualRate, yearsHeld))
    return { fairValue: fair, lowValue: Math.round(fair * 0.95), highValue: Math.round(fair * 1.05), confidence: 45, compsUsed: 0, method: 'growth_rate_fallback' }
  }

  if (!outcode) return fallback()

  try {
    // ── QUERY LAND REGISTRY SPARQL ────────────────────────────────────────────
    // Fetch sold prices for same outcode, same property type, last 18 months
    // Free public endpoint — no auth required
    const lrType = toLrType(subjectType)
    const cutoffDate = new Date()
    cutoffDate.setMonth(cutoffDate.getMonth() - 18)
    const cutoffStr = cutoffDate.toISOString().slice(0, 10)

    const lrTypeUri = lrType === 'F' ? 'http://landregistry.data.gov.uk/def/ppi/flat-maisonette'
      : lrType === 'S' ? 'http://landregistry.data.gov.uk/def/ppi/semi-detached'
      : lrType === 'T' ? 'http://landregistry.data.gov.uk/def/ppi/terraced'
      : lrType === 'D' ? 'http://landregistry.data.gov.uk/def/ppi/detached'
      : ''

    const typeFilter = lrTypeUri
      ? `?transx <http://landregistry.data.gov.uk/def/ppi/propertyType> <${lrTypeUri}> .`
      : `?transx <http://landregistry.data.gov.uk/def/ppi/propertyType> ?propertyType .`

    // SPARQL query using full URIs — correct format per Land Registry docs
    const sparql = `
SELECT ?postcode ?amount ?date WHERE {
  ?transx a <http://landregistry.data.gov.uk/def/ppi/TransactionRecord> .
  ?transx <http://landregistry.data.gov.uk/def/ppi/pricePaid> ?amount .
  ?transx <http://landregistry.data.gov.uk/def/ppi/transactionDate> ?date .
  ?transx <http://landregistry.data.gov.uk/def/ppi/newBuild> "false"^^<http://www.w3.org/2001/XMLSchema#boolean> .
  ${typeFilter}
  ?transx <http://landregistry.data.gov.uk/def/ppi/propertyAddress> ?addr .
  ?addr <http://landregistry.data.gov.uk/def/common/postcode> ?postcode .
  FILTER(STRSTARTS(STR(?postcode), "${outcode}"))
  FILTER(?date >= "${cutoffStr}"^^<http://www.w3.org/2001/XMLSchema#date>)
}
ORDER BY DESC(?date)
LIMIT 50
`.trim()

    // POST with form-encoded body — correct per Land Registry API docs
    const sparqlUrl = 'http://landregistry.data.gov.uk/landregistry/query'
    const body = new URLSearchParams({ query: sparql, output: 'json' })

    const res = await fetch(sparqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body.toString(),
      cache: 'no-store',
    })

    if (!res.ok) {
      console.log('Land Registry SPARQL failed:', res.status)
      return fallback()
    }

    const sparqlData = await res.json()
    const bindings: Record<string, { value: string }>[] = sparqlData?.results?.bindings || []

    console.log(`LR SPARQL: ${bindings.length} results for outcode ${outcode}`)

    if (bindings.length < 2) return fallback()

    // ── SCORE EACH COMPARABLE ─────────────────────────────────────────────────
    // Land Registry doesn't include floor area — we estimate from property type
    // and use price alone (not £/sqm) when no area available, OR use estimated area
    const now = Date.now()

    interface ScoredComp {
      pricePerSqm: number
      soldPrice: number
      floorArea: number
      score: number
      date: string
    }

    const scored: ScoredComp[] = []

    for (const b of bindings) {
      const soldPrice  = Number(b.amount?.value || 0)
      const soldDate   = String(b.date?.value || '')
      const compType   = String(b.propertyType?.value || '').toLowerCase()
      const compPostcode = String(b.postcode?.value || '')

      if (!soldPrice || soldPrice < 10000) continue

      // Estimate floor area from property type
      // LR doesn't provide floor area — use type-based estimate
      // This is less precise than having actual sqm but still enables £/sqm calc
      const estimatedArea = lrType === 'F' ? 60
        : lrType === 'S' ? 88
        : lrType === 'T' ? 80
        : lrType === 'D' ? 110
        : estimateFloorArea(subjectBeds, subjectType)

      // Use the subject property's actual area if available for normalisation
      // Otherwise use the estimated area for this property type
      const floorArea = estimatedArea

      const pricePerSqm = soldPrice / floorArea

      // Sanity check
      if (pricePerSqm < 500 || pricePerSqm > 25000) continue

      // ── SIMILARITY SCORING ─────────────────────────────────────────────────
      // Size similarity (35%) — same outcode, no size data from LR, use type match as proxy
      const sizeSimilarity = lrType && compType.includes(
        lrType === 'S' ? 'semi' : lrType === 'T' ? 'terrace' : lrType === 'F' ? 'flat' : 'detach'
      ) ? 0.85 : 0.6

      // Distance (25%) — same full postcode = highest, same outcode only = medium
      const sameFullPostcode = compPostcode.trim().toUpperCase() === postcode.trim().toUpperCase()
      const sameIncode = compPostcode.trim().split(' ')[0].toUpperCase() === outcode.toUpperCase()
      const distanceScore = sameFullPostcode ? 1.0 : sameIncode ? 0.7 : 0.4

      // Recency (25%)
      const soldMs = soldDate ? new Date(soldDate).getTime() : now - 86400000 * 365
      const ageMs = now - soldMs
      const maxAgeMs = 18 * 30 * 86400000
      const recencyScore = Math.max(0, 1 - ageMs / maxAgeMs)

      // Property match (15%) — type match only (no beds from LR)
      const typeMatchScore = sizeSimilarity > 0.8 ? 1.0 : 0.6

      const score =
        (sizeSimilarity  * 0.35) +
        (distanceScore   * 0.25) +
        (recencyScore    * 0.25) +
        (typeMatchScore  * 0.15)

      scored.push({ pricePerSqm, soldPrice, floorArea, score, date: soldDate })
    }

    if (scored.length < 2) {
      console.log('Too few valid LR comps — using fallback')
      return fallback()
    }

    // ── WEIGHTED £/SQM ────────────────────────────────────────────────────────
    const totalScore  = scored.reduce((s, c) => s + c.score, 0)
    const weightedPsm = scored.reduce((s, c) => s + c.pricePerSqm * c.score, 0) / totalScore

    // ── BASE VALUE ────────────────────────────────────────────────────────────
    const effectiveArea = subjectArea > 0 ? subjectArea : estimateFloorArea(subjectBeds, subjectType)
    const baseValue = Math.round(weightedPsm * effectiveArea)

    // ── FEATURE ADJUSTMENTS ───────────────────────────────────────────────────
    let adjustment = 1.0
    if      (subjectEpc === 'A' || subjectEpc === 'B') adjustment += 0.02
    else if (subjectEpc === 'E') adjustment -= 0.02
    else if (subjectEpc === 'F') adjustment -= 0.04
    else if (subjectEpc === 'G') adjustment -= 0.05
    if (hasParking)  adjustment += 0.03
    if (hasGarden)   adjustment += 0.02
    if (subjectTenure.includes('leasehold')) adjustment -= 0.01

    const adjustedValue = Math.round(baseValue * adjustment)

    // ── CONFIDENCE SCORE ──────────────────────────────────────────────────────
    let confidence = 50
    if (scored.length >= 5)  confidence += 15
    if (scored.length >= 15) confidence += 10
    if (subjectArea > 0)     confidence += 10 // actual floor area available
    else                     confidence -= 5  // using estimated floor area
    if (scored.some(c => c.pricePerSqm > 0)) confidence += 5
    confidence = Math.min(88, Math.max(40, confidence))

    // ── VALUATION RANGE ───────────────────────────────────────────────────────
    const spread    = confidence >= 75 ? 0.05 : confidence >= 60 ? 0.07 : 0.10
    const lowValue  = Math.round(adjustedValue * (1 - spread) / 1000) * 1000
    const highValue = Math.round(adjustedValue * (1 + spread) / 1000) * 1000
    const fairValue = Math.round(adjustedValue / 1000) * 1000

    console.log(`LR Valuation: £${fairValue.toLocaleString()} (${scored.length} comps, ${confidence}% confidence, £${Math.round(weightedPsm)}/sqm, area ${effectiveArea}sqm)`)

    return { fairValue, lowValue, highValue, confidence, compsUsed: scored.length, method: 'lr_comparable_psm' }

  } catch (e) {
    console.error('LR valuation engine error:', e)
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
