import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const outcode  = req.nextUrl.searchParams.get('outcode') || 'EN3'
  const lrType   = req.nextUrl.searchParams.get('type') || 'semi-detached'
  const postcode = req.nextUrl.searchParams.get('postcode') || ''

  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - 18)
  const cutoffStr = cutoffDate.toISOString().slice(0, 10)

  const compUrl = `http://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(outcode)}&_pageSize=10&_sort=-transactionDate&propertyType=${lrType}&min-transactionDate=${cutoffStr}`

  const histUrl = postcode
    ? `http://landregistry.data.gov.uk/data/ppi/address.json?postcode=${encodeURIComponent(postcode)}&_pageSize=20&_sort=-transactionDate`
    : null

  try {
    const compRes = await fetch(compUrl, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
    const compText = await compRes.text()
    let compData: Record<string, unknown>
    try { compData = JSON.parse(compText) } catch { compData = { raw: compText.slice(0, 500) } }
    const compItems = (compData?.result as Record<string, unknown>)?.items || compData?.items || []

    let histResult = null
    if (histUrl) {
      const histRes = await fetch(histUrl, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      const histText = await histRes.text()
      let histData: Record<string, unknown>
      try { histData = JSON.parse(histText) } catch { histData = { raw: histText.slice(0, 500) } }
      histResult = {
        status: histRes.status,
        count: ((histData?.result as Record<string, unknown>)?.items as unknown[] || []).length,
        sample: ((histData?.result as Record<string, unknown>)?.items as unknown[] || []).slice(0, 3),
      }
    }

    return NextResponse.json({
      outcode, lrType, cutoffDate: cutoffStr,
      comparables: {
        url: compUrl,
        status: compRes.status,
        count: (compItems as unknown[]).length,
        sample: (compItems as unknown[]).slice(0, 3),
      },
      history: histResult,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e), outcode, lrType })
  }
}
// Tue 19 May 2026 08:36:49 BST
// force Tue 19 May 2026 08:53:31 BST
