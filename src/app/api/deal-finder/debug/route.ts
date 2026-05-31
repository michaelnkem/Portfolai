import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://api.homedata.co.uk/api'

async function probe(url: string, apiKey: string) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' }, cache: 'no-store' })
    const body = await res.text().catch(() => '')
    return { url, status: res.status, ok: res.ok, body: body.slice(0, 800) }
  } catch (err) {
    return { url, status: 0, ok: false, body: String(err) }
  }
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.HOMEDATA_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'HOMEDATA_API_KEY not set' }, { status: 500 })

  const location = req.nextUrl.searchParams.get('location') || 'Manchester'

  // Step 1 - boundary lookup
  const boundaryUrl = `${BASE}/boundaries/autocomplete/?q=${encodeURIComponent(location)}`
  const boundaryResult = await probe(boundaryUrl, apiKey)

  let boundaryId: number | null = null
  let boundaryName: string | null = null
  try {
    const parsed = JSON.parse(boundaryResult.body)
    const first = parsed?.results?.[0]
    if (first?.id) { boundaryId = Number(first.id); boundaryName = String(first.display_name) }
  } catch {}

  // Step 2 - listings using boundary ID
  let listingsResult = null
  if (boundaryId) {
    const listingsUrl = `${BASE}/live-listings/search/?boundary_id=${boundaryId}&transaction_type=Sale&page_size=5`
    listingsResult = await probe(listingsUrl, apiKey)
  }

  // Step 3 - also try properties endpoint as alternative
  const propertiesUrl = `${BASE}/properties/?location=${encodeURIComponent(location)}&page_size=3`
  const propertiesResult = await probe(propertiesUrl, apiKey)

  return NextResponse.json({
    apiKeyPrefix: `${apiKey.slice(0, 6)}…`,
    location,
    boundary: { status: boundaryResult.status, id: boundaryId, name: boundaryName },
    listings: listingsResult ? { status: listingsResult.status, ok: listingsResult.ok, body: listingsResult.body } : 'skipped — no boundary ID',
    propertiesEndpoint: { status: propertiesResult.status, ok: propertiesResult.ok, body: propertiesResult.body },
    diagnosis: boundaryId
      ? listingsResult?.ok
        ? 'All working — boundary and listings both responding'
        : `Boundary ID ${boundaryId} found but listings call returned ${listingsResult?.status}`
      : 'Boundary lookup succeeded but ID extraction failed',
  })
}
