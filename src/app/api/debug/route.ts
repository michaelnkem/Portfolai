import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const outcode = req.nextUrl.searchParams.get('outcode') || 'EN3'
  const postcode = req.nextUrl.searchParams.get('postcode') || ''
  const urls = [
    `http://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(outcode)}&_pageSize=5&_sort=-transactionDate`,
    `http://landregistry.data.gov.uk/data/ppi/transaction-record.json?postcode=${encodeURIComponent(outcode)}&_pageSize=5`,
    `http://landregistry.data.gov.uk/data/ppi/address.json?postcode=${encodeURIComponent(outcode)}&_pageSize=5`,
    postcode ? `http://landregistry.data.gov.uk/data/ppi/address.json?postcode=${encodeURIComponent(postcode)}&_pageSize=10` : null,
  ].filter(Boolean) as string[]
  const results: Record<string, unknown>[] = []
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      const text = await res.text()
      let data: Record<string, unknown>
      try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 300) } }
      const items = (data?.result as Record<string, unknown>)?.items || data?.items || []
      results.push({ url, status: res.status, count: (items as unknown[]).length, totalResults: (data?.result as Record<string, unknown>)?.totalResults, sample: (items as unknown[]).slice(0, 2), keys: Object.keys(data?.result as object || data || {}) })
    } catch (e) { results.push({ url, error: String(e) }) }
  }
  return NextResponse.json({ outcode, postcode, results })
}
