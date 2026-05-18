import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const outcode = req.nextUrl.searchParams.get('outcode') || 'EN3'
  const lrType  = req.nextUrl.searchParams.get('type') || 'S'

  const lrTypeUri = lrType === 'F' ? 'http://landregistry.data.gov.uk/def/ppi/flat-maisonette'
    : lrType === 'S' ? 'http://landregistry.data.gov.uk/def/ppi/semi-detached'
    : lrType === 'T' ? 'http://landregistry.data.gov.uk/def/ppi/terraced'
    : 'http://landregistry.data.gov.uk/def/ppi/detached'

  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - 18)
  const cutoffStr = cutoffDate.toISOString().slice(0, 10)

  const sparql = `
SELECT ?postcode ?amount ?date WHERE {
  ?transx a <http://landregistry.data.gov.uk/def/ppi/TransactionRecord> .
  ?transx <http://landregistry.data.gov.uk/def/ppi/pricePaid> ?amount .
  ?transx <http://landregistry.data.gov.uk/def/ppi/transactionDate> ?date .
  ?transx <http://landregistry.data.gov.uk/def/ppi/newBuild> "false"^^<http://www.w3.org/2001/XMLSchema#boolean> .
  ?transx <http://landregistry.data.gov.uk/def/ppi/propertyType> <${lrTypeUri}> .
  ?transx <http://landregistry.data.gov.uk/def/ppi/propertyAddress> ?addr .
  ?addr <http://landregistry.data.gov.uk/def/common/postcode> ?postcode .
  FILTER(STRSTARTS(STR(?postcode), "${outcode}"))
  FILTER(?date >= "${cutoffStr}"^^<http://www.w3.org/2001/XMLSchema#date>)
}
ORDER BY DESC(?date)
LIMIT 10
`.trim()

  try {
    const body = new URLSearchParams({ query: sparql, output: 'json' })
    const res = await fetch('http://landregistry.data.gov.uk/landregistry/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body.toString(),
      cache: 'no-store',
    })

    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 1000) } }
    const bindings = data?.results?.bindings || []

    return NextResponse.json({
      outcode, lrType, cutoffDate: cutoffStr,
      httpStatus: res.status,
      resultCount: bindings.length,
      sample: bindings.slice(0, 5),
      sparqlQuery: sparql,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) })
  }
}
