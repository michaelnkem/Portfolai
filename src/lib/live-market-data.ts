// Server-side only — enriches static MARKET_DATA with live Homedata price trends
import { getPriceTrends } from './homedata'
import { MARKET_DATA } from './market-data'

// Residential outcodes chosen for data density — mid-market, high transaction volume
const CITY_OUTCODES: Record<string, string> = {
  Manchester: 'M14',
  Birmingham: 'B29',
  Liverpool:  'L18',
  Leeds:      'LS6',
  Sheffield:  'S10',
  Nottingham: 'NG7',
  Bristol:    'BS6',
  London:     'E17',
}

export type LiveMarketData = typeof MARKET_DATA

export async function getLiveMarketData(): Promise<LiveMarketData> {
  const cities = structuredClone(MARKET_DATA.cities) as typeof MARKET_DATA.cities

  await Promise.all(
    Object.entries(CITY_OUTCODES).map(async ([city, outcode]) => {
      try {
        const trends = await getPriceTrends(outcode)
        const sorted = [...trends].sort((a, b) => b.period.localeCompare(a.period))
        const prices = sorted
          .map(t => t.median_price || t.mean_price)
          .filter(p => p > 10000)

        if (prices.length < 6) return

        // Recency-weighted avg for current avgPrice
        const weights = prices.slice(0, 6).map((_, i) => Math.exp(-0.15 * i))
        const totalW = weights.reduce((s, w) => s + w, 0)
        const avgPrice = Math.round(
          prices.slice(0, 6).reduce((s, p, i) => s + p * weights[i], 0) / totalW / 1000
        ) * 1000

        // capitalGrowth1yr: recent 3 months vs same window 12 months ago
        let capitalGrowth1yr = cities[city as keyof typeof cities].capitalGrowth1yr
        if (prices.length >= 12) {
          const recentAvg = prices.slice(0, 3).reduce((s, p) => s + p, 0) / 3
          const yearAgoSlice = prices.slice(9, 12)
          const yearAgoAvg = yearAgoSlice.reduce((s, p) => s + p, 0) / yearAgoSlice.length
          capitalGrowth1yr = parseFloat(((recentAvg / yearAgoAvg - 1) * 100).toFixed(1))
        }

        cities[city as keyof typeof cities] = {
          ...cities[city as keyof typeof cities],
          avgPrice,
          capitalGrowth1yr,
        }

        console.log(`Live market: ${city} avgPrice=£${avgPrice.toLocaleString()} growth=${capitalGrowth1yr}%`)
      } catch (e) {
        console.error(`Live market data failed for ${city} (${outcode}):`, e)
      }
    })
  )

  const now = new Date()
  const dataAsOf = now.toLocaleString('en-GB', { month: 'long', year: 'numeric' })

  return { ...MARKET_DATA, cities, dataAsOf }
}
