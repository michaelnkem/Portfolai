import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://api.homedata.co.uk/api'

export async function GET(req: NextRequest) {
  const apiKey = process.env.HOMEDATA_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'HOMEDATA_API_KEY not set' }, { status: 500 })

  const location = req.nextUrl.searchParams.get('location') || 'Manchester'

  // Step 1 - boundary lookup — read full body before parsing
  const boundaryUrl = `${BASE}/boundaries/autocomplete/?q=${encodeURIComponent(location)}`
  const boundaryRes = await fetch(boundaryUrl, {
    headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  const boundaryText = await boundaryRes.text()
  const boundaryJson = JSON.parse(boundaryText)
  const first = boundaryJson?.results?.[0]
  const boundaryId = first?.id ? Number(first.id) : null
  const boundaryName = first?.display_name ?? null

  // Step 2 - listings
  let listingsResult: Record<string, unknown> = { skipped: true }
  if (boundaryId) {
    const listingsUrl = `${BASE}/live-listings/search/?boundary_id=${boundaryId}&transaction_type=Sale&page_size=5`
    const res = await fetch(listingsUrl, {
      headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    const text = await res.text()
    listingsResult = { status: res.status, ok: res.ok, body: text.slice(0, 1000) }
  }

  return NextResponse.json({
    apiKeyPrefix: `${apiKey.slice(0, 6)}…`,
    location,
    boundaryStatus: boundaryRes.status,
    boundaryId,
    boundaryName,
    rawFirstResult: first ?? null,
    listings: listingsResult,
    diagnosis: boundaryId
      ? (listingsResult as Record<string, unknown>).ok
        ? 'All working'
        : `Boundary ID ${boundaryId} found — listings returned ${(listingsResult as Record<string, unknown>).status}`
      : 'ID extraction failed — check rawFirstResult',
  })
}
