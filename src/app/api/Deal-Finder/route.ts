import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type HomeDataListing = {
  id: string;
  street?: string | null;
  postcode?: string | null;
  transaction_type?: string | null;
  latest_status?: string | null;
  latest_price?: number | null;
  previous_price?: number | null;
  source?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  reception_rooms?: number | null;
  property_type?: string | null;
  ownership?: string | null;
  is_new_build?: boolean | null;
  has_garden?: boolean | null;
  has_parking?: boolean | null;
  has_solar_panels?: boolean | null;
  is_reduced?: boolean | null;
  times_reduced?: number | null;
  is_withdrawn?: boolean | null;
  days_on_market?: number | null;
  added_date?: string | null;
  agent_name?: string | null;
  uprn?: string | null;
  image_url?: string | null;
};

export type DealCandidate = {
  id: string;
  uprn: string | null;
  address: string;
  displayAddress: string;
  city: string | null;
  postcode: string | null;
  askingPrice: number | null;
  previousAskingPrice: number | null;
  rentEstimateMonthly: number | null;
  grossYield: number | null;
  netYield: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string | null;
  tenure: string | null;
  epcRating: string | null;
  listingStatus: "new_listing" | "reduced" | "active" | "under_offer" | "sold_stc";
  listingDate: string | null;
  updatedAt: string | null;
  imageUrl: string | null;
  investmentFitScore: number;
  investmentFitLabel: string;
  investmentReasons: string[];
};

const HOMEDATA_URL = "https://api.homedata.co.uk/api/live-listings/search/";

const CITY_OUTCODES: Record<string, string[]> = {
  London: ["E", "EC", "N", "NW", "SE", "SW", "W", "WC"],
  Liverpool: ["L"],
  Manchester: ["M"],
  Birmingham: ["B"],
  Leeds: ["LS"],
  Sheffield: ["S"],
  Bristol: ["BS"],
  Nottingham: ["NG"],
  Leicester: ["LE"],
  Newcastle: ["NE"],
  Cardiff: ["CF"],
  Glasgow: ["G"],
  Edinburgh: ["EH"],
};

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normaliseText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function getOutcode(postcode: string | null | undefined): string {
  if (!postcode) return "";
  return postcode.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

function getAreaPrefix(postcode: string | null | undefined): string {
  const outcode = getOutcode(postcode);
  return outcode.replace(/[0-9]/g, "");
}

function titleCase(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/_/g, " ")
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

function inferCity(postcode: string | null | undefined): string | null {
  const prefix = getAreaPrefix(postcode);
  for (const [city, prefixes] of Object.entries(CITY_OUTCODES)) {
    if (prefixes.includes(prefix)) return city;
  }
  return null;
}

function mapStatus(listing: HomeDataListing): DealCandidate["listingStatus"] {
  const status = String(listing.latest_status ?? "").toLowerCase();

  if (listing.is_reduced || Number(listing.times_reduced ?? 0) > 0) return "reduced";
  if (status.includes("under offer")) return "under_offer";
  if (status.includes("sold stc")) return "sold_stc";

  const days = Number(listing.days_on_market ?? 999);
  if (Number.isFinite(days) && days <= 7) return "new_listing";

  return "active";
}

function estimateRentMonthly(sale: HomeDataListing, rentalListings: HomeDataListing[]): number | null {
  const saleBeds = numberOrNull(sale.bedrooms);
  const saleType = normaliseText(sale.property_type);
  const saleOutcode = getOutcode(sale.postcode);
  const saleArea = getAreaPrefix(sale.postcode);

  const rents = rentalListings
    .filter((r) => {
      const price = numberOrNull(r.latest_price);
      if (!price) return false;

      const sameOutcode = getOutcode(r.postcode) === saleOutcode;
      const sameArea = getAreaPrefix(r.postcode) === saleArea;
      const sameBeds = saleBeds ? numberOrNull(r.bedrooms) === saleBeds : true;
      const sameType = saleType ? normaliseText(r.property_type) === saleType : true;

      return (sameOutcode || sameArea) && sameBeds && sameType;
    })
    .map((r) => numberOrNull(r.latest_price))
    .filter((v): v is number => v != null);

  if (rents.length > 0) {
    return Math.round(rents.reduce((a, b) => a + b, 0) / rents.length);
  }

  const fallbackRents = rentalListings
    .filter((r) => getAreaPrefix(r.postcode) === saleArea)
    .map((r) => numberOrNull(r.latest_price))
    .filter((v): v is number => v != null);

  if (fallbackRents.length > 0) {
    return Math.round(fallbackRents.reduce((a, b) => a + b, 0) / fallbackRents.length);
  }

  return null;
}

function calculateGrossYield(askingPrice: number | null, monthlyRent: number | null): number | null {
  if (!askingPrice || !monthlyRent) return null;
  return Number(((monthlyRent * 12) / askingPrice * 100).toFixed(1));
}

function calculateNetYield(grossYield: number | null): number | null {
  if (!grossYield) return null;

  // Simple landlord-cost deduction. Later you can replace this with your full AI yield model.
  return Number((grossYield * 0.78).toFixed(1));
}

function scoreDeal(args: {
  askingPrice: number | null;
  netYield: number | null;
  grossYield: number | null;
  bedrooms: number | null;
  propertyType: string | null;
  listingStatus: DealCandidate["listingStatus"];
  favAvgNetYield: number;
  favAvgValue: number;
  favPropertyTypes: string[];
  favMinBeds: number;
  favMaxBeds: number;
}): { score: number; label: string; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];

  if (args.netYield != null) {
    if (args.netYield >= args.favAvgNetYield + 1.5) {
      score += 25;
      reasons.push("Strong yield");
    } else if (args.netYield >= args.favAvgNetYield) {
      score += 18;
      reasons.push("Yield match");
    } else if (args.netYield >= Math.max(4, args.favAvgNetYield - 1)) {
      score += 10;
    }
  }

  if (args.askingPrice != null && args.favAvgValue > 0) {
    if (args.askingPrice <= args.favAvgValue * 0.9) {
      score += 15;
      reasons.push("Lower entry price");
    } else if (args.askingPrice <= args.favAvgValue * 1.15) {
      score += 8;
      reasons.push("Price fit");
    }
  }

  if (args.bedrooms != null && args.bedrooms >= args.favMinBeds && args.bedrooms <= args.favMaxBeds) {
    score += 10;
    reasons.push("Bedroom match");
  }

  if (args.propertyType && args.favPropertyTypes.length > 0) {
    const wanted = args.favPropertyTypes.map((x) => x.toLowerCase().replace(/_/g, " "));
    const actual = args.propertyType.toLowerCase().replace(/_/g, " ");
    if (wanted.some((w) => actual.includes(w) || w.includes(actual))) {
      score += 8;
      reasons.push("Type match");
    }
  }

  if (args.listingStatus === "new_listing") {
    score += 5;
    reasons.push("New listing");
  }

  if (args.listingStatus === "reduced") {
    score += 7;
    reasons.push("Price reduced");
  }

  score = Math.max(0, Math.min(98, Math.round(score)));

  const label =
    score >= 90 ? "Excellent fit" :
    score >= 80 ? "Strong fit" :
    score >= 70 ? "Good fit" :
    score >= 60 ? "Possible fit" :
    "Low fit";

  return {
    score,
    label,
    reasons: Array.from(new Set(reasons)).slice(0, 4),
  };
}

function passesFilters(deal: DealCandidate, request: NextRequest): boolean {
  const params = request.nextUrl.searchParams;

  const minPrice = numberOrNull(params.get("minPrice"));
  const maxPrice = numberOrNull(params.get("maxPrice"));
  const minYield = numberOrNull(params.get("minYield"));
  const minBedrooms = numberOrNull(params.get("minBedrooms"));
  const maxBedrooms = numberOrNull(params.get("maxBedrooms"));

  const propertyTypes = (params.get("propertyTypes") ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  if (minPrice && (!deal.askingPrice || deal.askingPrice < minPrice)) return false;
  if (maxPrice && (!deal.askingPrice || deal.askingPrice > maxPrice)) return false;
  if (minYield && (!deal.grossYield || deal.grossYield < minYield)) return false;
  if (minBedrooms && (!deal.bedrooms || deal.bedrooms < minBedrooms)) return false;
  if (maxBedrooms && maxBedrooms < 6 && deal.bedrooms != null && deal.bedrooms > maxBedrooms) return false;

  if (propertyTypes.length && deal.propertyType) {
    const actual = deal.propertyType.toLowerCase();
    const matched = propertyTypes.some((t) => actual.includes(t.toLowerCase().replace("-", " ")));
    if (!matched) return false;
  }

  return true;
}

async function fetchHomeData(params: Record<string, string>) {
  const apiKey = process.env.HOMEDATA_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      data: null,
      error: "Missing HOMEDATA_API_KEY",
    };
  }

  const url = new URL(HOMEDATA_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
    },
    cache: "no-store",
  });

  let data: any = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data,
      error: typeof data === "object" ? JSON.stringify(data) : "HomeData request failed",
    };
  }

  return {
    ok: true,
    status: response.status,
    data,
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const favAvgNetYield = Number(params.get("favAvgNetYield") ?? 4.5);
  const favAvgValue = Number(params.get("favAvgValue") ?? 250000);
  const favPropertyTypes = (params.get("favPropertyTypes") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const favMinBeds = Number(params.get("favMinBeds") ?? 1);
  const favMaxBeds = Number(params.get("favMaxBeds") ?? 5);

  const cities = (params.get("cities") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const outcodes = (params.get("outcodes") ?? "")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

  const saleResponse = await fetchHomeData({
    page_size: "100",
  });

  if (!saleResponse.ok) {
    console.error("[deal-finder] HomeData sale request failed", saleResponse.status, saleResponse.error);

    return NextResponse.json(
      {
        status: "unavailable",
        deals: [],
        meta: null,
        error: saleResponse.error,
      },
      { status: 200 }
    );
  }

  const rentalResponse = await fetchHomeData({
    page_size: "100",
  });

  const rawListings = Array.isArray(saleResponse.data?.results)
    ? (saleResponse.data.results as HomeDataListing[])
    : [];

  const rentalListings = Array.isArray(rentalResponse.data?.results)
    ? (rentalResponse.data.results as HomeDataListing[]).filter(
        (x) => String(x.transaction_type ?? "").toLowerCase() === "rental"
      )
    : [];

  const selectedCityPrefixes = cities.flatMap((city) => CITY_OUTCODES[city] ?? []);

  const saleListings = rawListings
    .filter((listing) => String(listing.transaction_type ?? "").toLowerCase() === "sale")
    .filter((listing) => !listing.is_withdrawn)
    .filter((listing) => {
      const area = getAreaPrefix(listing.postcode);
      const outcode = getOutcode(listing.postcode);

      if (outcodes.length > 0 && outcodes.includes(outcode)) return true;
      if (selectedCityPrefixes.length > 0 && selectedCityPrefixes.includes(area)) return true;

      // If no area filters were supplied, keep the listing.
      if (outcodes.length === 0 && selectedCityPrefixes.length === 0) return true;

      // If area filters were supplied but no listings match, this filter may reduce results.
      return false;
    });

  const fallbackListings =
    saleListings.length > 0
      ? saleListings
      : rawListings.filter((listing) => String(listing.transaction_type ?? "").toLowerCase() === "sale");

  const deals: DealCandidate[] = fallbackListings
    .map((listing) => {
      const askingPrice = numberOrNull(listing.latest_price);
      const rentEstimateMonthly = estimateRentMonthly(listing, rentalListings);
      const grossYield = calculateGrossYield(askingPrice, rentEstimateMonthly);
      const netYield = calculateNetYield(grossYield);
      const listingStatus = mapStatus(listing);
      const propertyType = titleCase(listing.property_type);
      const bedrooms = numberOrNull(listing.bedrooms);
      const bathrooms = numberOrNull(listing.bathrooms);
      const postcode = normaliseText(listing.postcode);
      const city = inferCity(postcode);

      const fit = scoreDeal({
        askingPrice,
        netYield,
        grossYield,
        bedrooms,
        propertyType,
        listingStatus,
        favAvgNetYield: Number.isFinite(favAvgNetYield) ? favAvgNetYield : 4.5,
        favAvgValue: Number.isFinite(favAvgValue) ? favAvgValue : 250000,
        favPropertyTypes,
        favMinBeds: Number.isFinite(favMinBeds) ? favMinBeds : 1,
        favMaxBeds: Number.isFinite(favMaxBeds) ? favMaxBeds : 5,
      });

      const street = normaliseText(listing.street);
      const displayAddress = [street, postcode].filter(Boolean).join(", ");

      return {
        id: String(listing.id),
        uprn: normaliseText(listing.uprn),
        address: displayAddress || street || postcode || "Address unavailable",
        displayAddress: displayAddress || street || postcode || "Address unavailable",
        city,
        postcode,
        askingPrice,
        previousAskingPrice: numberOrNull(listing.previous_price),
        rentEstimateMonthly,
        grossYield,
        netYield,
        bedrooms,
        bathrooms,
        propertyType,
        tenure: normaliseText(listing.ownership),
        epcRating: null,
        listingStatus,
        listingDate: normaliseText(listing.added_date),
        updatedAt: normaliseText(listing.added_date),
        imageUrl: normaliseText(listing.image_url),
        investmentFitScore: fit.score,
        investmentFitLabel: fit.label,
        investmentReasons: fit.reasons,
      };
    })
    .filter((deal) => passesFilters(deal, request))
    .sort((a, b) => b.investmentFitScore - a.investmentFitScore)
    .slice(0, 30);

  const avg = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const netYields = deals.map((d) => d.netYield).filter((v): v is number => v != null);
  const askingPrices = deals.map((d) => d.askingPrice).filter((v): v is number => v != null);
  const bestDeal = [...deals].sort((a, b) => (b.netYield ?? 0) - (a.netYield ?? 0))[0];

  return NextResponse.json({
    status: "ok",
    deals,
    meta: {
      totalDeals: deals.length,
      avgNetYield: avg(netYields),
      avgAskingPrice: avg(askingPrices),
      bestNetYield: bestDeal?.netYield ?? null,
      bestNetYieldCity: bestDeal?.city ?? bestDeal?.postcode ?? null,
      newListingsCount: deals.filter((d) => d.listingStatus === "new_listing").length,
    },
  });
}
