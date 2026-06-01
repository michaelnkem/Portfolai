// Server-side only — API key never exposed to browser
const HOMEDATA_BASE = 'https://api.homedata.co.uk'
const API_KEY = process.env.HOMEDATA_API_KEY || ''

function headers() {
  return { Authorization: `Api-Key ${API_KEY}` }
}

// ── PropertyData EPC address matching helper ──────────────────────────────────
function matchEpcAddress(
  subjectAddress: string,
  records: Array<{ address: string; score: number; rating: string; inspection_date: string }>
): { matched: boolean; estimated: boolean; rating: string; score: number; date: string } | null {

  if (!records || records.length === 0) return null

  const subjectNum = subjectAddress.match(/\d+/)?.[0] || ''

  // Step 1 — exact house number match
  if (subjectNum) {
    const exact = records.find(r => {
      const rNum = r.address.match(/\d+/)?.[0] || ''
      return rNum === subjectNum
    })
    if (exact) {
      return {
        matched: true,
        estimated: false,
        rating: exact.rating,
        score: exact.score,
        date: exact.inspection_date,
      }
    }
  }

  // Step 2 — closest house number match
  if (subjectNum) {
    const subjectInt = parseInt(subjectNum)
    let closest = records[0]
    let closestDiff = Infinity

    for (const r of records) {
      const rNum = parseInt(r.address.match(/\d+/)?.[0] || '0')
      const diff = Math.abs(rNum - subjectInt)
      if (diff < closestDiff) {
        closestDiff = diff
        closest = r
      }
    }

    // Only use closest match if within 10 house numbers
    if (closestDiff <= 10 && closest) {
      return {
        matched: false,
        estimated: true,
        rating: closest.rating,
        score: closest.score,
        date: closest.inspection_date,
      }
    }
  }

  // Step 3 — street average as last resort
  const ratings = records.map(r => r.score).filter(s => s > 0)
  if (ratings.length >= 3) {
    const avgScore = Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length)
    const avgRating = avgScore >= 92 ? 'A'
      : avgScore >= 81 ? 'B'
      : avgScore >= 69 ? 'C'
      : avgScore >= 55 ? 'D'
      : avgScore >= 39 ? 'E'
      : avgScore >= 21 ? 'F' : 'G'

    return {
      matched: false,
      estimated: true,
      rating: avgRating,
      score: avgScore,
      date: records[0]?.inspection_date || '',
    }
  }

  return null
}

export interface PropertyRecord {
  uprn: number
  full_address: string
  address: string
  postcode: string
  outward_postcode: string
  building_name?: string
  street_name?: string
  town_name?: string
  property_type: string
  built_form?: string
  construction_age_band?: string
  bedrooms: number
  bathrooms?: number
  habitable_rooms?: number
  epc_floor_area?: number
  internal_area_sqm?: number
  current_energy_efficiency?: number
  current_energy_rating?: string
  potential_energy_efficiency?: number
  tenure?: string
  council_tax_band?: string
  has_garden?: boolean
  has_parking?: boolean
  last_sold_date?: string
  last_sold_price?: number
  latitude?: number
  longitude?: number
}

export interface AddressSuggestion {
  uprn: string
  full_address: string
  postcode: string
  address: string
}

export interface EpcData {
  uprn: number
  current_energy_efficiency: number
  potential_energy_efficiency: number
  last_epc_date: string
  epc_floor_area: number
  construction_age_band: string
  epc_id: string
}

export interface RiskResult {
  risk_type: string
  label: string
  score: number
  score_unit: string
  intersects: boolean
  distance_m: number
  radius_description: string
  properties?: Record<string, string>
}

export interface SaleRecord {
  date: string
  price: number
  transaction_type: string
}

export interface PriceTrend {
  outcode: string
  property_type: string
  period: string
  median_price: number
  mean_price: number
  count: number
  price_change_pct?: number
}

// Address search — returns suggestions (2 API calls)
export async function searchAddress(query: string): Promise<AddressSuggestion[]> {
  const res = await fetch(
    `${HOMEDATA_BASE}/api/address/find/?q=${encodeURIComponent(query)}`,
    { headers: headers(), next: { revalidate: 3600 } },
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.suggestions || data.results || []
}

// Full property record by UPRN — correct endpoint is /api/address/retrieve/{uprn}/
export async function getProperty(uprn: string): Promise<PropertyRecord | null> {
  const res = await fetch(
    `${HOMEDATA_BASE}/api/address/retrieve/${uprn}/?level=property`,
    { headers: headers(), cache: 'no-store' },
  )
  if (!res.ok) {
    console.error(`getProperty ${uprn} failed:`, res.status)
    return null
  }
  const data = await res.json()
  console.log('getProperty response keys:', Object.keys(data).slice(0, 10))
  // Handle all known response shapes
  if (data.uprn) return data
  if (data.data?.uprn) return data.data
  if (data.property?.uprn) return data.property
  if (data.results?.[0]?.uprn) return data.results[0]
  return data
}

// EPC data by UPRN — with PropertyData fallback
export async function getEpc(uprn: string, address?: string, postcode?: string): Promise<EpcData | null> {
  // Source 1 — Homedata
  const res = await fetch(
    `${HOMEDATA_BASE}/api/epc/${uprn}/`,
    { headers: headers(), cache: 'no-store' },
  )
  if (res.ok) {
    const data = await res.json()
    const result = data.data || data
    if (result?.current_energy_efficiency || result?.current_energy_rating) {
      return result
    }
  }

  // Fallback 3 — PropertyData /energy-efficiency
  // Only called if Homedata returned nothing
  // Uses address matching to find exact or nearest property on same street
  const propertyDataKey = process.env.PROPERTYDATA_API_KEY
  if (propertyDataKey && postcode) {
    try {
      const pdRes = await fetch(
        `https://api.propertydata.co.uk/energy-efficiency?key=${encodeURIComponent(propertyDataKey)}&postcode=${encodeURIComponent(postcode)}`,
        { cache: 'no-store' }
      )

      if (pdRes.ok) {
        const pdData = await pdRes.json()

        if (pdData?.status === 'success' && Array.isArray(pdData?.energy_efficiency)) {
          const records = pdData.energy_efficiency as Array<{
            address: string
            score: number
            rating: string
            inspection_date: string
          }>

          console.log(`PropertyData EPC: ${records.length} records for ${postcode}`)

          const matchResult = matchEpcAddress(address || '', records)

          if (matchResult) {
            console.log(`PropertyData EPC match: ${matchResult.matched ? 'exact' : 'estimated'} — rating ${matchResult.rating} score ${matchResult.score}`)

            return {
              uprn: Number(uprn),
              current_energy_efficiency: matchResult.score,
              potential_energy_efficiency: matchResult.score + 5,
              last_epc_date: matchResult.date,
              epc_floor_area: 0,
              construction_age_band: '',
              epc_id: '',
              current_energy_rating: matchResult.rating,
              source: matchResult.matched ? 'propertydata_exact' : 'propertydata_estimated',
              estimated: matchResult.estimated,
            } as EpcData & {
              current_energy_rating: string
              source: string
              estimated: boolean
            }
          }
        }
      }
    } catch (e) {
      console.error('PropertyData EPC fallback error:', e)
    }
  }

  return null
}

// Environmental risks
export async function getRisks(uprn: string): Promise<RiskResult[]> {
  const res = await fetch(
    `${HOMEDATA_BASE}/api/risks/all/?uprn=${uprn}`,
    { headers: headers(), cache: 'no-store' },
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.results || data.risks || []
}

// Transaction history
export async function getTransactions(uprn: string): Promise<SaleRecord[]> {
  const res = await fetch(
    `${HOMEDATA_BASE}/api/transactions/?uprn=${uprn}`,
    { headers: headers(), cache: 'no-store' },
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.results || data.transactions || data.data || []
}

// Price trends by outcode (1 call)
export async function getPriceTrends(outcode: string): Promise<PriceTrend[]> {
  const res = await fetch(
    `${HOMEDATA_BASE}/api/price_trends/${outcode}/`,
    { headers: headers(), next: { revalidate: 3600 } },
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.results || []
}

// Comparable sales (10 calls — use carefully on free tier)
export async function getComparables(uprn: string): Promise<SaleRecord[]> {
  const res = await fetch(
    `${HOMEDATA_BASE}/api/comparables/?uprn=${uprn}&radius=0.25&limit=5`,
    { headers: headers(), next: { revalidate: 3600 } },
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.results || []
}

// ── Comparable Sales — Growth-plan endpoint ───────────────────────────────────
export interface ComparableSale {
  address:       string
  postcode:      string
  price:         number
  date:          string
  property_type: string
  bedrooms:      number | null
  floor_area:    number | null
  uprn:          string | null
  distance_m:    number | null
}

export async function getHomedataComparables(
  uprn:        string,
  radiusMiles = 0.5,
  limit       = 25,
): Promise<ComparableSale[]> {
  try {
    const url = `${HOMEDATA_BASE}/api/comparables/?uprn=${uprn}&radius=${radiusMiles}&limit=${limit}`
    const res = await fetch(url, { headers: headers(), cache: 'no-store' })
    if (!res.ok) {
      console.log(`[homedata comps] ${res.status} for UPRN ${uprn}`)
      return []
    }

    const data = await res.json()
    const raw: unknown[] =
      Array.isArray(data.results)     ? data.results
      : Array.isArray(data.comparables) ? data.comparables
      : Array.isArray(data.data)        ? data.data
      : Array.isArray(data)             ? data
      : []

    const mapped: ComparableSale[] = raw.map((item: unknown) => {
      const i = item as Record<string, unknown>
      return {
        address:       String(i.address || i.full_address || ''),
        postcode:      String(i.postcode || i.post_code || ''),
        price:         Number(i.price || i.sold_price || i.last_sold_price || 0),
        date:          String(i.date || i.sold_date || i.last_sold_date || ''),
        property_type: String(i.property_type || i.propertyType || ''),
        bedrooms:      i.bedrooms != null ? Number(i.bedrooms) : null,
        floor_area:    i.floor_area != null     ? Number(i.floor_area)
                     : i.internal_area_sqm != null ? Number(i.internal_area_sqm)
                     : i.epc_floor_area != null  ? Number(i.epc_floor_area)
                     : null,
        uprn:          i.uprn != null ? String(i.uprn) : null,
        distance_m:    i.distance_m != null ? Number(i.distance_m) : null,
      }
    })

    return mapped.filter(c => c.price > 10000 && c.date !== '')
  } catch (e) {
    console.error('[homedata comps] error:', e)
    return []
  }
}

// Flood risk (1 call)
export async function getFloodRisk(uprn: string): Promise<RiskResult | null> {
  const res = await fetch(
    `${HOMEDATA_BASE}/api/risks/flood/?uprn=${uprn}`,
    { headers: headers(), next: { revalidate: 86400 } },
  )
  if (!res.ok) return null
  const data = await res.json()
  return data.results?.[0] || null
}

// Schools nearby (1 call)
export async function getSchoolsNearby(uprn: string): Promise<Array<{ name: string; type: string; rating: string; distance_m: number }>> {
  const res = await fetch(
    `${HOMEDATA_BASE}/api/schools/?uprn=${uprn}&radius=800`,
    { headers: headers(), next: { revalidate: 86400 } },
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.results || []
}
