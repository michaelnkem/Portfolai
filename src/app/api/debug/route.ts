import { NextRequest, NextResponse } from 'next/server'

// Debug endpoint — helps diagnose Homedata API response format
// Visit: /api/debug?q=your+search+query
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || 'Oxford Street London'
  const uprn = req.nextUrl.searchParams.get('uprn')

  if (!process.env.HOMEDATA_API_KEY) {
    return NextResponse.json({ error: 'No API key' })
  }

  const headers = { Authorization: `Api-Key ${process.env.HOMEDATA_API_KEY}` }

  if (uprn) {
    const res = await fetch(`https://api.homedata.co.uk/api/properties/${uprn}`, { headers })
    const data = await res.json()
    return NextResponse.json({ status: res.status, uprn, data })
  }

  const res = await fetch(
    `https://api.homedata.co.uk/api/address/find/?q=${encodeURIComponent(q)}`,
    { headers }
  )
  const data = await res.json()
  return NextResponse.json({
    status: res.status,
    query: q,
    responseKeys: Object.keys(data),
    fullResponse: data,
  })
}
