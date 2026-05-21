import { getPriceTrends } from './homedata'
import { MARKET_DATA } from './market-data'

export type LiveMarketData = typeof MARKET_DATA

const CITY_OUTCODES: Record<string, string> = {
  Manchester: 'M14',
  Birmingham: 'B29',
  Liverpool: 'L18',
  Leeds: 'LS6',
  Sheffield: 'S10',
  Nottingham: 'NG7',
  Bristol: 'BS6',
  London: 'E17',
}

function recencyWeightedAvg(trends: { period: string; mean_price: number }[], months = 6): number {
  const sorted = [...trends]
    .filter(t => t.mean_price > 0)
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, months)

  if (sorted.length === 0) return 0

  const λ = 0.15
  let weightSum = 0
  let valueSum = 0
  sorted.forEach((t, i) => {
    const w = Math.exp(-λ * i)
    weightSum += w
    valueSum += t.mean_price * w
  })
  return valueSum / weightSum
}

function capitalGrowth1yr(trends: { period: string; mean_price: number }[]): number {
  const sorted = [...trends]
    .filter(t => t.mean_price > 0)
    .sort((a, b) => b.period.localeCompare(a.period))

  if (sorted.length < 13) return 0
  const recent = (sorted[0].mean_price + sorted[1].mean_price + sorted[2].mean_price) / 3
  const prior = (sorted[12].mean_price + sorted[11].mean_price + sorted[10].mean_price) / 3
  if (prior === 0) return 0
  return parseFloat(((recent / prior - 1) * 100).toFixed(1))
}

export async function getLiveMarketData(): Promise<LiveMarketData> {
  const cityEntries = Object.entries(CITY_OUTCODES)

  const results = await Promise.allSettled(
    cityEntries.map(async ([city, outcode]) => {
      const trends = await getPriceTrends(outcode)
      if (!trends || trends.length < 6) return null
      const avgPrice = Math.round(recencyWeightedAvg(trends))
      const growth = capitalGrowth1yr(trends)
      return { city, avgPrice, capitalGrowth1yr: growth }
    })
  )

  const cityUpdates: Record<string, { avgPrice: number; capitalGrowth1yr: number }> = {}
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      const { city, avgPrice, capitalGrowth1yr } = r.value
      if (avgPrice > 50000) {
        cityUpdates[city] = { avgPrice, capitalGrowth1yr }
      }
    } else {
      console.log(`getLiveMarketData: ${cityEntries[i][0]} fell back to static`)
    }
  })

  const cities = { ...MARKET_DATA.cities }
  for (const [city, updates] of Object.entries(cityUpdates)) {
    const key = city as keyof typeof cities
    if (cities[key]) {
      cities[key] = { ...cities[key], ...updates }
    }
  }

  const now = new Date()
  const dataAsOf = now.toLocaleString('en-GB', { month: 'long', year: 'numeric' })

  return {
    ...MARKET_DATA,
    dataAsOf,
    cities,
  } as LiveMarketData
}
