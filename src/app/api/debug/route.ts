import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const outcode = req.nextUrl.searchParams.get('outcode') || 'EN3'
  const apiKey = process.env.HOMEDATA_API_KEY || ''

  let trendsRaw: unknown = null
  let trendsStatus = 0
  try {
    const res = await fetch(
      `https://api.homedata.co.uk/api/price_trends/${encodeURIComponent(outcode)}/`,
      { headers: { Authorization: `Api-Key ${apiKey}` }, cache: 'no-store' }
    )
    trendsStatus = res.status
    trendsRaw = await res.json()
  } catch (e) {
    trendsRaw = { error: String(e) }
  }

  const trendsObj = trendsRaw as Record<string, unknown>
  const topKeys = trendsRaw && typeof trendsRaw === 'object' ? Object.keys(trendsObj) : []
  const results = Array.isArray(trendsObj?.results) ? trendsObj.results as unknown[] : []

  return NextResponse.json({
    outcode,
    apiKeyPresent: !!apiKey,
    trendsStatus,
    topKeys,
    totalRecords: results.length,
    sample: results.slice(0, 3),
    fullResponse: trendsRaw,
  })
}
