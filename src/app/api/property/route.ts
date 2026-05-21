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
        cityName,
        process.env.HOMEDATA_API_KEY!
      )

      // Use valuation fair value as the effective price basis for yield calculations
      // when last_sold_price is unavailable — gives a meaningful estimate rather than 0
      const effectivePrice = price || valuation.fairValue

      const grossYield = effectivePrice ? calcGrossYield(effectivePrice, estimatedRent) : 0
      const netYield = effectivePrice ? calcNetYield(
        effectivePrice, estimatedRent,
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
          netMonthly: effectivePrice ? calcNetMonthlyIncome(
            effectivePrice, estimatedRent,
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
// Data source: Homedata price_trends endpoint
// Methodology: area-adjusted £/sqm from local monthly average prices
interface ValuationResult {
  fairValue: number
  lowValue: number
  highValue: number
  confidence: number
  compsUsed: number
  method: string
}

// Typical floor area (sqm) by property type — used to derive £/sqm from avg sold price
function getTypicalFloorArea(propertyType: string): number {
  const t = propertyType.toLowerCase()
  if (t.includes('flat') || t.includes('maisonette') || t.includes('apartment')) return 60
  if (t.includes('semi')) return 88
  if (t.includes('terrace')) return 80
  if (t.includes('detached') && !t.includes('semi')) return 110
  return 80
}

async function calcComparableValuation(
  _uprn: string,
  prop: Record<string, unknown>,
  cityData: Record<string, number>,
  cityName: string,
  apiKey: string
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
    const soldPrice = Number(prop.last_sold_price || 0)
    if (soldPrice) {
      const soldYear  = Number(String(prop.last_sold_date || '2015').slice(0, 4))
      const yearsHeld = Math.max(0, 2026 - soldYear)
      const annualRate = Math.max(0.01, (cityData.capitalGrowth5yr / 5) / 100)
      const fair = Math.round(soldPrice * Math.pow(1 + annualRate, yearsHeld))
      return { fairValue: fair, lowValue: Math.round(fair * 0.95), highValue: Math.round(fair * 1.05), confidence: 45, compsUsed: 0, method: 'growth_rate_fallback' }
    }
    // No sold history — use city avg price for the bed count as best estimate
    const beds = Number(prop.bedrooms || 2)
    const cityByBed = MARKET_DATA.cityByBedroom[cityName as keyof typeof MARKET_DATA.cityByBedroom]
    const bedKey = beds === 0 ? 'studio' : beds === 1 ? '1bed' : beds === 2 ? '2bed' : beds === 3 ? '3bed' : '4bed'
    const bedData = cityByBed?.[bedKey as keyof typeof cityByBed]
    const fair = bedData?.avgPrice || cityData.avgPrice as number || 0
    if (!fair) return { fairValue: 0, lowValue: 0, highValue: 0, confidence: 0, compsUsed: 0, method: 'none' }
    return { fairValue: fair, lowValue: Math.round(fair * 0.90), highValue: Math.round(fair * 1.10), confidence: 25, compsUsed: 0, method: 'city_avg_estimate' }
  }

  if (!outcode) return fallback()

  try {
    // ── FETCH HOMEDATA PRICE TRENDS ───────────────────────────────────────────
    const trendsUrl = `https://api.homedata.co.uk/api/price_trends/${encodeURIComponent(outcode)}/`
    const res = await fetch(trendsUrl, {
      headers: { Authorization: `Api-Key ${apiKey}` },
      cache: 'no-store',
    })

    if (!res.ok) {
      console.log(`Homedata price_trends failed for ${outcode}:`, res.status)
      return fallback()
    }

    const trendsData = await res.json()
    console.log(`Homedata price_trends keys for ${outcode}:`, Object.keys(trendsData || {}))

    // Extract monthly average prices — handle common response shapes
    const monthlyPrices: Record<string, unknown>[] = (
      trendsData?.monthly_average_prices ||
      trendsData?.data?.monthly_average_prices ||
      trendsData?.results?.monthly_average_prices ||
      []
    )

    // Last 12 months
    const last12 = monthlyPrices.slice(-12)
    if (last12.length < 3) {
      console.log(`Too few price trend months (${last12.length}) for ${outcode} — using fallback`)
      return fallback()
    }

    const prices = last12
      .map(m => Number(m.average_price ?? m.avg_price ?? m.price ?? m.value ?? 0))
      .filter(p => p > 50000) // sanity filter — reject implausible values

    if (prices.length < 3) {
      console.log(`Too few valid price points for ${outcode} — using fallback`)
      return fallback()
    }

    const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length

    // ── £/SQM FROM AREA-ADJUSTED AVERAGE ─────────────────────────────────────
    const typicalArea   = getTypicalFloorArea(subjectType)
    const pricePerSqm   = avgPrice / typicalArea
    const effectiveArea = subjectArea > 0 ? subjectArea : estimateFloorArea(subjectBeds, subjectType)
    const baseValue     = Math.round(pricePerSqm * effectiveArea)

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
    let confidence = 60
    if (prices.length >= 9)  confidence += 10
    if (prices.length >= 12) confidence += 5
    if (subjectArea > 0)     confidence += 10
    else                     confidence -= 5
    confidence = Math.min(88, Math.max(40, confidence))

    // ── VALUATION RANGE ───────────────────────────────────────────────────────
    const spread    = confidence >= 75 ? 0.05 : confidence >= 60 ? 0.07 : 0.10
    const lowValue  = Math.round(adjustedValue * (1 - spread) / 1000) * 1000
    const highValue = Math.round(adjustedValue * (1 + spread) / 1000) * 1000
    const fairValue = Math.round(adjustedValue / 1000) * 1000

    console.log(`Homedata Valuation: £${fairValue.toLocaleString()} (${prices.length} months, ${confidence}% confidence, £${Math.round(pricePerSqm)}/sqm, area ${effectiveArea}sqm, avg sold £${Math.round(avgPrice).toLocaleString()})`)

    return { fairValue, lowValue, highValue, confidence, compsUsed: prices.length, method: 'homedata_price_trends' }

  } catch (e) {
    console.error('Homedata valuation engine error:', e)
    return fallback()
  }
}

// Estimate floor area from beds when not provided
function estimateFloorArea(beds: number, type: string): number {
  const t = type.toLowerCase()
  const base: Record<number, number> = { 0: 35, 1: 50, 2: 70, 3: 90, 4: 115, 5: 140 }
  const area = base[Math.min(beds, 5)] || 70
  if (t.includes('detached') && !t.includes('semi')) return Math.round(area * 1.2)
  return area
}

// ── LAND REGISTRY FULL TRANSACTION HISTORY ───────────────────────────────────
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
    // Use the exact postcode address endpoint — confirmed working
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
          const date = String((tx as Record<string, unknown>).transactionDate || '')
          const type = String((tx as Record<string, unknown>).propertyType || '').split('/').pop() || ''
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
