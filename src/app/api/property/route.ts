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
      const outcode = postcode.split(' ')[0]

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

      const subjectAddr = String(propRecord.full_address || propRecord.address || '')
      const [lrData, epcOpenData] = await Promise.all([
        fetchLrData(String(propRecord.postcode || ''), subjectAddr),
        fetchEpcData(
          String(propRecord.postcode || ''),
          subjectAddr,
          process.env.EPC_API_KEY,
          process.env.EPC_API_EMAIL,
        ),
      ])

      const resolvedEpc = epc || epcOpenData.subjectEpc

      const lrLastSold    = lrData.history.length > 0 ? lrData.history[0] : null
      const lastSoldPrice = lrLastSold ? lrLastSold.price : price
      const lastSoldDate  = lrLastSold ? lrLastSold.date  : String(propRecord.last_sold_date || '')
      const allTransactions = lrData.history.length > 0
        ? lrData.history.map(t => ({ price: t.price, date: t.date, transaction_type: t.type }))
        : (transactions || []).slice(0, 20)

      const valuation = await calcComparableValuation(
        uprn,
        propRecord,
        cityData,
        cityName,
        lrData.comps,
        epcOpenData.floorAreas,
        process.env.HOMEDATA_API_KEY!
      )

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
        epc: resolvedEpc,
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
          epcRating: resolvedEpc?.current_energy_efficiency
            ? efficiencyToRating(resolvedEpc.current_energy_efficiency as number)
            : resolvedEpc?.current_energy_rating
              ? String(resolvedEpc.current_energy_rating)
              : String(propRecord.current_energy_rating || 'Unknown'),
          epcFloorArea: resolvedEpc?.total_floor_area || propRecord.internal_area_sqm || propRecord.epc_floor_area || null,
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
    0: 0.55,
    1: 0.75,
    2: 1.00,
    3: 1.35,
    4: 1.70,
    5: 2.10,
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

function getTypicalFloorArea(propertyType: string): number {
  const t = propertyType.toLowerCase()
  if (t.includes('flat') || t.includes('maisonette') || t.includes('apartment')) return 60
  if (t.includes('semi')) return 88
  if (t.includes('terrace')) return 80
  if (t.includes('detached') && !t.includes('semi')) return 110
  return 80
}

function normPropertyType(t: string): string {
  const tl = t.toLowerCase()
  if (tl.includes('flat') || tl.includes('maisonette') || tl.includes('apartment')) return 'flat'
  if (tl.includes('semi')) return 'semi'
  if (tl.includes('detach')) return 'detached'
  return 'terraced'
}

async function calcComparableValuation(
  _uprn: string,
  prop: Record<string, unknown>,
  cityData: Record<string, number>,
  cityName: string,
  lrComps: LrTransaction[],
  epcData: Map<string, number>,
  apiKey: string
): Promise<ValuationResult> {

  const subjectArea   = Number(prop.internal_area_sqm || prop.epc_floor_area || 0)
  const subjectType   = String(prop.property_type || '').toLowerCase()
  const subjectBeds   = Number(prop.bedrooms || 2)
  const subjectTenure = String(prop.tenure || '').toLowerCase()
  const subjectEpc    = String(prop.current_energy_rating || 'D')
  const hasParking    = Boolean(prop.has_parking)
  const hasGarden     = Boolean(prop.has_garden)
  const outcode       = String(prop.postcode || '').split(' ')[0]

  let featureAdj = 1.0
  if      (subjectEpc === 'A' || subjectEpc === 'B') featureAdj += 0.02
  else if (subjectEpc === 'E') featureAdj -= 0.02
  else if (subjectEpc === 'F') featureAdj -= 0.04
  else if (subjectEpc === 'G') featureAdj -= 0.05
  if (hasParking)  featureAdj += 0.03
  if (hasGarden)   featureAdj += 0.02
  if (subjectTenure.includes('leasehold')) featureAdj -= 0.01

  const effectiveArea = subjectArea > 0 ? subjectArea : estimateFloorArea(subjectBeds, subjectType)
  const annualRate    = Math.max(0.005, (cityData.capitalGrowth5yr / 5) / 100)
  const now           = Date.now()

  // ── FALLBACK ──────────────────────────────────────────────────────────────────
  const fallback = (): ValuationResult => {
    const soldPrice = Number(prop.last_sold_price || 0)
    if (soldPrice) {
      const soldYear  = Number(String(prop.last_sold_date || '2015').slice(0, 4))
      const yearsHeld = Math.max(0, 2026 - soldYear)
      const fair = Math.round(soldPrice * Math.pow(1 + annualRate, yearsHeld))
      return { fairValue: fair, lowValue: Math.round(fair * 0.95), highValue: Math.round(fair * 1.05), confidence: 40, compsUsed: 0, method: 'growth_rate_fallback' }
    }
    const beds = Number(prop.bedrooms || 2)
    const cityByBed = MARKET_DATA.cityByBedroom[cityName as keyof typeof MARKET_DATA.cityByBedroom]
    const bedKey = beds === 0 ? 'studio' : beds === 1 ? '1bed' : beds === 2 ? '2bed' : beds === 3 ? '3bed' : '4bed'
    const bedData = cityByBed?.[bedKey as keyof typeof cityByBed]
    let fair = bedData?.avgPrice || cityData.avgPrice as number || 0
    // Outer London postcodes are significantly cheaper than the all-London average.
    // EN (Enfield), RM (Romford), DA (Dartford), IG (Ilford) ~65% of London avg
    // CR (Croydon), BR (Bromley), KT (Kingston), TW (Twickenham), UB (Uxbridge), HA (Harrow), WD (Watford), SM (Sutton) ~72%
    if (cityName === 'London' && fair > 0) {
      const outerFarPrefixes = ['EN','RM','DA','IG']
      const outerMidPrefixes = ['CR','BR','KT','TW','UB','HA','WD','SM']
      if (outerFarPrefixes.some(p => outcode.startsWith(p))) fair = Math.round(fair * 0.65)
      else if (outerMidPrefixes.some(p => outcode.startsWith(p))) fair = Math.round(fair * 0.72)
    }
    if (!fair) return { fairValue: 0, lowValue: 0, highValue: 0, confidence: 0, compsUsed: 0, method: 'none' }
    return { fairValue: Math.round(fair / 1000) * 1000, lowValue: Math.round(fair * 0.90 / 1000) * 1000, highValue: Math.round(fair * 1.10 / 1000) * 1000, confidence: 25, compsUsed: 0, method: 'city_avg_estimate' }
  }

  // ── TIER 1: LAND REGISTRY POSTCODE COMPARABLES ───────────────────────────────
  if (lrComps.length >= 2) {
    const subjectNorm  = normPropertyType(subjectType)
    const sameType     = lrComps.filter(c => normPropertyType(c.type) === subjectNorm)
    const workingComps = sameType.length >= 2 ? sameType : lrComps

    const compPsqm = workingComps.map(c => {
      const yearsAgo  = (now - new Date(c.date).getTime()) / (365.25 * 24 * 3600 * 1000)
      const adjPrice  = c.price * Math.pow(1 + annualRate, Math.max(0, yearsAgo))
      const compArea  = epcData.get(c.address.trim().split(/[\s,]/)[0].toLowerCase()) || getTypicalFloorArea(c.type)
      return adjPrice / compArea
    }).filter(v => v > 0 && v < 30000).sort((a, b) => a - b)

    if (compPsqm.length >= 2) {
      const mid        = Math.floor(compPsqm.length / 2)
      const medianPsqm = compPsqm.length % 2 === 0
        ? (compPsqm[mid - 1] + compPsqm[mid]) / 2
        : compPsqm[mid]

      const epcHits   = workingComps.filter(c => epcData.has(c.address.trim().split(/[\s,]/)[0].toLowerCase())).length
      const baseValue = Math.round(medianPsqm * effectiveArea * featureAdj)
      const fair      = Math.round(baseValue / 1000) * 1000

      const confidence = Math.min(88,
        50 + compPsqm.length * 4 +
        (sameType.length >= 2 ? 5 : 0) +
        (subjectArea > 0 ? 8 : 0) +
        Math.min(epcHits * 3, 12)
      )
      const spread = confidence >= 78 ? 0.05 : confidence >= 65 ? 0.07 : 0.10

      console.log(`LR Comps: £${fair.toLocaleString()} (${compPsqm.length} comps, ${epcHits} EPC-backed, ${confidence}% conf, £${Math.round(medianPsqm)}/sqm × ${effectiveArea}sqm)`)
      return {
        fairValue: fair,
        lowValue:  Math.round(fair * (1 - spread) / 1000) * 1000,
        highValue: Math.round(fair * (1 + spread) / 1000) * 1000,
        confidence,
        compsUsed: compPsqm.length,
        method: `lr_postcode_comparables${epcHits > 0 ? '_epc' : ''}`,
      }
    }
  }

  // ── TIER 2: HOMEDATA PRICE TRENDS ────────────────────────────────────────────
  if (outcode) {
    try {
      const trendsUrl = `https://api.homedata.co.uk/api/price_trends/${encodeURIComponent(outcode)}/`
      const res = await fetch(trendsUrl, { headers: { Authorization: `Api-Key ${apiKey}` }, cache: 'no-store' })

      if (res.ok) {
        const trendsData = await res.json()
        const monthlyPrices: Record<string, unknown>[] = (
          trendsData?.monthly_average_prices ||
          trendsData?.data?.monthly_average_prices ||
          trendsData?.results?.monthly_average_prices ||
          []
        )
        const prices = monthlyPrices.slice(-12)
          .map(m => Number(m.average_price ?? m.avg_price ?? m.price ?? m.value ?? 0))
          .filter(p => p > 50000)

        if (prices.length >= 3) {
          const avgPrice    = prices.reduce((s, p) => s + p, 0) / prices.length
          const pricePerSqm = avgPrice / getTypicalFloorArea(subjectType)
          const baseValue   = Math.round(pricePerSqm * effectiveArea * featureAdj)
          const fair        = Math.round(baseValue / 1000) * 1000
          let confidence    = 55 + (prices.length >= 9 ? 10 : 0) + (prices.length >= 12 ? 5 : 0) + (subjectArea > 0 ? 10 : -5)
          confidence = Math.min(82, Math.max(40, confidence))
          const spread = confidence >= 75 ? 0.05 : 0.08

          console.log(`Homedata Trends: £${fair.toLocaleString()} (${prices.length} months, ${confidence}% conf)`)
          return { fairValue: fair, lowValue: Math.round(fair * (1 - spread) / 1000) * 1000, highValue: Math.round(fair * (1 + spread) / 1000) * 1000, confidence, compsUsed: prices.length, method: 'homedata_price_trends' }
        }
      }
    } catch (e) {
      console.error('Homedata price_trends error:', e)
    }
  }

  return fallback()
}

function estimateFloorArea(beds: number, type: string): number {
  const t = type.toLowerCase()
  const base: Record<number, number> = { 0: 35, 1: 50, 2: 70, 3: 90, 4: 115, 5: 140 }
  const area = base[Math.min(beds, 5)] || 70
  if (t.includes('detached') && !t.includes('semi')) return Math.round(area * 1.2)
  return area
}

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
    const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode)}&size=50`
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
    const addrIdx   = col('address1')
    const areaIdx   = col('total-floor-area')
    const ratingIdx = col('current-energy-rating')
    const scoreIdx  = col('current-energy-efficiency')
    const potRatIdx = col('potential-energy-rating')
    const potScoIdx = col('potential-energy-efficiency')
    const dateIdx   = col('lodgement-date')
    const inspIdx   = col('inspection-date')

    const subjectToken = subjectAddress.trim().split(/[\s,]/)[0].toLowerCase().replace(/\D/g, '') ||
                         subjectAddress.trim().split(/[\s,]/)[0].toLowerCase()

    const floorAreas = new Map<string, number>()
    let subjectEpc: Record<string, unknown> | null = null
    let subjectEpcDate = ''

    for (const row of rows) {
      const addr = String(row[addrIdx] || '').trim()
      const area = Number(row[areaIdx] || 0)
      if (!addr) continue

      const key = addr.split(/[\s,]/)[0].toLowerCase()
      if (area > 0) floorAreas.set(key, area)

      const rowToken  = key.replace(/\D/g, '') || key
      const isSubject = subjectToken && (rowToken === subjectToken || key === subjectToken)
      const rowDate   = String(row[dateIdx] || row[inspIdx] || '')

      if (isSubject && (!subjectEpc || rowDate > subjectEpcDate)) {
        subjectEpcDate = rowDate
        subjectEpc = {
          current_energy_rating:       String(row[ratingIdx] || ''),
          current_energy_efficiency:   Number(row[scoreIdx] || 0),
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
    console.error('EPC floor area fetch error:', e)
    return empty
  }
}

interface LrTransaction {
  price: number
  date: string
  type: string
  address: string
}

function abortAfter(ms: number): AbortSignal {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), ms)
  return ctrl.signal
}

async function fetchLrData(
  postcode: string,
  address: string,
): Promise<{ history: LrTransaction[]; comps: LrTransaction[] }> {
  const empty = { history: [], comps: [] }
  if (!postcode) return empty

  try {
    const url = `http://landregistry.data.gov.uk/data/ppi/address.json?postcode=${encodeURIComponent(postcode)}&_pageSize=50`
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (!res.ok) return empty

    const data = await res.json()
    const addresses: Record<string, unknown>[] = (data?.result as Record<string, unknown>)?.items || []
    console.log(`LR: ${addresses.length} addresses in ${postcode}`)

    const houseNumber = address.trim().split(' ')[0].replace(/\D/g, '')
    const twoYearsAgo = new Date(Date.now() - 730 * 24 * 3600 * 1000).toISOString().slice(0, 10)

    const fetchAddrTxns = async (addr: Record<string, unknown>): Promise<{ paon: string; isSubject: boolean; txns: LrTransaction[] }> => {
      const paon      = String(addr.paon || '')
      const addrUrl   = String(addr._about || '')
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
      if (isSubject) {
        history.push(...txns)
      } else {
        comps.push(...txns.filter(t => t.date >= twoYearsAgo))
      }
    }

    history.sort((a, b) => b.date.localeCompare(a.date))
    console.log(`LR: ${history.length} subject txns, ${comps.length} postcode comps (last 24mo)`)

    return { history, comps }
  } catch (e) {
    console.error('LR data error:', e)
    return empty
  }
}
