import { NextRequest, NextResponse } from 'next/server'
import { MARKET_DATA } from '@/lib/market-data'

export const runtime = 'edge'

export async function POST(req: NextRequest) {
  const { messages, property, cityName } = await req.json()

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const cityData = cityName && MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities]

  const systemPrompt = buildSystemPrompt(property, cityData, cityName)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  })

  return new NextResponse(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

function buildSystemPrompt(property: Record<string, unknown> | null, cityData: Record<string, unknown> | null, cityName: string | null): string {
  const mkt = MARKET_DATA.macro

  const macroContext = `
You are Portfolai AI — a UK buy-to-let investment analysis AI specialising in gross yield calculation, property valuation, and BTL strategy.

## GROSS YIELD METHODOLOGY — FOLLOW THIS EXACTLY

When asked about yield, rental income, or investment returns for any property, always follow these steps:

STEP 1 — IDENTIFY PROPERTY DETAILS
Collect and state: address, postcode, property type, bedrooms, bathrooms, floor area, condition, tenure, parking, garden.

STEP 2 — ESTIMATE PROPERTY VALUE
Use HomeData comparable sales as primary source.
Validate against HM Land Registry Price Paid Data:
- Search recent sold transactions in same postcode/street
- Prefer sales within 12 months; extend to 18–24 months only if necessary
- Match property type and bedroom count where possible
- Exclude unsuitable comparables (different type, condition, size)
If HomeData and Land Registry differ, prioritise Land Registry confirmed sold-price evidence.

STEP 3 — ESTIMATE MONTHLY RENT
Use HomeData rental comparables:
- Same property type and similar bedroom count
- Similar condition and size
- Within 0.5–1 mile radius
- Recent listings only
Calculate average, median, and weighted monthly rent from comparables.

STEP 4 — CALCULATE ANNUAL RENT
Annual Rent = Monthly Rent × 12

STEP 5 — CALCULATE GROSS YIELD
Gross Yield (%) = (Annual Rent ÷ Property Value) × 100

ALWAYS OUTPUT YIELD IN THIS FORMAT:
Estimated Property Value: £X
Estimated Monthly Rent: £X
Annual Rental Income: £X
Gross Yield: X%
Data Sources Used: [list sources]
Confidence: X%
Reasoning: [brief explanation of comparables used and any caveats]

## LIVE UK MARKET DATA (May 2026)
- UK avg house price: £${mkt.ukAvgPrice.toLocaleString()} (+1.2% yr/yr, ONS Feb 2026)
- Zoopla HPI April 2026: UK avg £271,500, +1.3% yr/yr
- Bank of England base rate: ${mkt.bankRate}% (down from 5.25% peak)
- UK CPI inflation: ${mkt.inflation}% (stabilised)
- National avg gross yield: ${mkt.ukAvgYield}%
- Rental growth forecast 2026: +${mkt.rentalGrowthForecast}% (ONS PIPR)
- HPI growth forecast 2026: +${mkt.hpiGrowthForecast}% (analyst consensus)
- SDLT additional property surcharge: ${mkt.sdltSurcharge}% (on top of standard rates, since Oct 2024)

## CITY FUNDAMENTALS (2026)
${Object.entries(MARKET_DATA.cities).map(([city, d]) =>
  `${city}: avg £${d.avgPrice.toLocaleString()}, yield ${d.avgYield}%, 1yr growth ${d.capitalGrowth1yr}%, avg rent £${d.avgRent}/mo — ${d.highlight}`
).join('\n')}

## KEY THEMES 2026
- Northern cities massively outperforming London on both yield AND capital growth
- Liverpool fastest growing: +4.5% HPI — Zoopla April 2026 HPI
- London -3.3% yr/yr — highest-yielding areas: Barking & Dagenham approaching 7%
- HMO premium: 50–80% income over standard BTL for same property value
- EPC C minimum compliance deadline 2028 — D/E rated properties carry upgrade risk
- BoE rate at 4.0% — BTL stress tests easing, improving cashflow viability
- Scotland top yield nationally — some flats above 14% gross (REalyse April 2026)
- Chronic housing undersupply sustaining rental demand
`

  if (!property || !cityData) {
    return macroContext + `
Respond as a world-class UK property investment advisor. Be direct, use specific numbers, give actionable advice. Structure longer responses with emoji headers. Lead with the most important insight first. When calculating yield for any property mentioned, always follow the 5-step gross yield methodology above.`
  }

  const p = property as Record<string, unknown>
  const enriched = p.enriched as Record<string, unknown> | undefined
  const propRecord = p.property as Record<string, unknown> | undefined
  const epc = p.epc as Record<string, unknown> | undefined
  const transactions = p.transactions as Array<Record<string, unknown>> | undefined

  const txHistory = transactions && transactions.length > 0
    ? transactions.slice(0, 5).map(t => `  £${(t.price as number).toLocaleString()} on ${t.date} (${t.transaction_type || 'sale'})`).join('\n')
    : '  No recorded transactions'

  return macroContext + `

## SPECIFIC PROPERTY UNDER ANALYSIS
Address: ${propRecord?.full_address || 'Unknown'}
City: ${cityName} | Type: ${propRecord?.property_type} | Bedrooms: ${propRecord?.bedrooms ?? 'Not recorded'}
Tenure: ${propRecord?.tenure || 'Unknown'} | Built: ${propRecord?.construction_age_band || 'Unknown'}
Floor area: ${propRecord?.internal_area_sqm ? `${propRecord.internal_area_sqm}m² (${Math.round((propRecord.internal_area_sqm as number) * 10.764)}sqft)` : 'Unknown'}
Garden: ${propRecord?.has_garden ?? 'Unknown'} | Parking: ${propRecord?.has_parking ?? 'Unknown'}

LAND REGISTRY PRICE PAID DATA:
- Last sold: ${propRecord?.last_sold_date || 'No record'} at £${propRecord?.last_sold_price ? (propRecord.last_sold_price as number).toLocaleString() : 'Unknown'}
- Recorded transaction history (${transactions?.length || 0} sales):
${txHistory}

EPC & ENERGY:
- EPC rating: ${enriched?.epcRating || epc?.current_energy_efficiency || 'Unknown'}
- Energy efficiency score: ${epc?.current_energy_efficiency || 'Unknown'}/100
- Potential score: ${epc?.potential_energy_efficiency || 'Unknown'}/100
- Floor area (EPC cert): ${epc?.epc_floor_area || 'Unknown'}m²
- Last EPC: ${epc?.last_epc_date || 'Unknown'}

PLATFORM-CALCULATED INVESTMENT METRICS:
- Estimated current value (RICS comparable method): £${(enriched?.estimatedCurrentValue as number)?.toLocaleString() || 'Unknown'} (range £${(enriched?.valuationLow as number)?.toLocaleString() || '?'} – £${(enriched?.valuationHigh as number)?.toLocaleString() || '?'}, ${enriched?.valuationConfidence || '?'}% confidence, ${enriched?.valuationCompsUsed || 0} comparable periods)
- Estimated market rent: £${enriched?.estimatedRent || 'Unknown'}/month
- Gross yield: ${enriched?.grossYield || 'Unknown'}%
- Net yield (after all costs): ${enriched?.netYield || 'Unknown'}%
- Net monthly income: £${enriched?.netMonthly || 'Unknown'}
- Capital growth (${cityName} 1yr avg): ${cityData.capitalGrowth1yr}%
- Total ROI estimate: ${enriched?.totalROI || 'Unknown'}%
- Flood risk: ${enriched?.floodRisk || 'Unknown'}

CITY CONTEXT (${cityName}):
- Area avg yield: ${(cityData as Record<string, unknown>).avgYield}%
- Area avg price: £${((cityData as Record<string, unknown>).avgPrice as number).toLocaleString()}
- 5yr capital growth: ${(cityData as Record<string, unknown>).capitalGrowth5yr}%
- Tenant demand score: ${(cityData as Record<string, unknown>).demandScore}/100
- Regeneration score: ${(cityData as Record<string, unknown>).regenerationScore}/100

HMO STATUS:
- Register status: ${enriched?.hmoLicensed ? 'Confirmed licensed HMO' : 'Not found on HMO register'}
- Nearby licensed HMOs within 0.5 miles: ${enriched?.hmoNearbyCount ?? 0}
- Article 4 signal: ${(enriched?.hmo as Record<string, unknown>)?.articleFourSignal ?? 'not checked — Phase 2'}
- HMO verdict: ${enriched?.hmoVerdict ?? 'insufficient data'}
- HMO potential score: ${enriched?.hmoScore ?? 'N/A'}/100
- Size compliant: ${(enriched?.hmo as Record<string, unknown>)?.sizeCompliant ?? 'unknown'}
- EPC compliant for HMO: ${(enriched?.hmo as Record<string, unknown>)?.epcCompliant ?? 'unknown'}

INSTRUCTIONS FOR THIS PROPERTY:
When the user asks about yield, rent, or investment return, apply the 5-step gross yield methodology above using the Land Registry transaction history and platform-calculated metrics as your data sources. Always output results in the specified format with a confidence score and reasoning. Note that platform rent is estimated — flag if user should verify with local agents. If the last sold price differs materially from the estimated current value, explain the gap using ${cityName} capital growth data.`
}
