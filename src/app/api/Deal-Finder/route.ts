// Server-side only — HOMEDATA_API_KEY never exposed to browser
import { NextRequest, NextResponse } from 'next/server'
import { MARKET_DATA, calcNetMonthlyIncome } from '@/lib/market-data'

const HD_BASE = 'https://api.homedata.co.uk'

function hdHeaders() {
  return { Authorization: `Api-Key ${process.env.HOMEDATA_API_KEY ?? ''}` }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ListingStatus = 'for_sale' | 'new_listing' | 'reduced' | 'sold_stc' | 'unknown'

export interface DealCandidate {
  id: string
  uprn: string | null
  listingId: string | null
  address: string
  displayAddress: string
  postcode: string
  outcode: string | null
  city: string | null
  localAuthority: string | null
  askingPrice: number | null
  previousAskingPrice: number | null
  listingStatus: ListingStatus
  listingDate: string | null
  updatedAt: string | null
  propertyType: string | null
  bedrooms: number | null
  bathrooms: number | null
  floorAreaSqm: number | null
  tenure: string | null
  imageUrl: string | null
  imageUrls: string[]
  rentEstimateMonthly: number | null
  estimatedMarketValue: number | null
  epcRating: string | null
  grossYield: number | null
  netYield: number | null
  totalROI: number | null
  investmentFitScore: number
  investmentFitLabel: string
  investmentReasons: string[]
  dataConfidence: number
  source: 'homedata_live_listings'
}

type CityKey = keyof typeof MARKET_DATA.cities

// ── Helpers ───────────────────────────────────────────────────────────────────

function normPropertyType(raw: string): string {
  const t = (raw || '').toLowerCase()
  if (t.includes('flat') || t.includes('apartment') || t.includes('maisonette')) return 'Flat'
  if (t.includes('detached') && t.includes('semi')) return 'Semi-Detached'
  if (t.includes('detached')) return 'Detached'
  if (t.includes('terraced') || t.includes('terrace') || t.includes('end of terrace')) return 'Terraced'
  if (t.includes('bungalow')) return 'Bungalow'
  if (t.includes('house')) return 'House'
  return raw || 'Unknown'
}

function normEpc(raw: unknown): string | null {
  const s = String(raw || '').toUpperCase().match(/[A-G]/)?.[0] ?? null
  return s
}

function normStatus(raw: unknown): ListingStatus {
  const s = String(raw || '').toLowerCase().replace(/[_\s-]+/g, '')
  if (s.includes('reduc') || s.includes('pricechange')) return 'reduced'
  if (s.includes('new') || s.includes('added') || s.includes('first')) return 'new_listing'
  if (s.includes('soldstc') || s.includes('underagreement') || s.includes('stc')) return 'sold_stc'
  if (s.includes('sale') || s.includes('active') || s.includes('live') || s.includes('listed')) return 'for_sale'
  return 'unknown'
}

function extractImages(raw: unknown): string[] {
  if (!raw) return []
  if (typeof raw === 'string' && raw.startsWith('http')) return [raw]
  if (Array.isArray(raw)) {
    return (raw as unknown[]).flatMap(item => {
      if (typeof item === 'string' && item.startsWith('http')) return [item]
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>
        const url = String(obj.url || obj.src || obj.href || obj.image_url || '')
        return url.startsWith('http') ? [url] : []
      }
      return []
    })
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    const url = String(obj.url || obj.src || obj.href || obj.image_url || '')
    return url.startsWith('http') ? [url] : []
  }
  return []
}

function detectCityFromPostcode(postcode: string): CityKey {
  const pc = (postcode || '').toUpperCase().trim()
  const outward = pc.split(' ')[0]
  if (!outward) return 'London'

  if (outward.match(/^M\d/)) return 'Manchester'
  if (outward.match(/^(WA|CH|PR|BB|FY|WN|LA|SK|BL|OL)/)) return 'Manchester'
  if (outward.match(/^B\d/)) return 'Birmingham'
  if (outward.match(/^(CV|LE|DE|NN|WV|WS|WR|DY)/)) return 'Birmingham'
  if (outward.match(/^L\d/)) return 'Liverpool'
  if (outward.match(/^(LS|BD|HX|WF|HG)/)) return 'Leeds'
  if (outward.match(/^YO\d/)) return 'Leeds'
  if (outward.match(/^S\d/) && !outward.startsWith('SE') && !outward.startsWith('SW') && !outward.startsWith('SM')) return 'Sheffield'
  if (outward.match(/^(SR|TS|DL|DH|NE)/)) return 'Sheffield'
  if (outward.match(/^NG\d/)) return 'Nottingham'
  if (outward.match(/^(BS|BA|BH|SN|SP|GL)/)) return 'Bristol'
  if (outward.match(/^(SO|PO|BN|CF|SA|NP)/)) return 'Bristol'
  return 'London'
}

function bedKey(beds: number | null): string {
  if (!beds || beds === 0) return 'studio'
  if (beds === 1) return '1bed'
  if (beds === 2) return '2bed'
  if (beds === 3) return '3bed'
  return '4bed'
}

function estimateRentFromMarketData(
  propertyType: string | null,
  beds: number | null,
  city: CityKey,
): number | null {
  const cityBedData = (MARKET_DATA.cityByBedroom as Record<string, Record<string, { avgRent: number }>>)[city]
  if (!cityBedData) return null
  const key = bedKey(beds)
  const bedData = cityBedData[key]
  if (!bedData) return null
  const base = bedData.avgRent
  const isFlat = (propertyType || '').toLowerCase().includes('flat')
  if (isFlat && key === '2bed') return Math.round(base * 0.95 / 50) * 50
  if (key === '3bed' && !isFlat) return Math.round(base * 1.05 / 50) * 50
  return base
}

// ── Investment Fit Score ──────────────────────────────────────────────────────

interface UserProfile {
  favAvgNetYield: number
  favAvgValue: number
  favPropertyTypes: string[]
  favMinBeds: number
  favMaxBeds: number
  favCities: string[]
}

function calcInvestmentFit(
  deal: Omit<DealCandidate, 'investmentFitScore' | 'investmentFitLabel' | 'investmentReasons'>,
  profile: UserProfile,
): { score: number; label: string; reasons: string[] } {
  const reasons: string[] = []
  let scoreA = 0
  let scoreB = 0
  let scoreC = 0
  let scoreD = 0
  let scoreE = 0
  let scoreF = 0

  // ── Factor A: Return efficiency (30 pts) ──────────────────────────────────
  const netY = deal.netYield
  const grossY = deal.grossYield
  const effectiveYield = netY ?? (grossY != null ? grossY * 0.72 : null)
  const benchmarkYield = profile.favAvgNetYield > 0 ? profile.favAvgNetYield : 4.5

  if (effectiveYield != null) {
    const diff = effectiveYield - benchmarkYield
    if (diff >= 1.5) { scoreA = 30; reasons.push('Better net yield') }
    else if (diff >= 0.75) { scoreA = 25; reasons.push('Better net yield') }
    else if (diff >= 0) { scoreA = 20 }
    else if (diff >= -0.75) { scoreA = 14 }
    else if (diff >= -1.5) { scoreA = 8 }
    else { scoreA = 4 }
  } else {
    scoreA = 4
  }

  // ── Factor B: Entry price efficiency (20 pts) ─────────────────────────────
  const price = deal.askingPrice
  const cityKey = (deal.city ?? 'London') as CityKey
  const cityData = MARKET_DATA.cities[cityKey] ?? MARKET_DATA.cities.London
  const cityAvgPrice = cityData.avgPrice

  if (price != null) {
    const vsCity = (price - cityAvgPrice) / cityAvgPrice
    const vsUser = profile.favAvgValue > 0 ? (price - profile.favAvgValue) / profile.favAvgValue : 0

    if (vsCity <= -0.10 && vsUser <= 0) {
      scoreB = 20; reasons.push('Lower entry price')
    } else if (vsCity <= -0.05 || vsUser <= -0.05) {
      scoreB = 16; reasons.push('Lower entry price')
    } else if (vsCity <= 0.05) {
      scoreB = 12
    } else if (vsCity <= 0.10) {
      scoreB = 7
    } else {
      scoreB = 3
    }
  } else {
    scoreB = 6
  }

  // ── Factor C: Strategy match (15 pts) ─────────────────────────────────────
  let stratScore = 4
  const typeMatch = !profile.favPropertyTypes.length ||
    (deal.propertyType != null && profile.favPropertyTypes.some(
      t => t.toLowerCase() === (deal.propertyType ?? '').toLowerCase()
    ))
  const bedsOk = deal.bedrooms != null &&
    deal.bedrooms >= profile.favMinBeds &&
    deal.bedrooms <= profile.favMaxBeds
  const priceOk = price != null && profile.favAvgValue > 0 &&
    price >= profile.favAvgValue * 0.5 &&
    price <= profile.favAvgValue * 1.8

  if (typeMatch && bedsOk && priceOk) { stratScore = 15; reasons.push('Similar strategy fit') }
  else if ((typeMatch || bedsOk) && priceOk) { stratScore = 10 }
  else if (typeMatch || bedsOk) { stratScore = 7 }
  scoreC = stratScore

  // ── Factor D: Location opportunity (15 pts) ───────────────────────────────
  const cityYield = cityData.avgYield
  const cityGrowth = cityData.capitalGrowth1yr
  const isCrossCity = profile.favCities.length > 0 && !profile.favCities.includes(cityKey)

  let locScore = 8
  if (cityYield >= 7.0 && cityGrowth >= 3.0) { locScore = 15; if (isCrossCity) reasons.push('Cross-city opportunity') }
  else if (cityYield >= 6.5 || cityGrowth >= 3.0) { locScore = 12; if (isCrossCity) reasons.push('Cross-city opportunity') }
  else if (cityYield >= 5.5) { locScore = 9 }
  else { locScore = 5 }
  scoreD = locScore

  // ── Factor E: Risk / compliance (15 pts) ──────────────────────────────────
  const epc = deal.epcRating
  let riskScore = 8
  if (epc === 'A' || epc === 'B') { riskScore = 15; reasons.push('EPC compliant') }
  else if (epc === 'C') { riskScore = 12; reasons.push('EPC compliant') }
  else if (epc === 'D') { riskScore = 8 }
  else if (epc === 'E' || epc === 'F' || epc === 'G') { riskScore = 3 }
  else { riskScore = 6 } // unknown
  scoreE = riskScore

  // Listing status bonus
  if (deal.listingStatus === 'reduced') { scoreE = Math.min(15, scoreE + 2) }
  if (deal.listingStatus === 'new_listing') { scoreE = Math.min(15, scoreE + 1) }

  // ── Factor F: Data confidence (5 pts) ─────────────────────────────────────
  const fields = [
    deal.uprn, deal.listingId, deal.askingPrice, deal.rentEstimateMonthly,
    deal.propertyType, deal.bedrooms, deal.postcode, deal.epcRating,
    deal.listingDate, deal.imageUrl, deal.city,
  ]
  const presentCount = fields.filter(f => f != null && f !== '').length
  if (presentCount >= 9) scoreF = 5
  else if (presentCount >= 7) scoreF = 4
  else if (presentCount >= 5) scoreF = 3
  else if (presentCount >= 3) scoreF = 2
  else scoreF = 1

  // Dedup reasons
  const uniqueReasons = Array.from(new Set(reasons)).slice(0, 3)

  const raw = scoreA + scoreB + scoreC + scoreD + scoreE + scoreF
  const clamped = Math.max(0, Math.min(100, raw))

  const label =
    clamped >= 90 ? 'Exceptional fit' :
    clamped >= 80 ? 'Strong fit' :
    clamped >= 70 ? 'Good fit' :
    clamped >= 60 ? 'Speculative fit' : 'Weak fit'

  return { score: clamped, label, reasons: uniqueReasons }
}

// ── Normalize a raw listing record from Homedata ──────────────────────────────

function normalizeListing(
  raw: Record<string, unknown>,
  profile: UserProfile,
): DealCandidate {
  const uprn = raw.uprn != null ? String(raw.uprn) : null
  const listingId = raw.listing_id != null ? String(raw.listing_id)
    : raw.id != null ? String(raw.id) : null
  const id = uprn ?? listingId ?? `listing-${Math.random().toString(36).slice(2)}`

  const address = String(
    raw.full_address || raw.address || raw.display_address || ''
  )
  const displayAddress = String(
    raw.display_address || raw.address || raw.full_address || ''
  )
  const postcode = String(raw.postcode || raw.post_code || '')
  const outcode = postcode ? postcode.split(' ')[0] : null
  const rawCity = String(raw.city || raw.town || raw.town_name || '')
  const city = rawCity || detectCityFromPostcode(postcode)
  const localAuthority = raw.local_authority ? String(raw.local_authority) : null

  const askingPrice = raw.asking_price != null ? Number(raw.asking_price)
    : raw.price != null ? Number(raw.price)
    : raw.list_price != null ? Number(raw.list_price)
    : null
  const previousAskingPrice = raw.previous_asking_price != null ? Number(raw.previous_asking_price)
    : raw.original_price != null ? Number(raw.original_price)
    : null
  const listingStatus = normStatus(
    raw.listing_status ?? raw.status ?? raw.event_type ?? raw.listing_event_type
  )
  const listingDate = raw.listing_date != null ? String(raw.listing_date)
    : raw.date_added != null ? String(raw.date_added)
    : raw.listed_at != null ? String(raw.listed_at)
    : null
  const updatedAt = raw.updated_at != null ? String(raw.updated_at)
    : raw.last_updated != null ? String(raw.last_updated)
    : null

  const propertyType = normPropertyType(String(raw.property_type || raw.propertyType || ''))
  const bedrooms = raw.bedrooms != null ? Number(raw.bedrooms) : null
  const bathrooms = raw.bathrooms != null ? Number(raw.bathrooms) : null
  const floorAreaSqm = raw.floor_area_sqm != null ? Number(raw.floor_area_sqm)
    : raw.internal_area_sqm != null ? Number(raw.internal_area_sqm)
    : raw.epc_floor_area != null ? Number(raw.epc_floor_area)
    : null
  const tenure = raw.tenure ? String(raw.tenure) : null

  const imageUrls = extractImages(raw.images ?? raw.media ?? raw.photos ?? raw.image_urls ?? null)
  if (raw.image_url && typeof raw.image_url === 'string') imageUrls.unshift(raw.image_url)
  if (raw.primary_image && typeof raw.primary_image === 'string') imageUrls.unshift(raw.primary_image)
  const uniqueImageUrls = Array.from(new Set(imageUrls))
  const imageUrl = uniqueImageUrls[0] ?? null

  const rentEstimateMonthly = raw.rent_estimate_monthly != null ? Number(raw.rent_estimate_monthly)
    : raw.estimated_rent != null ? Number(raw.estimated_rent)
    : raw.rental_estimate != null ? Number(raw.rental_estimate)
    : estimateRentFromMarketData(propertyType, bedrooms, city as CityKey)

  const estimatedMarketValue = raw.estimated_market_value != null ? Number(raw.estimated_market_value)
    : raw.estimated_value != null ? Number(raw.estimated_value)
    : null

  const epcRating = normEpc(
    raw.epc_rating ?? raw.current_energy_rating ?? raw.epc ?? null
  )

  // KPI calculations
  let grossYield: number | null = null
  let netYield: number | null = null
  let totalROI: number | null = null

  if (askingPrice && askingPrice > 0 && rentEstimateMonthly && rentEstimateMonthly > 0) {
    grossYield = parseFloat(((rentEstimateMonthly * 12 / askingPrice) * 100).toFixed(2))

    const isFlat = (propertyType || '').toLowerCase().includes('flat')
    const isLeasehold = (tenure || '').toLowerCase().includes('leasehold')
    const serviceCharge = isFlat ? 2000 : 0
    const groundRent = isLeasehold ? 200 : 0
    const netMonthly = calcNetMonthlyIncome(
      askingPrice, rentEstimateMonthly, serviceCharge, groundRent
    )
    if (netMonthly > 0) {
      netYield = parseFloat(((netMonthly * 12 / askingPrice) * 100).toFixed(2))

      const cityKey = (city || 'London') as CityKey
      const cityData = MARKET_DATA.cities[cityKey] ?? MARKET_DATA.cities.London
      const capitalGrowth = (cityData.capitalGrowth1yr ?? 2.5) / 100
      totalROI = parseFloat((netYield + capitalGrowth * 100).toFixed(2))
    }
  }

  // Data confidence
  const fields = [uprn, listingId, askingPrice, rentEstimateMonthly, propertyType,
    bedrooms, postcode, epcRating, listingDate, imageUrl, city]
  const dataConfidence = fields.filter(f => f != null && f !== '').length

  const candidateBase = {
    id, uprn, listingId, address, displayAddress, postcode, outcode,
    city, localAuthority, askingPrice, previousAskingPrice, listingStatus,
    listingDate, updatedAt, propertyType, bedrooms, bathrooms, floorAreaSqm,
    tenure, imageUrl, imageUrls: uniqueImageUrls, rentEstimateMonthly,
    estimatedMarketValue, epcRating, grossYield, netYield, totalROI,
    investmentFitScore: 0, investmentFitLabel: '', investmentReasons: [],
    dataConfidence,
    source: 'homedata_live_listings' as const,
  }

  const { score, label, reasons } = calcInvestmentFit(candidateBase, profile)
  return { ...candidateBase, investmentFitScore: score, investmentFitLabel: label, investmentReasons: reasons }
}

// ── Fetch listings from Homedata ──────────────────────────────────────────────

async function fetchHomedataListings(params: URLSearchParams): Promise<{
  ok: boolean
  results: Record<string, unknown>[]
}> {
  const queryStr = params.toString()
  const endpoints = [
    `${HD_BASE}/api/listings/?${queryStr}`,
    `${HD_BASE}/api/listing-events/?${queryStr}`,
    `${HD_BASE}/api/live-listings/?${queryStr}`,
  ]

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: hdHeaders(), cache: 'no-store' })
      if (res.status === 404 || res.status === 405) continue
      if (!res.ok) {
        console.log(`[deal-finder] ${url} returned ${res.status}`)
        continue
      }
      const data = await res.json()
      const results: unknown[] =
        Array.isArray(data.results) ? data.results :
        Array.isArray(data.listings) ? data.listings :
        Array.isArray(data.data) ? data.data :
        Array.isArray(data) ? data : []
      if (results.length > 0) {
        return { ok: true, results: results as Record<string, unknown>[] }
      }
    } catch (e) {
      console.log('[deal-finder] endpoint failed:', e)
    }
  }
  return { ok: false, results: [] }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!process.env.HOMEDATA_API_KEY) {
    return NextResponse.json({
      status: 'unavailable',
      message: 'HOMEDATA_API_KEY not configured',
      deals: [],
      meta: null,
    })
  }

  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('mode') ?? 'ai'
  const outcodes = (searchParams.get('outcodes') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const cities = (searchParams.get('cities') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const minPrice = Number(searchParams.get('minPrice') ?? 0) || 0
  const maxPrice = Number(searchParams.get('maxPrice') ?? 0) || 0
  const minYield = Number(searchParams.get('minYield') ?? 0) || 0
  const propertyTypes = (searchParams.get('propertyTypes') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const minBedrooms = Number(searchParams.get('minBedrooms') ?? 0) || 0
  const maxBedrooms = Number(searchParams.get('maxBedrooms') ?? 10) || 10

  const profile: UserProfile = {
    favAvgNetYield: Number(searchParams.get('favAvgNetYield') ?? 0) || 4.5,
    favAvgValue: Number(searchParams.get('favAvgValue') ?? 0) || 250000,
    favPropertyTypes: (searchParams.get('favPropertyTypes') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    favMinBeds: Number(searchParams.get('favMinBeds') ?? 1) || 1,
    favMaxBeds: Number(searchParams.get('favMaxBeds') ?? 4) || 4,
    favCities: (searchParams.get('favCities') ?? '').split(',').map(s => s.trim()).filter(Boolean),
  }

  // Build search queries — outcodes for AI mode, city names for custom
  const searchQueries: string[] = []
  if (mode === 'ai') {
    if (outcodes.length) searchQueries.push(...outcodes.slice(0, 4))
    if (cities.length) searchQueries.push(...cities.slice(0, 2))
    if (!searchQueries.length) {
      // Default: search top UK investment cities
      const allCities = Object.keys(MARKET_DATA.cities) as CityKey[]
      searchQueries.push(...allCities.slice(0, 3))
    }
  } else {
    searchQueries.push(...cities.slice(0, 4))
    if (!searchQueries.length) {
      return NextResponse.json({ status: 'ok', deals: [], meta: { totalDeals: 0 } })
    }
  }

  // Fetch from each query in parallel
  const allResults: Record<string, unknown>[] = []

  await Promise.all(
    searchQueries.map(async q => {
      const params = new URLSearchParams({ limit: '20', status: 'for_sale' })
      // Try both outcode and location params
      params.set('outcode', q)
      params.set('location', q)
      params.set('postcode_area', q)

      const { ok, results } = await fetchHomedataListings(params)
      if (!ok && results.length === 0) {
        // Try with just the query as a generic param
        const fallbackParams = new URLSearchParams({ q, limit: '20' })
        const fallback = await fetchHomedataListings(fallbackParams)
        if (fallback.ok) allResults.push(...fallback.results)
      } else {
        allResults.push(...results)
      }
    })
  )

  // If no listings came back from any endpoint, return unavailable
  if (allResults.length === 0) {
    return NextResponse.json({
      status: 'unavailable',
      message: 'Live listing data is not available on this API plan. Connect Homedata live listings to activate Deal Finder.',
      deals: [],
      meta: null,
    })
  }

  // Deduplicate by uprn or listing id
  const seen = new Set<string>()
  const uniqueResults: Record<string, unknown>[] = []
  for (const r of allResults) {
    const key = String(r.uprn ?? r.listing_id ?? r.id ?? Math.random())
    if (!seen.has(key)) { seen.add(key); uniqueResults.push(r) }
  }

  // Exclude withdrawn / inactive
  const activeResults = uniqueResults.filter(r => {
    const status = normStatus(r.listing_status ?? r.status ?? r.event_type ?? '')
    return status !== 'sold_stc' // include sold_stc if you want
  })

  // Normalize and score
  let deals = activeResults.map(r => normalizeListing(r, profile))

  // Apply optional filters
  if (minPrice > 0) deals = deals.filter(d => d.askingPrice == null || d.askingPrice >= minPrice)
  if (maxPrice > 0) deals = deals.filter(d => d.askingPrice == null || d.askingPrice <= maxPrice)
  if (minYield > 0) deals = deals.filter(d => d.grossYield == null || d.grossYield >= minYield)
  if (propertyTypes.length) deals = deals.filter(d => !d.propertyType || propertyTypes.some(t => t.toLowerCase() === (d.propertyType ?? '').toLowerCase()))
  if (minBedrooms > 0) deals = deals.filter(d => d.bedrooms == null || d.bedrooms >= minBedrooms)
  if (maxBedrooms < 10) deals = deals.filter(d => d.bedrooms == null || d.bedrooms <= maxBedrooms)

  // Sort by Investment Fit descending
  deals.sort((a, b) => b.investmentFitScore - a.investmentFitScore)

  // Build meta
  const netYields = deals.map(d => d.netYield).filter((y): y is number => y != null)
  const prices = deals.map(d => d.askingPrice).filter((p): p is number => p != null)
  const today = new Date().toISOString().slice(0, 10)
  const newListings = deals.filter(d => d.listingDate && d.listingDate >= today.slice(0, 7)).length
  const bestDeal = deals.find(d => d.netYield != null)

  const meta = {
    totalDeals: deals.length,
    avgNetYield: netYields.length ? parseFloat((netYields.reduce((a, b) => a + b, 0) / netYields.length).toFixed(2)) : null,
    avgAskingPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
    bestNetYield: bestDeal?.netYield ?? null,
    bestNetYieldCity: bestDeal?.city ?? null,
    newListingsCount: newListings,
  }

  return NextResponse.json({ status: 'ok', deals, meta })
}
