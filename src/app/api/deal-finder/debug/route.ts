import { NextRequest, NextResponse } from 'next/server'
import { MARKET_DATA, calcInvestmentFit } from '@/lib/market-data'
import type { UserBenchmark } from '@/lib/market-data'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DealCandidate {
  id: string
  uprn: string | null
  address: string
  displayAddress: string
  postcode: string
  city: string
  propertyType: string | null
  bedrooms: number | null
  bathrooms: number | null
  tenure: string | null
  askingPrice: number
  previousAskingPrice: number | null
  epcRating: string | null
  imageUrl: string | null
  listingDate: string | null
  updatedAt: string | null
  listingStatus: 'new_listing' | 'reduced' | 'for_sale'
  rentEstimateMonthly: number | null
  grossYield: number | null
  netYield: number | null
  investmentFitScore: number
  investmentFitLabel: string
  investmentReasons: string[]
  badge: string
  badgeColour: string
}

interface DealFinderMeta {
  totalDeals: number
  avgNetYield: number | null
  avgAskingPrice: number | null
  bestNetYield: number | null
  bestNetYieldCity: string | null
  newListingsCount: number
}

interface HomedataListing {
  id: string
  uprn?: string | null
  street?: string | null
  postcode?: string | null
  latest_price?: number | null
  previous_price?: number | null
  latest_status?: string | null
  property_type?: string | null
  bedrooms?: number | null
  bathrooms?: number | null
  ownership?: string | null
  is_reduced?: boolean
  is_new_build?: boolean
  is_withdrawn?: boolean
  has_garden?: boolean | null
  has_parking?: boolean | null
  added_date?: string | null
  updated_date?: string | null
  days_on_market?: number | null
  agent_name?: string | null
  image_url?: string | null
  epc_rating?: string | null
}

const BASE = 'https://api.homedata.co.uk/api'

// ── City → boundary ID mapping ────────────────────────────────────────────────
// Cached from debug probe to avoid extra API calls on every request
const CITY_BOUNDARY_IDS: Record<string, number> = {
  Manchester: 14356,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getBoundaryId(city: string, apiKey: string): Promise<number | null> {
  // Return cached ID if available
  if (CITY_BOUNDARY_IDS[city]) return CITY_BOUNDARY_IDS[city]

  try {
    const res = await fetch(
      `${BASE}/boundaries/autocomplete/?q=${encodeURIComponent(city)}`,
      { headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' }, cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    const id = data?.results?.[0]?.id
    if (id) {
      CITY_BOUNDARY_IDS[city] = Number(id)
      return Number(id)
    }
    return null
  } catch {
    return null
  }
}

async function fetchListingsForCity(
  city: string,
  boundaryId: number,
  apiKey: string,
  filters: {
    minPrice?: number
    maxPrice?: number
    minBedrooms?: number
    maxBedrooms?: number
    propertyTypes?: string[]
  }
): Promise<HomedataListing[]> {
  try {
    const params = new URLSearchParams({
      boundary_id: String(boundaryId),
      transaction_type: 'Sale',
      page_size: '50',
    })

    // Only include active for-sale listings — exclude Sold STC and withdrawn
    params.set('is_withdrawn', 'false')

    if (filters.minPrice && filters.minPrice > 0) params.set('min_price', String(filters.minPrice))
    if (filters.maxPrice && filters.maxPrice > 0) params.set('max_price', String(filters.maxPrice))
    if (filters.minBedrooms && filters.minBedrooms > 0) params.set('min_bedrooms', String(filters.minBedrooms))
    if (filters.maxBedrooms && filters.maxBedrooms < 10) params.set('max_bedrooms', String(filters.maxBedrooms))

    const url = `${BASE}/live-listings/search/?${params}`
    const res = await fetch(url, {
      headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!res.ok) {
      console.log(`Listings fetch failed for ${city}: ${res.status}`)
      return []
    }

    const data = await res.json()
    const results: HomedataListing[] = data?.results || []

    // Filter out Sold STC on client side as belt-and-braces
    return results.filter(l =>
      l.latest_status !== 'Sold STC' &&
      l.latest_status !== 'Under Offer' &&
      !l.is_withdrawn &&
      l.latest_price && l.latest_price > 0
    )
  } catch (e) {
    console.error(`Error fetching listings for ${city}:`, e)
    return []
  }
}

function detectCityFromPostcode(postcode: string): string {
  const pc = (postcode || '').toUpperCase().trim()
  const outward = pc.split(' ')[0]
  const londonPrefixes = ['EC','WC','SW','SE','NW','W1','W2','W3','W4','W5','W6','W7','W8','W9','N1','N2','N3','N4','N5','N6','N7','N8','N9','E1','E2','E3','E4','E5','E6','E7','E8','E9','BR','CR','DA','EN','HA','IG','KT','RM','SM','TW','UB','WD']
  if (londonPrefixes.some(p => outward.startsWith(p))) return 'London'
  if (outward.startsWith('BS')) return 'Bristol'
  if (outward.startsWith('NG')) return 'Nottingham'
  if (outward.startsWith('LS')) return 'Leeds'
  if (outward.startsWith('S') && !outward.startsWith('SK') && !outward.startsWith('SM')) return 'Sheffield'
  if (outward.startsWith('L') && !outward.startsWith('LS')) return 'Liverpool'
  if (outward.startsWith('B') && !outward.startsWith('BR') && !outward.startsWith('BS')) return 'Birmingham'
  if (outward.startsWith('M') || outward.startsWith('SK')) return 'Manchester'
  return 'London'
}

function estimateRentFromCity(cityName: string, beds: number, propertyType: string): number {
  const city = MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities]
  const avgRent = city?.avgRent || 1200
  const bedMultiplier: Record<number, number> = { 0: 0.55, 1: 0.75, 2: 1.00, 3: 1.35, 4: 1.70, 5: 2.10 }
  const isHmo = propertyType?.toLowerCase().includes('hmo')
  const multiplier = isHmo ? (beds * 0.55) : (bedMultiplier[Math.min(beds, 5)] || 1.00)
  return Math.round(avgRent * multiplier / 50) * 50
}

function calcNetYieldSimple(price: number, monthlyRent: number): number {
  const annualRent = monthlyRent * 12
  const effectiveRent = annualRent * (50 / 52) // 2 void weeks
  const mgmt = effectiveRent * 0.10
  const maintenance = price * 0.015
  const netIncome = effectiveRent - mgmt - maintenance
  return parseFloat(((netIncome / price) * 100).toFixed(2))
}

function normaliseListing(
  listing: HomedataListing,
  city: string,
): DealCandidate | null {
  const price = listing.latest_price
  if (!price || price <= 0) return null

  const beds = listing.bedrooms ?? null
  const propertyType = listing.property_type
    ? listing.property_type.charAt(0).toUpperCase() + listing.property_type.slice(1)
    : null

  const postcode = listing.postcode || ''
  const street = listing.street || ''
  const address = [street, postcode].filter(Boolean).join(', ')
  const displayAddress = street || postcode || 'Address unavailable'

  const detectedCity = postcode ? detectCityFromPostcode(postcode) : city

  const monthlyRent = beds && beds > 0 && propertyType
    ? estimateRentFromCity(detectedCity, beds, propertyType)
    : estimateRentFromCity(detectedCity, 2, 'terraced')

  const grossYield = parseFloat(((monthlyRent * 12 / price) * 100).toFixed(2))
  const netYield = calcNetYieldSimple(price, monthlyRent)

  // Listing status
  let listingStatus: 'new_listing' | 'reduced' | 'for_sale' = 'for_sale'
  if (listing.is_reduced) listingStatus = 'reduced'
  else if (listing.added_date) {
    const daysOld = Math.floor((Date.now() - new Date(listing.added_date).getTime()) / 86400000)
    if (daysOld <= 7) listingStatus = 'new_listing'
  }

  // EPC rating — normalise to single letter
  const epcRaw = listing.epc_rating?.trim().toUpperCase().charAt(0)
  const epcRating = epcRaw && /[A-G]/.test(epcRaw) ? epcRaw : null

  return {
    id: listing.id,
    uprn: listing.uprn || null,
    address,
    displayAddress,
    postcode,
    city: detectedCity,
    propertyType,
    bedrooms: beds,
    bathrooms: listing.bathrooms || null,
    tenure: listing.ownership || null,
    askingPrice: price,
    previousAskingPrice: listing.previous_price || null,
    epcRating,
    imageUrl: listing.image_url || null,
    listingDate: listing.added_date || null,
    updatedAt: listing.updated_date || null,
    listingStatus,
    rentEstimateMonthly: monthlyRent,
    grossYield,
    netYield,
    // Scores applied after normalisation
    investmentFitScore: 0,
    investmentFitLabel: '',
    investmentReasons: [],
    badge: '',
    badgeColour: 'grey',
  }
}

function applyInvestmentFit(
  deal: DealCandidate,
  benchmark: UserBenchmark,
): DealCandidate {
  const cityData = MARKET_DATA.cities[deal.city as keyof typeof MARKET_DATA.cities]

  const result = calcInvestmentFit(
    {
      askingPrice: deal.askingPrice,
      estimatedNetYield: deal.netYield || 0,
      estimatedGrossYield: deal.grossYield || 0,
      propertyType: deal.propertyType || 'Terraced',
      bedrooms: deal.bedrooms || 2,
      tenure: deal.tenure || 'Freehold',
      epcRating: deal.epcRating || 'D',
      cityName: deal.city,
      hasFloodRisk: false,
      capitalGrowth1yr: cityData?.capitalGrowth1yr,
    },
    benchmark
  )

  // Build investment reasons from primaryStrength + cross-city note
  const reasons: string[] = [result.primaryStrength]
  if (deal.city !== benchmark.preferredTypes[0]) {
    const cityInfo = MARKET_DATA.cities[deal.city as keyof typeof MARKET_DATA.cities]
    if (cityInfo && deal.netYield && deal.netYield > benchmark.avgNetYield) {
      reasons.push(`Cross-city opportunity — ${deal.city}`)
    }
  }
  if (deal.listingStatus === 'reduced') reasons.push('Price reduced')
  if (deal.epcRating && deal.epcRating <= 'C') reasons.push('EPC compliant 2028')

  return {
    ...deal,
    investmentFitScore: result.score,
    investmentFitLabel: result.label,
    investmentReasons: reasons,
    badge: result.badge,
    badgeColour: result.badgeColour,
  }
}

function buildBenchmark(params: URLSearchParams): UserBenchmark {
  const favAvgNetYield = parseFloat(params.get('favAvgNetYield') || '5')
  const favAvgValue    = parseFloat(params.get('favAvgValue')    || '300000')
  const favPropertyTypes = (params.get('favPropertyTypes') || 'Terraced,Semi-Detached')
    .split(',').map(s => s.trim()).filter(Boolean)
  const favMinBeds = parseInt(params.get('favMinBeds') || '1')
  const favMaxBeds = parseInt(params.get('favMaxBeds') || '5')

  const preferredBeds: number[] = []
  for (let b = Math.max(1, favMinBeds); b <= Math.min(6, favMaxBeds); b++) preferredBeds.push(b)

  return {
    avgNetYield: favAvgNetYield || 5,
    avgGrossYield: (favAvgNetYield || 5) + 2,
    avgPrice: favAvgValue || 300000,
    preferredTypes: favPropertyTypes.length ? favPropertyTypes : ['Terraced', 'Semi-Detached'],
    preferredBeds: preferredBeds.length ? preferredBeds : [2, 3, 4],
    preferredTenure: 'Any',
    minNetYield: (favAvgNetYield || 5) * 0.75,
    minPrice: (favAvgValue || 300000) * 0.4,
    maxPrice: (favAvgValue || 300000) * 1.8,
  }
}

function buildMeta(deals: DealCandidate[]): DealFinderMeta {
  const yields = deals.map(d => d.netYield).filter((y): y is number => y !== null && y > 0)
  const prices = deals.map(d => d.askingPrice).filter(p => p > 0)
  const newCount = deals.filter(d => d.listingStatus === 'new_listing').length

  const bestDeal = deals.reduce<DealCandidate | null>((best, d) => {
    if (!best || (d.netYield || 0) > (best.netYield || 0)) return d
    return best
  }, null)

  return {
    totalDeals: deals.length,
    avgNetYield: yields.length
      ? parseFloat((yields.reduce((a, b) => a + b, 0) / yields.length).toFixed(1))
      : null,
    avgAskingPrice: prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length / 1000) * 1000
      : null,
    bestNetYield: bestDeal?.netYield ?? null,
    bestNetYieldCity: bestDeal?.city ?? null,
    newListingsCount: newCount,
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const apiKey = process.env.HOMEDATA_API_KEY

  if (!apiKey) {
    console.error('HOMEDATA_API_KEY not configured')
    return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
  }

  try {
    const params = req.nextUrl.searchParams
    const mode = params.get('mode') || 'ai'

    // Cities to search
    const citiesParam = params.get('cities') || ''
    const requestedCities = citiesParam
      .split(',')
      .map(c => c.trim())
      .filter(c => c && MARKET_DATA.cities[c as keyof typeof MARKET_DATA.cities])

    // For AI mode with no cities specified, use all supported cities
    // For cross-city discovery, always search broadly
    const citiesToSearch = requestedCities.length > 0
      ? requestedCities
      : Object.keys(MARKET_DATA.cities)

    // Filters
    const minPrice     = parseInt(params.get('minPrice')     || '0')
    const maxPrice     = parseInt(params.get('maxPrice')     || '0')
    const minYield     = parseFloat(params.get('minYield')   || '0')
    const minBedrooms  = parseInt(params.get('minBedrooms')  || '0')
    const maxBedrooms  = parseInt(params.get('maxBedrooms')  || '10')
    const propertyTypes = (params.get('propertyTypes') || '').split(',').map(s => s.trim()).filter(Boolean)

    // Build user benchmark from favourites profile
    const benchmark = buildBenchmark(params)

    // Fetch listings for all cities in parallel
    const cityFetches = citiesToSearch.map(async city => {
      const boundaryId = await getBoundaryId(city, apiKey)
      if (!boundaryId) {
        console.log(`No boundary ID found for ${city}`)
        return []
      }
      return fetchListingsForCity(city, boundaryId, apiKey, {
        minPrice: minPrice > 0 ? minPrice : undefined,
        maxPrice: maxPrice > 0 ? maxPrice : undefined,
        minBedrooms: minBedrooms > 0 ? minBedrooms : undefined,
        maxBedrooms: maxBedrooms < 10 ? maxBedrooms : undefined,
        propertyTypes: propertyTypes.length > 0 ? propertyTypes : undefined,
      })
    })

    const cityResults = await Promise.allSettled(cityFetches)
    const allListings: HomedataListing[] = cityResults
      .filter((r): r is PromiseFulfilledResult<HomedataListing[]> => r.status === 'fulfilled')
      .flatMap(r => r.value)

    console.log(`Deal Finder: ${allListings.length} raw listings across ${citiesToSearch.length} cities`)

    if (allListings.length === 0) {
      // If we got no listings at all, likely a plan/auth issue
      return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
    }

    // Normalise all listings into DealCandidate shape
    const normalised = allListings
      .map(l => normaliseListing(l, 'Unknown'))
      .filter((d): d is DealCandidate => d !== null)

    // Apply investment fit scoring
    const scored = normalised.map(d => applyInvestmentFit(d, benchmark))

    // Apply yield filter if specified
    const filtered = minYield > 0
      ? scored.filter(d => (d.netYield || 0) >= minYield)
      : scored

    // Sort by investment fit score descending
    const sorted = filtered.sort((a, b) => b.investmentFitScore - a.investmentFitScore)

    // Cross-city diversity — max 3 from same city in first 9 results
    const diversified: DealCandidate[] = []
    const cityCount: Record<string, number> = {}
    const remainder: DealCandidate[] = []

    for (const deal of sorted) {
      const count = cityCount[deal.city] || 0
      if (count < 3 || diversified.length >= 9) {
        diversified.push(deal)
        cityCount[deal.city] = count + 1
      } else {
        remainder.push(deal)
      }
    }

    const finalDeals = [...diversified, ...remainder].slice(0, 50)
    const meta = buildMeta(finalDeals)

    console.log(`Deal Finder: returning ${finalDeals.length} scored deals, avg fit ${finalDeals.length ? Math.round(finalDeals.reduce((s, d) => s + d.investmentFitScore, 0) / finalDeals.length) : 0}%`)

    return NextResponse.json({ status: 'ok', deals: finalDeals, meta })

  } catch (e) {
    console.error('Deal Finder route error:', e)
    return NextResponse.json({ status: 'unavailable', deals: [], meta: null })
  }
}
