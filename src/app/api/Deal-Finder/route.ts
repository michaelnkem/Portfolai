import { NextRequest, NextResponse } from 'next/server'
import { MARKET_DATA, calcNetYield, calcGrossYield } from '@/lib/market-data'

const HD_BASE = 'https://api.homedata.co.uk/api'
type CityKey = keyof typeof MARKET_DATA.cities

// ── Public types ──────────────────────────────────────────────────────────────

export interface DealCandidate {
  id: string
  uprn: string | null
  address: string
  displayAddress: string
  postcode: string
  outcode: string | null
  city: string | null
  localAuthority: string | null
  propertyType: string | null
  bedrooms: number | null
  bathrooms: number | null
  floorAreaSqm: number | null
  tenure: string | null
  askingPrice: number
  previousAskingPrice: number | null
  listingStatus: 'for_sale' | 'new_listing' | 'reduced' | 'sold_stc' | 'unknown'
  listingDate: string | null
  updatedAt: string | null
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
  badge: string
  badgeColour: string
  dataConfidence: number
  source: 'homedata_live_listings'
}

interface UserBenchmark {
  favAvgNetYield: number
  favAvgValue: number
  favPropertyTypes: string[]
  favMinBeds: number
  favMaxBeds: number
  favCities: string[]
}

// ── UK postcode helpers ───────────────────────────────────────────────────────

function isFullUKPostcode(value: string): boolean {
  return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(value.trim())
}

function normalizePostcode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/, ' ')
}

// Extract postcode from a display_address string, e.g. "12 High St, London, E1 6RF"
function extractPostcode(address: string): string {
  const m = address.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)
  return m ? normalizePostcode(m[1]) : ''
}

// ── Rent estimation fallback ──────────────────────────────────────────────────

function estimateRent(city: string | null, beds: number | null): number | null {
  const cityKey = city as CityKey | null
  if (!cityKey || !MARKET_DATA.cityByBedroom[cityKey]) return null
  const cityData = MARKET_DATA.cityByBedroom[cityKey]
  const baseRent = MARKET_DATA.cities[cityKey]?.avgRent ?? null
  if (!baseRent) return null

  const b = beds ?? 2
  const bedKey =
    b <= 0 ? 'studio' :
    b === 1 ? '1bed' :
    b === 2 ? '2bed' :
    b === 3 ? '3bed' : '4bed'

  const bedroomData = cityData[bedKey as keyof typeof cityData]
  if (bedroomData) return bedroomData.avgRent
  const mult =
    b <= 0 ? 0.55 :
    b === 1 ? 0.75 :
    b === 2 ? 1.00 :
    b === 3 ? 1.35 : 1.70
  return Math.round(baseRent * mult)
}

// ── Investment Fit Score (6-factor, 100 pts) ──────────────────────────────────

function calcInvestmentFit(
  deal: {
    netYield: number | null
    askingPrice: number
    epcRating: string | null
    propertyType: string | null
    bedrooms: number | null
    listingStatus: string
    city: string | null
    dataFields: number
  },
  bench: UserBenchmark,
): { score: number; label: string; badge: string; badgeColour: string; reasons: string[] } {
  const reasons: string[] = []

  // Factor A — return efficiency (30 pts)
  let factorA = 4
  const ny = deal.netYield ?? 0
  const diff = ny - bench.favAvgNetYield
  if      (diff >= 1.5)   { factorA = 30; reasons.push('Exceptional yield vs strategy') }
  else if (diff >= 0.75)  { factorA = 25; reasons.push('Strong yield vs strategy') }
  else if (diff >= 0)     { factorA = 20; reasons.push('Yield meets strategy') }
  else if (diff >= -0.75) { factorA = 14 }
  else if (diff >= -1.5)  { factorA =  8 }
  else                    { factorA =  4 }

  // Factor B — entry price efficiency (20 pts)
  let factorB = 3
  const cityData = MARKET_DATA.cities[deal.city as CityKey]
  const cityAvgPrice = cityData?.avgPrice ?? bench.favAvgValue
  const refPrice = bench.favAvgValue > 0 ? (cityAvgPrice + bench.favAvgValue) / 2 : cityAvgPrice
  const priceDiff = refPrice > 0 ? (refPrice - deal.askingPrice) / refPrice : 0
  if      (priceDiff >= 0.10)  { factorB = 20; reasons.push('Below market entry price') }
  else if (priceDiff >= 0.05)  { factorB = 16; reasons.push('Competitive entry price') }
  else if (priceDiff >= -0.05) { factorB = 12 }
  else if (priceDiff >= -0.10) { factorB =  7 }
  else                          { factorB =  3 }

  // Factor C — strategy match (15 pts)
  let factorC = 4
  let matchCount = 0
  const normType = (deal.propertyType ?? '').toLowerCase()
  if (bench.favPropertyTypes.length > 0 &&
      bench.favPropertyTypes.some(t => normType.includes(t.toLowerCase()))) matchCount++
  if (deal.bedrooms != null &&
      deal.bedrooms >= bench.favMinBeds && deal.bedrooms <= bench.favMaxBeds) matchCount++
  const priceBand = bench.favAvgValue > 0 && deal.askingPrice > 0
    ? Math.abs(deal.askingPrice - bench.favAvgValue) / bench.favAvgValue
    : 1
  if (priceBand < 0.30) matchCount++
  if      (matchCount >= 3) { factorC = 15; reasons.push('Perfect strategy match') }
  else if (matchCount >= 2) { factorC = 10 }
  else if (matchCount >= 1) { factorC =  7 }
  else                      { factorC =  4 }

  // Factor D — location opportunity (15 pts)
  let factorD = 5
  if (cityData) {
    const cy = cityData.avgYield
    const cg = cityData.capitalGrowth1yr
    if      (cy >= 7.0 && cg >= 3.0) { factorD = 15; reasons.push('High-yield growth city') }
    else if (cy >= 6.5 || cg >= 3.0) { factorD = 12; reasons.push('Strong location fundamentals') }
    else if (cy >= 5.5)               { factorD =  9 }
    else                              { factorD =  5 }
  }
  if (bench.favCities.length > 0 && deal.city && !bench.favCities.includes(deal.city)) {
    reasons.push('Cross-city opportunity')
  }

  // Factor E — risk & compliance (15 pts)
  let factorE = 6
  const epc = (deal.epcRating ?? '').toUpperCase()
  if      (epc === 'A' || epc === 'B') { factorE = 15; reasons.push('EPC A/B rating') }
  else if (epc === 'C')                { factorE = 12 }
  else if (epc === 'D')                { factorE =  8 }
  else if (epc >= 'E' && epc <= 'G')   { factorE =  3 }
  else                                 { factorE =  6 }
  if      (deal.listingStatus === 'reduced')     { factorE = Math.min(15, factorE + 2); reasons.push('Price reduced') }
  else if (deal.listingStatus === 'new_listing') { factorE = Math.min(15, factorE + 1) }

  // Factor F — data confidence (5 pts)
  const df = deal.dataFields
  const factorF = df >= 9 ? 5 : df >= 7 ? 4 : df >= 5 ? 3 : df >= 3 ? 2 : 1

  const score = factorA + factorB + factorC + factorD + factorE + factorF

  const label =
    score >= 90 ? 'Exceptional fit' :
    score >= 80 ? 'Strong fit' :
    score >= 70 ? 'Good fit' :
    score >= 60 ? 'Speculative fit' : 'Weak fit'

  const badge =
    score >= 90 ? 'Top Deal' :
    score >= 80 ? 'Strong Fit' :
    score >= 70 ? 'Good Fit' : ''

  const badgeColour =
    score >= 90 ? 'bg-[#047857] text-white' :
    score >= 80 ? 'bg-[#ECFDF5] text-[#047857]' :
    score >= 70 ? 'bg-[#FFF7E6] text-[#B7791F]' : ''

  return { score, label, badge, badgeColour, reasons: reasons.slice(0, 3) }
}

// ── Homedata boundary autocomplete ────────────────────────────────────────────

interface BoundaryResult {
  id: number | string
  name?: string
  type?: string
}

async function resolveBoundaryId(
  location: string,
  apiKey: string,
): Promise<{ boundaryId: string | null; error?: string }> {
  const url = `${HD_BASE}/boundaries/autocomplete/?q=${encodeURIComponent(location)}`
  console.log('[deal-finder] boundary lookup:', url)

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[deal-finder] boundary autocomplete ${res.status} for "${location}":`, text.slice(0, 300))
      return { boundaryId: null, error: `Boundary lookup failed: ${res.status}` }
    }

    const data = await res.json() as { results?: BoundaryResult[]; count?: number }
    const first = data?.results?.[0]
    if (!first?.id) {
      console.warn(`[deal-finder] no boundary found for "${location}"`)
      return { boundaryId: null, error: 'No boundary match' }
    }

    console.log(`[deal-finder] boundary for "${location}": id=${first.id} name="${first.name ?? ''}"`)
    return { boundaryId: String(first.id) }
  } catch (err) {
    console.error('[deal-finder] boundary autocomplete error:', err)
    return { boundaryId: null, error: String(err) }
  }
}

// ── Homedata live listings fetch ──────────────────────────────────────────────

interface HomedataListing {
  id?: string | number | null
  property_uprn?: string | number | null
  display_address?: string | null
  transaction_type?: string | null
  latest_status?: string | null
  latest_price?: number | null
  source?: string | null
  bedrooms?: number | null
  bathrooms?: number | null
  listing_property_type?: string | null
  loki_property_type?: string | null
  ownership?: string | null
  is_new_build?: boolean | null
  added_date?: string | null
  reduced_date?: string | null
  description?: string | null
  geopoint?: { lat?: number; lon?: number } | null
  images?: string[] | null
  agent_name?: string | null
  // Extended fields that may also appear
  postcode?: string | null
  city?: string | null
  town?: string | null
  epc_rating?: string | null
  current_energy_rating?: string | null
  floor_area_sqm?: number | null
  estimated_market_value?: number | null
  market_value?: number | null
  gross_yield?: number | null
  net_yield?: number | null
  rent_estimate?: number | null
  estimated_rent?: number | null
  previous_asking_price?: number | null
}

interface HomedataListingsResponse {
  count?: number
  page?: number
  page_size?: number
  total_pages?: number
  results?: HomedataListing[]
}

async function fetchLiveListings(
  locationKey: { boundaryId: string } | { postcode: string },
  filters: {
    transaction_type: string
    bedrooms?: number
    max_bedrooms?: number
    min_price?: number
    max_price?: number
    property_type?: string
    page_size?: number
    sort?: string
  },
  apiKey: string,
): Promise<{ ok: boolean; results: HomedataListing[]; statusCode?: number }> {
  const params = new URLSearchParams()

  if ('boundaryId' in locationKey) {
    params.set('boundary_id', locationKey.boundaryId)
  } else {
    params.set('postcode', locationKey.postcode)
  }

  params.set('transaction_type', filters.transaction_type || 'Sale')
  if (filters.bedrooms)      params.set('bedrooms',      String(filters.bedrooms))
  if (filters.max_bedrooms)  params.set('max_bedrooms',  String(filters.max_bedrooms))
  if (filters.min_price)     params.set('min_price',     String(filters.min_price))
  if (filters.max_price)     params.set('max_price',     String(filters.max_price))
  if (filters.property_type) params.set('property_type', filters.property_type)
  params.set('page_size', String(filters.page_size ?? 50))
  params.set('sort', filters.sort ?? '-added_date')

  const url = `${HD_BASE}/live-listings/search/?${params.toString()}`
  // Log URL without the API key appearing in the query (it's in the header)
  console.log('[deal-finder] live listings fetch:', url)

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
    })

    console.log('[deal-finder] live listings response status:', res.status)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[deal-finder] live listings ${res.status}:`, text.slice(0, 400))
      return { ok: false, results: [], statusCode: res.status }
    }

    const data = await res.json() as HomedataListingsResponse
    const results = data?.results ?? []
    console.log(`[deal-finder] received ${results.length} results (total count: ${data?.count ?? '?'})`)
    return { ok: true, results }
  } catch (err) {
    console.error('[deal-finder] live listings fetch error:', err)
    return { ok: false, results: [] }
  }
}

// ── Fetch listings for a single location string ───────────────────────────────

async function fetchListingsForLocation(
  location: string,
  filters: Parameters<typeof fetchLiveListings>[1],
  apiKey: string,
): Promise<{ ok: boolean; results: HomedataListing[] }> {
  if (isFullUKPostcode(location)) {
    const postcode = normalizePostcode(location)
    console.log(`[deal-finder] "${location}" is a full postcode → direct postcode search`)
    return fetchLiveListings({ postcode }, filters, apiKey)
  }

  // City/town/outcode — resolve via boundary autocomplete first
  const { boundaryId, error } = await resolveBoundaryId(location, apiKey)
  if (!boundaryId) {
    console.warn(`[deal-finder] skipping "${location}": ${error}`)
    return { ok: false, results: [] }
  }

  return fetchLiveListings({ boundaryId }, filters, apiKey)
}

// ── Normalise a Homedata live listing into DealCandidate ─────────────────────

function normaliseListing(
  raw: HomedataListing,
  sourceCityHint: string | null,
  bench: UserBenchmark,
): DealCandidate | null {
  // Price — Homedata live listings use latest_price
  const askingPrice =
    typeof raw.latest_price === 'number' && raw.latest_price > 0 ? raw.latest_price : 0
  if (!askingPrice) return null

  const uprn = raw.property_uprn != null ? String(raw.property_uprn) : null
  const listingId = raw.id != null ? String(raw.id) : null
  const id = uprn ?? listingId ?? `dl-${Math.random().toString(36).slice(2)}`

  const displayAddress = String(raw.display_address ?? '').trim()
  const address        = displayAddress  // live listings use display_address as canonical address

  // Try to extract postcode from display_address; fall back to raw.postcode field if present
  const extractedPostcode = extractPostcode(displayAddress)
  const postcode = extractedPostcode || String(raw.postcode ?? '').trim().toUpperCase()
  const outcode  = postcode.split(' ')[0] || null

  // City resolution — prefer explicit city field, fall back to sourceCityHint
  const rawCity = String(raw.city ?? raw.town ?? '').trim()
  const knownCityKeys = Object.keys(MARKET_DATA.cities)
  const city =
    knownCityKeys.find(k => rawCity.toLowerCase().includes(k.toLowerCase())) ??
    (sourceCityHint ? (knownCityKeys.find(k => sourceCityHint.toLowerCase().includes(k.toLowerCase())) ?? null) : null) ??
    (rawCity || null) ??
    sourceCityHint ??
    null

  const propertyType  = String(raw.listing_property_type ?? raw.loki_property_type ?? '').trim() || null
  const bedrooms      = typeof raw.bedrooms === 'number' ? raw.bedrooms : null
  const bathrooms     = typeof raw.bathrooms === 'number' ? raw.bathrooms : null
  const floorAreaSqm  = typeof raw.floor_area_sqm === 'number' ? raw.floor_area_sqm : null
  const tenure        = String(raw.ownership ?? '').trim().toLowerCase() || null

  const previousAskingPrice =
    typeof raw.previous_asking_price === 'number' && raw.previous_asking_price !== askingPrice
      ? raw.previous_asking_price : null

  // Status normalisation from latest_status
  const rawStatus = String(raw.latest_status ?? '').toLowerCase()
  const isReduced = rawStatus.includes('reduc') || (raw.reduced_date != null && raw.reduced_date !== '')
  const listingStatus: DealCandidate['listingStatus'] =
    rawStatus.includes('sold')  ? 'sold_stc' :
    isReduced                   ? 'reduced' :
    rawStatus.includes('new')   ? 'new_listing' :
    rawStatus.includes('sale') || rawStatus.includes('for sale') ? 'for_sale' : 'unknown'

  const listingDate = raw.added_date ?? null
  const updatedAt   = raw.reduced_date ?? raw.added_date ?? null

  const epcRating = String(raw.epc_rating ?? raw.current_energy_rating ?? '').trim().toUpperCase().match(/[A-G]/)?.[0] ?? null

  // Images — Homedata returns images as an array of strings or objects
  const rawImages = raw.images ?? []
  const imageUrls: string[] = rawImages
    .map(img => (typeof img === 'string' ? img : (img as Record<string, unknown>)?.url as string ?? ''))
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
  const imageUrl = imageUrls[0] ?? null

  const estimatedMarketValue =
    typeof raw.estimated_market_value === 'number' ? raw.estimated_market_value :
    typeof raw.market_value === 'number' ? raw.market_value : null

  const rawRent =
    typeof raw.rent_estimate === 'number' ? raw.rent_estimate :
    typeof raw.estimated_rent === 'number' ? raw.estimated_rent : null
  const rentEstimateMonthly = rawRent ?? estimateRent(city, bedrooms)

  const isFlat      = (propertyType ?? '').toLowerCase().includes('flat')
  const isLeasehold = (tenure ?? '').includes('leasehold')
  const serviceCharge = isFlat ? 2000 : 0
  const groundRent    = isLeasehold ? 200 : 0

  const grossYield = rentEstimateMonthly
    ? (typeof raw.gross_yield === 'number'
        ? raw.gross_yield
        : calcGrossYield(askingPrice, rentEstimateMonthly))
    : null
  const netYield = rentEstimateMonthly
    ? (typeof raw.net_yield === 'number'
        ? raw.net_yield
        : calcNetYield(askingPrice, rentEstimateMonthly, serviceCharge, groundRent))
    : null
  const totalROI = netYield != null && city
    ? parseFloat((netYield + (MARKET_DATA.cities[city as CityKey]?.capitalGrowth1yr ?? 0)).toFixed(2))
    : null

  const dataFields = [uprn, address, postcode, city, propertyType, bedrooms, epcRating, rentEstimateMonthly, tenure]
    .filter(f => f != null && f !== '' && f !== 0).length

  const fit = calcInvestmentFit(
    { netYield, askingPrice, epcRating, propertyType, bedrooms, listingStatus, city, dataFields },
    bench,
  )

  return {
    id, uprn, address, displayAddress, postcode, outcode,
    city, localAuthority: null,
    propertyType, bedrooms, bathrooms, floorAreaSqm, tenure,
    askingPrice, previousAskingPrice,
    listingStatus, listingDate, updatedAt,
    imageUrl, imageUrls,
    rentEstimateMonthly, estimatedMarketValue,
    epcRating, grossYield, netYield, totalROI,
    investmentFitScore: fit.score,
    investmentFitLabel: fit.label,
    investmentReasons: fit.reasons,
    badge: fit.badge,
    badgeColour: fit.badgeColour,
    dataConfidence: dataFields,
    source: 'homedata_live_listings',
  }
}

// ── Parse request params ──────────────────────────────────────────────────────

function parseParams(req: NextRequest) {
  const s = req.nextUrl.searchParams
  const csv = (k: string) => (s.get(k) ?? '').split(',').map(v => v.trim()).filter(Boolean)
  const num = (k: string) => parseFloat(s.get(k) ?? '') || 0

  return {
    mode: s.get('mode') ?? 'ai',
    cities: csv('cities'),
    outcodes: csv('outcodes'),
    favAvgNetYield: num('favAvgNetYield') || 4.5,
    favAvgValue: num('favAvgValue') || 250000,
    favPropertyTypes: csv('favPropertyTypes'),
    favMinBeds: num('favMinBeds') || 1,
    favMaxBeds: num('favMaxBeds') || 5,
    favCities: csv('favCities'),
    minPrice: num('minPrice') || undefined as number | undefined,
    maxPrice: num('maxPrice') || undefined as number | undefined,
    minYield: num('minYield') || undefined as number | undefined,
    minNetYield: num('minNetYield') || undefined as number | undefined,
    propertyTypes: csv('propertyTypes'),
    minBedrooms: num('minBedrooms') || undefined as number | undefined,
    maxBedrooms: num('maxBedrooms') || undefined as number | undefined,
    tenure: s.get('tenure') ?? undefined,
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.HOMEDATA_API_KEY
    if (!apiKey) {
      console.warn('[deal-finder] HOMEDATA_API_KEY not set — returning unavailable')
      return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
    }

    const p = parseParams(req)
    console.log(`[deal-finder] mode=${p.mode} cities=[${p.cities}] outcodes=[${p.outcodes}]`)

    const bench: UserBenchmark = {
      favAvgNetYield: p.favAvgNetYield,
      favAvgValue: p.favAvgValue,
      favPropertyTypes: p.favPropertyTypes,
      favMinBeds: p.favMinBeds,
      favMaxBeds: p.favMaxBeds,
      favCities: p.favCities,
    }

    const listingFilters = {
      transaction_type: 'Sale',
      bedrooms: p.minBedrooms,
      max_bedrooms: p.maxBedrooms,
      min_price: p.minPrice,
      max_price: p.maxPrice,
      property_type: p.propertyTypes.length
        ? p.propertyTypes.map(t => {
            // Normalise UI labels to Homedata expected values
            if (t === 'Semi-Detached') return 'Semi-Detached'
            if (t === 'Detached')      return 'Detached'
            if (t === 'Terraced')      return 'Terraced'
            if (t === 'Flat')          return 'Flat'
            if (t === 'Bungalow')      return 'Bungalow'
            return t
          }).join(',')
        : undefined,
      page_size: 50,
      sort: '-added_date',
    }

    // Deduplicate locations — cities first, then outcodes
    const locations = Array.from(new Set([...p.cities, ...p.outcodes])).filter(Boolean)

    if (!locations.length) {
      console.warn('[deal-finder] no locations specified')
      return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
    }

    // Fetch from all locations in parallel
    const fetches = await Promise.allSettled(
      locations.map(loc => fetchListingsForLocation(loc, listingFilters, apiKey))
    )

    const allRaw: Array<{ listing: HomedataListing; sourceCityHint: string }> = []
    let anyOk = false

    for (let i = 0; i < fetches.length; i++) {
      const result = fetches[i]
      const loc = locations[i]
      if (result.status === 'fulfilled' && result.value.ok) {
        anyOk = true
        for (const listing of result.value.results) {
          allRaw.push({ listing, sourceCityHint: loc })
        }
      }
    }

    if (!anyOk) {
      console.warn('[deal-finder] all location fetches failed — returning unavailable')
      return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
    }

    // Deduplicate by uprn / listing id
    const seen = new Set<string>()
    const deduped = allRaw.filter(({ listing }) => {
      const key = String(listing.property_uprn ?? listing.id ?? '')
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Normalise
    let deals = deduped
      .map(({ listing, sourceCityHint }) => normaliseListing(listing, sourceCityHint, bench))
      .filter((d): d is DealCandidate => d !== null)

    // Server-side yield/netYield filter
    if (p.minYield) {
      deals = deals.filter(d => d.grossYield != null && d.grossYield >= p.minYield!)
    }
    if (p.minNetYield) {
      deals = deals.filter(d => d.netYield != null && d.netYield >= p.minNetYield!)
    }

    deals.sort((a, b) => b.investmentFitScore - a.investmentFitScore)
    deals = deals.slice(0, 50)

    // Meta summary
    const yields = deals.map(d => d.netYield).filter((y): y is number => y != null)
    const prices = deals.map(d => d.askingPrice).filter(v => v > 0)
    const bestYield = yields.length ? Math.max(...yields) : null
    const bestIdx   = bestYield != null ? yields.indexOf(bestYield) : -1

    const meta = {
      totalDeals: deals.length,
      avgNetYield: yields.length
        ? parseFloat((yields.reduce((a, b) => a + b, 0) / yields.length).toFixed(1))
        : null,
      avgAskingPrice: prices.length
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length / 1000) * 1000
        : null,
      bestNetYield: bestYield != null ? parseFloat(bestYield.toFixed(1)) : null,
      bestNetYieldCity: bestIdx >= 0 ? (deals[bestIdx]?.city ?? null) : null,
      newListingsCount: deals.filter(d => d.listingStatus === 'new_listing').length,
    }

    console.log(`[deal-finder] returning ${deals.length} deals`)
    return NextResponse.json({ status: 'ok', deals, meta })

  } catch (err) {
    console.error('[deal-finder] unhandled error:', err)
    return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
  }
}
