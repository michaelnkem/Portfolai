import { NextRequest, NextResponse } from 'next/server'
import {
  getProperty, getEpc, getTransactions, getRisks, getHomedataComparables,
} from '@/lib/homedata'
import type { ComparableSale } from '@/lib/homedata'
import { MARKET_DATA, calcGrossYield, calcNetYield, calcNetMonthlyIncome } from '@/lib/market-data'

// ── HMO Intelligence — Phase 1 ───────────────────────────────────────────────
interface HmoRecord {
  uprn?:            string
  address?:         string
  postcode?:        string
  licence_number?:  string
  licence_type?:    string
  bedrooms?:        number
  occupants?:       number
  licence_start?:   string
  licence_end?:     string
  distance_miles?:  number
}

interface HmoResult {
  isLicensed:          boolean
  licenceNumber:       string | null
  licenceType:         string | null
  licenceExpiry:       string | null
  nearbyWithin05Miles: number
  epcCompliant:        boolean | null
  sizeCompliant:       boolean | null
  mandatoryLicensing:  boolean
  verdict:             'licensed' | 'strong_potential' | 'possible' | 'restricted' | 'insufficient_data'
  hmoScore:            number
  articleFourSignal:   'likely_restricted' | 'likely_permitted' | 'unknown' | 'not_checked'
  planningRefusals:    number
  planningApprovals:   number
  rawRecords:          HmoRecord[]
}

function matchHmoAddress(candidateAddress: string, targetAddress: string): boolean {
  if (!candidateAddress || !targetAddress) return false
  const normalise = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  const a = normalise(candidateAddress)
  const b = normalise(targetAddress)
  if (a === b) return true
  // Match on house number + first word of street
  const numMatch = a.match(/^(\d+[a-z]?)/)
  if (!numMatch) return false
  const num = numMatch[1]
  const streetWordA = a.split(' ')[1] ?? ''
  const streetWordB = b.split(' ')[1] ?? ''
  return b.startsWith(num) && streetWordA === streetWordB
}

// ── REPLACE the entire fetchHmoData function in src/app/api/property/route.ts ──
// Find: async function fetchHmoData(
// Replace from that line to the closing } of the function (around line 250)

async function fetchHmoData(
  postcode:  string,
  outcode:   string,
  address:   string,
  bedrooms:  number,
  floorArea: number | null,
  epcRating: string,
  apiKey:    string,
): Promise<HmoResult | null> {
  console.log(`HMO fetch: postcode=${postcode} key=${apiKey?.slice(0,6)}`)

  // ── Helper: parse HMO records from response handling both data formats ────
  // API returns either { data: HmoRecord[] } or { data: { hmos: HmoRecord[] } }
  function parseHmoRecords(resp: { status?: string; data?: unknown } | null): HmoRecord[] {
    if (!resp || resp.status !== 'success') return []
    const d = resp.data
    if (Array.isArray(d)) return d as HmoRecord[]
    if (d && typeof d === 'object' && Array.isArray((d as Record<string,unknown>).hmos))
      return (d as Record<string,unknown>).hmos as HmoRecord[]
    return []
  }

  // ── Fetch planning, rents and initial HMO register concurrently ───────────
  const [hmoRes, planningRes, rentsRes] = await Promise.allSettled([
    fetch(
      `https://api.propertydata.co.uk/national-hmo-register?key=${apiKey}&postcode=${encodeURIComponent(postcode)}`,
      { cache: 'no-store' }
    ),
    fetch(
      `https://api.propertydata.co.uk/planning-applications?key=${apiKey}&postcode=${encodeURIComponent(postcode)}`,
      { cache: 'no-store' }
    ),
    fetch(
      `https://api.propertydata.co.uk/rents?key=${apiKey}&postcode=${encodeURIComponent(outcode)}`,
      { cache: 'no-store' }
    ),
  ])

  // Process HMO register response
  console.log(`HMO register raw: fulfilled=${hmoRes.status === 'fulfilled'} httpStatus=${hmoRes.status === 'fulfilled' ? hmoRes.value.status : 'n/a'} ok=${hmoRes.status === 'fulfilled' ? hmoRes.value.ok : 'n/a'}`)
  const hmoResponse = hmoRes.status === 'fulfilled' && hmoRes.value.ok
    ? await hmoRes.value.json() as { status?: string; data?: unknown }
    : null

  // Process planning applications response
  const planningResponse = planningRes.status === 'fulfilled' && planningRes.value.ok
    ? await planningRes.value.json() as { status?: string; data?: Array<Record<string, unknown>> }
    : null

  console.log(`Planning applications for ${postcode}: status=${planningResponse?.status} count=${Array.isArray(planningResponse?.data) ? planningResponse.data.length : 0}`)

  // Parse rents response
  const rentsResponse = rentsRes.status === 'fulfilled' && rentsRes.value.ok
    ? await rentsRes.value.json() as { status?: string; data?: { long_let?: { average?: number; raw_data?: Array<{ bedrooms?: number | null; price?: number }> } } }
    : null

  // Filter raw listings by bedroom count for accuracy, fall back to district average
  const rawListings = rentsResponse?.data?.long_let?.raw_data ?? []
  console.log(`Rents filter: bedrooms=${bedrooms} type=${typeof bedrooms} rawCount=${rawListings.length} bedroomMatch=${rawListings.filter(l => l.bedrooms === bedrooms).length}`)
  const bedroomListings = rawListings.filter(l => l.bedrooms === bedrooms && typeof l.price === 'number')
  const fallbackListings = rawListings.filter(l => typeof l.price === 'number')
  const relevantListings = bedroomListings.length >= 3 ? bedroomListings : fallbackListings
  const weeklyRent = relevantListings.length > 0
    ? relevantListings.reduce((sum, l) => sum + (l.price ?? 0), 0) / relevantListings.length
    : (rentsResponse?.status === 'success' ? rentsResponse?.data?.long_let?.average ?? null : null)
  const monthlyWhole = weeklyRent ? weeklyRent * 52 / 12 : null
  const sharedRoomRent   = monthlyWhole ? Math.round(monthlyWhole * 0.38) : null
  const ensuiteRoomRent  = monthlyWhole ? Math.round(monthlyWhole * 0.48) : null
  const singleLetMonthly = monthlyWhole ? Math.round(monthlyWhole) : null

  console.log(`HMO register response: status=${hmoResponse?.status} keys=${JSON.stringify(Object.keys(hmoResponse || {}))}`)
  if (!hmoResponse || hmoResponse.status !== 'success') return null

  // ── Radius fallback: if no records at default radius, retry with expanding radii ──
  // Each level applies a distance weight to the nearby count to penalise lower locality
  // Weight: 1.0 = exact postcode, 0.8 = 0.5mi, 0.6 = 1mi, 0.4 = 1.5mi
  type RadiusResult = { records: HmoRecord[]; distanceWeight: number; radiusUsed: number | null }

  const initialRecords = parseHmoRecords(hmoResponse)
  let radiusResult: RadiusResult = { records: initialRecords, distanceWeight: 1.0, radiusUsed: null }

  if (initialRecords.length === 0) {
    // Try expanding radii sequentially until we find records
    const radiiToTry: Array<{ radius: number; weight: number }> = [
      { radius: 0.5, weight: 0.8 },
      { radius: 1.0, weight: 0.6 },
      { radius: 1.5, weight: 0.4 },
    ]
    for (const { radius, weight } of radiiToTry) {
      try {
        const fallbackRes = await fetch(
          `https://api.propertydata.co.uk/national-hmo-register?key=${apiKey}&postcode=${encodeURIComponent(postcode)}&radius=${radius}`,
          { cache: 'no-store' }
        )
        if (!fallbackRes.ok) continue
        const fallbackData = await fallbackRes.json() as { status?: string; data?: unknown }
        const fallbackRecords = parseHmoRecords(fallbackData)
        console.log(`HMO radius fallback ${radius}mi: found ${fallbackRecords.length} records (weight=${weight})`)
        if (fallbackRecords.length > 0) {
          radiusResult = { records: fallbackRecords, distanceWeight: weight, radiusUsed: radius }
          break
        }
      } catch {
        // silent — continue to next radius
      }
    }
  }

  const records = radiusResult.records
  const distanceWeight = radiusResult.distanceWeight

  // 1. Is THIS property licensed?
  const thisRecord = records.find(r => matchHmoAddress(r.address ?? '', address))
  const isLicensed = !!thisRecord

  // 2. Nearby count — weighted by distance when radius fallback was used
  const rawNearbyCount = records.filter(r =>
    !matchHmoAddress(r.address ?? '', address) &&
    (r.distance_miles == null || r.distance_miles <= (radiusResult.radiusUsed ?? 0.5))
  ).length
  const nearbyWithin05Miles = Math.round(rawNearbyCount * distanceWeight)

  // 3. EPC compliance — F/G are ineligible
  const epcUpper = epcRating?.toUpperCase()
  const epcCompliant = epcUpper && epcUpper !== 'UNKNOWN'
    ? !['F', 'G'].includes(epcUpper)
    : null

  // 4. Size compliance — total floor area ÷ bedrooms ≥ 6.51m²
  const sizeCompliant = floorArea && bedrooms > 0
    ? (floorArea / bedrooms) >= 6.51
    : null

  // 5. Mandatory licensing threshold
  const mandatoryLicensing = bedrooms >= 5

  // Article 4 Direction — scan planning applications for HMO signals
  let articleFourSignal: HmoResult['articleFourSignal'] = 'unknown'
  let planningRefusals = 0
  let planningApprovals = 0

  if (planningResponse?.status === 'success' && Array.isArray(planningResponse?.data)) {
    const applications = planningResponse.data
    const threeYearsAgo = new Date()
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)

    const hmoKeywords = [
      'hmo', 'house in multiple occupation', 'article 4',
      'c3 to c4', 'change of use', 'sui generis',
      'permitted development', 'multiple occupancy'
    ]
    const restrictionKeywords = [
      'article 4', 'refused', 'refusal', 'not permitted',
      'planning permission required', 'permitted development removed'
    ]
    const approvalKeywords = [
      'approved', 'granted', 'permitted', 'allowed'
    ]

    for (const app of applications) {
      const description = String(app.description || app.proposal || '').toLowerCase()
      const decision    = String(app.decision || app.status || '').toLowerCase()
      const dateStr     = String(app.decision_date || app.date || '')
      const appDate     = dateStr ? new Date(dateStr) : null

      // Only consider applications from last 3 years
      if (appDate && appDate < threeYearsAgo) continue

      // Check if this application is HMO-related
      const isHmoRelated = hmoKeywords.some(kw => description.includes(kw))
      if (!isHmoRelated) continue

      const isRefusal  = restrictionKeywords.some(kw => decision.includes(kw) || description.includes(kw))
      const isApproval = approvalKeywords.some(kw => decision.includes(kw))

      if (isRefusal) planningRefusals++
      else if (isApproval) planningApprovals++
    }

    if (planningRefusals >= 2) {
      articleFourSignal = 'likely_restricted'
    } else if (planningApprovals >= 2 && planningRefusals === 0) {
      articleFourSignal = 'likely_permitted'
    } else {
      articleFourSignal = 'unknown'
    }

    console.log(`Article 4 signal for ${postcode}: ${articleFourSignal} (${planningRefusals} refusals, ${planningApprovals} approvals)`)
  } else {
    // No planning data available — mark as not checked only when API key was used but no data returned
    articleFourSignal = planningResponse === null ? 'not_checked' : 'unknown'
    console.log(`Article 4 signal: ${articleFourSignal} (${planningRefusals} refusals, ${planningApprovals} approvals)`)
  }

  // 6. HMO Score (0–100)
  // nearbyWithin05Miles is already distance-weighted so scoring remains unchanged
  let score = 0
  if (isLicensed)                     score += 40
  if (nearbyWithin05Miles >= 5)        score += 20
  else if (nearbyWithin05Miles >= 2)   score += 10
  if (epcCompliant === true)           score += 15
  if (bedrooms >= 4)                   score += 15
  else if (bedrooms >= 3)              score += 8
  if (sizeCompliant === true)          score += 10
  if (articleFourSignal === 'likely_restricted')     score -= 20
  else if (articleFourSignal === 'likely_permitted') score += 10
  const hmoScore = Math.min(100, Math.max(0, score))

  // 7. Verdict
  let verdict: HmoResult['verdict']
  if (articleFourSignal === 'likely_restricted' && !isLicensed) {
    verdict = 'restricted'
  } else if (isLicensed) {
    verdict = 'licensed'
  } else if (epcCompliant === false) {
    verdict = 'restricted'
  } else if (hmoScore >= 60 && bedrooms >= 3) {
    verdict = 'strong_potential'
  } else if (hmoScore >= 30 || nearbyWithin05Miles > 0) {
    verdict = 'possible'
  } else {
    verdict = 'insufficient_data'
  }

  return {
    isLicensed,
    licenceNumber:       thisRecord?.licence_number ?? null,
    licenceType:         thisRecord?.licence_type   ?? null,
    licenceExpiry:       thisRecord?.licence_end    ?? null,
    nearbyWithin05Miles,
    epcCompliant,
    sizeCompliant,
    mandatoryLicensing,
    verdict,
    hmoScore,
    articleFourSignal,
    planningRefusals,
    planningApprovals,
    rawRecords:          records.slice(0, 10),
    sharedRoomRent,
    ensuiteRoomRent,
    singleLetMonthly,
  }
}
// redeploy Tue  2 Jun 2026 07:18:05 BST
