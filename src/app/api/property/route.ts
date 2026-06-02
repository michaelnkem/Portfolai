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
  sharedRoomRent:      number | null
  ensuiteRoomRent:     number | null
  singleLetMonthly:    number | null
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
    ? await hmoRes.value.json() as { status?: string; data?: Array<Record<string, unknown>> | HmoRecord[] }
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

  console.log(`HMO register response: status=${hmoResponse?.status} dataIsArray=${Array.isArray(hmoResponse?.data)} keys=${JSON.stringify(Object.keys(hmoResponse || {}))}`)
  if (!hmoResponse || hmoResponse.status !== 'success') return null
  const records: HmoRecord[] = Array.isArray(hmoResponse.data) ? hmoResponse.data as HmoRecord[] : []

  // 1. Is THIS property licensed?
  const thisRecord = records.find(r => matchHmoAddress(r.address ?? '', address))
  const isLicensed = !!thisRecord

  // 2. Nearby count (within 0.5 miles — API returns distance_miles if available)
  const nearbyWithin05Miles = records.filter(r =>
    !matchHmoAddress(r.address ?? '', address) &&
    (r.distance_miles == null || r.distance_miles <= 0.5)
  ).length

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
  let score = 0
  if (isLicensed)                     score += 40
  if (nearbyWithin05Miles >= 5)        score += 20
  else if (nearbyWithin05Miles >= 2)   score += 10
  if (epcCompliant === true)           score += 15
  if (bedrooms >= 4)                   score += 15
  else if (bedrooms >= 3)              score += 8
  if (sizeCompliant === true)          score += 10
  // Article 4 adjustment
  if (articleFourSignal === 'likely_restricted') score -= 20
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')
  const uprn = searchParams.get('uprn')

  if (!process.env.HOMEDATA_API_KEY) {
    return NextResponse.json({ error: 'HOMEDATA_API_KEY not configured' }, { status: 500 })
  }

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

  if (uprn) {
    try {
      const [property, transactions, risks] = await Promise.all([
        getProperty(uprn),
        getTransactions(uprn).catch(() => []),
        getRisks(uprn).catch(() => []),
      ])

      const propRecordEarly = property as Record<string, unknown> | null
      const epc = await getEpc(
        uprn,
        String(propRecordEarly?.full_address || propRecordEarly?.address || ''),
        String(propRecordEarly?.postcode || '')
      ).catch(() => null)

      const prop = property || { uprn, full_address: `UPRN ${uprn}`, address: `UPRN ${uprn}` }
      const cityName = detectCity(
        String((prop as Record<string,unknown>).town_name || ''),
        String((prop as Record<string,unknown>).postcode || '')
      )
      const cityData = MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities]
        || MARKET_DATA.cities.London

      const propRecord = prop as Record<string, unknown>
      const postcode   = String(propRecord.postcode || '')

      const defaults = {
        serviceCharge: String(propRecord.property_type || '').toLowerCase().includes('flat') ? 2000 : 0,
        groundRent: String(propRecord.tenure || '').toLowerCase().includes('leasehold') ? 200 : 0,
        managementFee: 10,
        maintenanceAllowance: 1.5,
        voidWeeks: 2,
      }

      const subjectAddr = String(propRecord.full_address || propRecord.address || '')
      const homedataComparablesPromise = uprn
        ? getHomedataComparables(uprn, 0.5, 25).catch(e => {
            console.log('[comps] Homedata comparables failed, falling back to LR:', e)
            return [] as ComparableSale[]
          })
        : Promise.resolve([] as ComparableSale[])

      const [lrData, epcOpenData, homedataComps] = await Promise.all([
        fetchLrData(postcode, subjectAddr, true),
        fetchEpcData(postcode, subjectAddr, process.env.EPC_API_KEY, process.env.EPC_API_EMAIL),
        homedataComparablesPromise,
      ])

      // Build valuation comparables: Homedata first (>= 3), LR fallback
      let valuationComps: LrTransaction[]
      if (homedataComps.length >= 3) {
        valuationComps = homedataComps.map(c => ({
          price:      c.price,
          date:       c.date,
          type:       c.property_type,
          address:    c.address,
          _bedrooms:  c.bedrooms ?? undefined,
          _floorArea: c.floor_area ?? undefined,
        } as LrTransaction))
        console.log(`[comps] Using ${homedataComps.length} Homedata comparables`)
      } else {
        const lrDataWithComps = await fetchLrData(postcode, subjectAddr, false)
        valuationComps = lrDataWithComps.comps
        console.log(`[comps] Fell back to ${valuationComps.length} Land Registry comparables`)
      }

      const resolvedEpc = epc || epcOpenData.subjectEpc

      const lrLastSold    = lrData.history.length > 0 ? lrData.history[0] : null
      const lastSoldPrice = lrLastSold ? lrLastSold.price : Number(propRecord.last_sold_price || 0)
      const lastSoldDate  = lrLastSold ? lrLastSold.date  : String(propRecord.last_sold_date || '')
      let allTransactions = lrData.history.length > 0
        ? lrData.history.map(t => ({ price: t.price, date: t.date, transaction_type: t.type }))
        : (transactions || []).slice(0, 20)

      // Fallback: synthesise a transaction from property record when both LR and Homedata return nothing
      if (allTransactions.length === 0 && lastSoldPrice > 0 && lastSoldDate) {
        allTransactions = [{ price: lastSoldPrice, date: lastSoldDate, transaction_type: 'Standard' }]
      }

      // ── ATTRIBUTE RECOVERY v1.0 ────────────────────────────────────────────────
      const resolvedEpcR = resolvedEpc as Record<string, unknown> | null
      // Always check EPC Open Data subject first — Homedata EPC often lacks total_floor_area
      const epcOpenSub   = epcOpenData.subjectEpc as Record<string, unknown> | null
      const epcFloorAreaN = Number(
        epcOpenSub?.total_floor_area ||      // EPC Open Data register — highest priority
        resolvedEpcR?.epc_floor_area ||      // Homedata EpcData field
        resolvedEpcR?.total_floor_area ||    // EPC Open Data via resolvedEpc
        propRecord.internal_area_sqm || propRecord.epc_floor_area || 0
      )
      const epcFloorArea = epcFloorAreaN > 0 ? epcFloorAreaN : null
      const propRecordWithCity = { ...propRecord, _cityName: cityName, _homedataComps: homedataComps }
      const attrs = enrichAttributes(propRecordWithCity, epcFloorArea, postcode)

      // Pass resolved floor area and bedrooms into valuation — always override Homedata 0-values
      const valuationProp = {
        ...propRecord,
        last_sold_price: lastSoldPrice,
        last_sold_date:  lastSoldDate,
        ...(epcFloorArea ? { epc_floor_area: epcFloorArea } : {}),
        ...(attrs.bedrooms != null ? { bedrooms: attrs.bedrooms } : {}),
      }

      // ── HYBRID VALUATION ENGINE v1.0 ───────────────────────────────────────────
      const valuation = await calcValuation(
        valuationProp,
        cityName,
        cityData,
        valuationComps,
        epcOpenData.floorAreas,
        process.env.HOMEDATA_API_KEY!
      )

      const effectivePrice = lastSoldPrice || valuation.fairValue

      const estimatedRent = estimateRent(
        String(propRecord.property_type || ''),
        Number(attrs.bedrooms ?? propRecord.bedrooms ?? 1),
        cityData.avgRent,
      )

      const grossYield = effectivePrice ? calcGrossYield(effectivePrice, estimatedRent) : 0
      const netYield   = effectivePrice ? calcNetYield(
        effectivePrice, estimatedRent,
        defaults.serviceCharge, defaults.groundRent,
        defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
      ) : 0

      const floodRisk  = (risks || []).find((r: Record<string,unknown>) => r.risk_type === 'flood_rivers_sea')

      // EPC rating: efficiency score → letter; or direct letter from EPC Open Data; or property record
      // epcOpenSub takes priority for the letter rating as it comes directly from the register
      const epcScore = Number(resolvedEpcR?.current_energy_efficiency ?? 0)
      const epcRating = epcScore > 0
        ? efficiencyToRating(epcScore)
        : resolvedEpcR?.current_energy_rating
          ? String(resolvedEpcR.current_energy_rating)
          : epcOpenSub?.current_energy_rating
            ? String(epcOpenSub.current_energy_rating)
            : String(propRecord.current_energy_rating || 'Unknown')

      // HMO Intelligence — Phase 1
      // Wrapped in catch so it NEVER blocks the page load
      const hmoOutcode = postcode.trim().split(' ')[0].toUpperCase()
      const hmoResult = process.env.PROPERTYDATA_API_KEY
        ? await fetchHmoData(
            hmoOutcode,
            String(propRecord.full_address || propRecord.address || ''),
            Number(attrs.bedrooms ?? propRecord.bedrooms ?? 2),
            epcFloorArea !== null ? epcFloorArea : null,
            epcRating,
            process.env.PROPERTYDATA_API_KEY
          ).catch(() => null)
        : null

      return NextResponse.json({
        uprn,
        property: { ...prop, last_sold_price: lastSoldPrice, last_sold_date: lastSoldDate },
        epc: resolvedEpc,
        transactions: allTransactions,
        risks: risks || [],
        cityData,
        cityName,
        enriched: {
          estimatedRent,
          estimatedCurrentValue:  valuation.fairValue,
          valuationLow:           valuation.lowValue,
          valuationHigh:          valuation.highValue,
          valuationConfidence:    valuation.confidence,
          valuationCompsUsed:     valuation.compsUsed,
          valuationMethod:        valuation.method,
          valuationWeightedPsqm:  valuation.weightedPsqm,
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
          epcRating,
          epcFloorArea,
          defaults,
          // Attribute Recovery results
          attrBedrooms:           attrs.bedrooms,
          attrBedroomsLabel:      attrs.bedroomsLabel,
          attrBedroomsConfidence: attrs.bedroomsConfidence,
          attrBedroomsInferred:   attrs.bedroomsInferred,
          attrBathroomsLabel:     attrs.bathroomsLabel,
          attrBathroomsInferred:  attrs.bathroomsInferred,
          attrTenureLabel:        attrs.tenureLabel,
          attrTenureInferred:     attrs.tenureInferred,
          attrGardenLabel:        attrs.gardenLabel,
          attrGardenInferred:     attrs.gardenInferred,
          // HMO Intelligence — Phase 1
          hmo:                   hmoResult,
          hmoVerdict:            hmoResult?.verdict              ?? null,
          hmoScore:              hmoResult?.hmoScore             ?? null,
          hmoLicensed:           hmoResult?.isLicensed           ?? false,
          hmoNearbyCount:        hmoResult?.nearbyWithin05Miles  ?? 0,
          hmoArticleFourSignal:  hmoResult?.articleFourSignal    ?? 'not_checked',
          hmoPlanningRefusals:   hmoResult?.planningRefusals     ?? 0,
          hmoPlanningApprovals:  hmoResult?.planningApprovals    ?? 0,
          hmoSharedRoomRent:     hmoResult?.sharedRoomRent       ?? null,
          hmoEnsuiteRoomRent:    hmoResult?.ensuiteRoomRent      ?? null,
          hmoSingleLetMonthly:   hmoResult?.singleLetMonthly     ?? null,
        },
      })
    } catch (e) {
      console.error('Property fetch error:', e)
      return NextResponse.json({ error: 'Failed to fetch property data' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Provide q (search) or uprn' }, { status: 400 })
}

// ── Address search ────────────────────────────────────────────────────────────
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
  if (Array.isArray(obj)) items = obj
  else if (Array.isArray(obj.suggestions)) items = obj.suggestions as unknown[]
  else if (Array.isArray(obj.results)) items = obj.results as unknown[]
  else if (Array.isArray(obj.addresses)) items = obj.addresses as unknown[]
  else if (Array.isArray(obj.data)) items = obj.data as unknown[]

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
  const t  = (town || '').toLowerCase()
  const pc = (postcode || '').toUpperCase().trim()
  const outward = pc.split(' ')[0]

  // Explicit prefix mappings — must come before generic single-letter fallbacks
  // North East England (NE prefix would falsely match N* London without this guard)
  if (outward.startsWith('NE') || outward.startsWith('SR') || outward.startsWith('TS') ||
      outward.startsWith('DL') || outward.startsWith('DH')) return 'Sheffield'
  // North West extras → Manchester
  if (outward.startsWith('WA') || outward.startsWith('CH') || outward.startsWith('PR') ||
      outward.startsWith('BB') || outward.startsWith('FY') || outward.startsWith('WN') ||
      outward.startsWith('LA')) return 'Manchester'
  // Yorkshire → Leeds
  if (outward.startsWith('BD') || outward.startsWith('HX') || outward.startsWith('WF') ||
      outward.startsWith('YO') || outward.startsWith('HU') || outward.startsWith('DN')) return 'Leeds'
  // Midlands extras → Birmingham
  if (outward.startsWith('CV') || outward.startsWith('LE') || outward.startsWith('DE') ||
      outward.startsWith('NN') || outward.startsWith('MK') || outward.startsWith('PE') ||
      outward.startsWith('WV') || outward.startsWith('WS') || outward.startsWith('WR')) return 'Birmingham'
  // South coast → Bristol
  if (outward.startsWith('SO') || outward.startsWith('PO') || outward.startsWith('BN')) return 'Bristol'
  // Wales → Bristol (nearest major city in dataset)
  if (outward.startsWith('CF') || outward.startsWith('SA') || outward.startsWith('NP') ||
      outward.startsWith('LL') || outward.startsWith('LD') || outward.startsWith('SY')) return 'Bristol'
  // SE commuter belt → London
  if (outward.startsWith('RG') || outward.startsWith('SL') || outward.startsWith('HP') ||
      outward.startsWith('LU') || outward.startsWith('GU') || outward.startsWith('RH') ||
      outward.startsWith('TN') || outward.startsWith('CT') || outward.startsWith('ME') ||
      outward.startsWith('CB') || outward.startsWith('IP') || outward.startsWith('NR') ||
      outward.startsWith('CO') || outward.startsWith('OX')) return 'London'
  // Scotland → Leeds proxy (comparable northern price bands; LA_HPI provides local calibration)
  if ((outward.startsWith('G') && !outward.startsWith('GU')) ||
      outward.startsWith('EH') || outward.startsWith('AB') || outward.startsWith('DD') ||
      outward.startsWith('PA') || outward.startsWith('KA') || outward.startsWith('KY') ||
      outward.startsWith('FK') || outward.startsWith('PH') || outward.startsWith('IV')) return 'Leeds'

  // Town name checks
  if (t.includes('london'))     return 'London'
  if (t.includes('manchester') || t.includes('salford') || t.includes('stockport')) return 'Manchester'
  if (t.includes('birmingham') || t.includes('solihull') || t.includes('wolverhampton')) return 'Birmingham'
  if (t.includes('liverpool'))  return 'Liverpool'
  if (t.includes('leeds'))      return 'Leeds'
  if (t.includes('sheffield'))  return 'Sheffield'
  if (t.includes('bristol'))    return 'Bristol'
  if (t.includes('nottingham')) return 'Nottingham'
  if (t.includes('bradford') || t.includes('wakefield') || t.includes('york') || t.includes('hull')) return 'Leeds'
  if (t.includes('newcastle') || t.includes('sunderland') || t.includes('middlesbrough')) return 'Sheffield'
  if (t.includes('glasgow') || t.includes('edinburgh') || t.includes('aberdeen')) return 'Leeds'
  if (t.includes('cardiff') || t.includes('swansea') || t.includes('newport')) return 'Bristol'

  // London postcode patterns (all non-London W/N/E already handled above)
  const londonPrefixes = [
    'EC','WC','SW','SE','NW',
    'W1','W2','W3','W4','W5','W6','W7','W8','W9',
    'N1','N2','N3','N4','N5','N6','N7','N8','N9',
    'E1','E2','E3','E4','E5','E6','E7','E8','E9',
    'BR','CR','DA','EN','HA','IG','KT','RM','SM','TW','UB','WD',
  ]
  if (londonPrefixes.some(p => outward.startsWith(p))) return 'London'
  if (['E','N','W'].some(p => outward === p || (outward.startsWith(p) && /^[ENW]\d/.test(outward)))) return 'London'

  if (outward.startsWith('BS')) return 'Bristol'
  if (outward.startsWith('NG')) return 'Nottingham'
  if (outward.startsWith('LS')) return 'Leeds'
  if (outward.startsWith('SK')) return 'Manchester'
  if (outward.startsWith('L') && !outward.startsWith('LS') && !outward.startsWith('LL') && !outward.startsWith('LD')) return 'Liverpool'
  if (outward.startsWith('B') && !outward.startsWith('BR') && !outward.startsWith('BS') && !outward.startsWith('BB') && !outward.startsWith('BN')) return 'Birmingham'
  if (outward.startsWith('M')) return 'Manchester'
  if (outward.startsWith('S') && !outward.startsWith('SK') && !outward.startsWith('SM')) return 'Sheffield'

  return 'London'
}

function estimateRent(propertyType: string, beds: number, cityAvgRent: number): number {
  const bedMultiplier: Record<number, number> = { 0: 0.55, 1: 0.75, 2: 1.00, 3: 1.35, 4: 1.70, 5: 2.10 }
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

// ── ATTRIBUTE RECOVERY ENGINE v1.0 ───────────────────────────────────────────
// 5-step process: primary → secondary → historical → inference → validation
interface AttrResult {
  bedrooms: number | null
  bedroomsLabel: string
  bedroomsConfidence: number
  bedroomsInferred: boolean
  bathrooms: number | null
  bathroomsLabel: string
  bathroomsInferred: boolean
  tenure: string
  tenureLabel: string
  tenureInferred: boolean
  hasGarden: boolean | null
  gardenLabel: string
  gardenInferred: boolean
}

function normPropertyType(t: string): string {
  const tl = (t || '').toLowerCase()
  if (tl.includes('flat') || tl.includes('maisonette') || tl.includes('apartment')) return 'flat'
  if (tl.includes('semi')) return 'semi'
  if (tl.includes('detach')) return 'detached'
  return 'terraced'
}

// Spec-defined bedroom inference tables
function inferBedroomsFromArea(area: number, propertyType: string, isEnfield = false): { beds: number; confidence: number } {
  const t = normPropertyType(propertyType)
  if (t === 'flat') {
    if (area < 40)  return { beds: 0, confidence: 78 }
    if (area < 60)  return { beds: 1, confidence: 78 }
    if (area < 80)  return { beds: 2, confidence: 72 }
    if (area < 100) return { beds: 3, confidence: 65 }
    return          { beds: 4, confidence: 60 }
  }
  if (t === 'terraced') {
    // Enfield terraced houses are typically larger family homes — tighter thresholds
    if (isEnfield) {
      if (area < 70)  return { beds: 2, confidence: 75 }
      if (area < 100) return { beds: 3, confidence: 78 }
      if (area < 140) return { beds: 4, confidence: 73 }
      return          { beds: 5, confidence: 65 }
    }
    if (area < 75)  return { beds: 2, confidence: 72 }
    if (area < 110) return { beds: 3, confidence: 78 }
    if (area < 140) return { beds: 4, confidence: 73 }
    return          { beds: 5, confidence: 65 }
  }
  if (t === 'semi') {
    if (isEnfield) {
      if (area < 90)  return { beds: 3, confidence: 73 }
      if (area < 135) return { beds: 4, confidence: 72 }
      return          { beds: 5, confidence: 65 }
    }
    if (area < 95)  return { beds: 3, confidence: 73 }
    if (area < 130) return { beds: 4, confidence: 72 }
    return          { beds: 5, confidence: 65 }
  }
  // detached
  if (area < 120) return { beds: 4, confidence: 65 }
  if (area < 160) return { beds: 5, confidence: 65 }
  return          { beds: 6, confidence: 60 }
}

// Conflict detection — bedroom count strongly conflicts with floor area
function bedroomConflictsWithArea(beds: number, area: number, propertyType: string, isEnfield = false): boolean {
  const t = normPropertyType(propertyType)
  if (t === 'flat') {
    if (area < 45  && beds > 1)  return true
    if (area > 95  && beds < 3)  return true
    if (area > 120 && beds < 4)  return true
  }
  if (t === 'terraced') {
    if (isEnfield) {
      // Enfield terraced: stricter thresholds — 100+ sqm should be 4-bed
      if (area < 65   && beds > 2)  return true
      if (area >= 70  && beds < 3)  return true
      if (area >= 100 && beds < 4)  return true
      if (area >= 140 && beds < 5)  return true
    } else {
      if (area < 65  && beds > 2)  return true
      if (area > 75  && beds < 3)  return true
      if (area > 110 && beds < 4)  return true
      if (area > 140 && beds < 5)  return true
    }
  }
  if (t === 'semi') {
    if (area < 75  && beds > 3)  return true
    if (area > 95  && beds < 3)  return true
    if (area > 130 && beds < 4)  return true
  }
  if (t === 'detached') {
    if (area < 90  && beds > 4)  return true
    if (area > 120 && beds < 4)  return true
    if (area > 160 && beds < 5)  return true
  }
  return false
}

function enrichAttributes(
  prop: Record<string, unknown>,
  floorArea: number | null,
  postcode: string,
): AttrResult {
  const propertyType = String(prop.property_type || '')
  const t            = normPropertyType(propertyType)
  // Detect Enfield (EN1/EN2/EN3 and any EN outward code) for Enfield-specific inference
  const pcNorm       = postcode.replace(/\s+/g, '').toUpperCase()
  const isEnfield    = /^EN\d/.test(pcNorm)
  // Homedata returns 0 for unknown bedrooms — treat 0 as null so inference can run
  const statedBeds   = (prop.bedrooms != null && Number(prop.bedrooms) > 0) ? Number(prop.bedrooms) : null
  const statedBaths  = prop.bathrooms != null ? Number(prop.bathrooms) : null
  const statedTenure = String(prop.tenure || '').trim()
  const statedGarden = prop.has_garden

  // ── Bedrooms: 3-step recovery ────────────────────────────────────────────────
  let beds = statedBeds
  let bedroomsLabel      = beds != null ? String(beds) : 'Not recorded'
  let bedroomsConfidence = 100
  let bedroomsInferred   = false

  if (floorArea && floorArea > 0) {
    if (beds == null) {
      const inf = inferBedroomsFromArea(floorArea, propertyType, isEnfield)
      beds = inf.beds
      bedroomsLabel      = inf.beds === 0 ? 'Studio' : String(inf.beds)
      bedroomsConfidence = inf.confidence
      bedroomsInferred   = true
    } else if (bedroomConflictsWithArea(beds, floorArea, propertyType, isEnfield)) {
      const inf = inferBedroomsFromArea(floorArea, propertyType, isEnfield)
      beds = inf.beds
      bedroomsLabel      = inf.beds === 0 ? 'Studio' : String(inf.beds)
      bedroomsConfidence = inf.confidence
      bedroomsInferred   = true
    }
  }

  // ── Extended bedroom fallback chain (runs only when beds still null) ──────────
  if (beds === null) {
    const habitableRooms = Number(prop.habitable_rooms ?? prop.habitableRooms ?? 0)
    if (habitableRooms > 0) {
      const inf = inferBedsFromHabitableRooms(habitableRooms, propertyType)
      if (inf) {
        console.log(`[beds] Habitable rooms fallback: ${habitableRooms} → ${inf.beds} beds`)
        beds = inf.beds; bedroomsLabel = inf.beds === 0 ? 'Studio' : String(inf.beds)
        bedroomsConfidence = inf.confidence; bedroomsInferred = true
      }
    }
  }
  if (beds === null) {
    const addr = String(prop.full_address ?? prop.address ?? '')
    if (addr) {
      const inf = inferBedsFromAddress(addr)
      if (inf) {
        console.log(`[beds] Address string fallback: "${addr}" → ${inf.beds} beds`)
        beds = inf.beds; bedroomsLabel = inf.beds === 0 ? 'Studio' : String(inf.beds)
        bedroomsConfidence = inf.confidence; bedroomsInferred = true
      }
    }
  }
  if (beds === null) {
    const lastSoldPrice = Number(prop.last_sold_price ?? 0)
    const lastSoldDate  = String(prop.last_sold_date ?? '')
    const propCityName  = String(prop._cityName ?? 'London')
    if (lastSoldPrice > 0 && lastSoldDate) {
      const inf = inferBedsFromPrice(lastSoldPrice, lastSoldDate, propertyType, propCityName, postcode)
      if (inf) {
        console.log(`[beds] Price banding fallback: £${lastSoldPrice.toLocaleString()} → ${inf.beds} beds`)
        beds = inf.beds; bedroomsLabel = inf.beds === 0 ? 'Studio' : String(inf.beds)
        bedroomsConfidence = inf.confidence; bedroomsInferred = true
      }
    }
  }
  if (beds === null) {
    // Fallback C.5 — Homedata comparable bedroom distribution
    const homedataComps = (prop as Record<string, unknown>)._homedataComps as ComparableSale[] | undefined
    if (homedataComps && homedataComps.length >= 3) {
      const typeNorm = normPropertyType(propertyType)
      const sameTypeComps = homedataComps.filter(c =>
        normPropertyType(c.property_type) === typeNorm &&
        c.bedrooms != null &&
        c.bedrooms > 0
      )
      if (sameTypeComps.length >= 2) {
        const lastSoldPrice = Number(prop.last_sold_price || 0)
        if (lastSoldPrice > 0) {
          const sorted = [...sameTypeComps].sort((a, b) =>
            Math.abs(a.price - lastSoldPrice) - Math.abs(b.price - lastSoldPrice)
          )
          const closestComp = sorted[0]
          if (closestComp.bedrooms != null) {
            beds = closestComp.bedrooms
            bedroomsLabel = beds === 0 ? 'Studio' : String(beds)
            bedroomsConfidence = 52
            bedroomsInferred = true
            console.log(`[beds] Comparable distribution: ${beds} beds from nearest comp`)
          }
        }
      }
    }
  }
  if (beds === null) {
    const inf = inferBedsFromPostcodeModal(postcode, propertyType)
    if (inf) {
      console.log(`[beds] Postcode modal fallback: ${postcode} ${propertyType} → ${inf.beds} beds`)
      beds = inf.beds; bedroomsLabel = inf.beds === 0 ? 'Studio' : String(inf.beds)
      bedroomsConfidence = inf.confidence; bedroomsInferred = true
    }
  }
  if (beds === null) {
    console.log('[beds] All fallbacks exhausted')
    bedroomsLabel = 'Not recorded'; bedroomsConfidence = 0; bedroomsInferred = false
  }

  // ── Bathrooms: area-based inference when absent ──────────────────────────────
  let bathrooms      = statedBaths
  let bathroomsLabel = statedBaths != null ? String(statedBaths) : 'Unknown'
  let bathroomsInferred = false

  if (statedBaths == null) {
    const area = floorArea || 70
    let inf: number
    if      (area < 70)  inf = 1
    else if (area < 120) inf = t === 'flat' ? 1 : 2
    else                 inf = t === 'flat' ? 2 : t === 'detached' ? 3 : 2

    bathrooms      = inf
    bathroomsLabel = String(inf)
    bathroomsInferred = true
  }

  // ── Tenure: property-type heuristics ────────────────────────────────────────
  let tenureLabel   = statedTenure || 'Unknown'
  let tenureInferred = false

  if (!statedTenure) {
    const out = postcode.toUpperCase().split(' ')[0]
    const newBuildLeaseholdPrefixes = ['M4','M15','M50','B1','B5','LS1','LS2']
    if (t === 'flat') {
      tenureLabel = 'Likely Leasehold'
    } else if (newBuildLeaseholdPrefixes.some(p => out.startsWith(p))) {
      tenureLabel = 'Likely Leasehold'
    } else {
      tenureLabel = 'Likely Freehold'
    }
    tenureInferred = true
  }

  // ── Garden: property-type heuristics ────────────────────────────────────────
  let hasGarden: boolean | null = statedGarden === true ? true : statedGarden === false ? false : null
  let gardenLabel   = hasGarden === true ? 'Yes' : hasGarden === false ? 'No' : 'Unknown'
  let gardenInferred = false

  if (hasGarden === null) {
    if (t === 'flat') {
      hasGarden  = false
      gardenLabel = 'Likely No Garden'
    } else {
      hasGarden  = true
      gardenLabel = 'Likely Rear Garden'
    }
    gardenInferred = true
  }

  return {
    bedrooms: beds, bedroomsLabel, bedroomsConfidence, bedroomsInferred,
    bathrooms, bathroomsLabel, bathroomsInferred,
    tenure: tenureLabel, tenureLabel, tenureInferred,
    hasGarden, gardenLabel, gardenInferred,
  }
}

// ── HYBRID VALUATION ENGINE v1.0 ─────────────────────────────────────────────
// L1 Comparable Engine — primary (50–75% weight based on evidence strength)
// L2 District Trends   — Homedata price_trends (20%)
// L3 LA HPI Calibration— local authority + property type growth (20%)
// L4 City Fallback     — bedroom-adjusted city average (10%)
// Dynamic weight redistribution. Calibration bands as soft guidance only.

// Local Authority HPI table — 5yr property-type-specific growth rates (%)
// Sources: UK HPI ONS Feb 2026, Land Registry local authority analysis
interface LaHpi { la: string; det: number; semi: number; ter: number; flat: number }
const LA_HPI: Record<string, LaHpi> = {
  // Outer London
  'EN': { la:'Enfield',      det:20.0, semi:22.0, ter:21.0, flat: 8.0 },
  'RM': { la:'Havering',     det:10.0, semi:11.0, ter:12.0, flat: 4.0 },
  'DA': { la:'Bexley',       det: 9.0, semi:10.0, ter:11.0, flat: 3.5 },
  'IG': { la:'Redbridge',    det: 7.0, semi: 8.0, ter: 9.0, flat: 2.5 },
  'HA': { la:'Harrow',       det: 6.0, semi: 7.0, ter: 8.0, flat: 2.0 },
  'CR': { la:'Croydon',      det: 7.0, semi: 8.0, ter: 9.0, flat: 2.0 },
  'BR': { la:'Bromley',      det: 5.0, semi: 6.0, ter: 7.0, flat: 1.5 },
  'KT': { la:'Kingston',     det: 4.0, semi: 5.0, ter: 6.0, flat: 1.5 },
  'TW': { la:'Richmond',     det: 3.0, semi: 4.0, ter: 5.0, flat: 1.0 },
  'UB': { la:'Hillingdon',   det: 5.0, semi: 6.0, ter: 7.0, flat: 2.0 },
  'SM': { la:'Sutton',       det: 4.0, semi: 5.0, ter: 6.0, flat: 1.5 },
  'WD': { la:'Watford',      det: 6.0, semi: 7.0, ter: 8.0, flat: 2.5 },
  // Inner London — specific districts (lookup tries most specific first)
  'N16': { la:'Stoke Newington',  det:22.0, semi:21.0, ter:20.0, flat: 3.0 },
  'N1':  { la:'Islington',        det:17.0, semi:16.0, ter:15.0, flat: 2.0 },
  'N4':  { la:'Finsbury Park',    det:18.0, semi:17.0, ter:16.0, flat: 2.5 },
  'N5':  { la:'Highbury',         det:18.0, semi:17.0, ter:16.0, flat: 2.5 },
  'N6':  { la:'Highgate',         det:14.0, semi:13.0, ter:12.0, flat: 2.0 },
  'N7':  { la:'Holloway',         det:17.0, semi:16.0, ter:15.0, flat: 2.0 },
  'N8':  { la:'Crouch End',       det:16.0, semi:15.0, ter:14.0, flat: 2.0 },
  'E8':  { la:'Hackney',          det:22.0, semi:21.0, ter:20.0, flat: 4.0 },
  'E9':  { la:'Homerton',         det:20.0, semi:19.0, ter:18.0, flat: 3.5 },
  'E2':  { la:'Bethnal Green',    det:20.0, semi:19.0, ter:18.0, flat: 3.5 },
  'E3':  { la:'Bow',              det:18.0, semi:17.0, ter:16.0, flat: 3.0 },
  'SE22':{ la:'East Dulwich',     det:18.0, semi:17.0, ter:16.0, flat: 2.5 },
  'SE15':{ la:'Peckham',          det:20.0, semi:19.0, ter:18.0, flat: 3.0 },
  'SE5': { la:'Camberwell',       det:18.0, semi:17.0, ter:16.0, flat: 2.5 },
  'SE24':{ la:'Herne Hill',       det:16.0, semi:15.0, ter:14.0, flat: 2.0 },
  'SW9': { la:'Brixton',          det:17.0, semi:16.0, ter:15.0, flat: 2.0 },
  'NW1': { la:'Camden',           det:14.0, semi:13.0, ter:12.0, flat: 1.5 },
  'NW3': { la:'Hampstead',        det:12.0, semi:11.0, ter:10.0, flat: 1.0 },
  'NW5': { la:'Kentish Town',     det:15.0, semi:14.0, ter:13.0, flat: 1.5 },
  // Inner London — generic prefix fallbacks (houses up 15-18% over 5yr, flats flat/declining)
  'E':  { la:'East London',  det:18.0, semi:17.0, ter:16.0, flat: 3.0 },
  'N':  { la:'North London', det:17.0, semi:16.0, ter:15.0, flat: 2.0 },
  'SW': { la:'South West',   det:13.0, semi:12.0, ter:11.0, flat: 0.5 },
  'SE': { la:'South East',   det:16.0, semi:15.0, ter:14.0, flat: 2.0 },
  'W':  { la:'West London',  det:10.0, semi: 9.0, ter: 8.0, flat:-0.5 },
  'NW': { la:'North West',   det:13.0, semi:12.0, ter:11.0, flat: 1.0 },
  'EC': { la:'City',         det: 5.0, semi: 4.0, ter: 4.0, flat:-2.0 },
  'WC': { la:'West Central', det: 5.0, semi: 4.0, ter: 4.0, flat:-2.0 },
  // Northern England — core cities
  'M':  { la:'Manchester',   det:35.0, semi:33.0, ter:32.0, flat:28.0 },
  'SK': { la:'Stockport',    det:28.0, semi:26.0, ter:25.0, flat:20.0 },
  'B':  { la:'Birmingham',   det:28.0, semi:27.0, ter:25.0, flat:20.0 },
  'L':  { la:'Liverpool',    det:34.0, semi:33.0, ter:32.0, flat:25.0 },
  'LS': { la:'Leeds',        det:29.0, semi:28.0, ter:27.0, flat:21.0 },
  'S':  { la:'Sheffield',    det:27.0, semi:26.0, ter:25.0, flat:19.0 },
  'NG': { la:'Nottingham',   det:25.0, semi:24.0, ter:23.0, flat:18.0 },
  'BS': { la:'Bristol',      det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  // Yorkshire
  'BD': { la:'Bradford',     det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'HX': { la:'Halifax',      det:17.0, semi:16.0, ter:15.0, flat:12.0 },
  'WF': { la:'Wakefield',    det:19.0, semi:18.0, ter:17.0, flat:13.0 },
  'YO': { la:'York',         det:24.0, semi:23.0, ter:22.0, flat:18.0 },
  'HU': { la:'Hull',         det:22.0, semi:21.0, ter:20.0, flat:15.0 },
  'DN': { la:'Doncaster',    det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  // East / West Midlands
  'DE': { la:'Derby',        det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'LE': { la:'Leicester',    det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'CV': { la:'Coventry',     det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  'NN': { la:'Northampton',  det:17.0, semi:16.0, ter:15.0, flat:11.0 },
  'MK': { la:'Milton Keynes',det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'PE': { la:'Peterborough', det:19.0, semi:18.0, ter:17.0, flat:13.0 },
  'WV': { la:'Wolverhampton',det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'WS': { la:'Walsall',      det:19.0, semi:18.0, ter:17.0, flat:13.0 },
  // North East England
  'NE': { la:'Newcastle',    det:25.0, semi:24.0, ter:23.0, flat:18.0 },
  'SR': { la:'Sunderland',   det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'TS': { la:'Teesside',     det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'DL': { la:'Darlington',   det:17.0, semi:16.0, ter:15.0, flat:11.0 },
  'DH': { la:'Durham',       det:16.0, semi:15.0, ter:14.0, flat:10.0 },
  // North West extras
  'WA': { la:'Warrington',   det:27.0, semi:26.0, ter:25.0, flat:20.0 },
  'CH': { la:'Chester',      det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  'PR': { la:'Preston',      det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  'BB': { la:'Blackburn',    det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'FY': { la:'Blackpool',    det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'LA': { la:'Lancaster',    det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'WN': { la:'Wigan',        det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  // South England
  'SO': { la:'Southampton',  det:14.0, semi:13.0, ter:12.0, flat: 8.0 },
  'PO': { la:'Portsmouth',   det:12.0, semi:11.0, ter:10.0, flat: 7.0 },
  'BN': { la:'Brighton',     det:10.0, semi: 9.0, ter: 8.0, flat: 4.0 },
  'RG': { la:'Reading',      det:12.0, semi:11.0, ter:10.0, flat: 6.0 },
  'OX': { la:'Oxford',       det: 8.0, semi: 7.0, ter: 6.0, flat: 2.0 },
  'SL': { la:'Slough',       det:10.0, semi: 9.0, ter: 8.0, flat: 4.0 },
  'HP': { la:'Hemel/Wycombe',det:10.0, semi: 9.0, ter: 8.0, flat: 4.0 },
  'LU': { la:'Luton',        det:14.0, semi:13.0, ter:12.0, flat: 8.0 },
  'GU': { la:'Guildford',    det: 6.0, semi: 5.0, ter: 4.0, flat: 1.0 },
  'RH': { la:'Redhill',      det: 8.0, semi: 7.0, ter: 6.0, flat: 2.0 },
  'TN': { la:'Tunbridge',    det: 7.0, semi: 6.0, ter: 5.0, flat: 1.0 },
  'CT': { la:'Canterbury',   det:10.0, semi: 9.0, ter: 8.0, flat: 4.0 },
  'ME': { la:'Medway',       det:12.0, semi:11.0, ter:10.0, flat: 6.0 },
  'CB': { la:'Cambridge',    det: 6.0, semi: 5.0, ter: 4.0, flat: 0.0 },
  'IP': { la:'Ipswich',      det:14.0, semi:13.0, ter:12.0, flat: 8.0 },
  'NR': { la:'Norwich',      det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'CO': { la:'Colchester',   det:13.0, semi:12.0, ter:11.0, flat: 7.0 },
  // Scotland
  'G':  { la:'Glasgow',      det:30.0, semi:28.0, ter:27.0, flat:22.0 },
  'EH': { la:'Edinburgh',    det:28.0, semi:26.0, ter:25.0, flat:20.0 },
  'AB': { la:'Aberdeen',     det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'DD': { la:'Dundee',       det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'PA': { la:'Paisley',      det:22.0, semi:21.0, ter:20.0, flat:16.0 },
  'KA': { la:'Kilmarnock',   det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'KY': { la:'Kirkcaldy',    det:16.0, semi:15.0, ter:14.0, flat:10.0 },
  'FK': { la:'Falkirk',      det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'PH': { la:'Perth',        det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'IV': { la:'Inverness',    det:12.0, semi:11.0, ter:10.0, flat: 7.0 },
  // Wales
  'CF': { la:'Cardiff',      det:20.0, semi:19.0, ter:18.0, flat:14.0 },
  'SA': { la:'Swansea',      det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'NP': { la:'Newport',      det:18.0, semi:17.0, ter:16.0, flat:12.0 },
  'LL': { la:'N Wales',      det:15.0, semi:14.0, ter:13.0, flat: 9.0 },
  'SY': { la:'Shrewsbury',   det:14.0, semi:13.0, ter:12.0, flat: 8.0 },
  'LD': { la:'Mid Wales',    det:12.0, semi:11.0, ter:10.0, flat: 6.0 },
}

// Postcode district calibration — £/sqm bands + bedroom anchors (soft guidance)
// Strong local comparables always override these ranges
interface CalibBand {
  psqmMin: number
  psqmMax: number
  anchors: Partial<Record<'studio'|'1bed'|'2bed'|'3bed'|'4bed', { min:number; max:number }>>
}
const CALIBRATION: Record<string, CalibBand> = {
  // Inner London — houses command £7,000–10,000+ /sqm in prime areas
  'N16': { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:620000,max:800000},'3bed':{min:750000,max:960000},'4bed':{min:860000,max:1100000}} },
  'N1':  { psqmMin:8000, psqmMax:11000, anchors:{'2bed':{min:750000,max:950000},'3bed':{min:900000,max:1150000},'4bed':{min:1050000,max:1400000}} },
  'N4':  { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:620000,max:800000},'3bed':{min:750000,max:960000},'4bed':{min:870000,max:1100000}} },
  'N5':  { psqmMin:7500, psqmMax:10000, anchors:{'2bed':{min:670000,max:860000},'3bed':{min:810000,max:1020000},'4bed':{min:940000,max:1200000}} },
  'E8':  { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:600000,max:780000},'3bed':{min:720000,max:930000},'4bed':{min:840000,max:1080000}} },
  'E9':  { psqmMin:6500, psqmMax:9000,  anchors:{'2bed':{min:560000,max:730000},'3bed':{min:680000,max:880000},'4bed':{min:790000,max:1020000}} },
  'E2':  { psqmMin:7000, psqmMax:9500,  anchors:{'1bed':{min:380000,max:520000},'2bed':{min:580000,max:760000},'3bed':{min:700000,max:900000}} },
  'SE22':{ psqmMin:6500, psqmMax:8500,  anchors:{'2bed':{min:560000,max:720000},'3bed':{min:680000,max:860000},'4bed':{min:790000,max:1000000}} },
  'SE15':{ psqmMin:5500, psqmMax:7500,  anchors:{'2bed':{min:460000,max:620000},'3bed':{min:560000,max:740000},'4bed':{min:660000,max:860000}} },
  'SE5': { psqmMin:5500, psqmMax:7500,  anchors:{'2bed':{min:460000,max:620000},'3bed':{min:560000,max:740000}} },
  'SW9': { psqmMin:6000, psqmMax:8000,  anchors:{'2bed':{min:500000,max:660000},'3bed':{min:620000,max:800000},'4bed':{min:730000,max:940000}} },
  'NW1': { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:600000,max:780000},'3bed':{min:730000,max:940000},'4bed':{min:860000,max:1100000}} },
  'NW3': { psqmMin:8000, psqmMax:11000, anchors:{'3bed':{min:900000,max:1200000},'4bed':{min:1100000,max:1500000}} },
  'NW5': { psqmMin:7000, psqmMax:9500,  anchors:{'2bed':{min:600000,max:780000},'3bed':{min:730000,max:940000}} },
  // Outer London
  'EN1': { psqmMin:4500, psqmMax:5800, anchors:{'2bed':{min:340000,max:420000},'3bed':{min:450000,max:560000},'4bed':{min:580000,max:700000}} },
  'EN2': { psqmMin:4800, psqmMax:6200, anchors:{'2bed':{min:370000,max:460000},'3bed':{min:490000,max:600000},'4bed':{min:620000,max:760000}} },
  'EN3': { psqmMin:4200, psqmMax:5600, anchors:{'2bed':{min:300000,max:380000},'3bed':{min:430000,max:530000},'4bed':{min:550000,max:670000}} },
  'EN4': { psqmMin:5200, psqmMax:6800, anchors:{'3bed':{min:550000,max:700000},'4bed':{min:700000,max:900000}} },
  'RM1': { psqmMin:4000, psqmMax:5200, anchors:{'2bed':{min:280000,max:360000},'3bed':{min:380000,max:480000}} },
  'RM3': { psqmMin:4200, psqmMax:5400, anchors:{'2bed':{min:290000,max:370000},'3bed':{min:400000,max:500000}} },
  'M1':  { psqmMin:3800, psqmMax:5500, anchors:{'studio':{min:110000,max:160000},'1bed':{min:160000,max:230000},'2bed':{min:230000,max:320000}} },
  'M14': { psqmMin:2800, psqmMax:4200, anchors:{'2bed':{min:200000,max:280000},'3bed':{min:250000,max:340000}} },
  'M20': { psqmMin:3000, psqmMax:4500, anchors:{'2bed':{min:220000,max:310000},'3bed':{min:280000,max:380000}} },
  'M21': { psqmMin:2900, psqmMax:4300, anchors:{'2bed':{min:210000,max:300000},'3bed':{min:265000,max:360000}} },
  'B1':  { psqmMin:3000, psqmMax:4500, anchors:{'1bed':{min:140000,max:200000},'2bed':{min:190000,max:270000}} },
  'B15': { psqmMin:3500, psqmMax:5200, anchors:{'2bed':{min:230000,max:330000},'3bed':{min:300000,max:420000}} },
  'B29': { psqmMin:2800, psqmMax:4000, anchors:{'2bed':{min:180000,max:250000},'3bed':{min:230000,max:310000}} },
  'L1':  { psqmMin:2500, psqmMax:3800, anchors:{'1bed':{min:100000,max:150000},'2bed':{min:150000,max:220000}} },
  'L15': { psqmMin:2200, psqmMax:3500, anchors:{'2bed':{min:140000,max:200000},'3bed':{min:180000,max:260000}} },
  'L18': { psqmMin:3000, psqmMax:4500, anchors:{'3bed':{min:230000,max:320000},'4bed':{min:300000,max:420000}} },
  'LS1': { psqmMin:2800, psqmMax:4200, anchors:{'1bed':{min:140000,max:200000},'2bed':{min:190000,max:270000}} },
  'LS6': { psqmMin:2500, psqmMax:3800, anchors:{'2bed':{min:180000,max:260000},'3bed':{min:220000,max:310000}} },
  'S1':  { psqmMin:2200, psqmMax:3500, anchors:{'1bed':{min:110000,max:165000},'2bed':{min:160000,max:230000}} },
  'S11': { psqmMin:2800, psqmMax:4200, anchors:{'2bed':{min:200000,max:280000},'3bed':{min:250000,max:350000}} },
  'NG1': { psqmMin:2200, psqmMax:3500, anchors:{'1bed':{min:110000,max:165000},'2bed':{min:155000,max:225000}} },
  'NG7': { psqmMin:2000, psqmMax:3200, anchors:{'2bed':{min:140000,max:200000},'3bed':{min:180000,max:250000}} },
  'BS1': { psqmMin:4000, psqmMax:6000, anchors:{'1bed':{min:240000,max:340000},'2bed':{min:320000,max:450000}} },
  'BS6': { psqmMin:4200, psqmMax:6500, anchors:{'2bed':{min:340000,max:480000},'3bed':{min:420000,max:580000}} },
}

interface ValuationResult {
  fairValue:      number
  lowValue:       number
  highValue:      number
  confidence:     number
  compsUsed:      number
  method:         string
  weightedPsqm:   number | null
}

function getTypicalFloorArea(propertyType: string): number {
  const t = (propertyType || '').toLowerCase()
  if (t.includes('flat') || t.includes('maisonette') || t.includes('apartment')) return 60
  if (t.includes('semi'))    return 88
  if (t.includes('terrace')) return 80
  if (t.includes('detached') && !t.includes('semi')) return 110
  return 80
}

// IQR outlier filter — removes bottom/top ~10–15% using 1.5×IQR rule
function iqrFilter(vals: number[]): number[] {
  if (vals.length < 4) return vals
  const sorted = [...vals].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)]
  const q3 = sorted[Math.floor(sorted.length * 0.75)]
  const iqr = q3 - q1
  return vals.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr)
}

// Weighted 62nd-percentile — leans optimistic (seller asking guidance vs pure median)
function weightedMedian(vals: number[], weights: number[]): number {
  const pairs = vals.map((v, i) => ({ v, w: weights[i] })).sort((a, b) => a.v - b.v)
  const total = pairs.reduce((s, p) => s + p.w, 0)
  let cumul = 0
  for (const p of pairs) {
    cumul += p.w
    if (cumul >= total * 0.62) return p.v
  }
  return pairs[pairs.length - 1].v
}

// Comparable scoring formula (spec §COMPARABLE WEIGHTING ENGINE)
function scoreComp(
  comp: LrTransaction,
  subjectType: string,
  subjectArea: number,
  compArea: number,
  distanceScore: number,
  isEpcBacked: boolean,
): number {
  const typeScore    = normPropertyType(comp.type) === normPropertyType(subjectType) ? 1.0 : 0.3
  const areaDiff     = subjectArea > 0 ? Math.abs(compArea - subjectArea) / subjectArea : 0.3
  const areaScore    = Math.max(0, 1 - areaDiff * 2)
  const monthsAgo    = (Date.now() - new Date(comp.date).getTime()) / (30 * 24 * 3600 * 1000)
  const recencyScore = Math.max(0, 1 - monthsAgo / 24)
  const reliScore    = isEpcBacked ? 1.0 : 0.5
  // type×30% + area×25% + distance×20% + recency×15% + tenure×5% + reliability×5%
  return typeScore * 0.30 + areaScore * 0.25 + distanceScore * 0.20 + recencyScore * 0.15 + 1.0 * 0.05 + reliScore * 0.05
}

// Feature adjustment — spec §FEATURE ADJUSTMENTS
// Cap: +10% positive, -12% negative
function calcFeatureAdj(
  epcRating: string,
  hasParking: boolean,
  hasGarden: boolean,
  tenure: string,
): number {
  let adj = 0
  if      (epcRating === 'A' || epcRating === 'B') adj += 1.5
  else if (epcRating === 'E') adj -= 2.0
  else if (epcRating === 'F') adj -= 4.0
  else if (epcRating === 'G') adj -= 5.0
  if (hasParking) adj += 2.0
  if (hasGarden)  adj += 1.5
  if (tenure.toLowerCase().includes('leasehold')) adj -= 2.0
  // Hard caps per spec
  adj = Math.min(10, Math.max(-12, adj))
  return 1 + adj / 100
}

function getLaHpiGrowth(outcode: string, propertyType: string): number | null {
  const t = normPropertyType(propertyType)
  const candidates = [
    outcode,
    outcode.replace(/\d+$/, ''),
    outcode.slice(0, 2),
    outcode.slice(0, 1),
  ].filter((v, i, a) => v && a.indexOf(v) === i)

  for (const c of candidates) {
    const entry = LA_HPI[c]
    if (entry) {
      return t === 'flat' ? entry.flat
        : t === 'semi'     ? entry.semi
        : t === 'terraced' ? entry.ter
        : entry.det
    }
  }
  return null
}

// ── Extended bedroom fallback helpers ────────────────────────────────────────
function inferBedsFromHabitableRooms(
  habitableRooms: number,
  propertyType: string,
): { beds: number; confidence: number } | null {
  if (!habitableRooms || habitableRooms <= 0) return null
  const t = normPropertyType(propertyType)
  let beds: number
  if (t === 'flat') {
    beds = Math.max(0, habitableRooms - 1)
  } else {
    beds = habitableRooms >= 5 ? habitableRooms - 2 : habitableRooms - 1
    beds = Math.max(1, beds)
  }
  beds = Math.min(8, beds)
  return { beds, confidence: 58 }
}

function inferBedsFromAddress(
  address: string,
): { beds: number; confidence: number } | null {
  const lower = (address || '').toLowerCase()
  if (lower.includes('studio') || lower.includes('bedsit')) {
    return { beds: 0, confidence: 70 }
  }
  const match = lower.match(/(\d+)\s*[-\s]?bed(?:room)?s?/)
  if (match) {
    const n = parseInt(match[1], 10)
    if (n >= 0 && n <= 10) return { beds: n, confidence: 68 }
  }
  return null
}

function inferBedsFromPrice(
  lastSoldPrice: number,
  lastSoldDate: string,
  propertyType: string,
  cityName: string,
  postcode: string,
): { beds: number; confidence: number } | null {
  if (!lastSoldPrice || !lastSoldDate) return null
  const soldYear = Number(lastSoldDate.slice(0, 4))
  if (!soldYear || soldYear < 1990) return null
  const yearsAgo = 2026 - soldYear
  if (yearsAgo > 10) return null
  const outcode = postcode.trim().toUpperCase().split(' ')[0]
  const laGrowth5yr = getLaHpiGrowth(outcode, propertyType)
  const annualRate = laGrowth5yr != null ? (laGrowth5yr / 5) / 100 : 0.03
  const todayEquivalent = lastSoldPrice * Math.pow(1 + annualRate, yearsAgo)
  const cityByBed = (MARKET_DATA.cityByBedroom as Record<string, Record<string, { avgPrice: number }>>)[cityName]
    || (MARKET_DATA.cityByBedroom as Record<string, Record<string, { avgPrice: number }>>).London
  const isLondonEN = cityName === 'London' && outcode.startsWith('EN')
  const bandKeys = ['studio', '1bed', '2bed', '3bed', '4bed'] as const
  let bestKey: string = '2bed'
  let bestDiff = Infinity
  for (const bk of bandKeys) {
    const band = cityByBed[bk]
    if (!band) continue
    const bandPrice = isLondonEN ? Math.round(band.avgPrice * 0.82) : band.avgPrice
    const diff = Math.abs(todayEquivalent - bandPrice)
    if (diff < bestDiff) { bestDiff = diff; bestKey = bk }
  }
  const beds = bestKey === 'studio' ? 0 : parseInt(bestKey[0], 10)
  const confidence = yearsAgo <= 3 ? 55 : yearsAgo <= 5 ? 50 : yearsAgo <= 7 ? 45 : 38
  return { beds, confidence }
}

const POSTCODE_MODAL_BEDS: Record<string, { terraced: number; semi: number; detached: number; flat: number }> = {
  'EN': { terraced: 3, semi: 3, detached: 4, flat: 2 },
  'RM': { terraced: 3, semi: 3, detached: 4, flat: 2 },
  'DA': { terraced: 3, semi: 3, detached: 4, flat: 2 },
  'IG': { terraced: 3, semi: 3, detached: 4, flat: 2 },
  'HA': { terraced: 3, semi: 3, detached: 4, flat: 2 },
  'N':  { terraced: 3, semi: 4, detached: 5, flat: 2 },
  'E':  { terraced: 3, semi: 4, detached: 5, flat: 2 },
  'SE': { terraced: 3, semi: 4, detached: 5, flat: 2 },
  'SW': { terraced: 3, semi: 4, detached: 5, flat: 2 },
  'NW': { terraced: 3, semi: 4, detached: 5, flat: 2 },
  'M':  { terraced: 2, semi: 3, detached: 4, flat: 1 },
  'L':  { terraced: 3, semi: 3, detached: 4, flat: 2 },
  'B':  { terraced: 3, semi: 3, detached: 4, flat: 2 },
  'LS': { terraced: 2, semi: 3, detached: 4, flat: 2 },
  'S':  { terraced: 2, semi: 3, detached: 4, flat: 2 },
  'NG': { terraced: 2, semi: 3, detached: 4, flat: 2 },
  'BS': { terraced: 3, semi: 3, detached: 4, flat: 2 },
  'default': { terraced: 3, semi: 3, detached: 4, flat: 2 },
}

function inferBedsFromPostcodeModal(
  postcode: string,
  propertyType: string,
): { beds: number; confidence: number } | null {
  const outcode = postcode.trim().toUpperCase().split(' ')[0]
  if (!outcode) return null
  const t = normPropertyType(propertyType)
  const key = t === 'flat' ? 'flat' : t === 'semi' ? 'semi' : t === 'detached' ? 'detached' : 'terraced'
  const candidates = [
    outcode,
    outcode.replace(/\d+$/, ''),
    outcode.slice(0, 2),
    outcode.slice(0, 1),
  ].filter((v, i, a) => v && a.indexOf(v) === i)
  for (const c of candidates) {
    const entry = POSTCODE_MODAL_BEDS[c]
    if (entry) return { beds: entry[key], confidence: 38 }
  }
  const def = POSTCODE_MODAL_BEDS['default']
  return { beds: def[key], confidence: 30 }
}

function getCalibration(outcode: string): CalibBand | null {
  return CALIBRATION[outcode] || null
}

function getAnchor(calib: CalibBand, beds: number): { min: number; max: number } | null {
  const key = beds === 0 ? 'studio' : beds === 1 ? '1bed' : beds === 2 ? '2bed' : beds === 3 ? '3bed' : '4bed'
  return calib.anchors[key as keyof typeof calib.anchors] || null
}

async function calcValuation(
  prop: Record<string, unknown>,
  cityName: string,
  cityData: Record<string, number>,
  lrComps: LrTransaction[],
  epcData: Map<string, number>,
  apiKey: string,
): Promise<ValuationResult> {

  const subjectArea   = Number(prop.internal_area_sqm || prop.epc_floor_area || 0)
  const subjectType   = String(prop.property_type || '')
  const outcode       = String(prop.postcode || '').split(' ')[0]
  const isEnfield     = outcode.startsWith('EN')
  // Enfield default 3 (family house market) — avoids 2-bed suppression when no EPC floor area
  const subjectBeds   = Number(prop.bedrooms) > 0 ? Number(prop.bedrooms) : (isEnfield ? 3 : 2)
  const subjectTenure = String(prop.tenure || '')
  const subjectEpc    = String(prop.current_energy_rating || 'D')
  const hasParking    = Boolean(prop.has_parking)
  const hasGarden     = Boolean(prop.has_garden)
  const lastSoldPrice = Number(prop.last_sold_price || 0)
  const lastSoldDate  = String(prop.last_sold_date || '')

  const featureAdj    = calcFeatureAdj(subjectEpc, hasParking, hasGarden, subjectTenure)
  const effectiveArea = subjectArea > 0 ? subjectArea : estimateFloorArea(subjectBeds, subjectType)
  const annualRate    = Math.max(0.005, (cityData.capitalGrowth5yr / 5) / 100)
  const now           = Date.now()

  const calib  = getCalibration(outcode)
  const anchor = calib ? getAnchor(calib, subjectBeds) : null

  // ── L1: COMPARABLE ENGINE ─────────────────────────────────────────────────────
  // Default weight 50%. Boosted to 70–75% when 3+ strong same-type comps exist.
  let l1Value: number | null = null
  let l1Comps = 0
  let l1StrongComps = 0
  let weightedPsqm: number | null = null

  if (lrComps.length >= 2) {
    const subjectNorm  = normPropertyType(subjectType)
    const sameType     = lrComps.filter(c => normPropertyType(c.type) === subjectNorm)
    const workingComps = sameType.length >= 2 ? sameType : lrComps

    const rawEntries: { psqm: number; weight: number; sameType: boolean }[] = []

    for (const c of workingComps) {
      const yearsAgo   = (now - new Date(c.date).getTime()) / (365.25 * 24 * 3600 * 1000)
      const adjPrice   = c.price * Math.pow(1 + annualRate, Math.max(0, yearsAgo))
      const addrKey    = c.address.trim().split(/[\s,]/)[0].toLowerCase()
      const compArea   = epcData.get(addrKey) || getTypicalFloorArea(c.type)
      const isEpcBkd   = epcData.has(addrKey)
      const psqm       = adjPrice / compArea
      if (psqm > 500 && psqm < 30000) {
        const w = scoreComp(c, subjectType, effectiveArea, compArea, 1.0, isEpcBkd)
        rawEntries.push({ psqm, weight: w, sameType: normPropertyType(c.type) === subjectNorm })
      }
    }

    if (rawEntries.length >= 2) {
      // IQR outlier filtering before weighted median (removes distressed/luxury outliers)
      const filteredPsqm    = iqrFilter(rawEntries.map(e => e.psqm))
      const filteredEntries = rawEntries.filter(e => filteredPsqm.includes(e.psqm))

      // Clamp to calibration psqm range if available (soft guidance — only narrows extremes)
      const psqmVals = filteredEntries.map(e =>
        calib ? Math.min(calib.psqmMax * 1.15, Math.max(calib.psqmMin * 0.85, e.psqm)) : e.psqm
      )

      const median = weightedMedian(psqmVals, filteredEntries.map(e => e.weight))
      weightedPsqm = Math.round(median)
      l1Value      = Math.round(median * effectiveArea * featureAdj)
      l1Comps      = filteredEntries.length
      l1StrongComps = filteredEntries.filter(e => e.sameType).length
    }
  }

  // ── L2: DISTRICT TRENDS ───────────────────────────────────────────────────────
  let l2Value: number | null = null

  if (outcode) {
    try {
      const trendsUrl = `https://api.homedata.co.uk/api/price_trends/${encodeURIComponent(outcode)}/`
      const res = await fetch(trendsUrl, { headers: { Authorization: `Api-Key ${apiKey}` }, cache: 'no-store' })
      if (res.ok) {
        const td = await res.json()
        const raw = (
          td?.monthly_average_prices ||
          td?.data?.monthly_average_prices ||
          td?.results?.monthly_average_prices
        )
        const monthlyPrices: Record<string, unknown>[] = Array.isArray(raw) ? raw : []
        const prices = monthlyPrices.slice(-12)
          .map(m => Number(m.average_price ?? m.avg_price ?? m.price ?? m.value ?? 0))
          .filter(p => p > 50000)

        if (prices.length >= 3) {
          const avgDistrict = prices.reduce((s, p) => s + p, 0) / prices.length
          const psqm = avgDistrict / getTypicalFloorArea(subjectType)
          l2Value = Math.round(psqm * effectiveArea * featureAdj)
        }
      }
    } catch (e) {
      console.error('Homedata price_trends error:', e)
    }
  }

  // ── L3: LA HPI CALIBRATION ────────────────────────────────────────────────────
  // Uses local authority + property type specific 5yr growth — NOT generic city growth
  let l3Value: number | null = null

  if (lastSoldPrice > 0 && lastSoldDate) {
    const laGrowth5yr = getLaHpiGrowth(outcode, subjectType)
    if (laGrowth5yr != null) {
      const soldYear    = Number(lastSoldDate.slice(0, 4))
      const yearsHeld   = Math.max(0, 2026 - soldYear)
      const annualLaRate = laGrowth5yr / 5 / 100
      l3Value = Math.round(lastSoldPrice * Math.pow(1 + annualLaRate, yearsHeld) * featureAdj)
    }
  }

  // ── L4: CITY FALLBACK ─────────────────────────────────────────────────────────
  let l4Value: number | null = null

  const cityByBed  = MARKET_DATA.cityByBedroom[cityName as keyof typeof MARKET_DATA.cityByBedroom]
  const bedKey     = subjectBeds === 0 ? 'studio' : subjectBeds === 1 ? '1bed' : subjectBeds === 2 ? '2bed' : subjectBeds === 3 ? '3bed' : '4bed'
  const bedData    = cityByBed?.[bedKey as keyof typeof cityByBed]
  let cityBedAvg   = bedData?.avgPrice || (cityData.avgPrice as number) || 0

  if (cityName === 'London' && cityBedAvg > 0) {
    const outerFar   = ['RM','DA','IG']  // EN separated — Enfield family houses price above this group
    const outerMid   = ['CR','BR','KT','TW','UB','HA','WD','SM']
    // Gentrified inner London districts trade well above the all-London average
    const innerPrime = ['N1','N4','N5','N6','N7','N8','N16','E1','E2','E3','E8','E9',
                        'SW1','SW3','SW6','SW7','SW10','W1','W2','W8','W11',
                        'SE1','SE5','SE15','SE22','SE24','NW1','NW3','NW5']
    // Enfield (EN1/EN2/EN3): established family-house outer London market, not as cheap as RM/DA
    if      (outcode.startsWith('EN'))                    cityBedAvg = Math.round(cityBedAvg * 0.82)
    else if (outerFar.some(p => outcode.startsWith(p)))   cityBedAvg = Math.round(cityBedAvg * 0.65)
    else if (outerMid.some(p => outcode.startsWith(p)))   cityBedAvg = Math.round(cityBedAvg * 0.72)
    else if (innerPrime.includes(outcode))                 cityBedAvg = Math.round(cityBedAvg * 1.20)
    else                                                   cityBedAvg = Math.round(cityBedAvg * 1.08)
  }

  if (cityBedAvg > 0) l4Value = Math.round(cityBedAvg * featureAdj)

  // ── DYNAMIC WEIGHT REDISTRIBUTION ────────────────────────────────────────────
  // Comparable override rule: 3+ strong same-type comps → L1 weight 70–75%
  const l1Weight = l1StrongComps >= 3 ? 0.75 : l1StrongComps >= 2 ? 0.60 : 0.50

  const layers = [
    { val: l1Value, w: l1Weight   },
    { val: l2Value, w: 0.20       },
    { val: l3Value, w: 0.20       },
    { val: l4Value, w: 0.10       },
  ].filter(l => l.val !== null && l.val > 0) as { val: number; w: number }[]

  if (layers.length === 0) {
    return { fairValue: 0, lowValue: 0, highValue: 0, confidence: 0, compsUsed: 0, method: 'none', weightedPsqm: null }
  }

  const totalW = layers.reduce((s, l) => s + l.w, 0)
  let hybrid   = layers.reduce((s, l) => s + l.val * (l.w / totalW), 0)

  // Calibration constraint: anchors are soft guidance only.
  // Only blend when NO comparables at all AND value is extreme (>20% outside anchor).
  if (anchor && l1Value === null) {
    if (hybrid > anchor.max * 1.20 || hybrid < anchor.min * 0.80) {
      const mid = (anchor.min + anchor.max) / 2
      hybrid = hybrid * 0.70 + mid * 0.30
    }
  }

  // Confidence scoring (needed before askBias)
  const hasL1pre = l1Value !== null
  const hasL2pre = l2Value !== null
  const hasL3pre = l3Value !== null
  const confidencePre = Math.min(92, Math.max(25,
    (hasL1pre ? 35 + Math.min(l1StrongComps * 5, 25) : 0) +
    (hasL2pre && hasL1pre ? 8 : hasL2pre ? 15 : 0) +
    (hasL3pre ? 10 : 0) +
    (!hasL1pre && !hasL2pre && !hasL3pre ? 25 : 0) +
    (subjectArea > 0 ? 5 : 0) +
    (calib ? 2 : 0)
  ))

  // Optimistic asking-price bias — lean toward achievable seller guidance (not distressed median)
  const askBias = confidencePre >= 85 ? 1.07 : confidencePre >= 70 ? 1.05 : confidencePre >= 50 ? 1.03 : 1.00
  hybrid *= askBias

  let fair = Math.round(hybrid / 1000) * 1000

  // Enfield safeguard: 3+ bed family house < £425k with <3 strong comps = likely undervalued
  // Blend toward Enfield bedroom-specific floor without overriding strong comparable evidence
  if (isEnfield && normPropertyType(subjectType) !== 'flat' &&
      subjectBeds >= 3 && effectiveArea >= 85 && fair < 425000 && l1StrongComps < 3) {
    const enfieldFloor = Math.round(
      ((MARKET_DATA.cityByBedroom.London as Record<string, { avgPrice: number }>)[bedKey]?.avgPrice || 500000) * 0.82
    )
    if (fair < enfieldFloor) {
      console.log(`Enfield safeguard: £${fair.toLocaleString()} < £${enfieldFloor.toLocaleString()} floor — blending`)
      hybrid = hybrid * 0.55 + enfieldFloor * 0.45
      fair = Math.round(hybrid / 1000) * 1000
    }
  }

  // Confidence scoring (reuse pre-bias variables)
  const hasL1 = hasL1pre
  const hasL2 = hasL2pre
  const hasL3 = hasL3pre
  const confidence = confidencePre

  const spread = confidence >= 80 ? 0.05 : confidence >= 65 ? 0.07 : 0.10
  const activeLayers = [hasL1&&'L1', hasL2&&'L2', hasL3&&'L3', hasL1||hasL2||hasL3?'L4':false].filter(Boolean).join('+')

  console.log(
    `Valuation v1.0: £${fair.toLocaleString()} | ` +
    `L1=${l1Value?.toLocaleString()||'—'}(${l1StrongComps}st+${l1Comps}c) ` +
    `L2=${l2Value?.toLocaleString()||'—'} L3=${l3Value?.toLocaleString()||'—'} L4=${l4Value?.toLocaleString()||'—'} | ` +
    `${confidence}% conf | psqm=${weightedPsqm||'—'} | ${fair}`
  )

  return {
    fairValue:    fair,
    lowValue:     Math.round(fair * (1 - spread) / 1000) * 1000,
    highValue:    Math.round(fair * (1 + spread) / 1000) * 1000,
    confidence,
    compsUsed:    l1Comps,
    method:       `4layer_hybrid_${activeLayers}_${confidence}pct`,
    weightedPsqm,
  }
}

function estimateFloorArea(beds: number, type: string): number {
  const t    = (type || '').toLowerCase()
  const base: Record<number, number> = { 0: 35, 1: 50, 2: 70, 3: 90, 4: 115, 5: 140 }
  const area = base[Math.min(beds, 5)] || 70
  if (t.includes('detached') && !t.includes('semi')) return Math.round(area * 1.2)
  return area
}

// ── EPC OPEN DATA ─────────────────────────────────────────────────────────────
interface EpcResult {
  floorAreas: Map<string, number>
  subjectEpc: Record<string, unknown> | null
}

async function fetchEpcData(
  postcode: string,
  subjectAddress: string,
  apiKey?: string,
  apiEmail?: string,
): Promise<EpcResult> {
  const empty: EpcResult = { floorAreas: new Map(), subjectEpc: null }
  if (!postcode || !apiKey || !apiEmail) return empty

  try {
    const url  = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode)}&size=50`
    const auth = Buffer.from(`${apiEmail}:${apiKey}`).toString('base64')
    const res  = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: abortAfter(8000),
    })
    if (!res.ok) {
      console.log(`EPC API: ${res.status} for ${postcode}`)
      return empty
    }

    const data = await res.json()
    const cols = (data['column-names'] || []) as string[]
    const rows = (data.rows || []) as string[][]

    const col = (name: string) => cols.indexOf(name)
    const addrIdx    = col('address1')
    const areaIdx    = col('total-floor-area')
    const ratingIdx  = col('current-energy-rating')
    const scoreIdx   = col('current-energy-efficiency')
    const potRatIdx  = col('potential-energy-rating')
    const potScoIdx  = col('potential-energy-efficiency')
    const dateIdx    = col('lodgement-date')
    const inspIdx    = col('inspection-date')

    // Extract first digit sequence — handles "FLAT 12, 54 STREET" where first word is "FLAT"
    const getAddrKey = (addr: string) =>
      (addr.match(/^\d+/) || addr.match(/(\d+)/))?.[0] ||
      addr.trim().split(/[\s,]/)[0].toLowerCase()

    const subjectToken = getAddrKey(subjectAddress)

    const floorAreas = new Map<string, number>()
    let subjectEpc: Record<string, unknown> | null = null
    let subjectEpcDate = ''

    for (const row of rows) {
      const addr = String(row[addrIdx] || '').trim()
      const area = Number(row[areaIdx] || 0)
      if (!addr) continue
      const key = getAddrKey(addr)
      if (area > 0) floorAreas.set(key, area)
      const isSubject = !!subjectToken && key === subjectToken
      const rowDate   = String(row[dateIdx] || row[inspIdx] || '')
      if (isSubject && (!subjectEpc || rowDate > subjectEpcDate)) {
        subjectEpcDate = rowDate
        subjectEpc = {
          current_energy_rating:       String(row[ratingIdx] || ''),
          current_energy_efficiency:   Number(row[scoreIdx]  || 0),
          potential_energy_rating:     String(row[potRatIdx] || ''),
          potential_energy_efficiency: Number(row[potScoIdx] || 0),
          total_floor_area:            area,
          inspection_date:             rowDate,
          source:                      'epc_open_data',
        }
      }
    }

    console.log(`EPC: ${floorAreas.size} floor areas, subject matched: ${!!subjectEpc}`)
    return { floorAreas, subjectEpc }
  } catch (e) {
    console.error('EPC fetch error:', e)
    return empty
  }
}

// ── LAND REGISTRY DATA ────────────────────────────────────────────────────────
interface LrTransaction {
  price:       number
  date:        string
  type:        string
  address:     string
  _bedrooms?:  number
  _floorArea?: number
}

function abortAfter(ms: number): AbortSignal {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), ms)
  return ctrl.signal
}

async function fetchLrData(
  postcode: string,
  address: string,
  subjectOnly = false,
): Promise<{ history: LrTransaction[]; comps: LrTransaction[] }> {
  const empty = { history: [], comps: [] }
  if (!postcode) return empty

  try {
    const url = `https://landregistry.data.gov.uk/data/ppi/address.json?postcode=${encodeURIComponent(postcode)}&_pageSize=50`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) return empty

    const data      = await res.json()
    const addresses: Record<string, unknown>[] = (data?.result as Record<string, unknown>)?.items || []
    console.log(`LR: ${addresses.length} addresses in ${postcode}`)

    const houseNumber = address.trim().split(' ')[0].replace(/\D/g, '')
    const twoYearsAgo = new Date(Date.now() - 730 * 24 * 3600 * 1000).toISOString().slice(0, 10)

    const fetchAddrTxns = async (addr: Record<string, unknown>): Promise<{ paon: string; isSubject: boolean; txns: LrTransaction[] }> => {
      const paon    = String(addr.paon || '')
      const addrUrl = String(addr._about || '').replace(/^http:\/\//i, 'https://')
      const isSubject = Boolean(houseNumber && paon && paon.includes(houseNumber))
      if (!addrUrl) return { paon, isSubject, txns: [] }

      try {
        const txRes = await fetch(`${addrUrl}.json`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: abortAfter(7000),
        })
        if (!txRes.ok) return { paon, isSubject, txns: [] }

        const txData   = await txRes.json()
        const topic    = (txData?.result as Record<string, unknown>)?.primaryTopic as Record<string, unknown>
        const rawDates = topic?.soldDate
        if (!rawDates) return { paon, isSubject, txns: [] }

        const list = Array.isArray(rawDates) ? rawDates : [rawDates]
        const txns: LrTransaction[] = list
          .filter(Boolean)
          .map((tx: unknown) => ({
            price:   Number((tx as Record<string, unknown>).pricePaid || 0),
            date:    String((tx as Record<string, unknown>).transactionDate || ''),
            type:    String((tx as Record<string, unknown>).propertyType || '').split('/').pop() || '',
            address: paon,
          }))
          .filter(t => t.price > 0)

        return { paon, isSubject, txns }
      } catch {
        return { paon, isSubject, txns: [] }
      }
    }

    const settled = await Promise.allSettled(addresses.slice(0, 25).map(fetchAddrTxns))
    const history: LrTransaction[] = []
    const comps:   LrTransaction[] = []

    for (const r of settled) {
      if (r.status !== 'fulfilled') continue
      const { isSubject, txns } = r.value
      if (isSubject) history.push(...txns)
      else if (!subjectOnly) comps.push(...txns.filter(t => t.date >= twoYearsAgo))
    }

    history.sort((a, b) => b.date.localeCompare(a.date))
    console.log(`LR: ${history.length} subject txns, ${comps.length} postcode comps (last 24mo)`)

    return { history, comps }
  } catch (e) {
    console.error('LR data error:', e)
    return empty
  }
}
// redeploy Tue  2 Jun 2026 07:18:05 BST
