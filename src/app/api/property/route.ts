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

  // Phase 1: address search — returns suggestions list
  if (q && !uprn) {
    const suggestions = await searchAddress(q)
    return NextResponse.json({ suggestions })
  }

  // Phase 2: full property fetch by UPRN
  if (uprn) {
    const [property, epc, transactions, risks] = await Promise.all([
      getProperty(uprn),
      getEpc(uprn),
      getTransactions(uprn),
      getRisks(uprn),
    ])

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // Derive city from town/postcode
    const cityName = detectCity(property.town_name || '', property.postcode || '')
    const cityData = MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities]
      || MARKET_DATA.cities.Manchester // fallback

    // Default investment assumptions
    const defaults = {
      serviceCharge: property.property_type?.toLowerCase().includes('flat') ? 2000 : 0,
      groundRent: property.tenure?.toLowerCase().includes('leasehold') ? 200 : 0,
      managementFee: 10,
      maintenanceAllowance: 1.5,
      voidWeeks: 2,
    }

    // Estimate monthly rent from local data (rough heuristic — user can override)
    const estimatedRent = estimateRent(
      property.property_type || '',
      property.bedrooms || 1,
      cityData.avgRent,
    )

    const price = property.last_sold_price || 0
    const grossYield = price ? calcGrossYield(price, estimatedRent) : 0
    const netYield = price ? calcNetYield(
      price, estimatedRent,
      defaults.serviceCharge, defaults.groundRent,
      defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
    ) : 0

    const floodRisk = risks.find(r => r.risk_type === 'flood_rivers_sea')

    return NextResponse.json({
      uprn,
      property,
      epc,
      transactions: transactions.slice(0, 20), // last 20 sales
      risks,
      cityData,
      cityName,
      enriched: {
        estimatedRent,
        grossYield,
        netYield,
        netMonthly: price ? calcNetMonthlyIncome(
          price, estimatedRent,
          defaults.serviceCharge, defaults.groundRent,
          defaults.managementFee, defaults.maintenanceAllowance, defaults.voidWeeks
        ) : 0,
        capitalGrowth: cityData.capitalGrowth1yr,
        totalROI: parseFloat((netYield + cityData.capitalGrowth1yr).toFixed(1)),
        floodRisk: floodRisk?.label || 'Unknown',
        epcRating: epc?.current_energy_efficiency
          ? efficiencyToRating(epc.current_energy_efficiency)
          : property.current_energy_rating || 'Unknown',
        defaults,
      },
    })
  }

  return NextResponse.json({ error: 'Provide q (search) or uprn' }, { status: 400 })
}

function detectCity(town: string, postcode: string): string {
  const t = town.toLowerCase()
  const pc = postcode.toUpperCase()
  if (t.includes('manchester') || t.includes('salford') || pc.startsWith('M') || pc.startsWith('SK')) return 'Manchester'
  if (t.includes('birmingham') || pc.startsWith('B') || pc.startsWith('B1') || pc.startsWith('B2')) return 'Birmingham'
  if (t.includes('liverpool') || pc.startsWith('L') ) return 'Liverpool'
  if (t.includes('leeds') || pc.startsWith('LS')) return 'Leeds'
  if (t.includes('sheffield') || pc.startsWith('S') || pc.startsWith('S1')) return 'Sheffield'
  if (t.includes('nottingham') || pc.startsWith('NG')) return 'Nottingham'
  if (t.includes('bristol') || pc.startsWith('BS')) return 'Bristol'
  if (t.includes('london') || ['E','EC','N','NW','SE','SW','W','WC'].some(p => pc.startsWith(p))) return 'London'
  return 'Manchester' // default to northern city data
}

function estimateRent(propertyType: string, beds: number, cityAvgRent: number): number {
  // Relative rent multipliers by bed count
  const bedMultiplier: Record<number, number> = {
    0: 0.55, // studio
    1: 0.75,
    2: 1.00,
    3: 1.35,
    4: 1.70,
    5: 2.10,
  }
  const isHmo = propertyType?.toLowerCase().includes('hmo')
  const multiplier = isHmo ? (beds * 0.55) : (bedMultiplier[beds] || 1)
  return Math.round(cityAvgRent * multiplier / 50) * 50 // round to £50
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
