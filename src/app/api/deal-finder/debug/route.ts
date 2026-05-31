import { NextRequest, NextResponse } from 'next/server'
const BASE = 'https://api.homedata.co.uk/api'
export async function GET(req: NextRequest) {
  const apiKey = process.env.HOMEDATA_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' })
  const location = req.nextUrl.searchParams.get('location') || 'Manchester'
  const boundaryRes = await fetch(`${BASE}/boundaries/autocomplete/?q=${encodeURIComponent(location)}`, { headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' }, cache: 'no-store' })
  const boundaryText = await boundaryRes.text()
  const boundaryJson = JSON.parse(boundaryText)
  const first = boundaryJson?.results?.[0]
  const boundaryId = first?.id ? Number(first.id) : null
  let listingsResult = null
  if (boundaryId) {
    const lr = await fetch(`${BASE}/live-listings/search/?boundary_id=${boundaryId}&transaction_type=Sale&page_size=5&is_withdrawn=false`, { headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' }, cache: 'no-store' })
    const lt = await lr.text()
    listingsResult = { status: lr.status, ok: lr.ok, body: lt.slice(0, 1000) }
  }
  return NextResponse.json({ apiKeyPrefix: apiKey.slice(0, 6), boundaryId, boundaryName: first?.display_name, listings: listingsResult, diagnosis: boundaryId ? listingsResult?.ok ? 'All working' : `Listings failed: ${listingsResult?.status}` : 'Boundary ID not found' })
}
