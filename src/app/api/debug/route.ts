import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || 'EN3 5NX'
  const apiKey = process.env.HOMEDATA_API_KEY || ''

  const results: Record<string, unknown>[] = []

  try {
    const url = `https://api.homedata.co.uk/api/address/find/?q=${encodeURIComponent(q)}`
    const res = await fetch(url, {
      headers: { Authorization: `Api-Key ${apiKey}` },
      cache: 'no-store',
    })
    const text = await res.text()
    let data: Record<string, unknown>
    try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 500) } }
    results.push({
      test: 'address_search',
      status: res.status,
      statusText: res.statusText,
      keys: Object.keys(data),
      count: (data.suggestions as unknown[] || data.results as unknown[] || []).length,
      sample: (data.suggestions as unknown[] || data.results as unknown[] || []).slice(0, 2),
      raw: res.status !== 200 ? text.slice(0, 500) : undefined,
    })
  } catch (e) {
    results.push({ test: 'address_search', error: String(e) })
  }

  try {
    const outcode = q.split(' ')[0]
    const url = `https://api.homedata.co.uk/api/price_trends/${outcode}/`
    const res = await fetch(url, {
      headers: { Authorization: `Api-Key ${apiKey}` },
      cache: 'no-store',
    })
    const text = await res.text()
    let data: Record<string, unknown>
    try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 500) } }
    const monthlyPrices = data.monthly_average_prices as Record<string, number> | undefined
    results.push({
      test: 'price_trends',
      status: res.status,
      statusText: res.statusText,
      monthCount: monthlyPrices ? Object.keys(monthlyPrices).length : 0,
      raw: res.status !== 200 ? text.slice(0, 500) : undefined,
    })
  } catch (e) {
    results.push({ test: 'price_trends', error: String(e) })
  }

  return NextResponse.json({
    apiKeyPresent: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.slice(0, 8) + '...' : 'NOT SET',
    query: q,
    results,
    diagnosis: results.map(r => {
      if (r.status === 200) return `✅ ${r.test}: OK`
      if (r.status === 429) return `🚫 ${r.test}: RATE LIMITED / QUOTA EXCEEDED`
      if (r.status === 401 || r.status === 403) return `🔑 ${r.test}: AUTH FAILED`
      if (r.status === 402) return `💳 ${r.test}: PAYMENT REQUIRED — plan limit`
      if (r.error) return `❌ ${r.test}: ${r.error}`
      return `⚠️ ${r.test}: HTTP ${r.status}`
    }),
  })
}
