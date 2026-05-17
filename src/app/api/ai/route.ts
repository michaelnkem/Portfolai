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

  // Stream the response back to the client
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
You are Portfolai AI — the UK's most sophisticated property investment analyst. You combine deep expertise in BTL, HMO, capital growth strategy, mortgage finance, tax, and portfolio construction with access to live 2026 market data.

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
Respond as a world-class UK property investment advisor. Be direct, use specific numbers, give actionable advice. Structure longer responses with emoji headers. Lead with the most important insight first.`
  }

  const p = property as Record<string, unknown>
  const enriched = p.enriched as Record<string, unknown> | undefined
  const propRecord = p.property as Record<string, unknown> | undefined
  const epc = p.epc as Record<string, unknown> | undefined
  const transactions = p.transactions as Array<Record<string, unknown>> | undefined

  return macroContext + `

## SPECIFIC PROPERTY UNDER ANALYSIS
Address: ${propRecord?.full_address || 'Unknown'}
City: ${cityName} | Type: ${propRecord?.property_type} | Bedrooms: ${propRecord?.bedrooms}
Tenure: ${propRecord?.tenure || 'Unknown'} | Built: ${propRecord?.construction_age_band || 'Unknown'}
Floor area: ${propRecord?.internal_area_sqm ? `${propRecord.internal_area_sqm}m² (${Math.round((propRecord.internal_area_sqm as number) * 10.764)}sqft)` : 'Unknown'}

LAND REGISTRY DATA:
- Last sold: ${propRecord?.last_sold_date || 'No record'} at £${propRecord?.last_sold_price ? (propRecord.last_sold_price as number).toLocaleString() : 'Unknown'}
- Transaction history: ${transactions?.length || 0} recorded sales
${transactions && transactions.length > 0 ? `- Most recent transactions: ${transactions.slice(0, 3).map(t => `£${(t.price as number).toLocaleString()} (${t.date})`).join(', ')}` : ''}

EPC & ENERGY:
- EPC rating: ${enriched?.epcRating || epc?.current_energy_efficiency || 'Unknown'}
- Energy efficiency score: ${epc?.current_energy_efficiency || 'Unknown'}/100
- Potential score: ${epc?.potential_energy_efficiency || 'Unknown'}/100
- Floor area (EPC cert): ${epc?.epc_floor_area || 'Unknown'}m²
- Last EPC: ${epc?.last_epc_date || 'Unknown'}

INVESTMENT METRICS (estimated, user should confirm rent):
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

Analyse this specific property. Note that rent is estimated — the user should verify with local agents. Be specific, data-driven, and actionable. Flag if the last sold price is significantly different from current market value in ${cityName}.`
}
