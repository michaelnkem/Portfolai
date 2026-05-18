import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const outcode = req.nextUrl.searchParams.get('outcode') || 'EN3'
  const lrType  = req.nextUrl.searchParams.get('type') || 'S' // S=semi, T=terraced, F=flat, D=detached

  const lrTypeUri = lrType === 'F' ? 'http://landregistry.data.gov.uk/def/ppi/flat-maisonette'
    : lrType === 'S' ? 'http://landregistry.data.gov.uk/def/ppi/semi-detached'
    : lrType === 'T' ? 'http://landregistry.data.gov.uk/def/ppi/terraced'
    : 'http://landregistry.data.gov.uk/def/ppi/detached'

  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - 18)
  const cutoffStr = cutoffDate.toISOString().slice(0, 10)

  const sparql = `
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>

SELECT ?postcode ?amount ?date ?propertyType WHERE {
  ?transx lrppi:pricePaid ?amount ;
          lrppi:transactionDate ?date ;
          lrppi:propertyType ?propertyType ;
          lrppi:newBuild ?newBuild ;
          lrppi:propertyAddress ?addr .
  ?addr lrcommon:postcode ?postcode .
  FILTER(STRSTARTS(STR(?postcode), "${outcode}"))
  FILTER(?date >= "${cutoffStr}"^^xsd:date)
  FILTER(?newBuild = "false"^^xsd:boolean)
  FILTER(?propertyType = <${lrTypeUri}>)
}
ORDER BY DESC(?date)
LIMIT 20
`.trim()

  const url = `https://landregistry.data.gov.uk/landregistry/query?query=${encodeURIComponent(sparql)}&output=json`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/sparql-results+json' },
      cache: 'no-store',
    })

    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 500) } }

    const bindings = data?.results?.bindings || []

    return NextResponse.json({
      outcode,
      lrType,
      lrTypeUri,
      cutoffDate: cutoffStr,
      httpStatus: res.status,
      resultCount: bindings.length,
      sample: bindings.slice(0, 5),
      sparqlUrl: url.slice(0, 200) + '...',
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e), outcode, lrType })
  }
}
