import { NextRequest, NextResponse } from 'next/server'

const VARIANTS = [
  'https://api.homedata.co.uk/api',
  'https://api.homedata.co.uk',
  'https://homedata.co.uk/api',
]

async function probe(baseUrl: string, path: string, apiKey: string) {
  const url = `${baseUrl}${path}`
  try {
    const res = await fetch(url, { headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' }, cache: 'no-store' })
    const body = await res.text().catch(() => '')
    return { url, status: res.status, ok: res.ok, body: body.slice(0, 500) }
  } catch (err) {
    return { url, status: 0, ok: false, body: String(err) }
  }
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.HOMEDATA_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'HOMEDATA_API_KEY not set' }, { status: 500 })

  const location = req.nextUrl.searchParams.get('location') || 'Manchester'
  const boundaryPath = `/boundaries/autocomplete/?q=${encodeURIComponent(location)}`
  const boundaryProbes = await Promise.all(VARIANTS.map(base => probe(base, boundaryPath, apiKey)))
  const workingBoundary = boundaryProbes.find(p => p.ok)

  let listingProbes: typeof boundaryProbes = []
  let boundaryId: string | null = null

  if (workingBoundary) {
    try {
      const parsed = JSON.parse(workingBoundary.body) as Record<string, unknown>
      const results = Array.isArray(parsed.results) ? parsed.results as Record<string, unknown>[] : []
      boundaryId = results[0]?.id != null ? String(results[0].id) : null
    } catch {}

    if (boundaryId) {
      const listingPath = `/live-listings/search/?boundary_id=${boundaryId}&transaction_type=Sale&page_size=3`
      const workingBase = VARIANTS.find(b => workingBoundary.url.startsWith(b)) ?? VARIANTS[0]
      listingProbes = [await probe(workingBase, listingPath, apiKey)]
    }
  }

  return NextResponse.json({
    apiKeyPresent: true,
    apiKeyPrefix: `${apiKey.slice(0, 6)}…`,
    location,
    boundaryProbes: boundaryProbes.map(p => ({ url: p.url, status: p.status, ok: p.ok, bodyPreview: p.body.slice(0, 200) })),
    resolvedBoundaryId: boundaryId,
    listingProbes: listingProbes.map(p => ({ url:

