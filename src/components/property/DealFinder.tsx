'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { MARKET_DATA } from '@/lib/market-data'
import type { DealCandidate } from '@/app/api/deal-finder/route'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'
const ALL_CITY_KEYS = Object.keys(MARKET_DATA.cities)

type DealFinderTab = 'ai' | 'custom' | 'saved'
type SortBy = 'investmentFit' | 'netYield' | 'grossYield' | 'askingPrice' | 'newest'
type TenureFilter = 'any' | 'freehold' | 'leasehold'
type FetchStatus = 'idle' | 'loading' | 'ok' | 'unavailable' | 'error'

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
  if (!badges.length && deal.investmentReasons.includes('Lower entry price')) {
    badges.push({ label: 'Lower Entry', color: 'bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]' })
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

  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] flex flex-col overflow-hidden hover:border-[#A7F3D0] transition-all">
      {/* Image */}
      <div className="relative h-[160px] overflow-hidden">
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
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-xl font-bold text-[#111827]" style={{ fontFamily: SERIF }}>
              {fmtPrice(deal.askingPrice)}
            </p>
            {deal.previousAskingPrice && deal.previousAskingPrice !== deal.askingPrice && (
              <span className="text-xs text-[#9CA3AF] line-through mt-1">{fmtPrice(deal.previousAskingPrice)}</span>
            )}
          </div>
          <p className="text-xs text-[#6B7280] mb-0.5 uppercase tracking-[0.05em] font-semibold">Asking Price</p>
          <p className="text-sm font-semibold text-[#111827] leading-snug" style={{ fontFamily: SERIF }}>
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

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            {
              label: 'Net Yield',
              value: fmtYield(deal.netYield),
              hi: deal.netYield != null && deal.netYield >= 6,
            },
            {
              label: 'Est. Rent',
              value: fmtRent(deal.rentEstimateMonthly),
              hi: false,
            },
            {
              label: 'EPC',
              value: deal.epcRating ?? '—',
              hi: false,
              colorClass: epcColor,
            },
          ].map(kpi => (
            <div key={kpi.label} className="bg-[#FAF9F5] border border-[#F3F4F6] rounded-xl p-2.5 text-center">
              <p className="text-[9px] uppercase tracking-[0.06em] text-[#9CA3AF] mb-0.5">{kpi.label}</p>
              <p className={`font-bold text-sm ${kpi.colorClass ?? (kpi.hi ? 'text-[#047857]' : 'text-[#111827]')}`}
                style={{ fontFamily: SERIF }}>
                {kpi.value}
              </p>
            </div>
          ))}
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
          {isOpening ? <><Spinner /> Loading analysis…</> : 'View Deal →'}
        </button>
      </div>
    </div>
  )
}

// ── KPI Row ───────────────────────────────────────────────────────────────────

function KpiRow({ meta }: { meta: DealFinderMeta | null }) {
  const kpis = [
    { label: 'Top Deals', value: meta?.totalDeals != null ? String(meta.totalDeals) : '—', sub: 'Active live listings' },
    { label: 'Avg. Net Yield', value: meta?.avgNetYield != null ? `${meta.avgNetYield.toFixed(1)}%` : '—', sub: 'Across returned deals' },
    { label: 'Avg. Entry Price', value: meta?.avgAskingPrice != null ? fmtPrice(meta.avgAskingPrice) : '—', sub: 'Mean asking price' },
    { label: 'Best Net Yield', value: meta?.bestNetYield != null ? `${meta.bestNetYield.toFixed(1)}%` : '—', sub: meta?.bestNetYieldCity ?? '' },
    { label: 'New Listings', value: meta?.newListingsCount != null ? String(meta.newListingsCount) : '—', sub: 'This month' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
      {kpis.map(k => (
        <div key={k.label} className="bg-white border border-[#E7E5DD] rounded-2xl p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">{k.label}</p>
          <p className="font-bold text-2xl text-[#111827] leading-none mb-1" style={{ fontFamily: SERIF }}>{k.value}</p>
          {k.sub && <p className="text-[11px] text-[#9CA3AF]">{k.sub}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Empty / status states ──────────────────────────────────────────────────────

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
      <p className="font-semibold text-[#374151] mb-2">No live deals found</p>
      <p className="text-sm text-[#6B7280] max-w-[420px] mx-auto mb-4">
        Try widening your filters or check that live listing access is enabled.
      </p>
      {onReset && (
        <button type="button" onClick={onReset}
          className="text-sm font-semibold text-[#047857] border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-2 rounded-xl hover:bg-[#D1FAE5] transition-colors">
          Reset filters
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function DealFinder({
  favouriteItems,
  onGoToDiscover,
  onOpenAnalysis,
}: DealFinderProps) {
  const [finderTab, setFinderTab] = useState<DealFinderTab>('ai')
  const [sortBy, setSortBy] = useState<SortBy>('investmentFit')

  // AI tab
  const [aiDeals, setAiDeals] = useState<DealCandidate[]>([])
  const [aiStatus, setAiStatus] = useState<FetchStatus>('idle')
  const [aiMeta, setAiMeta] = useState<DealFinderMeta | null>(null)

  // Custom tab
  const [selectedCustomCities, setSelectedCustomCities] = useState<string[]>([])
  const [customMinPrice, setCustomMinPrice] = useState(0)
  const [customMaxPrice, setCustomMaxPrice] = useState(0)
  const [customMinYield, setCustomMinYield] = useState(0)
  const [customPropertyTypes, setCustomPropertyTypes] = useState<string[]>([])
  const [customMinBeds, setCustomMinBeds] = useState(0)
  const [customMaxBeds, setCustomMaxBeds] = useState(6)
  const [customTenure, setCustomTenure] = useState<TenureFilter>('any')
  const [customDeals, setCustomDeals] = useState<DealCandidate[]>([])
  const [customStatus, setCustomStatus] = useState<FetchStatus>('idle')
  const [customMeta, setCustomMeta] = useState<DealFinderMeta | null>(null)

  // Opening state
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({})
  const [localFavs, setLocalFavs] = useState<Set<string>>(new Set())

  const customDebounce = useRef<ReturnType<typeof setTimeout>>()

  // ── Derived favourite profile ─────────────────────────────────────────────
  const profile = useMemo(() => deriveBenchmarkFromFavourites(favouriteItems), [favouriteItems])
  const hasFavourites = favouriteItems.length > 0

  // ── AI auto-fetch ─────────────────────────────────────────────────────────
  useEffect(() => {
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
      .catch(() => setAiStatus('error'))
  }, [hasFavourites, profile.favOutcodes.join(','), profile.favCities.join(',')])

  // ── Custom search fetch ───────────────────────────────────────────────────
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
    if (customMinPrice > 0) params.set('minPrice', String(customMinPrice))
    if (customMaxPrice > 0) params.set('maxPrice', String(customMaxPrice))
    if (customMinYield > 0) params.set('minYield', String(customMinYield))
    if (customPropertyTypes.length) params.set('propertyTypes', customPropertyTypes.join(','))
    if (customMinBeds > 0) params.set('minBedrooms', String(customMinBeds))
    if (customMaxBeds < 6) params.set('maxBedrooms', String(customMaxBeds))

    fetch(`/api/deal-finder?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'unavailable') {
          setCustomStatus('unavailable')
        } else {
          setCustomDeals((data.deals ?? []) as DealCandidate[])
          setCustomMeta(data.meta ?? null)
          setCustomStatus('ok')
        }
      })
      .catch(() => setCustomStatus('error'))
  }, [selectedCustomCities, customMinPrice, customMaxPrice, customMinYield, customPropertyTypes, customMinBeds, customMaxBeds, profile])

  useEffect(() => {
    clearTimeout(customDebounce.current)
    customDebounce.current = setTimeout(runCustomSearch, 400)
    return () => clearTimeout(customDebounce.current)
  }, [runCustomSearch])

  // ── Open canonical Property Analysis ─────────────────────────────────────
  const openVerifiedAnalysis = useCallback(async (deal: DealCandidate) => {
    const cardId = deal.id
    setOpeningId(cardId)
    setOpenErrors(prev => { const n = { ...prev }; delete n[cardId]; return n })

    let uprn = deal.uprn
    try {
      if (!uprn) {
        const searchQ = deal.postcode || deal.displayAddress || deal.address
        const res = await fetch(`/api/property?q=${encodeURIComponent(searchQ)}`)
        if (res.ok) {
          const data = await res.json()
          const suggestions = (data.suggestions ?? []) as Array<Record<string, unknown>>
          const match = suggestions.find(s => String(s.uprn ?? '').length > 0)
          uprn = match ? String(match.uprn ?? '') || null : null
        }
      }

      if (!uprn) {
        setOpenErrors(prev => ({
          ...prev,
          [cardId]: 'Unable to open analysis — this listing could not be matched to a verified property record.',
        }))
        return
      }

      const res = await fetch(`/api/property?uprn=${encodeURIComponent(uprn)}`)
      if (!res.ok) throw new Error(`Analysis request failed: ${res.status}`)
      const data = await res.json()
      if (!data?.property) throw new Error('Missing property data')
      onOpenAnalysis(data)
    } catch (err) {
      console.error('[deal-finder] open analysis failed', err)
      setOpenErrors(prev => ({
        ...prev,
        [cardId]: 'Unable to open analysis. Please try searching for this property manually.',
      }))
    } finally {
      setOpeningId(null)
    }
  }, [onOpenAnalysis])

  const toggleLocalFav = useCallback((id: string) => {
    setLocalFavs(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }, [])

  // ── Sort & filter active deals ────────────────────────────────────────────
  const activeDeals = finderTab === 'ai' ? aiDeals : customDeals
  const activeStatus = finderTab === 'ai' ? aiStatus : customStatus
  const activeMeta = finderTab === 'ai' ? aiMeta : customMeta

  const sortedDeals = useMemo(() => {
    const copy = [...activeDeals]
    switch (sortBy) {
      case 'netYield': return copy.sort((a, b) => (b.netYield ?? 0) - (a.netYield ?? 0))
      case 'grossYield': return copy.sort((a, b) => (b.grossYield ?? 0) - (a.grossYield ?? 0))
      case 'askingPrice': return copy.sort((a, b) => (a.askingPrice ?? Infinity) - (b.askingPrice ?? Infinity))
      case 'newest': return copy.sort((a, b) => (b.listingDate ?? '').localeCompare(a.listingDate ?? ''))
      default: return copy.sort((a, b) => b.investmentFitScore - a.investmentFitScore)
    }
  }, [activeDeals, sortBy])

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

      {/* KPI row — shown when we have meta */}
      {activeMeta && activeStatus === 'ok' && <KpiRow meta={activeMeta} />}

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-[#E7E5DD] mb-6">
        {([
          { id: 'ai',     label: 'AI Recommendations' },
          { id: 'custom', label: 'Custom Search'       },
          { id: 'saved',  label: 'Saved Searches'      },
        ] as const).map(t => (
          <button key={t.id} type="button" onClick={() => setFinderTab(t.id)}
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

          {/* Main content */}
          {!hasFavourites ? (
            <NoFavouritesState onDiscover={onGoToDiscover} />
          ) : aiStatus === 'loading' || aiStatus === 'idle' ? (
            <LoadingState />
          ) : aiStatus === 'unavailable' || aiStatus === 'error' ? (
            <UnavailableState onDiscover={onGoToDiscover} />
          ) : sortedDeals.length === 0 ? (
            <NoDealsState />
          ) : (
            <>
              {/* Results header */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-[#374151]">
                  <span className="font-semibold text-[#111827]">{sortedDeals.length}</span> live {sortedDeals.length === 1 ? 'deal' : 'deals'} ranked by investment fit
                </p>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-[#6B7280]">Sort:</label>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}
                    className="bg-white border border-[#E7E5DD] text-xs font-medium text-[#374151] rounded-xl px-3 py-1.5 outline-none focus:border-[#047857] cursor-pointer">
                    <option value="investmentFit">Investment Fit</option>
                    <option value="netYield">Highest net yield</option>
                    <option value="grossYield">Highest gross yield</option>
                    <option value="askingPrice">Lowest price</option>
                    <option value="newest">Newest first</option>
                  </select>
                </div>
              </div>

              {/* Deal grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {sortedDeals.map(deal => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    isFav={localFavs.has(deal.id)}
                    isOpening={openingId === deal.id}
                    openError={openErrors[deal.id] ?? null}
                    onToggleFav={() => toggleLocalFav(deal.id)}
                    onOpen={() => openVerifiedAnalysis(deal)}
                  />
                ))}
              </div>

              {/* Why Investment Fit? */}
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
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">

            {/* Left: filters */}
            <div className="space-y-5">

              {/* City multi-select */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Cities / areas</h3>
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
                  {selectedCustomCities.length > 0 && (
                    <button type="button" onClick={() => setSelectedCustomCities([])}
                      className="px-3 py-1.5 rounded-full text-xs text-[#9CA3AF] hover:text-[#374151]">Clear all</button>
                  )}
                </div>
                {selectedCustomCities.length === 0 && (
                  <p className="text-[11px] text-[#9CA3AF] mt-2">Select one or more cities to search for live deals</p>
                )}
                {customStatus === 'loading' && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <Spinner className="w-3 h-3" />
                    <p className="text-[11px] text-[#9CA3AF]">Searching live listings…</p>
                  </div>
                )}
              </div>

              {/* Asking price range */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Asking price range</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1.5 block">Min £</label>
                    <input type="number" step={10000} value={customMinPrice || ''}
                      placeholder="No min"
                      onChange={e => setCustomMinPrice(Number(e.target.value) || 0)}
                      className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#047857]" />
                  </div>
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1.5 block">Max £</label>
                    <input type="number" step={10000} value={customMaxPrice || ''}
                      placeholder="No max"
                      onChange={e => setCustomMaxPrice(Number(e.target.value) || 0)}
                      className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#047857]" />
                  </div>
                </div>
              </div>

              {/* Min gross yield */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Minimum gross yield</h3>
                <div className="flex justify-between text-xs mb-2">
                  <label className="text-[#6B7280]">Min yield</label>
                  <span className="font-semibold text-[#047857]">{customMinYield > 0 ? `${customMinYield.toFixed(1)}%` : 'Any'}</span>
                </div>
                <input type="range" min={0} max={12} step={0.5} value={customMinYield}
                  onChange={e => setCustomMinYield(Number(e.target.value))}
                  className="w-full h-1.5 accent-[#047857]" />
                <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>Any</span><span>12%</span></div>
              </div>

              {/* Property type */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Property type</h3>
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
                  {customPropertyTypes.length > 0 && (
                    <button type="button" onClick={() => setCustomPropertyTypes([])}
                      className="px-3 py-1.5 rounded-full text-xs text-[#9CA3AF] hover:text-[#374151]">Clear</button>
                  )}
                </div>
              </div>

              {/* Bedrooms */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Bedrooms</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#6B7280] mb-2 block">Min: {customMinBeds === 0 ? 'Any' : customMinBeds}</label>
                    <input type="range" min={0} max={5} step={1} value={customMinBeds}
                      onChange={e => setCustomMinBeds(Number(e.target.value))}
                      className="w-full h-1.5 accent-[#047857]" />
                    <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>Any</span><span>5+</span></div>
                  </div>
                  <div>
                    <label className="text-xs text-[#6B7280] mb-2 block">Max: {customMaxBeds >= 6 ? 'Any' : customMaxBeds}</label>
                    <input type="range" min={1} max={6} step={1} value={customMaxBeds}
                      onChange={e => setCustomMaxBeds(Number(e.target.value))}
                      className="w-full h-1.5 accent-[#047857]" />
                    <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>1</span><span>Any</span></div>
                  </div>
                </div>
              </div>

              {/* Tenure */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Tenure</h3>
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
            </div>

            {/* Right: results panel */}
            <div className="space-y-4">
              <div className="bg-white border border-[#A7F3D0] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">
                  {selectedCustomCities.length === 0 ? 'Select a city above' :
                   customStatus === 'loading' ? 'Searching live listings…' :
                   customStatus === 'unavailable' ? 'Live data unavailable' :
                   `${customDeals.length} live ${customDeals.length === 1 ? 'deal' : 'deals'} found`}
                </p>

                {selectedCustomCities.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-2xl mb-2">🏙</p>
                    <p className="text-sm text-[#9CA3AF]">Choose a city to find live deals</p>
                  </div>
                ) : customStatus === 'loading' ? (
                  <div className="text-center py-8"><Spinner className="w-6 h-6 mx-auto" /></div>
                ) : customStatus === 'unavailable' ? (
                  <div className="text-center py-8">
                    <p className="text-2xl mb-2">🔌</p>
                    <p className="text-sm text-[#9CA3AF]">Live listing data not enabled</p>
                  </div>
                ) : customDeals.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-2xl mb-2">🔍</p>
                    <p className="text-sm text-[#9CA3AF]">No deals match your filters</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {customDeals.slice(0, 6).map(deal => (
                      <div key={deal.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#F3F4F6] hover:border-[#A7F3D0] transition-all cursor-pointer"
                        onClick={() => openVerifiedAnalysis(deal)}>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-[#111827] truncate">{deal.displayAddress || deal.address}</p>
                          <p className="text-[11px] text-[#9CA3AF]">{[deal.city, deal.postcode].filter(Boolean).join(' · ')}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-bold text-[#047857]">{fmtYield(deal.netYield)} net</p>
                          <p className="text-[10px] text-[#9CA3AF]">{fmtPrice(deal.askingPrice)}</p>
                        </div>
                        {openingId === deal.id && <Spinner className="w-4 h-4 shrink-0" />}
                      </div>
                    ))}
                    {customDeals.length > 6 && (
                      <p className="text-xs text-center text-[#9CA3AF]">+{customDeals.length - 6} more — narrow your filters</p>
                    )}
                  </div>
                )}
              </div>

              <button type="button"
                onClick={() => { setSortBy('investmentFit'); setFinderTab('ai') }}
                className="w-full bg-white border border-[#E7E5DD] text-[#374151] text-sm font-medium py-3 rounded-xl hover:bg-[#F6F3EC] transition-colors">
                Save search (coming soon)
              </button>
            </div>
          </div>

          {/* Full grid for custom results */}
          {customStatus === 'ok' && customDeals.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <p className="text-sm font-semibold text-[#374151]">
                  <span className="text-[#111827]">{customDeals.length}</span> live {customDeals.length === 1 ? 'deal' : 'deals'}
                </p>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-[#6B7280]">Sort:</label>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}
                    className="bg-white border border-[#E7E5DD] text-xs font-medium text-[#374151] rounded-xl px-3 py-1.5 outline-none focus:border-[#047857] cursor-pointer">
                    <option value="investmentFit">Investment Fit</option>
                    <option value="netYield">Highest net yield</option>
                    <option value="grossYield">Highest gross yield</option>
                    <option value="askingPrice">Lowest price</option>
                    <option value="newest">Newest first</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[...customDeals]
                  .sort((a, b) => {
                    switch (sortBy) {
                      case 'netYield': return (b.netYield ?? 0) - (a.netYield ?? 0)
                      case 'grossYield': return (b.grossYield ?? 0) - (a.grossYield ?? 0)
                      case 'askingPrice': return (a.askingPrice ?? Infinity) - (b.askingPrice ?? Infinity)
                      case 'newest': return (b.listingDate ?? '').localeCompare(a.listingDate ?? '')
                      default: return b.investmentFitScore - a.investmentFitScore
                    }
                  })
                  .map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      isFav={localFavs.has(deal.id)}
                      isOpening={openingId === deal.id}
                      openError={openErrors[deal.id] ?? null}
                      onToggleFav={() => toggleLocalFav(deal.id)}
                      onOpen={() => openVerifiedAnalysis(deal)}
                    />
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
