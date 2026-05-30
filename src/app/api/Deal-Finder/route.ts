import { NextRequest, NextResponse } from 'next/server'
import { MARKET_DATA, calcNetYield, calcGrossYield } from '@/lib/market-data'

const HD_BASE = 'https://api.homedata.co.uk'
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

// ── Homedata raw listing shape ────────────────────────────────────────────────

interface HomedataListing {
  uprn?: string | number | null
  id?: string | number | null
  listing_id?: string | number | null
  address?: string | null
  full_address?: string | null
  display_address?: string | null
  postcode?: string | null
  city?: string | null
  town?: string | null
  local_authority?: string | null
  property_type?: string | null
  bedrooms?: number | null
  bathrooms?: number | null
  floor_area_sqm?: number | null
  tenure?: string | null
  asking_price?: number | null
  price?: number | null
  asking_price_pence?: number | null
  previous_asking_price?: number | null
  status?: string | null
  listing_status?: string | null
  epc_rating?: string | null
  current_energy_rating?: string | null
  image_url?: string | null
  images?: string[] | null
  listing_date?: string | null
  created_at?: string | null
  updated_at?: string | null
  rent_estimate?: number | null
  estimated_rent?: number | null
  estimated_market_value?: number | null
  market_value?: number | null
  gross_yield?: number | null
  net_yield?: number | null
}

// ── Fetch listings from Homedata for one location ─────────────────────────────

async function fetchListingsForLocation(
  location: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<{ ok: boolean; results: HomedataListing[]; statusCode?: number }> {
  const qs = new URLSearchParams({ ...params, location, status: 'for_sale', page_size: '50' })
  const url = `${HD_BASE}/api/listings/?${qs.toString()}`

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Api-Key ${apiKey}` },
      next: { revalidate: 300 },
    })

    if (!res.ok) {
      let body = ''
      try { body = await res.text() } catch {}
      console.error(`[deal-finder] Homedata ${res.status} for ${location}:`, body.slice(0, 400))
      return { ok: false, results: [], statusCode: res.status }
    }

    const data = await res.json() as
      | { results?: HomedataListing[] }
      | HomedataListing[]
    const results = Array.isArray(data) ? data : (data.results ?? [])
    return { ok: true, results }
  } catch (err) {
    console.error('[deal-finder] fetch error for', location, err)
    return { ok: false, results: [] }
  }
}

// ── Normalise a raw listing into DealCandidate ────────────────────────────────

function normaliseListing(raw: HomedataListing, bench: UserBenchmark): DealCandidate | null {
  const askingPrice =
    typeof raw.asking_price === 'number' && raw.asking_price > 0 ? raw.asking_price :
    typeof raw.asking_price_pence === 'number' && raw.asking_price_pence > 0 ? raw.asking_price_pence / 100 :
    typeof raw.price === 'number' && raw.price > 0 ? raw.price : 0
  if (!askingPrice) return null

  const uprn = raw.uprn != null ? String(raw.uprn) : null
  const listingId = raw.listing_id != null ? String(raw.listing_id) :
    raw.id != null ? String(raw.id) : null
  const id = uprn ?? listingId ?? `dl-${Math.random().toString(36).slice(2)}`

  const address        = String(raw.full_address ?? raw.address ?? raw.display_address ?? '').trim()
  const displayAddress = String(raw.display_address ?? raw.full_address ?? raw.address ?? '').trim()
  const postcode       = String(raw.postcode ?? '').trim().toUpperCase()
  const outcode        = postcode.split(' ')[0] || null

  const rawCity = String(raw.city ?? raw.town ?? '').trim()
  const knownCityKeys = Object.keys(MARKET_DATA.cities)
  const city = knownCityKeys.find(k => rawCity.toLowerCase().includes(k.toLowerCase())) ?? (rawCity || null)

  const propertyType  = String(raw.property_type ?? '').trim() || null
  const bedrooms      = typeof raw.bedrooms === 'number' ? raw.bedrooms : null
  const bathrooms     = typeof raw.bathrooms === 'number' ? raw.bathrooms : null
  const floorAreaSqm  = typeof raw.floor_area_sqm === 'number' ? raw.floor_area_sqm : null
  const tenure        = String(raw.tenure ?? '').trim().toLowerCase() || null

  const previousAskingPrice =
    typeof raw.previous_asking_price === 'number' && raw.previous_asking_price !== askingPrice
      ? raw.previous_asking_price : null

  const rawStatus = String(raw.status ?? raw.listing_status ?? '').toLowerCase()
  const listingStatus: DealCandidate['listingStatus'] =
    rawStatus.includes('reduc') ? 'reduced' :
    rawStatus.includes('new')   ? 'new_listing' :
    rawStatus.includes('sold')  ? 'sold_stc' :
    rawStatus.includes('sale')  ? 'for_sale' : 'unknown'

  const listingDate = raw.listing_date ?? raw.created_at ?? null
  const updatedAt   = raw.updated_at ?? null

  const epcRating = String(raw.epc_rating ?? raw.current_energy_rating ?? '').trim().toUpperCase().match(/[A-G]/)?.[0] ?? null

  const rawImageUrl = raw.image_url ?? (Array.isArray(raw.images) ? raw.images[0] : null) ?? null
  const imageUrl    = typeof rawImageUrl === 'string' ? rawImageUrl : null
  const imageUrls   = Array.isArray(raw.images)
    ? raw.images.filter((u): u is string => typeof u === 'string')
    : imageUrl ? [imageUrl] : []

  const estimatedMarketValue =
    typeof raw.estimated_market_value === 'number' ? raw.estimated_market_value :
    typeof raw.market_value === 'number' ? raw.market_value : null

  const rawRent = typeof raw.rent_estimate === 'number' ? raw.rent_estimate :
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
    city, localAuthority: String(raw.local_authority ?? '').trim() || null,
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
    minPrice: num('minPrice') || undefined,
    maxPrice: num('maxPrice') || undefined,
    minYield: num('minYield') || undefined,
    propertyTypes: csv('propertyTypes'),
    minBedrooms: num('minBedrooms') || undefined,
    maxBedrooms: num('maxBedrooms') || undefined,
  }
}

function buildHdParams(p: ReturnType<typeof parseParams>): Record<string, string> {
  const q: Record<string, string> = {}
  if (p.minPrice)             q.min_price      = String(p.minPrice)
  if (p.maxPrice)             q.max_price      = String(p.maxPrice)
  if (p.minBedrooms)          q.min_bedrooms   = String(p.minBedrooms)
  if (p.maxBedrooms)          q.max_bedrooms   = String(p.maxBedrooms)
  if (p.propertyTypes.length) q.property_type  = p.propertyTypes[0]
  return q
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.HOMEDATA_API_KEY
    if (!apiKey) {
      return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
    }

    const p = parseParams(req)

    const bench: UserBenchmark = {
      favAvgNetYield: p.favAvgNetYield,
      favAvgValue: p.favAvgValue,
      favPropertyTypes: p.favPropertyTypes,
      favMinBeds: p.favMinBeds,
      favMaxBeds: p.favMaxBeds,
      favCities: p.favCities,
    }

    const hdParams = buildHdParams(p)
    const locations = Array.from(new Set([...p.cities, ...p.outcodes])).filter(Boolean)

    if (!locations.length) {
      return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
    }

    const fetches = await Promise.allSettled(
      locations.map(loc => fetchListingsForLocation(loc, hdParams, apiKey))
    )

    const allRaw: HomedataListing[] = []
    let anyOk = false
    for (const result of fetches) {
      if (result.status === 'fulfilled' && result.value.ok) {
        anyOk = true
        allRaw.push(...result.value.results)
      }
    }

    if (!anyOk) {
      return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
    }

    // Deduplicate
    const seen = new Set<string>()
    const deduped = allRaw.filter(r => {
      const key = String(r.uprn ?? r.listing_id ?? r.id ?? '')
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Normalise and filter
    let deals = deduped
      .map(raw => normaliseListing(raw, bench))
      .filter((d): d is DealCandidate => d !== null)

    if (p.minYield) {
      deals = deals.filter(d => d.netYield != null && d.netYield >= p.minYield!)
    }

    deals.sort((a, b) => b.investmentFitScore - a.investmentFitScore)
    deals = deals.slice(0, 50)

    // Meta
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

    return NextResponse.json({ status: 'ok', deals, meta })
  } catch (err) {
    console.error('[deal-finder] unhandled error:', err)
    return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
  }
}
