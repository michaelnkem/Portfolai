import { NextRequest, NextResponse } from 'next/server'
import {
  getProperty, getEpc, getTransactions, getRisks, getPriceTrends
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
        String((prop as Record<string,unknown>).town_name || ''),
        String((prop as Record<string,unknown>).postcode || '')
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

      const lrHistory = await fetchLrHistory(
        String(propRecord.postcode || ''),
        String(propRecord.full_address || propRecord.address || ''),
        String(propRecord.property_type || '')
      )

      const lrLastSold = lrHistory.length > 0 ? lrHistory[0] : null
      const lastSoldPrice = lrLastSold ? lrLastSold.price : price
      const lastSoldDate  = lrLastSold ? lrLastSold.date  : String(propRecord.last_sold_date || '')

      const allTransactions = lrHistory.length > 0
        ? lrHistory.map(t => ({ price: t.price, date: t.date, transaction_type: t.type }))
        : (transactions || []).slice(0, 20)

      const valuation = await calcComparableValuation(uprn, propRecord, cityData)

      const grossYield = price ? calcGrossYield(price, estimatedRent) : 0
      const netYield = price ? calcNetYield(
        price, estimatedRent,
        defaults.serviceCharge, defaults.groundRent,
        defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
      ) : 0

      const floodRisk = (risks || []).find((r: Record<string,unknown>) => r.risk_type === 'flood_rivers_sea')

      // Normalize bedroom/bathroom — Homedata uses varying field names
      const beds = propRecord.bedrooms ?? propRecord.bedroom_count ?? propRecord.num_bedrooms
        ?? propRecord.beds ?? propRecord.habitable_rooms ?? null
      const baths = propRecord.bathrooms ?? propRecord.bathroom_count ?? propRecord.num_bathrooms
        ?? propRecord.baths ?? null

      return NextResponse.json({
        uprn,
        property: {
          ...prop,
          last_sold_price: lastSoldPrice,
          last_sold_date: lastSoldDate,
          bedrooms: beds,
          bathrooms: baths,
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
          epcRating: epc?.current_energy_efficiency != null
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

  if (
    t.includes('london') ||
    londonPrefixes.some(p => outward.startsWith(p)) ||
    londonSinglePrefixes.some(p => outward.startsWith(p) && outward.length >= 2)
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
  const bedMultiplier: Record<number, number> = {
    0: 0.55, 1: 0.75, 2: 1.00, 3: 1.35, 4: 1.70, 5: 2.10,
  }
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

interface ValuationResult {
  fairValue: number
  lowValue: number
  highValue: number
  confidence: number
  compsUsed: number
  method: string
}

function getLrType(propertyType: string): string {
  const t = propertyType.toLowerCase()
  if (t.includes('flat') || t.includes('maisonette') || t.includes('apartment')) return 'F'
  if (t.includes('semi')) return 'S'
  if (t.includes('terrace')) return 'T'
  if (t.includes('detached') || t.includes('bungalow')) return 'D'
  return ''
}

// Premium/discount vs the blended district average £/sqm.
// Terraced and above command a premium over the blended average which includes
// cheaper flats; flats trade at a discount.
function getTypeMultiplier(propertyType: string): number {
  const t = propertyType.toLowerCase()
  if (t.includes('detached') && !t.includes('semi')) return 1.35
  if (t.includes('semi')) return 1.20
  if (t.includes('terrace')) return 1.10
  if (t.includes('flat') || t.includes('maisonette') || t.includes('apartment')) return 0.82
  return 1.0
}

function estimateFloorArea(beds: number, type: string): number {
  const t = type.toLowerCase()
  const base: Record<number, number> = { 0: 35, 1: 50, 2: 70, 3: 90, 4: 115, 5: 140 }
  const area = base[Math.min(beds, 5)] || 70
  if (t.includes('detached') && !t.includes('semi')) return Math.round(area * 1.2)
  return area
}

async function calcComparableValuation(
  _uprn: string,
  prop: Record<string, unknown>,
  cityData: Record<string, number>,
): Promise<ValuationResult> {

  const subjectArea   = Number(prop.internal_area_sqm || prop.epc_floor_area || 0)
  const subjectType   = String(prop.property_type || '').toLowerCase()
  const isFlat = subjectType.includes('flat') || subjectType.includes('maisonette') || subjectType.includes('apartment')
  // When bedrooms unknown, default to 3 for houses (most common) and 1 for flats
  const subjectBeds   = prop.bedrooms != null ? Number(prop.bedrooms) : (isFlat ? 1 : 3)
  const subjectTenure = String(prop.tenure || '').toLowerCase()
  const subjectEpc    = String(prop.current_energy_rating || 'D')
  const hasParking    = Boolean(prop.has_parking)
  const hasGarden     = Boolean(prop.has_garden)
  const postcode      = String(prop.postcode || '')
  const outcode       = postcode.split(' ')[0]

  const fallback = (): ValuationResult => {
    const price = Number(prop.last_sold_price || 0)
    if (!price) return { fairValue: 0, lowValue: 0, highValue: 0, confidence: 0, compsUsed: 0, method: 'none' }
    const soldYear  = Number(String(prop.last_sold_date || '2015').slice(0, 4))
    const yearsHeld = Math.max(0, new Date().getFullYear() - soldYear)
    const annualRate = Math.max(0.01, Math.min(0.08, (cityData.capitalGrowth5yr / 5) / 100))
    const fair = Math.round(price * Math.pow(1 + annualRate, yearsHeld))
    return { fairValue: fair, lowValue: Math.round(fair * 0.95), highValue: Math.round(fair * 1.05), confidence: 45, compsUsed: 0, method: 'growth_rate_fallback' }
  }

  if (!outcode) return fallback()

  try {
    const trends = await getPriceTrends(outcode)
    console.log(`Homedata price_trends: ${trends.length} records for ${outcode}`)

    if (trends.length < 1) {
      console.log(`No price trend data for ${outcode} — using fallback`)
      return fallback()
    }

    const lrType = getLrType(subjectType)
    const typeMatches = lrType ? trends.filter(t => {
      const pt = String(t.property_type || '').toLowerCase()
      return pt === lrType.toLowerCase() ||
        (lrType === 'F' && (pt.includes('flat') || pt.includes('maisonette') || pt.includes('apartment'))) ||
        (lrType === 'S' && pt.includes('semi')) ||
        (lrType === 'T' && (pt.includes('terrace') || pt === 't')) ||
        (lrType === 'D' && (pt.includes('detach') || pt.includes('bungalow') || pt === 'd'))
    }) : []
    const pool = typeMatches.length >= 1 ? typeMatches : trends
    console.log(`Valuation pool: ${pool.length} records (type-matched: ${typeMatches.length}, lrType: ${lrType || 'none'})`)

    const sorted = [...pool].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 12)

    const prices = sorted
      .map(t => {
        const raw = t as unknown as Record<string, unknown>
        return Number(
          t.median_price || t.mean_price ||
          raw.average_price || raw.avg_price || raw.price || raw.value || 0
        )
      })
      .filter(p => p > 10000)

    if (prices.length < 3) {
      console.log(`Too few valid price points for ${outcode} — using fallback`)
      return fallback()
    }

    // Recency-weighted average: recent months count more than older ones
    // Exponential decay with λ=0.15 — month 0 weight=1.0, month 11 weight≈0.19
    const weights = prices.map((_, i) => Math.exp(-0.15 * i))
    const totalWeight = weights.reduce((s, w) => s + w, 0)
    const weightedAvgPrice = prices.reduce((s, p, i) => s + p * weights[i], 0) / totalWeight

    // Trend projection: estimate monthly momentum, project forward ~2 months
    // for Homedata data lag. Capped at ±0.8%/month.
    const recentSlice = prices.slice(0, Math.min(3, prices.length))
    const olderSlice  = prices.slice(-Math.min(3, prices.length))
    const recentAvg = recentSlice.reduce((s, p) => s + p, 0) / recentSlice.length
    const olderAvg  = olderSlice.reduce((s, p) => s + p, 0)  / olderSlice.length
    const monthsSpan = prices.length - 1
    const rawMonthlyGrowth = monthsSpan > 0 ? (recentAvg / olderAvg - 1) / monthsSpan : 0
    const monthlyGrowth = Math.max(-0.008, Math.min(0.008, rawMonthlyGrowth))
    const dataLagMonths = 2
    const avgPrice = weightedAvgPrice * Math.pow(1 + monthlyGrowth, dataLagMonths)

    // Use constant 75 sqm (UK residential mean) as denominator so £/sqm
    // reflects the true blended district average, not a type-specific subset.
    // Type differences are then applied via the multiplier below.
    const pricePerSqm = avgPrice / 75

    const effectiveArea = subjectArea > 0
      ? subjectArea
      : estimateFloorArea(subjectBeds, subjectType)

    const typeMultiplier = getTypeMultiplier(subjectType)
    const baseValue = Math.round(pricePerSqm * effectiveArea * typeMultiplier)

    let adjustment = 1.0
    if      (subjectEpc === 'A' || subjectEpc === 'B') adjustment += 0.02
    else if (subjectEpc === 'E') adjustment -= 0.02
    else if (subjectEpc === 'F') adjustment -= 0.04
    else if (subjectEpc === 'G') adjustment -= 0.05
    if (hasParking)  adjustment += 0.03
    if (hasGarden)   adjustment += 0.02
    if (subjectTenure.includes('leasehold')) adjustment -= 0.01

    const adjustedValue = Math.round(baseValue * adjustment)

    let confidence = 60
    if (prices.length >= 9)  confidence += 10
    if (prices.length >= 12) confidence += 5
    if (subjectArea > 0)     confidence += 10
    else                     confidence -= 5
    confidence = Math.min(88, Math.max(40, confidence))

    const spread    = confidence >= 75 ? 0.05 : confidence >= 60 ? 0.07 : 0.10
    const lowValue  = Math.round(adjustedValue * (1 - spread) / 1000) * 1000
    const highValue = Math.round(adjustedValue * (1 + spread) / 1000) * 1000
    const fairValue = Math.round(adjustedValue / 1000) * 1000

    console.log(`Homedata Valuation: £${fairValue.toLocaleString()} (${prices.length} periods, ${confidence}% conf, £${Math.round(pricePerSqm)}/sqm, area ${effectiveArea}sqm, multiplier ${typeMultiplier}, weighted avg £${Math.round(weightedAvgPrice).toLocaleString()}, momentum ${(monthlyGrowth * 100).toFixed(2)}%/mo, projected avg £${Math.round(avgPrice).toLocaleString()})`)

    return { fairValue, lowValue, highValue, confidence, compsUsed: prices.length, method: 'homedata_price_trends' }

  } catch (e) {
    console.error('Homedata valuation engine error:', e)
    return fallback()
  }
}

interface LrTransaction {
  price: number
  date: string
  type: string
  address: string
}

// PAON match: subject must appear at start-of-string or after a hyphen,
// followed by a letter, hyphen, or end-of-string.
// Handles exact ("54"), suffixed ("54A"), and range ("52-54", "54-56")
// while rejecting false neighbours ("154", "254").
function paonMatch(itemPaon: string, subjectPaon: string): boolean {
  if (!subjectPaon) return true
  if (!itemPaon) return false
  const escaped = subjectPaon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|-)${escaped}(?=[A-Za-z]|-|$)`).test(itemPaon)
}

async function fetchLrHistory(
  postcode: string,
  address: string,
  _propertyType: string
): Promise<LrTransaction[]> {
  if (!postcode) return []

  try {
    const since = `${new Date().getFullYear() - 35}-01-01`
    const url = `http://landregistry.data.gov.uk/data/ppi/transaction-record.json`
      + `?propertyAddress.postcode=${encodeURIComponent(postcode)}`
      + `&_pageSize=200`
      + `&_sort=-transactionDate`
      + `&min-transactionDate=${since}`

    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
    if (!res.ok) {
      console.log(`LR transaction-record: HTTP ${res.status} for ${postcode}`)
      return []
    }

    const data = await res.json()
    const items: Record<string, unknown>[] = (data?.result as Record<string, unknown>)?.items || []
    console.log(`LR: ${items.length} raw transactions for postcode ${postcode}`)
    if (items.length === 0) return []

    const subjectPaon = address.trim().split(/[\s,]+/)[0].toUpperCase()

    const results: LrTransaction[] = []
    for (const item of items) {
      const addrObj = item.propertyAddress as Record<string, unknown> | undefined
      const itemPaon = String(addrObj?.paon || addrObj?.saon || item.paon || '').toUpperCase()

      if (!paonMatch(itemPaon, subjectPaon)) continue

      const price = Number(item.pricePaid || 0)
      const date = String(item.transactionDate || '')
      const type = String(item.propertyType || '').split('/').pop() || ''
      if (price > 0 && date) results.push({ price, date, type, address: itemPaon || subjectPaon })
    }

    results.sort((a, b) => b.date.localeCompare(a.date))
    console.log(`LR: ${results.length} matched transactions for ${subjectPaon} ${postcode}`)
    return results

  } catch (e) {
    console.error('LR history error:', e)
    return []
  }
}
