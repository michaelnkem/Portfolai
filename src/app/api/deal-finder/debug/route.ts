// Diagnostic route — safe to call from browser, never exposes API key
// GET /api/deal-finder/debug?location=Manchester
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const VARIANTS = [
  'https://api.homedata.co.uk/api',
  'https://api.homedata.co.uk',
  'https://homedata.co.uk/api',
]

async function probe(
  baseUrl: string,
  path: string,
  apiKey: string,
): Promise<{ url: string; status: number; ok: boolean; body: string }> {
  const url = `${baseUrl}${path}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Api-Key ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    const body = await res.text().catch(() => '')
    return { url, status: res.status, ok: res.ok, body: body.slice(0, 500) }
  } catch (err) {
    return { url, status: 0, ok: false, body: String(err) }
  }
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.HOMEDATA_API_KEY

  if (!apiKey) {
    return NextResponse.json({
      error: 'HOMEDATA_API_KEY is not set in environment variables',
      fix: 'Add HOMEDATA_API_KEY to your Vercel project environment variables',
    }, { status: 500 })
  }

  const location = req.nextUrl.searchParams.get('location') || 'Manchester'

  // Step 1 — probe boundary autocomplete across all base URL variants
  const boundaryPath = `/boundaries/autocomplete/?q=${encodeURIComponent(location)}`
  const boundaryProbes = await Promise.all(
    VARIANTS.map(base => probe(base, boundaryPath, apiKey))
  )

  const workingBoundary = boundaryProbes.find(p => p.ok)

  // Step 2 — if a boundary probe worked, try live-listings with that base
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
    boundaryProbes: boundaryProbes.map(p => ({
      url: p.url,
      status: p.status,
      ok: p.ok,
      bodyPreview: p.body.slice(0, 200),
    })),
    resolvedBoundaryId: boundaryId,
    listingProbes: listingProbes.map(p => ({
      url: p.url,
      status: p.status,
      ok: p.ok,
      bodyPreview: p.body.slice(0, 300),
    })),
    diagnosis: workingBoundary
      ? boundaryId
        ? listingProbes[0]?.ok
          ? 'All good — boundary and listings both working'
          : `Boundary OK (id=${boundaryId}) but live-listings call failed: ${listingProbes[0]?.status}`
        : 'Boundary endpoint responded but returned no results'
      : `All boundary URL variants failed. Check API key and base URL. Statuses: ${boundaryProbes.map(p => p.status).join(', ')}`,
  })
}
