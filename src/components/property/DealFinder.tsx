'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { MARKET_DATA } from '@/lib/market-data'
import type { DealCandidate } from '@/app/api/deal-finder/route'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'
const ALL_CITY_KEYS = Object.keys(MARKET_DATA.cities)

type DealFinderTab = 'ai' | 'custom' | 'saved'
type SortBy = 'investmentFit' | 'netYield' | 'grossYield' | 'totalROI' | 'askingPrice' | 'newest'
type DrilldownSort = 'investmentFit' | 'netYield' | 'grossYield' | 'totalROI' | 'cashflow' | 'askingPrice' | 'newest'
type TenureFilter = 'any' | 'freehold' | 'leasehold'
type FetchStatus = 'idle' | 'loading' | 'ok' | 'unavailable' | 'error'

const STRATEGY_OPTIONS = [
  'High Yield', 'Capital Growth', 'Balanced ROI', 'Below Market Value',
  'Cashflow Positive', 'BRR / Refurb', 'Low Risk', 'Student / HMO',
]

interface DealFinderMeta {
  totalDeals: number
  avgNetYield: number | null
  avgAskingPrice: number | null
  bestNetYield: number | null
  bestNetYieldCity: string | null
  newListingsCount: number
}

export interface DealFinderProps {
  favouriteItems: Array<Record<string, unknown>>
  favourites: Set<string>
  onToggleFavourite: (property: Record<string, unknown>) => void
  onAddToPortfolio: (data: Record<string, unknown>) => void
  onOpenAnalysis: (data: Record<string, unknown>) => void
  onGoToDiscover: () => void
}

// ── Favourite helpers ─────────────────────────────────────────────────────────

function dealToFavouritePayload(deal: DealCandidate): Record<string, unknown> {
  // toggleFavourite() in page.tsx reads property.uprn as the dedup key
  // Fall back to deal.id so listings without a verified UPRN can still be saved
  const effectiveUprn = deal.uprn ?? deal.id
  return {
    property: {
      uprn: effectiveUprn,
      full_address: deal.displayAddress || deal.address,
      address: deal.address,
      postcode: deal.postcode,
      property_type: deal.propertyType ?? '',
      bedrooms: deal.bedrooms ?? null,
      bathrooms: deal.bathrooms ?? null,
      tenure: deal.tenure ?? null,
      last_sold_price: null,
    },
    enriched: {
      estimatedCurrentValue: deal.estimatedMarketValue ?? deal.askingPrice,
      estimatedRent: deal.rentEstimateMonthly ?? null,
      grossYield: deal.grossYield ?? null,
      netYield: deal.netYield ?? null,
      totalROI: deal.totalROI ?? null,
      attrBedrooms: deal.bedrooms ?? null,
      epcRating: deal.epcRating ?? null,
      valuationMethod: 'listing_asking_price',
    },
    epc: deal.epcRating ? { current_energy_rating: deal.epcRating } : {},
    cityName: deal.city ?? '',
    _liveListingContext: {
      sourceContext: 'homedata_live_listing',
      liveListingAskingPrice: deal.askingPrice,
      liveListingPriceSource: deal.askingPrice > 0 ? 'asking_price' : null,
      imageUrl: deal.imageUrl,
      listingDate: deal.listingDate,
      listingId: deal.id,
      listingStatus: deal.listingStatus,
    },
  }
}

function isDealFavourited(
  deal: DealCandidate,
  favourites: Set<string>,
  favouriteItems: Array<Record<string, unknown>>,
): boolean {
  const effectiveId = deal.uprn ?? deal.id
  if (effectiveId && favourites.has(effectiveId)) return true
  return favouriteItems.some(item => {
    const p = item.property as Record<string, unknown> | null
    if (!p) return false
    if (deal.uprn && p.uprn && String(p.uprn) === deal.uprn) return true
    const storedAddr = String(p.full_address ?? p.address ?? '')
    const dealAddr = deal.displayAddress || deal.address
    return storedAddr.length > 0 && storedAddr === dealAddr && String(p.postcode ?? '') === (deal.postcode ?? '')
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—'
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`
  if (n >= 1_000) return `£${Math.round(n / 1000)}k`
  return `£${n}`
}

function fmtYield(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—'
  return `${n.toFixed(1)}%`
}

function fmtRent(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—'
  return `£${Math.round(n).toLocaleString()}/mo`
}

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const then = new Date(dateStr).getTime()
  if (isNaN(then)) return ''
  const diff = Date.now() - then
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Listed today'
  if (days === 1) return 'Listed yesterday'
  if (days < 7) return `Listed ${days} days ago`
  if (days < 30) return `Listed ${Math.floor(days / 7)}w ago`
  return `Listed ${Math.floor(days / 30)}mo ago`
}

function deriveBenchmarkFromFavourites(items: Array<Record<string, unknown>>) {
  const nets: number[] = []
  const values: number[] = []
  const types: string[] = []
  const beds: number[] = []
  const cities: string[] = []
  const outcodes: string[] = []

  for (const item of items) {
    const e = item.enriched as Record<string, unknown> | null
    const p = item.property as Record<string, unknown> | null
    const netY = Number(e?.netYield ?? 0)
    const val = Number(e?.estimatedCurrentValue ?? p?.last_sold_price ?? 0)
    const type = String(p?.property_type ?? '')
    const b = Number(e?.attrBedrooms ?? p?.bedrooms ?? 0)
    const city = String(item.cityName ?? '')
    const postcode = String(p?.postcode ?? '')
    const outcode = postcode.split(' ')[0] ?? ''

    if (netY > 0) nets.push(netY)
    if (val > 0) values.push(val)
    if (type) types.push(type)
    if (b > 0) beds.push(b)
    if (city) cities.push(city)
    if (outcode) outcodes.push(outcode)
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  const unique = <T,>(arr: T[]): T[] => Array.from(new Set(arr))

  return {
    favAvgNetYield: avg(nets) || 4.5,
    favAvgValue: avg(values) || 250000,
    favPropertyTypes: unique(types).slice(0, 3),
    favMinBeds: beds.length ? Math.max(1, Math.min(...beds) - 1) : 1,
    favMaxBeds: beds.length ? Math.max(...beds) + 1 : 5,
    favCities: unique(cities).slice(0, 4),
    favOutcodes: unique(outcodes).slice(0, 4),
  }
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className} text-[#047857]`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ── Investment Fit Badge ──────────────────────────────────────────────────────

function FitBadge({ score, label }: { score: number; label: string }) {
  const bg =
    score >= 90 ? 'bg-[#047857] text-white' :
    score >= 80 ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' :
    score >= 70 ? 'bg-[#FFF7E6] text-[#B7791F] border border-[#F5D48A]' :
    'bg-[#F3F4F6] text-[#374151]'
  return (
    <span className={`inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-full ${bg}`}>
      {score}% · {label}
    </span>
  )
}

// ── Deal Card image ───────────────────────────────────────────────────────────

function DealImage({ imageUrl, propertyType }: { imageUrl: string | null; propertyType: string | null }) {
  const [errored, setErrored] = useState(false)
  if (imageUrl && !errored) {
    return (
      <img
        src={imageUrl}
        alt={propertyType ?? 'Property'}
        loading="lazy"
        onError={() => setErrored(true)}
        className="w-full h-full object-cover"
      />
    )
  }
  return (
    <div className="w-full h-full bg-gradient-to-br from-[#ECFDF5] to-[#F6F3EC] flex flex-col items-center justify-center gap-2">
      <span className="text-4xl opacity-30">🏠</span>
      <span className="text-[10px] text-[#9CA3AF]">Image unavailable</span>
    </div>
  )
}

// ── Deal Opportunity Badge ────────────────────────────────────────────────────

function OpportunityBadge({ deal }: { deal: DealCandidate }) {
  const badges: { label: string; color: string }[] = []

  if (deal.investmentFitScore >= 90) badges.push({ label: 'Top Deal', color: 'bg-[#047857] text-white' })
  else if (deal.netYield != null && deal.netYield >= 7) badges.push({ label: 'High Yield', color: 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' })

  if (deal.listingStatus === 'reduced') badges.push({ label: 'Price Reduced', color: 'bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]' })
  else if (deal.listingStatus === 'new_listing') badges.push({ label: 'New Listing', color: 'bg-[#F3F4F6] text-[#374151] border border-[#E7E5DD]' })

  if (!badges.length && deal.investmentReasons.includes('Cross-city opportunity')) {
    badges.push({ label: 'Cross-City', color: 'bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]' })
  }
  if (!badges.length && deal.investmentReasons.includes('Below market entry price')) {
    badges.push({ label: 'Below Market', color: 'bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]' })
  }

  if (badges.length === 0) return null
  const badge = badges[0]
  return (
    <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.color}`}>
      {badge.label}
    </span>
  )
}

// ── Deal Card ─────────────────────────────────────────────────────────────────

function DealCard({
  deal,
  isFav,
  isOpening,
  openError,
  onToggleFav,
  onOpen,
}: {
  deal: DealCandidate
  isFav: boolean
  isOpening: boolean
  openError: string | null
  onToggleFav: () => void
  onOpen: () => void
}) {
  const epcColor =
    !deal.epcRating ? 'text-[#9CA3AF]' :
    deal.epcRating <= 'C' ? 'text-[#047857]' :
    deal.epcRating <= 'D' ? 'text-[#B7791F]' : 'text-[#DC2626]'

  const dateLabel = deal.listingStatus === 'reduced' && deal.updatedAt
    ? `Reduced ${relativeDate(deal.updatedAt).replace('Listed ', '')}`
    : relativeDate(deal.listingDate)

  // Monthly cashflow estimate from net yield
  const monthlyCashflow = deal.netYield != null && deal.askingPrice > 0
    ? Math.round((deal.netYield / 100 * deal.askingPrice) / 12)
    : null

  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] flex flex-col overflow-hidden hover:border-[#A7F3D0] transition-all">
      {/* Image */}
      <div className="relative h-[180px] overflow-hidden">
        <DealImage imageUrl={deal.imageUrl} propertyType={deal.propertyType} />
        <div className="absolute top-3 left-3 flex gap-1.5">
          <OpportunityBadge deal={deal} />
        </div>
        <div className="absolute top-3 right-10">
          <FitBadge score={deal.investmentFitScore} label={deal.investmentFitLabel} />
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggleFav() }}
          aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
          className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center rounded-lg bg-white/90 hover:bg-white border border-[#E7E5DD] text-base transition-colors">
          <span className={isFav ? 'text-[#B7791F]' : 'text-[#D1D5DB]'}>{isFav ? '★' : '☆'}</span>
        </button>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1">
        {/* Price + address */}
        <div className="mb-3">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <p className="text-xl font-bold text-[#111827]" style={{ fontFamily: SERIF }}>
              {fmtPrice(deal.askingPrice)}
            </p>
            {deal.previousAskingPrice && deal.previousAskingPrice !== deal.askingPrice && (
              <span className="text-xs text-[#9CA3AF] line-through mt-1">{fmtPrice(deal.previousAskingPrice)}</span>
            )}
          </div>
          <p className="text-[10px] text-[#6B7280] mb-1.5 uppercase tracking-[0.05em] font-semibold">Asking Price</p>
          <p className="text-sm font-semibold text-[#111827] leading-snug mb-0.5" style={{ fontFamily: SERIF }}>
            {deal.displayAddress || deal.address}
          </p>
          <p className="text-xs text-[#6B7280]">
            {[deal.city, deal.postcode].filter(Boolean).join(' · ')}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {deal.propertyType && (
              <span className="text-[11px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{deal.propertyType}</span>
            )}
            {deal.bedrooms != null && (
              <span className="text-[11px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{deal.bedrooms} bed</span>
            )}
            {deal.bathrooms != null && (
              <span className="text-[11px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{deal.bathrooms} bath</span>
            )}
            {deal.tenure && (
              <span className="text-[11px] bg-[#F6F3EC] text-[#6B7280] px-2 py-0.5 rounded-full capitalize">{deal.tenure}</span>
            )}
          </div>
        </div>

        {/* KPI grid — 2×2 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[
            { label: 'Gross Yield', value: fmtYield(deal.grossYield),      hi: deal.grossYield != null && deal.grossYield >= 6 },
            { label: 'Net Yield',   value: fmtYield(deal.netYield),        hi: deal.netYield != null && deal.netYield >= 5 },
            { label: 'Total ROI',   value: deal.totalROI != null ? `${deal.totalROI > 0 ? '+' : ''}${deal.totalROI.toFixed(1)}%` : '—', hi: deal.totalROI != null && deal.totalROI >= 7 },
            { label: 'Est. Rent',   value: fmtRent(deal.rentEstimateMonthly), hi: false },
          ].map(kpi => (
            <div key={kpi.label} className="bg-[#FAF9F5] border border-[#F3F4F6] rounded-xl p-2.5 text-center">
              <p className="text-[9px] uppercase tracking-[0.06em] text-[#9CA3AF] mb-0.5">{kpi.label}</p>
              <p className={`font-bold text-sm ${kpi.hi ? 'text-[#047857]' : 'text-[#111827]'}`} style={{ fontFamily: SERIF }}>
                {kpi.value}
              </p>
            </div>
          ))}
        </div>

        {/* Monthly cashflow + EPC strip */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {monthlyCashflow != null && monthlyCashflow !== 0 && (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
              monthlyCashflow > 0
                ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
                : 'bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5]'
            }`}>
              {monthlyCashflow > 0 ? '+' : ''}£{Math.abs(monthlyCashflow).toLocaleString()}/mo
            </span>
          )}
          {deal.epcRating && (
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${epcColor} ${
              deal.epcRating <= 'C' ? 'bg-[#ECFDF5] border-[#A7F3D0]' :
              deal.epcRating <= 'D' ? 'bg-[#FFF7E6] border-[#F5D48A]' : 'bg-[#FEF2F2] border-[#FCA5A5]'
            }`}>
              EPC {deal.epcRating}
            </span>
          )}
        </div>

        {/* Investment reasons */}
        {deal.investmentReasons.length > 0 && (
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {deal.investmentReasons.map(r => (
              <span key={r} className="text-[10px] font-semibold bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] px-2 py-0.5 rounded-full">
                {r}
              </span>
            ))}
          </div>
        )}

        {/* Listing date */}
        {dateLabel && (
          <p className="text-[11px] text-[#9CA3AF] mb-3">{dateLabel}</p>
        )}

        {openError && (
          <p className="text-[11px] text-[#DC2626] mb-2 leading-snug">{openError}</p>
        )}

        <button
          type="button"
          onClick={onOpen}
          disabled={isOpening}
          className="mt-auto w-full bg-[#047857] text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-[#065F46] transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {isOpening ? <><Spinner /> Loading analysis…</> : 'View Analysis →'}
        </button>
        {deal.agentName && (
          <p className="text-[10px] text-[#9CA3AF] mt-1 text-center">Listed by {deal.agentName}</p>
        )}
      </div>
    </div>
  )
}

// ── DrillDown Card (full-width horizontal row) ────────────────────────────────

function DrillDownCard({
  deal,
  isFav,
  isOpening,
  openError,
  onToggleFav,
  onOpen,
}: {
  deal: DealCandidate
  isFav: boolean
  isOpening: boolean
  openError: string | null
  onToggleFav: () => void
  onOpen: () => void
}) {
  const epcColor =
    !deal.epcRating ? 'text-[#9CA3AF]' :
    deal.epcRating <= 'C' ? 'text-[#047857]' :
    deal.epcRating <= 'D' ? 'text-[#B7791F]' : 'text-[#DC2626]'

  const fitBg =
    deal.investmentFitScore >= 90 ? 'bg-[#047857] text-white' :
    deal.investmentFitScore >= 80 ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' :
    deal.investmentFitScore >= 70 ? 'bg-[#FFF7E6] text-[#B7791F] border border-[#F5D48A]' :
    'bg-[#F3F4F6] text-[#6B7280]'

  const dateLabel = deal.listingStatus === 'reduced' && deal.updatedAt
    ? `Reduced ${relativeDate(deal.updatedAt).replace('Listed ', '')}`
    : relativeDate(deal.listingDate)

  const monthlyCashflow = deal.netYield != null && deal.askingPrice > 0
    ? Math.round((deal.netYield / 100 * deal.askingPrice) / 12)
    : null

  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_4px_16px_rgba(17,24,39,0.04)] hover:border-[#A7F3D0] hover:shadow-[0_8px_24px_rgba(4,120,87,0.08)] transition-all overflow-hidden flex flex-row items-stretch">

      {/* Image — 140px fixed width */}
      <div className="w-[140px] shrink-0 relative overflow-hidden">
        <DealImage imageUrl={deal.imageUrl} propertyType={deal.propertyType} />
        <div className="absolute top-2 left-2">
          <OpportunityBadge deal={deal} />
        </div>
      </div>

      {/* Info section */}
      <div className="flex-1 min-w-0 px-4 py-4 border-r border-[#F3F4F6] flex flex-col justify-between">
        <div>
          <p className="font-semibold text-[#111827] text-[13px] leading-snug mb-1 truncate" style={{ fontFamily: SERIF }}>
            {deal.displayAddress || deal.address}
          </p>
          <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
            {deal.postcode && (
              <span className="text-[10px] font-semibold bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] px-1.5 py-0.5 rounded-full shrink-0">
                {deal.postcode}
              </span>
            )}
            {deal.city && <span className="text-[11px] text-[#6B7280] truncate">{deal.city}</span>}
            {dateLabel && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                deal.listingStatus === 'new_listing' ? 'bg-[#ECFDF5] text-[#047857]' :
                deal.listingStatus === 'reduced' ? 'bg-[#EFF6FF] text-[#1D4ED8]' :
                'bg-[#F6F3EC] text-[#9CA3AF]'
              }`}>
                {dateLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {deal.propertyType && (
              <span className="text-[10px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{deal.propertyType}</span>
            )}
            {deal.bedrooms != null && (
              <span className="text-[10px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{deal.bedrooms} bed</span>
            )}
            {deal.bathrooms != null && (
              <span className="text-[10px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{deal.bathrooms} bath</span>
            )}
            {deal.tenure && (
              <span className="text-[10px] bg-[#F6F3EC] text-[#6B7280] px-2 py-0.5 rounded-full capitalize">{deal.tenure}</span>
            )}
            {deal.epcRating && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F6F3EC] ${epcColor}`}>
                EPC {deal.epcRating}
              </span>
            )}
          </div>
        </div>
        {deal.investmentReasons.length > 0 && (
          <p className="text-[10px] text-[#6B7280] mt-2 line-clamp-1">{deal.investmentReasons[0]}</p>
        )}
      </div>

      {/* Financial metrics — 6 columns */}
      <div className="hidden sm:flex divide-x divide-[#F3F4F6] shrink-0">
        {/* Asking Price */}
        <div className="flex flex-col items-center justify-center py-4 px-3 text-center min-w-[100px]">
          <p className="text-[9px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">Asking Price</p>
          <p className="text-sm font-bold text-[#111827] leading-none" style={{ fontFamily: SERIF }}>
            {fmtPrice(deal.askingPrice)}
          </p>
          {deal.previousAskingPrice && deal.previousAskingPrice !== deal.askingPrice && (
            <p className="text-[9px] text-[#9CA3AF] line-through mt-0.5">{fmtPrice(deal.previousAskingPrice)}</p>
          )}
          {deal.estimatedMarketValue && deal.estimatedMarketValue > 0 && (
            <p className="text-[9px] text-[#9CA3AF] mt-0.5">MV {fmtPrice(deal.estimatedMarketValue)}</p>
          )}
        </div>
        {/* Net Yield */}
        <div className="flex flex-col items-center justify-center py-4 px-3 text-center min-w-[80px]">
          <p className="text-[9px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">Net Yield</p>
          <p className={`text-sm font-bold leading-none ${(deal.netYield ?? 0) >= 6 ? 'text-[#047857]' : 'text-[#111827]'}`}
            style={{ fontFamily: SERIF }}>
            {fmtYield(deal.netYield)}
          </p>
        </div>
        {/* Gross Yield */}
        <div className="flex flex-col items-center justify-center py-4 px-3 text-center min-w-[80px]">
          <p className="text-[9px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">Gross Yield</p>
          <p className="text-sm font-bold text-[#111827] leading-none" style={{ fontFamily: SERIF }}>
            {fmtYield(deal.grossYield)}
          </p>
        </div>
        {/* Total ROI */}
        <div className="flex flex-col items-center justify-center py-4 px-3 text-center min-w-[80px]">
          <p className="text-[9px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">Total ROI</p>
          <p className={`text-sm font-bold leading-none ${(deal.totalROI ?? 0) >= 7 ? 'text-[#047857]' : 'text-[#111827]'}`}
            style={{ fontFamily: SERIF }}>
            {deal.totalROI != null ? `${deal.totalROI > 0 ? '+' : ''}${deal.totalROI.toFixed(1)}%` : '—'}
          </p>
        </div>
        {/* Monthly Cashflow */}
        <div className="flex flex-col items-center justify-center py-4 px-3 text-center min-w-[90px]">
          <p className="text-[9px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">Cashflow</p>
          <p className={`text-sm font-bold leading-none ${monthlyCashflow != null && monthlyCashflow > 0 ? 'text-[#047857]' : monthlyCashflow != null && monthlyCashflow < 0 ? 'text-[#DC2626]' : 'text-[#111827]'}`}
            style={{ fontFamily: SERIF }}>
            {monthlyCashflow != null ? `${monthlyCashflow > 0 ? '+' : ''}£${Math.abs(monthlyCashflow).toLocaleString()}/mo` : '—'}
          </p>
        </div>
        {/* Est. Rent */}
        <div className="flex flex-col items-center justify-center py-4 px-3 text-center min-w-[90px]">
          <p className="text-[9px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">Est. Rent</p>
          <p className="text-sm font-bold text-[#111827] leading-none" style={{ fontFamily: SERIF }}>
            {fmtRent(deal.rentEstimateMonthly)}
          </p>
        </div>
      </div>

      {/* Fit score + CTA */}
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-4 shrink-0 min-w-[140px] border-l border-[#F3F4F6]">
        <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${fitBg}`}>
          {deal.investmentFitScore}% · {deal.investmentFitLabel}
        </span>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggleFav() }}
          aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
          className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-colors text-base ${
            isFav
              ? 'bg-[#FFF7E6] border-[#F5D48A] text-[#B7791F]'
              : 'bg-[#FAF9F5] border-[#E7E5DD] hover:bg-white text-[#D1D5DB]'
          }`}>
          <span>{isFav ? '★' : '☆'}</span>
        </button>
        {openError && (
          <p className="text-[10px] text-[#DC2626] text-center leading-snug">{openError}</p>
        )}
        <button
          type="button"
          onClick={onOpen}
          disabled={isOpening}
          className="w-full bg-[#047857] text-white text-xs font-semibold px-3 py-2 rounded-xl hover:bg-[#065F46] transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
          {isOpening ? <><Spinner className="w-3 h-3" />Loading…</> : 'View Deal →'}
        </button>
      </div>

    </div>
  )
}

// ── KPI Row ───────────────────────────────────────────────────────────────────

function KpiRow({ meta, onTopDealsClick, onNewListingsClick, activeFilter }: {
  meta: DealFinderMeta | null
  onTopDealsClick: () => void
  onNewListingsClick: () => void
  activeFilter: 'topDeals' | 'newListings' | null
}) {
  const staticKpis = [
    { label: 'Avg. Net Yield', value: meta?.avgNetYield != null ? `${meta.avgNetYield.toFixed(1)}%` : '—', sub: 'Across returned deals' },
    { label: 'Avg. Entry',     value: meta?.avgAskingPrice != null ? fmtPrice(meta.avgAskingPrice) : '—', sub: 'Mean asking price' },
    { label: 'Best Net Yield', value: meta?.bestNetYield != null ? `${meta.bestNetYield.toFixed(1)}%` : '—', sub: meta?.bestNetYieldCity ?? '' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">

      {/* Top Deals — clickable */}
      <button
        type="button"
        onClick={onTopDealsClick}
        aria-label="View top deal properties"
        className={`bg-white border rounded-2xl p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)] cursor-pointer hover:border-[#A7F3D0] hover:shadow-md transition-all relative text-left w-full ${
          activeFilter === 'topDeals' ? 'border-[#A7F3D0] bg-[#ECFDF5]' : 'border-[#E7E5DD]'
        }`}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">Top Deals</p>
        <p className="font-bold text-2xl text-[#111827] leading-none mb-1" style={{ fontFamily: SERIF }}>
          {meta?.totalDeals != null ? String(meta.totalDeals) : '—'}
        </p>
        <p className="text-[11px] text-[#9CA3AF]">Active live listings</p>
        <span className="absolute bottom-3 right-3 text-[10px] text-[#9CA3AF]">↓</span>
      </button>

      {/* Static KPIs */}
      {staticKpis.map(k => (
        <div key={k.label} className="bg-white border border-[#E7E5DD] rounded-2xl p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">{k.label}</p>
          <p className="font-bold text-2xl text-[#111827] leading-none mb-1" style={{ fontFamily: SERIF }}>{k.value}</p>
          {k.sub && <p className="text-[11px] text-[#9CA3AF]">{k.sub}</p>}
        </div>
      ))}

      {/* New Listings — clickable */}
      <button
        type="button"
        onClick={onNewListingsClick}
        aria-label="View newly listed properties"
        className={`bg-white border rounded-2xl p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)] cursor-pointer hover:border-[#A7F3D0] hover:shadow-md transition-all relative text-left w-full ${
          activeFilter === 'newListings' ? 'border-[#A7F3D0] bg-[#ECFDF5]' : 'border-[#E7E5DD]'
        }`}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">New Listings</p>
        <p className="font-bold text-2xl text-[#111827] leading-none mb-1" style={{ fontFamily: SERIF }}>
          {meta?.newListingsCount != null ? String(meta.newListingsCount) : '—'}
        </p>
        <p className="text-[11px] text-[#9CA3AF]">This month</p>
        <span className="absolute bottom-3 right-3 text-[10px] text-[#9CA3AF]">↓</span>
      </button>

    </div>
  )
}

// ── Empty / status states ─────────────────────────────────────────────────────

function UnavailableState({ onDiscover }: { onDiscover: () => void }) {
  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <p className="text-4xl mb-4">🔌</p>
      <p className="font-semibold text-[#374151] mb-2" style={{ fontFamily: SERIF }}>Live listing data is not enabled</p>
      <p className="text-sm text-[#6B7280] max-w-[420px] mx-auto mb-6 leading-relaxed">
        Connect Homedata live listings to activate Deal Finder. Once enabled, this page will surface real active for-sale opportunities ranked by Investment Fit.
      </p>
      <button type="button" onClick={onDiscover}
        className="bg-[#047857] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#065F46] transition-colors">
        Go to Discover →
      </button>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <p className="text-4xl mb-4">⚠️</p>
      <p className="font-semibold text-[#374151] mb-2" style={{ fontFamily: SERIF }}>Unable to load live listings</p>
      <p className="text-sm text-[#6B7280] max-w-[420px] mx-auto mb-6 leading-relaxed">
        Please try again. If the issue continues, check the live listing data connection.
      </p>
      <button type="button" onClick={onRetry}
        className="bg-[#047857] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#065F46] transition-colors">
        Try again →
      </button>
    </div>
  )
}

function NoFavouritesState({ onDiscover }: { onDiscover: () => void }) {
  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <p className="text-4xl mb-4">☆</p>
      <p className="font-semibold text-[#374151] mb-2 text-lg" style={{ fontFamily: SERIF }}>
        Favourite properties to unlock Deal Finder
      </p>
      <p className="text-sm text-[#6B7280] max-w-[420px] mx-auto mb-6 leading-relaxed">
        Save properties you like and Portfolai will learn your investment profile, then surface live deals that match your return, value and risk appetite.
      </p>
      <button type="button" onClick={onDiscover}
        className="bg-[#047857] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#065F46] transition-colors">
        Go to Discover
      </button>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <Spinner className="w-8 h-8 mx-auto mb-4" />
      <p className="text-sm font-semibold text-[#374151] mb-1">Scanning live listings…</p>
      <p className="text-xs text-[#9CA3AF]">Ranking opportunities by Investment Fit</p>
    </div>
  )
}

function NoDealsState({ onReset }: { onReset?: () => void }) {
  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <p className="text-4xl mb-3">🔍</p>
      <p className="font-semibold text-[#374151] mb-2">No matching live listings found</p>
      <p className="text-sm text-[#6B7280] max-w-[420px] mx-auto mb-4">
        Try widening your search radius, increasing your budget, or lowering your minimum yield target.
      </p>
      {onReset && (
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={onReset}
            className="text-sm font-semibold text-[#047857] border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-2 rounded-xl hover:bg-[#D1FAE5] transition-colors">
            Clear filters
          </button>
        </div>
      )}
    </div>
  )
}

// ── Sort dropdown ─────────────────────────────────────────────────────────────

function SortControl({ sortBy, onChange }: { sortBy: SortBy; onChange: (v: SortBy) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-[#6B7280]">Sort:</label>
      <select value={sortBy} onChange={e => onChange(e.target.value as SortBy)}
        className="bg-white border border-[#E7E5DD] text-xs font-medium text-[#374151] rounded-xl px-3 py-1.5 outline-none focus:border-[#047857] cursor-pointer">
        <option value="investmentFit">Investment Fit</option>
        <option value="netYield">Highest net yield</option>
        <option value="grossYield">Highest gross yield</option>
        <option value="totalROI">Highest total ROI</option>
        <option value="askingPrice">Lowest price</option>
        <option value="newest">Newest first</option>
      </select>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function DealFinder({
  favouriteItems,
  favourites,
  onToggleFavourite,
  onGoToDiscover,
  onOpenAnalysis,
}: DealFinderProps) {
  const [finderTab, setFinderTab] = useState<DealFinderTab>('ai')
  const [sortBy, setSortBy] = useState<SortBy>('investmentFit')

  // AI tab
  const [aiDeals, setAiDeals] = useState<DealCandidate[]>([])
  const [aiStatus, setAiStatus] = useState<FetchStatus>('idle')
  const [aiMeta, setAiMeta] = useState<DealFinderMeta | null>(null)
  const aiFetchedRef = useRef(false)

  // Custom tab filters
  const [selectedCustomCities, setSelectedCustomCities] = useState<string[]>([])
  const [customMinPrice, setCustomMinPrice] = useState(0)
  const [customMaxPrice, setCustomMaxPrice] = useState(0)
  const [customMinYield, setCustomMinYield] = useState(0)
  const [customMinNetYield, setCustomMinNetYield] = useState(0)
  const [customMinROI, setCustomMinROI] = useState(0)
  const [customPropertyTypes, setCustomPropertyTypes] = useState<string[]>([])
  const [customMinBeds, setCustomMinBeds] = useState(0)
  const [customMaxBeds, setCustomMaxBeds] = useState(6)
  const [customTenure, setCustomTenure] = useState<TenureFilter>('any')
  const [customStrategies, setCustomStrategies] = useState<string[]>([])

  // Custom tab results
  const [customDeals, setCustomDeals] = useState<DealCandidate[]>([])
  const [customStatus, setCustomStatus] = useState<FetchStatus>('idle')
  const [customMeta, setCustomMeta] = useState<DealFinderMeta | null>(null)

  // Opening state
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({})
  const [localFavs, setLocalFavs] = useState<Set<string>>(new Set())
  const [kpiFilter, setKpiFilter] = useState<'topDeals' | 'newListings' | null>(null)
  const [drillDownSortBy, setDrillDownSortBy] = useState<DrilldownSort>('investmentFit')
  const drillDownRef = useRef<HTMLDivElement>(null)

  // ── Derived favourite profile ─────────────────────────────────────────────
  const profile = useMemo(() => deriveBenchmarkFromFavourites(favouriteItems), [favouriteItems])
  const hasFavourites = favouriteItems.length > 0

  // ── AI tab: fetch once when tab is opened with favourites ─────────────────
  const fetchAiDeals = useCallback(() => {
    if (!hasFavourites) { setAiDeals([]); setAiStatus('idle'); setAiMeta(null); return }

    setAiStatus('loading')
    const params = new URLSearchParams({
      mode: 'ai',
      outcodes: profile.favOutcodes.join(','),
      cities: profile.favCities.join(','),
      favAvgNetYield: String(profile.favAvgNetYield),
      favAvgValue: String(profile.favAvgValue),
      favPropertyTypes: profile.favPropertyTypes.join(','),
      favMinBeds: String(profile.favMinBeds),
      favMaxBeds: String(profile.favMaxBeds),
      favCities: profile.favCities.join(','),
    })

    fetch(`/api/deal-finder?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'unavailable') {
          setAiStatus('unavailable')
        } else {
          setAiDeals((data.deals ?? []) as DealCandidate[])
          setAiMeta(data.meta ?? null)
          setAiStatus('ok')
        }
      })
      .catch(() => setAiStatus('unavailable'))
  }, [hasFavourites, profile])

  // Trigger AI fetch when tab is first shown
  const handleTabChange = useCallback((t: DealFinderTab) => {
    setFinderTab(t)
    if (t === 'ai' && !aiFetchedRef.current && hasFavourites) {
      aiFetchedRef.current = true
      fetchAiDeals()
    }
  }, [fetchAiDeals, hasFavourites])

  // Auto-fetch AI on mount if on AI tab and has favourites
  const aiInitRef = useRef(false)
  if (!aiInitRef.current && finderTab === 'ai' && hasFavourites && aiStatus === 'idle') {
    aiInitRef.current = true
    // schedule via microtask to avoid render-phase side effect
  }

  // ── Custom search: button-triggered ──────────────────────────────────────
  const runCustomSearch = useCallback(() => {
    if (!selectedCustomCities.length) { setCustomDeals([]); setCustomStatus('idle'); return }

    setCustomStatus('loading')
    const params = new URLSearchParams({
      mode: 'custom',
      cities: selectedCustomCities.join(','),
      favAvgNetYield: String(profile.favAvgNetYield),
      favAvgValue: String(profile.favAvgValue),
      favPropertyTypes: profile.favPropertyTypes.join(','),
      favMinBeds: String(profile.favMinBeds),
      favMaxBeds: String(profile.favMaxBeds),
      favCities: profile.favCities.join(','),
    })
    if (customMinPrice > 0)        params.set('minPrice',      String(customMinPrice))
    if (customMaxPrice > 0)        params.set('maxPrice',      String(customMaxPrice))
    if (customMinYield > 0)        params.set('minYield',      String(customMinYield))
    if (customMinNetYield > 0)     params.set('minNetYield',   String(customMinNetYield))
    if (customPropertyTypes.length) params.set('propertyTypes', customPropertyTypes.join(','))
    if (customMinBeds > 0)         params.set('minBedrooms',   String(customMinBeds))
    if (customMaxBeds < 6)         params.set('maxBedrooms',   String(customMaxBeds))
    if (customTenure !== 'any')    params.set('tenure',        customTenure)

    fetch(`/api/deal-finder?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'unavailable') {
          setCustomStatus('unavailable')
        } else {
          let deals = (data.deals ?? []) as DealCandidate[]
          // Client-side filter by min ROI if set
          if (customMinROI > 0) {
            deals = deals.filter(d => d.totalROI != null && d.totalROI >= customMinROI)
          }
          setCustomDeals(deals)
          setCustomMeta(data.meta ?? null)
          setCustomStatus('ok')
        }
      })
      .catch((err: unknown) => {
        // Treat network failures the same as unavailable; only show error for unexpected exceptions
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('JSON')) {
          setCustomStatus('unavailable')
        } else {
          setCustomStatus('error')
        }
      })
  }, [
    selectedCustomCities, customMinPrice, customMaxPrice, customMinYield, customMinNetYield,
    customPropertyTypes, customMinBeds, customMaxBeds, customTenure, customMinROI, profile,
  ])

  const resetCustomFilters = useCallback(() => {
    setSelectedCustomCities([])
    setCustomMinPrice(0); setCustomMaxPrice(0)
    setCustomMinYield(0); setCustomMinNetYield(0); setCustomMinROI(0)
    setCustomPropertyTypes([])
    setCustomMinBeds(0); setCustomMaxBeds(6)
    setCustomTenure('any')
    setCustomStrategies([])
    setCustomDeals([]); setCustomStatus('idle'); setCustomMeta(null)
  }, [])

  // ── Open canonical Property Analysis ─────────────────────────────────────
  const openVerifiedAnalysis = useCallback(async (deal: DealCandidate) => {
    setOpeningId(deal.id)
    setOpenErrors(prev => { const n = { ...prev }; delete n[deal.id]; return n })

    try {
      let uprn = deal.uprn
      let resolvedViaSearch = false

      // Step 1 — if no UPRN, attempt to resolve via address search
      if (!uprn && (deal.displayAddress || deal.postcode)) {
        try {
          const searchQuery = [deal.displayAddress, deal.postcode].filter(Boolean).join(' ')
          const searchRes = await fetch(`/api/property?q=${encodeURIComponent(searchQuery)}`)
          if (searchRes.ok) {
            const searchData = await searchRes.json()
            const suggestions = (searchData.suggestions || []) as Array<Record<string, unknown>>
            if (suggestions.length === 1) {
              // Single result — use silently
              uprn = String(suggestions[0].uprn)
              resolvedViaSearch = true
            } else if (suggestions.length >= 2 && suggestions.length <= 3) {
              // 2–3 results — use first silently, notice will explain
              uprn = String(suggestions[0].uprn)
              resolvedViaSearch = true
            } else if (suggestions.length >= 4) {
              // 4+ results — use first result immediately so analysis loads,
              // but pass the full list so PropertyDetail can show the picker
              uprn = String(suggestions[0].uprn)
              resolvedViaSearch = true
              ;(window as unknown as Record<string, unknown>)._pendingUprnSuggestions = suggestions
              ;(window as unknown as Record<string, unknown>)._pendingDeal = deal
            }
          }
        } catch {
          // Search failed — continue to partial analysis below
        }
      }

      // Step 2 — if UPRN found (directly or via search), fetch full analysis
      if (uprn) {
        const res = await fetch(`/api/property?uprn=${encodeURIComponent(uprn)}`)
        if (!res.ok) throw new Error(`Property fetch failed: ${res.status}`)
        const data = await res.json()

        // Override estimated value with listing asking price
        if (deal.askingPrice && deal.askingPrice > 0 && data?.enriched) {
          (data.enriched as Record<string, unknown>).estimatedCurrentValue = deal.askingPrice
          ;(data.enriched as Record<string, unknown>).valuationMethod = 'listing_asking_price'
        }
        // Override property attributes with live listing data where available
        if (data?.property) {
          const prop = data.property as Record<string, unknown>
          if (deal.bedrooms != null) prop.bedrooms = deal.bedrooms
          if (deal.bathrooms != null) prop.bathrooms = deal.bathrooms
          if (deal.propertyType) prop.property_type = deal.propertyType
          if (deal.tenure) prop.tenure = deal.tenure
          if (deal.epcRating && data.epc) {
            (data.epc as Record<string, unknown>).current_energy_rating = deal.epcRating
          }
        }

        const enrichedData: Record<string, unknown> = {
          ...data,
          _liveListingContext: {
            sourceContext: 'homedata_live_listing',
            liveListingAskingPrice: deal.askingPrice,
            liveListingPriceSource: deal.askingPrice > 0 ? 'asking_price' : null,
            imageUrl: deal.imageUrl,
            listingDate: deal.listingDate,
            listingId: deal.id,
            listingStatus: deal.listingStatus,
            agentName: deal.agentName ?? null,
          },
        }
        if (resolvedViaSearch) {
          enrichedData._uprn_notice = `Property data sourced from nearest match on ${deal.displayAddress || deal.postcode}. Transaction history may relate to an adjacent property. Investment metrics are based on local market data and remain accurate.`
        }
        // Attach suggestions for picker if 4+ results were found
        const pending = (window as unknown as Record<string, unknown>)._pendingUprnSuggestions
        const pendingDeal = (window as unknown as Record<string, unknown>)._pendingDeal
        if (pending && pendingDeal === deal) {
          enrichedData._uprn_suggestions = pending
          enrichedData._uprn_notice = `Multiple properties found on ${deal.displayAddress || deal.postcode}. Showing the closest match — select below to refine.`
          delete (window as unknown as Record<string, unknown>)._pendingUprnSuggestions
          delete (window as unknown as Record<string, unknown>)._pendingDeal
        }
        onOpenAnalysis(enrichedData)
        return
      }

      // Step 3 — no UPRN found, build partial analysis from listing data
      const cityKey = deal.city as keyof typeof MARKET_DATA.cities
      const cityData = MARKET_DATA.cities[cityKey] || MARKET_DATA.cities.London
      const partialData: Record<string, unknown> = {
        uprn: null,
        _partial: true,
        _uprn_notice: `Full property data unavailable for this listing. Investment metrics shown are calculated from the listing details and local market data.`,
        property: {
          full_address: deal.displayAddress || deal.address,
          address: deal.address || deal.displayAddress,
          postcode: deal.postcode,
          property_type: deal.propertyType || '',
          bedrooms: deal.bedrooms,
          bathrooms: deal.bathrooms,
          tenure: deal.tenure || '',
          last_sold_price: null,
          last_sold_date: null,
        },
        epc: deal.epcRating ? { current_energy_rating: deal.epcRating } : null,
        transactions: [],
        risks: [],
        cityData,
        cityName: deal.city,
        enriched: {
          estimatedRent: deal.rentEstimateMonthly,
          estimatedCurrentValue: deal.askingPrice,
          valuationMethod: 'listing_asking_price',
          valuationConfidence: null,
          grossYield: deal.grossYield,
          netYield: deal.netYield,
          netMonthly: deal.rentEstimateMonthly
            ? Math.round(deal.rentEstimateMonthly * 0.8 - (deal.askingPrice * 0.015 / 12))
            : null,
          capitalGrowth: cityData.capitalGrowth1yr,
          totalROI: deal.netYield
            ? parseFloat((deal.netYield + cityData.capitalGrowth1yr).toFixed(1))
            : null,
          floodRisk: 'Unknown',
          epcRating: deal.epcRating || 'Unknown',
          defaults: {
            serviceCharge: 0,
            groundRent: 0,
            managementFee: 10,
            maintenanceAllowance: 1.5,
            voidWeeks: 2,
          },
        },
        _liveListingContext: {
          sourceContext: 'homedata_live_listing',
          liveListingAskingPrice: deal.askingPrice,
          liveListingPriceSource: deal.askingPrice > 0 ? 'asking_price' : null,
          imageUrl: deal.imageUrl,
          listingDate: deal.listingDate,
          listingId: deal.id,
          listingStatus: deal.listingStatus,
          agentName: deal.agentName ?? null,
        },
      }
      onOpenAnalysis(partialData)

    } catch (e) {
      console.error('[deal-finder] open analysis failed', e)
      setOpenErrors(prev => ({ ...prev, [deal.id]: 'Unable to load property data. Please try again.' }))
    } finally {
      setOpeningId(null)
    }
  }, [onOpenAnalysis])

  const toggleLocalFav = useCallback((id: string) => {
    setLocalFavs(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }, [])

  // ── Sort deals ────────────────────────────────────────────────────────────
  const sortDeals = useCallback((deals: DealCandidate[], by: SortBy) => {
    const copy = [...deals]
    switch (by) {
      case 'netYield':   return copy.sort((a, b) => (b.netYield ?? 0) - (a.netYield ?? 0))
      case 'grossYield': return copy.sort((a, b) => (b.grossYield ?? 0) - (a.grossYield ?? 0))
      case 'totalROI':   return copy.sort((a, b) => (b.totalROI ?? 0) - (a.totalROI ?? 0))
      case 'askingPrice': return copy.sort((a, b) => (a.askingPrice ?? Infinity) - (b.askingPrice ?? Infinity))
      case 'newest':     return copy.sort((a, b) => (b.listingDate ?? '').localeCompare(a.listingDate ?? ''))
      default:           return copy.sort((a, b) => b.investmentFitScore - a.investmentFitScore)
    }
  }, [])

  const activeDeals  = finderTab === 'ai' ? aiDeals : customDeals
  const activeStatus = finderTab === 'ai' ? aiStatus : customStatus
  const activeMeta   = finderTab === 'ai' ? aiMeta : customMeta

  const sortedDeals = useMemo(() => sortDeals(activeDeals, sortBy), [activeDeals, sortBy, sortDeals])

  // ── Strategy summary chips ────────────────────────────────────────────────
  const strategyChips = useMemo(() => {
    const chips: string[] = []
    if (profile.favAvgNetYield > 0) chips.push(`Target ≥${profile.favAvgNetYield.toFixed(1)}% net yield`)
    if (profile.favAvgValue > 0) chips.push(`Entry ~${fmtPrice(profile.favAvgValue)}`)
    if (profile.favPropertyTypes.length) chips.push(profile.favPropertyTypes.join(' / '))
    if (profile.favMinBeds > 0) chips.push(`${profile.favMinBeds}–${profile.favMaxBeds} beds`)
    if (profile.favCities.length) chips.push(profile.favCities.slice(0, 3).join(', '))
    return chips
  }, [profile])

  const canSearch = selectedCustomCities.length > 0

  const drillDownDeals = useMemo(() => {
    const source = finderTab === 'custom' ? customDeals : aiDeals
    if (!kpiFilter) return []
    let filtered: DealCandidate[]
    if (kpiFilter === 'topDeals') {
      filtered = [...source].sort((a, b) => b.investmentFitScore - a.investmentFitScore)
    } else {
      filtered = [...source.filter(d => d.listingStatus === 'new_listing')]
        .sort((a, b) => (b.listingDate ?? '').localeCompare(a.listingDate ?? ''))
    }
    switch (drillDownSortBy) {
      case 'netYield':    return [...filtered].sort((a, b) => (b.netYield ?? 0) - (a.netYield ?? 0))
      case 'grossYield':  return [...filtered].sort((a, b) => (b.grossYield ?? 0) - (a.grossYield ?? 0))
      case 'totalROI':    return [...filtered].sort((a, b) => (b.totalROI ?? 0) - (a.totalROI ?? 0))
      case 'cashflow':    return [...filtered].sort((a, b) => {
        const aCf = a.netYield != null && a.askingPrice > 0 ? (a.netYield / 100 * a.askingPrice) / 12 : 0
        const bCf = b.netYield != null && b.askingPrice > 0 ? (b.netYield / 100 * b.askingPrice) / 12 : 0
        return bCf - aCf
      })
      case 'askingPrice': return [...filtered].sort((a, b) => (a.askingPrice ?? Infinity) - (b.askingPrice ?? Infinity))
      case 'newest':      return [...filtered].sort((a, b) => (b.listingDate ?? '').localeCompare(a.listingDate ?? ''))
      default:            return filtered
    }
  }, [kpiFilter, aiDeals, customDeals, finderTab, drillDownSortBy])

  const handleKpiClick = (filter: 'topDeals' | 'newListings') => {
    setKpiFilter(prev => {
      if (prev === filter) return null
      setDrillDownSortBy(filter === 'newListings' ? 'newest' : 'investmentFit')
      return filter
    })
    setTimeout(() => {
      drillDownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#047857] mb-2">DEAL FINDER</p>
          <h1 className="text-[32px] font-bold text-[#111827] mb-2" style={{ fontFamily: SERIF, letterSpacing: '-0.02em' }}>
            Find your next investment deal
          </h1>
          <p className="text-sm text-[#6B7280]">
            Live investment opportunities ranked by investment fit to your strategy.
          </p>
        </div>
        <button type="button"
          className="shrink-0 mt-1 text-xs font-semibold text-[#047857] border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-2 rounded-xl hover:bg-[#D1FAE5] transition-colors">
          How it works
        </button>
      </div>

      {/* KPI row */}
      {activeMeta && activeStatus === 'ok' && (
        <KpiRow
          meta={finderTab === 'custom' ? customMeta : aiMeta}
          onTopDealsClick={() => handleKpiClick('topDeals')}
          onNewListingsClick={() => handleKpiClick('newListings')}
          activeFilter={kpiFilter}
        />
      )}

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-[#E7E5DD] mb-6">
        {([
          { id: 'ai',     label: 'AI Recommendations' },
          { id: 'custom', label: 'Custom Search'       },
          { id: 'saved',  label: 'Saved Searches'      },
        ] as const).map(t => (
          <button key={t.id} type="button" onClick={() => handleTabChange(t.id)}
            className={`px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
              finderTab === t.id ? 'border-[#047857] text-[#047857]' : 'border-transparent text-[#6B7280] hover:text-[#374151]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════ AI RECOMMENDATIONS TAB ════════════════════════════ */}
      {finderTab === 'ai' && (
        <div className="space-y-5">

          {/* Strategy summary */}
          {hasFavourites && strategyChips.length > 0 && (
            <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-1">Why these deals?</h3>
                  <p className="text-xs text-[#9CA3AF] mb-3">
                    We&apos;ve analysed your favourited properties to understand your investment strategy.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {strategyChips.map(chip => (
                      <span key={chip} className="text-xs bg-[#F6F3EC] border border-[#E7E5DD] text-[#374151] px-3 py-1 rounded-full">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={onGoToDiscover}
                  className="text-xs font-semibold text-[#047857] hover:underline shrink-0">
                  See all favourites →
                </button>
              </div>
            </div>
          )}

          {!hasFavourites ? (
            <NoFavouritesState onDiscover={onGoToDiscover} />
          ) : aiStatus === 'loading' || aiStatus === 'idle' ? (
            <>
              {aiStatus === 'idle' && (
                <div className="text-center py-10">
                  <button type="button" onClick={fetchAiDeals}
                    className="bg-[#047857] text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-[#065F46] transition-colors">
                    Find AI Recommendations →
                  </button>
                </div>
              )}
              {aiStatus === 'loading' && <LoadingState />}
            </>
          ) : aiStatus === 'unavailable' ? (
            <UnavailableState onDiscover={onGoToDiscover} />
          ) : aiStatus === 'error' ? (
            <ErrorState onRetry={fetchAiDeals} />
          ) : sortedDeals.length === 0 ? (
            <NoDealsState />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-[#374151]">
                  <span className="font-semibold text-[#111827]">{sortedDeals.length}</span> live {sortedDeals.length === 1 ? 'deal' : 'deals'} ranked by investment fit
                </p>
                <SortControl sortBy={sortBy} onChange={setSortBy} />
              </div>

              {kpiFilter !== null && (
                <div ref={drillDownRef} className="mb-8">
                  {/* Drill-down header */}
                  <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setKpiFilter(null)}
                        className="text-xs font-medium text-[#6B7280] hover:text-[#374151] flex items-center gap-1 transition-colors">
                        ← Back to overview
                      </button>
                      <div className="w-px h-4 bg-[#E7E5DD]" />
                      <div>
                        <h2 className="font-bold text-[#111827] text-base leading-none" style={{ fontFamily: SERIF }}>
                          {kpiFilter === 'topDeals' ? 'Top Deals' : 'New Listings'}
                        </h2>
                        <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                          {kpiFilter === 'topDeals' ? 'All deals ranked by Investment Fit' : 'Listings added most recently'}
                        </p>
                      </div>
                      <span className="text-[11px] font-semibold bg-[#F3F4F6] text-[#374151] px-2.5 py-1 rounded-full">
                        {drillDownDeals.length} deal{drillDownDeals.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-[#6B7280]">Sort:</label>
                      <select
                        value={drillDownSortBy}
                        onChange={e => setDrillDownSortBy(e.target.value as DrilldownSort)}
                        className="bg-white border border-[#E7E5DD] text-xs font-medium text-[#374151] rounded-xl px-3 py-1.5 outline-none focus:border-[#047857] cursor-pointer">
                        <option value="investmentFit">Investment Fit</option>
                        <option value="netYield">Highest net yield</option>
                        <option value="grossYield">Highest gross yield</option>
                        <option value="totalROI">Highest total ROI</option>
                        <option value="cashflow">Highest cashflow</option>
                        <option value="askingPrice">Lowest price</option>
                        <option value="newest">Newest first</option>
                      </select>
                    </div>
                  </div>
                  {drillDownDeals.length === 0 ? (
                    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-10 text-center">
                      <p className="text-sm text-[#9CA3AF]">No deals match this filter</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {drillDownDeals.map(deal => (
                        <DrillDownCard
                          key={deal.id}
                          deal={deal}
                          isFav={isDealFavourited(deal, favourites, favouriteItems)}
                          isOpening={openingId === deal.id}
                          openError={openErrors[deal.id] ?? null}
                          onToggleFav={() => onToggleFavourite(dealToFavouritePayload(deal))}
                          onOpen={() => openVerifiedAnalysis(deal)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {sortedDeals.map(deal => (
                  <DealCard key={deal.id} deal={deal}
                    isFav={localFavs.has(deal.id)} isOpening={openingId === deal.id}
                    openError={openErrors[deal.id] ?? null}
                    onToggleFav={() => toggleLocalFav(deal.id)}
                    onOpen={() => openVerifiedAnalysis(deal)} />
                ))}
              </div>

              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">How Investment Fit is calculated</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                  {[
                    { icon: '📈', label: 'Return efficiency', pts: '30 pts', desc: 'Net yield vs your strategy' },
                    { icon: '💰', label: 'Entry price',       pts: '20 pts', desc: 'Vs comparable sales & your avg' },
                    { icon: '⊞',  label: 'Strategy match',   pts: '15 pts', desc: 'Type, beds, price band' },
                    { icon: '🏙', label: 'Location',          pts: '15 pts', desc: 'City yield & growth signals' },
                    { icon: '⚡', label: 'Risk & EPC',        pts: '15 pts', desc: 'Compliance & listing quality' },
                    { icon: '✓',  label: 'Data confidence',  pts: '5 pts',  desc: 'Completeness of listing data' },
                  ].map(f => (
                    <div key={f.label} className="bg-[#FAF9F5] rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base">{f.icon}</span>
                        <span className="text-xs font-semibold text-[#374151]">{f.label}</span>
                        <span className="ml-auto text-[10px] text-[#047857] font-bold">{f.pts}</span>
                      </div>
                      <p className="text-[11px] text-[#9CA3AF]">{f.desc}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Investment Fit is deterministic — scores update as you favourite more properties and your strategy profile sharpens.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ════════════════ CUSTOM SEARCH TAB ════════════════════════════════ */}
      {finderTab === 'custom' && (
        <div className="space-y-6">

          {/* Filter card */}
          <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-[#111827] text-base" style={{ fontFamily: SERIF }}>Search criteria</h3>
              {(selectedCustomCities.length > 0 || customMinPrice || customMaxPrice || customPropertyTypes.length || customMinBeds || customMinYield || customMinNetYield || customMinROI) && (
                <button type="button" onClick={resetCustomFilters}
                  className="text-xs text-[#9CA3AF] hover:text-[#374151] transition-colors">
                  Clear all
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">

              {/* Location */}
              <div className="md:col-span-2 xl:col-span-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">City / area <span className="text-[#DC2626]">*</span></p>
                <div className="flex gap-2 flex-wrap">
                  {ALL_CITY_KEYS.map(city => {
                    const isSelected = selectedCustomCities.includes(city)
                    return (
                      <button key={city} type="button" aria-pressed={isSelected}
                        onClick={() => setSelectedCustomCities(prev =>
                          isSelected ? prev.filter(c => c !== city) : [...prev, city]
                        )}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          isSelected ? 'bg-[#047857] border-[#047857] text-white' : 'bg-white border-[#E7E5DD] text-[#6B7280] hover:border-[#047857]'
                        }`}>
                        {city}
                      </button>
                    )
                  })}
                </div>
                {!canSearch && (
                  <p className="text-[11px] text-[#9CA3AF] mt-2">Select at least one city to enable search</p>
                )}
              </div>

              {/* Asking price */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Asking price</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1 block">Min £</label>
                    <input type="number" step={10000} value={customMinPrice || ''}
                      placeholder="No min"
                      onChange={e => setCustomMinPrice(Number(e.target.value) || 0)}
                      className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#047857]" />
                  </div>
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1 block">Max £</label>
                    <input type="number" step={10000} value={customMaxPrice || ''}
                      placeholder="No max"
                      onChange={e => setCustomMaxPrice(Number(e.target.value) || 0)}
                      className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#047857]" />
                  </div>
                </div>
              </div>

              {/* Yield targets */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Yield targets</p>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <label className="text-[#6B7280]">Min gross yield</label>
                      <span className="font-semibold text-[#047857]">{customMinYield > 0 ? `${customMinYield.toFixed(1)}%` : 'Any'}</span>
                    </div>
                    <input type="range" min={0} max={12} step={0.5} value={customMinYield}
                      onChange={e => setCustomMinYield(Number(e.target.value))}
                      className="w-full h-1.5 accent-[#047857]" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <label className="text-[#6B7280]">Min net yield</label>
                      <span className="font-semibold text-[#047857]">{customMinNetYield > 0 ? `${customMinNetYield.toFixed(1)}%` : 'Any'}</span>
                    </div>
                    <input type="range" min={0} max={10} step={0.5} value={customMinNetYield}
                      onChange={e => setCustomMinNetYield(Number(e.target.value))}
                      className="w-full h-1.5 accent-[#047857]" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <label className="text-[#6B7280]">Min total ROI</label>
                      <span className="font-semibold text-[#047857]">{customMinROI > 0 ? `${customMinROI.toFixed(1)}%` : 'Any'}</span>
                    </div>
                    <input type="range" min={0} max={15} step={0.5} value={customMinROI}
                      onChange={e => setCustomMinROI(Number(e.target.value))}
                      className="w-full h-1.5 accent-[#047857]" />
                  </div>
                </div>
              </div>

              {/* Property type */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Property type</p>
                <div className="flex gap-2 flex-wrap">
                  {['Flat', 'Terraced', 'Semi-Detached', 'Detached', 'Bungalow'].map(t => {
                    const active = customPropertyTypes.includes(t)
                    return (
                      <button key={t} type="button" aria-pressed={active}
                        onClick={() => setCustomPropertyTypes(prev =>
                          active ? prev.filter(x => x !== t) : [...prev, t]
                        )}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          active ? 'bg-[#047857] border-[#047857] text-white' : 'bg-white border-[#E7E5DD] text-[#6B7280] hover:border-[#047857]'
                        }`}>
                        {t}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Bedrooms */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Bedrooms</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1.5 block">Min: {customMinBeds === 0 ? 'Any' : customMinBeds}</label>
                    <input type="range" min={0} max={5} step={1} value={customMinBeds}
                      onChange={e => setCustomMinBeds(Number(e.target.value))}
                      className="w-full h-1.5 accent-[#047857]" />
                    <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>Any</span><span>5+</span></div>
                  </div>
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1.5 block">Max: {customMaxBeds >= 6 ? 'Any' : customMaxBeds}</label>
                    <input type="range" min={1} max={6} step={1} value={customMaxBeds}
                      onChange={e => setCustomMaxBeds(Number(e.target.value))}
                      className="w-full h-1.5 accent-[#047857]" />
                    <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>1</span><span>Any</span></div>
                  </div>
                </div>
              </div>

              {/* Tenure */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Tenure</p>
                <div className="flex rounded-xl border border-[#E7E5DD] overflow-hidden">
                  {(['any', 'freehold', 'leasehold'] as TenureFilter[]).map(val => (
                    <button key={val} type="button"
                      onClick={() => setCustomTenure(val)}
                      className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
                        customTenure === val ? 'bg-[#047857] text-white' : 'bg-white text-[#374151] hover:bg-[#F6F3EC]'
                      }`}>
                      {val === 'any' ? 'Any' : val.charAt(0).toUpperCase() + val.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Strategy */}
              <div className="md:col-span-2 xl:col-span-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Investment strategy</p>
                <div className="flex gap-2 flex-wrap">
                  {STRATEGY_OPTIONS.map(s => {
                    const active = customStrategies.includes(s)
                    return (
                      <button key={s} type="button" aria-pressed={active}
                        onClick={() => setCustomStrategies(prev =>
                          active ? prev.filter(x => x !== s) : [...prev, s]
                        )}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          active ? 'bg-[#B7791F] border-[#B7791F] text-white' : 'bg-white border-[#E7E5DD] text-[#6B7280] hover:border-[#B7791F]'
                        }`}>
                        {s}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Search button */}
            <div className="flex items-center justify-between mt-6 pt-5 border-t border-[#F3F4F6]">
              <p className="text-xs text-[#9CA3AF]">
                {canSearch
                  ? `Searching ${selectedCustomCities.join(', ')}`
                  : 'Select a city above to enable search'}
              </p>
              <button
                type="button"
                onClick={runCustomSearch}
                disabled={!canSearch || customStatus === 'loading'}
                className="flex items-center gap-2 bg-[#047857] text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-[#065F46] transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px] justify-center">
                {customStatus === 'loading'
                  ? <><Spinner className="w-4 h-4" /> Searching…</>
                  : 'Search →'}
              </button>
            </div>
          </div>

          {/* Results area */}
          {customStatus === 'loading' && <LoadingState />}
          {customStatus === 'unavailable' && <UnavailableState onDiscover={onGoToDiscover} />}
          {customStatus === 'error' && <ErrorState onRetry={runCustomSearch} />}
          {customStatus === 'ok' && customDeals.length === 0 && <NoDealsState onReset={resetCustomFilters} />}
          {customStatus === 'ok' && customDeals.length > 0 && (
            <div>
              {kpiFilter !== null && (
                <div ref={drillDownRef} className="mb-8">
                  {/* Drill-down header */}
                  <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setKpiFilter(null)}
                        className="text-xs font-medium text-[#6B7280] hover:text-[#374151] flex items-center gap-1 transition-colors">
                        ← Back to overview
                      </button>
                      <div className="w-px h-4 bg-[#E7E5DD]" />
                      <div>
                        <h2 className="font-bold text-[#111827] text-base leading-none" style={{ fontFamily: SERIF }}>
                          {kpiFilter === 'topDeals' ? 'Top Deals' : 'New Listings'}
                        </h2>
                        <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                          {kpiFilter === 'topDeals' ? 'All deals ranked by Investment Fit' : 'Listings added most recently'}
                        </p>
                      </div>
                      <span className="text-[11px] font-semibold bg-[#F3F4F6] text-[#374151] px-2.5 py-1 rounded-full">
                        {drillDownDeals.length} deal{drillDownDeals.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-[#6B7280]">Sort:</label>
                      <select
                        value={drillDownSortBy}
                        onChange={e => setDrillDownSortBy(e.target.value as DrilldownSort)}
                        className="bg-white border border-[#E7E5DD] text-xs font-medium text-[#374151] rounded-xl px-3 py-1.5 outline-none focus:border-[#047857] cursor-pointer">
                        <option value="investmentFit">Investment Fit</option>
                        <option value="netYield">Highest net yield</option>
                        <option value="grossYield">Highest gross yield</option>
                        <option value="totalROI">Highest total ROI</option>
                        <option value="cashflow">Highest cashflow</option>
                        <option value="askingPrice">Lowest price</option>
                        <option value="newest">Newest first</option>
                      </select>
                    </div>
                  </div>
                  {drillDownDeals.length === 0 ? (
                    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-10 text-center">
                      <p className="text-sm text-[#9CA3AF]">No deals match this filter</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {drillDownDeals.map(deal => (
                        <DrillDownCard
                          key={deal.id}
                          deal={deal}
                          isFav={isDealFavourited(deal, favourites, favouriteItems)}
                          isOpening={openingId === deal.id}
                          openError={openErrors[deal.id] ?? null}
                          onToggleFav={() => onToggleFavourite(dealToFavouritePayload(deal))}
                          onOpen={() => openVerifiedAnalysis(deal)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <p className="text-sm text-[#374151]">
                  <span className="font-semibold text-[#111827]">{customDeals.length}</span> live {customDeals.length === 1 ? 'deal' : 'deals'} found
                </p>
                <SortControl sortBy={sortBy} onChange={setSortBy} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {sortDeals(customDeals, sortBy).map(deal => (
                  <DealCard key={deal.id} deal={deal}
                    isFav={localFavs.has(deal.id)} isOpening={openingId === deal.id}
                    openError={openErrors[deal.id] ?? null}
                    onToggleFav={() => toggleLocalFav(deal.id)}
                    onOpen={() => openVerifiedAnalysis(deal)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════ SAVED SEARCHES TAB ════════════════════════════════ */}
      {finderTab === 'saved' && (
        <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
          <p className="text-4xl mb-3">🔖</p>
          <p className="font-semibold text-[#374151] mb-2">No saved searches yet</p>
          <p className="text-sm text-[#6B7280] max-w-[360px] mx-auto mb-6">
            Create a custom search and save it to monitor new live deals as they appear.
          </p>
          <button type="button" onClick={() => setFinderTab('custom')}
            className="bg-[#047857] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#065F46] transition-colors">
            Create search →
          </button>
        </div>
      )}
    </div>
  )
}
