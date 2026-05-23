// Server-side only — API key never exposed to browser
const HOMEDATA_BASE = 'https://api.homedata.co.uk'
const API_KEY = process.env.HOMEDATA_API_KEY || ''

function headers() {
  return { Authorization: `Api-Key ${API_KEY}` }
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

// EPC data by UPRN — tries Homedata first, then free EPC public API
export async function getEpc(uprn: string): Promise<EpcData | null> {
  // Try Homedata first
  try {
    const res = await fetch(
      `${HOMEDATA_BASE}/api/epc/${uprn}/`,
      { headers: headers(), cache: 'no-store' },
    )
    if (res.ok) {
      const data = await res.json()
      const epc = data.data || data
      if (epc?.current_energy_rating || epc?.current_energy_efficiency) return epc
    }
  } catch { /* fall through to public API */ }

  // Fallback: EPC open data public API (no auth required)
  // https://epc.opendatacommunities.org/docs/api
  try {
    const res = await fetch(
      `https://epc.opendatacommunities.org/api/v1/domestic/uprn/${uprn}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Basic ' + Buffer.from('portfolai@example.com:').toString('base64'),
        },
        cache: 'no-store',
      }
    )
    if (res.ok) {
      const data = await res.json()
      const row = data?.rows?.[0]
      if (row) {
        return {
          uprn: Number(uprn),
          current_energy_efficiency: Number(row['current-energy-efficiency'] || 0),
          potential_energy_efficiency: Number(row['potential-energy-efficiency'] || 0),
          last_epc_date: String(row['lodgement-date'] || ''),
          epc_floor_area: Number(row['total-floor-area'] || 0),
          construction_age_band: String(row['construction-age-band'] || ''),
          epc_id: String(row['lmk-key'] || ''),
          current_energy_rating: String(row['current-energy-rating'] || ''),
        } as EpcData & { current_energy_rating: string }
      }
    }
  } catch { /* both failed */ }

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
