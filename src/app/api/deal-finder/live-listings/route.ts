import { NextRequest, NextResponse } from "next/server"

export const dynamic = 'force-dynamic'

const HOMEDATA_BASE_URL = "https://api.homedata.co.uk/api"

function isFullUKPostcode(value: string): boolean {
  return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(value.trim())
}

function normalizePostcode(value: string): string {
  const raw = value.trim().toUpperCase().replace(/\s+/g, "")
  return raw.length > 3 ? `${raw.slice(0, -3)} ${raw.slice(-3)}` : raw
}

async function fetchHomedata(path: string) {
  const apiKey = process.env.HOMEDATA_API_KEY

  if (!apiKey) {
    throw new Error("Missing HOMEDATA_API_KEY environment variable")
  }

  const response = await fetch(`${HOMEDATA_BASE_URL}${path}`, {
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  })

  const text = await response.text()

  if (!response.ok) {
    throw new Error(`Homedata error ${response.status}: ${text}`)
  }

  return JSON.parse(text) as Record<string, unknown>
}

function str(v: unknown): string | null {
  return v != null && v !== "" ? String(v) : null
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normalizeListing(listing: Record<string, unknown>) {
  // Images may be string[] or {url: string}[] — handle both
  const images = Array.isArray(listing.images) ? listing.images : []
  const firstImage = images[0] ?? null
  const imageUrl: string | null =
    typeof firstImage === "string"
      ? firstImage
      : firstImage != null && typeof (firstImage as Record<string, unknown>).url === "string"
      ? (firstImage as Record<string, unknown>).url as string
      : null

  return {
    id: str(listing.id),
    uprn: str(listing.property_uprn),
    address: str(listing.display_address),
    postcode: str(listing.postcode),
    transactionType: str(listing.transaction_type),
    status: str(listing.latest_status),
    askingPrice: num(listing.latest_price),
    source: str(listing.source),
    bedrooms: num(listing.bedrooms),
    bathrooms: num(listing.bathrooms),
    propertyType: str(listing.listing_property_type) ?? str(listing.loki_property_type),
    tenure: str(listing.ownership),
    isNewBuild: listing.is_new_build === true,
    addedDate: str(listing.added_date),
    reducedDate: str(listing.reduced_date),
    description: str(listing.description),
    imageUrl,
    raw: listing,
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const location = searchParams.get("location") || ""
    const transactionType = searchParams.get("transaction_type") || "Sale"

    if (!location.trim()) {
      return NextResponse.json(
        { error: "Location or postcode is required" },
        { status: 400 }
      )
    }

    const liveParams = new URLSearchParams()

    if (isFullUKPostcode(location)) {
      liveParams.set("postcode", normalizePostcode(location))
    } else {
      const boundaryData = await fetchHomedata(
        `/boundaries/autocomplete/?q=${encodeURIComponent(location)}`
      )

      const results = Array.isArray(boundaryData?.results) ? boundaryData.results as Record<string, unknown>[] : []
      const boundaryId = results[0]?.id

      if (!boundaryId) {
        return NextResponse.json(
          {
            error: "No matching boundary found",
            location,
            results: [],
          },
          { status: 404 }
        )
      }

      liveParams.set("boundary_id", String(boundaryId))
    }

    liveParams.set("transaction_type", transactionType)
    liveParams.set("page", searchParams.get("page") || "1")
    liveParams.set("page_size", searchParams.get("page_size") || "30")
    liveParams.set("sort", searchParams.get("sort") || "-added_date")

    const passthroughParams = [
      "bedrooms",
      "max_bedrooms",
      "min_price",
      "max_price",
      "property_type",
      "new_builds_only",
      "reduced_only",
      "reduction_count_min",
      "min_epc_band",
      "max_epc_band",
      "min_floor_area",
      "max_floor_area",
      "has_garden",
      "has_parking",
      "has_solar_panels",
      "min_dom",
    ]

    for (const key of passthroughParams) {
      const value = searchParams.get(key)
      if (value !== null && value !== "") {
        liveParams.set(key, value)
      }
    }

    const data = await fetchHomedata(
      `/live-listings/search/?${liveParams.toString()}`
    )

    const rawResults = Array.isArray(data.results) ? data.results as Record<string, unknown>[] : []
    const results = rawResults.map(normalizeListing)

    return NextResponse.json({
      count: num(data.count) ?? results.length,
      page: num(data.page) ?? Number(liveParams.get("page")),
      page_size: num(data.page_size) ?? Number(liveParams.get("page_size")),
      total_pages: num(data.total_pages) ?? null,
      results,
    })
  } catch (error) {
    console.error("Live listings route error:", error)

    return NextResponse.json(
      {
        error: "Unable to load live listings",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
