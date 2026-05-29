'use client'

import { useState, useRef, useEffect } from 'react'
import { LineChart } from '@/components/ui'
import { PropertySearchBar } from '@/components/property/PropertySearchBar'
import { calcSDLT, calcMortgagePayment, calcNetMonthlyIncome, calcSection24, MARKET_DATA } from '@/lib/market-data'
import type { Section24Result } from '@/lib/market-data'

interface PropertyDetailProps {
  data: Record<string, unknown>
  onClose: () => void
  onAI: () => void
  onAddPortfolio: () => void
  onHome?: () => void
  onMarketIntel?: (data: Record<string, unknown>) => void
  onSearchProperty?: (data: Record<string, unknown>) => void
  isSaved?: boolean
  inline?: boolean
}

type DetailTab = 'overview' | 'financials' | 'history' | 'risks' | 'market'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'

const BEDROOM_AREA_LOOKUP: Record<number, number> = {
  0: 35, 1: 50, 2: 70, 3: 90, 4: 115, 5: 140, 6: 160,
}

const NAV_ITEMS = [
  { icon: '⊞', label: 'Dashboard' },
  { icon: '⌂', label: 'Properties', active: true },
  { icon: '↗', label: 'Market Insights' },
  { icon: '✦', label: 'AI Analysis' },
  { icon: '◫', label: 'Portfolios' },
  { icon: '◈', label: 'Deal Finder' },
  { icon: '♡', label: 'Saved Searches' },
  { icon: '⌘', label: 'Mortgages' },
  { icon: '◻', label: 'Reports' },
  { icon: '◬', label: 'Alerts' },
]

function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)] ${className}`}>
      <div className="h-3 w-24 rounded-full bg-[#F3F4F6] mb-4 skeleton-light" />
      <div className="h-8 w-32 rounded-lg bg-[#F3F4F6] mb-2 skeleton-light" />
      <div className="h-3 w-40 rounded-full bg-[#F3F4F6] skeleton-light" />
    </div>
  )
}

export function PropertyDetail({ data, onClose, onAI, onAddPortfolio, onHome, onMarketIntel, onSearchProperty, isSaved = false, inline = false }: PropertyDetailProps) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [rent, setRent] = useState<number>(0)
  const [deposit, setDeposit] = useState(0)
  const [mortRate, setMortRate] = useState(4.8)
  const [mortYears, setMortYears] = useState(25)
  const [serviceCharge, setServiceCharge] = useState(0)
  const [groundRent, setGroundRent] = useState(0)
  const [mgmtFee, setMgmtFee] = useState(10)
  const [maintenance, setMaintenance] = useState(1.5)
  const [voidWks, setVoidWks] = useState(2)
  const [rentSet, setRentSet] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [otherAnnualIncome, setOtherAnnualIncome] = useState(0)
  const [annualMortgageInterest, setAnnualMortgageInterest] = useState(0)
  const [showSection24, setShowSection24] = useState(false)
  const [bedroomsOverride, setBedroomsOverride] = useState<number | null>(null)
  const [editingBeds, setEditingBeds] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 600)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = () => setScrolled(el.scrollTop > 260)
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [])

  // ── Data extraction ───────────────────────────────────────────────────────────
  const p            = data.property    as Record<string, unknown>
  const enriched     = data.enriched    as Record<string, unknown>
  const epc          = data.epc         as Record<string, unknown> | null
  const risks        = data.risks       as Array<Record<string, unknown>> | undefined
  const transactions = data.transactions as Array<Record<string, unknown>> | undefined
  const cityName     = data.cityName    as string
  const cityData     = cityName ? MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities] : null

  // Reset bedroom override when a different property is opened
  const propertyIdentityKey = String(
    p?.uprn || p?.id ||
    `${String(p?.full_address || p?.address || '')}-${String(p?.postcode ?? '')}`
  )
  useEffect(() => {
    setBedroomsOverride(null)
    setEditingBeds(false)
  }, [propertyIdentityKey])

  // Property type resolved early — needed for floor-area and recalculation
  const propType = String(p?.property_type ?? '')

  // ── Floor area: strict source priority with verified/inferred tracking ─────────
  const _faFromEpc = (() => {
    const v = Number(
      epc?.total_floor_area || epc?.totalFloorArea ||
      epc?.floor_area       || epc?.floorArea      || 0
    )
    return v > 10 && v < 1000 ? v : null
  })()

  const _faFromEnriched = (() => {
    const v = Number(enriched?.epcFloorArea || 0)
    return v > 10 && v < 1000 ? v : null
  })()

  const _faFromProperty = (() => {
    const v = Number(
      p?.internal_area_sqm || p?.internalAreaSqm ||
      p?.floor_area        || p?.floorArea       ||
      p?.size_sqm          || p?.sizeSqm         || 0
    )
    return v > 10 && v < 1000 ? v : null
  })()

  const floorArea: number | null = _faFromEpc || _faFromEnriched || _faFromProperty || null
  const floorAreaVerified        = !!(_faFromEpc || _faFromEnriched)
  const floorAreaSource: string | null = _faFromEpc
    ? (String(epc?.source ?? '') === 'epc_open_data' ? 'EPC' : 'Homedata EPC')
    : _faFromEnriched ? 'EPC'
    : _faFromProperty ? 'Homedata'
    : null

  // ── Calculations ──────────────────────────────────────────────────────────────
  const effectiveRent = rentSet ? rent : (enriched?.estimatedRent as number || 0)
  const price         = Number(p?.last_sold_price ?? 0)
  const soldYear      = Number(String(p?.last_sold_date ?? '2020').slice(0, 4))
  const yearsHeld     = Math.max(0, 2026 - soldYear)
  const annualGrowth  = cityData ? (cityData.capitalGrowth5yr / 5) / 100 : 0.025
  const _fallback     = price ? Math.round(price * Math.pow(1 + annualGrowth, yearsHeld)) : 0

  // Original bedroom count — preserves existing logic exactly, used as recalc anchor
  const originalPropertyBeds = (() => {
    if (enriched?.attrBedrooms != null) return Number(enriched.attrBedrooms)
    if (Number(p?.bedrooms) > 0) return Number(p.bedrooms)
    return 0
  })()

  // Estimated Current Value — recalculates locally when bedroom override is active
  const estimatedCurrentValue = (() => {
    const serverValue = Number(
      enriched?.estimatedCurrentValue ||
      p?.estimated_current_value      ||
      p?.estimatedCurrentValue        ||
      0
    )
    const anchor = serverValue > 0 ? serverValue : _fallback
    if (!Number.isFinite(anchor) || anchor <= 0) return _fallback
    if (bedroomsOverride === null) return anchor

    const lookupArea = BEDROOM_AREA_LOOKUP[bedroomsOverride]
    if (!lookupArea) return anchor

    const ptl        = propType.toLowerCase()
    const isDetached = ptl.includes('detached') && !ptl.includes('semi')
    const corrected  = isDetached ? lookupArea * 1.2 : lookupArea

    const originalArea =
      floorArea && floorArea > 10
        ? floorArea
        : originalPropertyBeds && BEDROOM_AREA_LOOKUP[originalPropertyBeds]
          ? BEDROOM_AREA_LOOKUP[originalPropertyBeds]
          : corrected

    if (!Number.isFinite(originalArea) || originalArea <= 0) return anchor
    return Math.round((anchor / originalArea * corrected) / 1000) * 1000
  })()

  // Yield price basis: last sold price first, fall back to estimated current value
  const _soldP          = Number(p?.last_sold_price ?? 0)
  const yieldPrice      = (_soldP > 0) ? _soldP : (estimatedCurrentValue > 0 ? estimatedCurrentValue : 0)
  const yieldPriceSource: 'last_sold_price' | 'estimated_current_value' | null =
    _soldP > 0 ? 'last_sold_price' : estimatedCurrentValue > 0 ? 'estimated_current_value' : null

  const grossYield  = yieldPrice && effectiveRent
    ? parseFloat(((effectiveRent * 12 / yieldPrice) * 100).toFixed(2)) : 0
  const netYield    = yieldPrice && effectiveRent
    ? parseFloat((calcNetMonthlyIncome(yieldPrice, effectiveRent, serviceCharge, groundRent, mgmtFee, maintenance, voidWks) * 12 / yieldPrice * 100).toFixed(2)) : 0
  const netMonthly  = yieldPrice && effectiveRent
    ? calcNetMonthlyIncome(yieldPrice, effectiveRent, serviceCharge, groundRent, mgmtFee, maintenance, voidWks) : 0
  const capitalGrowth = cityData?.capitalGrowth1yr || 0
  const totalROI    = parseFloat((netYield + capitalGrowth).toFixed(1))
  const sdlt        = price ? calcSDLT(price, true) : 0
  const mort        = price && deposit ? calcMortgagePayment(price, deposit, mortRate, mortYears) : null
  const cashflow    = mort ? netMonthly - mort.monthly : netMonthly

  const s24: Section24Result | null = showSection24 && effectiveRent > 0
    ? calcSection24({
        annualRentalIncome:      effectiveRent * 12,
        otherAnnualIncome,
        annualMortgageInterest,
        annualAllowableExpenses: Math.round(effectiveRent * 12 * (mgmtFee / 100))
          + Math.round((price || 0) * maintenance / 100)
          + serviceCharge + groundRent
          + Math.round(effectiveRent * voidWks / 4.33),
      })
    : null

  // ── EPC resolution (priority: homedata.epc → epc open data → property record) ─
  const epcRaw = String(
    epc?.current_energy_rating  ||
    epc?.currentEnergyRating    ||
    epc?.energy_rating          ||
    epc?.rating                 ||
    enriched?.epcRating         ||
    enriched?.current_energy_rating ||
    p?.current_energy_rating    ||
    p?.currentEnergyRating      ||
    p?.epc_rating               ||
    p?.epcRating                ||
    ''
  ).trim().toUpperCase()
  const epcRating   = epcRaw.match(/[A-G]/)?.[0] ?? '?'
  const epcKnown    = epcRating !== '?'
  const epcCompliant = epcKnown && epcRating <= 'C'

  // ── Attribute resolution ──────────────────────────────────────────────────────
  const bedsLabel = (() => {
    if (bedroomsOverride !== null) return String(bedroomsOverride)
    const enrichedLabel = String(enriched?.attrBedroomsLabel ?? '')
    if (enrichedLabel && enrichedLabel !== '0' && enrichedLabel !== 'Unknown') return enrichedLabel
    const rawBeds = Number(p?.bedrooms)
    if (rawBeds > 0) return String(rawBeds)
    return 'Not recorded'
  })()
  const bathsLabel     = String(enriched?.attrBathroomsLabel || (p?.bathrooms != null ? `${p.bathrooms}` : ''))
  const tenureLabel    = String(enriched?.attrTenureLabel    || String(p?.tenure ?? '') || '')
  const gardenLabel    = String(enriched?.attrGardenLabel    || (p?.has_garden === true ? 'Rear Garden' : p?.has_garden === false ? 'No' : ''))
  const bedsInferred   = Boolean(enriched?.attrBedroomsInferred)
  const bathsInferred  = Boolean(enriched?.attrBathroomsInferred)
  const tenureInferred = Boolean(enriched?.attrTenureInferred)
  const gardenInferred = Boolean(enriched?.attrGardenInferred)
  const floorAreaInferred = !floorAreaVerified && floorArea !== null
  const anyInferred    = (bedroomsOverride === null ? bedsInferred : false)
    || bathsInferred || tenureInferred || gardenInferred || floorAreaInferred

  const address  = String(p?.full_address || p?.address || 'Unknown Address')
  const postcode = String(p?.postcode ?? '')

  // propertyBeds: override takes priority, then original derived value
  const propertyBeds = bedroomsOverride !== null ? bedroomsOverride : originalPropertyBeds

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview',   label: 'Overview'          },
    { id: 'financials', label: 'Financials'        },
    { id: 'history',    label: 'History'           },
    { id: 'risks',      label: 'Risks'             },
    { id: 'market',     label: 'Market Comparison' },
  ]

  const epcColor = !epcKnown ? 'text-[#D1D5DB]'
    : epcRating <= 'B' ? 'text-[#047857]'
    : epcRating <= 'D' ? 'text-[#B7791F]'
    : 'text-[#DC2626]'

  const epcBadgeClass = epcRating <= 'C'
    ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
    : epcRating === 'D'
    ? 'bg-[#FFF7E6] text-[#B7791F] border-[#F5D48A]'
    : 'bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5]'

  const confidenceScore   = enriched?.valuationConfidence ? Number(enriched.valuationConfidence) : null
  const comparablesCount  = transactions?.length ?? 0
  const dataQuality       = Math.min(97, 60 + (comparablesCount * 5) + (epcKnown ? 10 : 0) + (floorArea ? 7 : 0))

  const localMarketType = (() => {
    const beds = Number(p?.bedrooms ?? 0)
    const type = propType.toLowerCase()
    if (type.includes('flat') || type.includes('apartment')) {
      return beds <= 1 ? 'Compact urban apartment market' : 'City apartment market'
    }
    if (beds >= 4) return 'Larger family house market'
    if (beds === 3) return 'Family house market'
    return 'Mid-sized residential market'
  })()

  return (
    <div className={inline ? 'flex flex-col flex-1 overflow-hidden bg-[#FAF9F5]' : 'fixed inset-0 z-50 flex bg-[#FAF9F5] overflow-hidden'} style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Sidebar (modal mode only) ── */}
      {!inline && <aside className="hidden lg:flex flex-col w-[248px] shrink-0 bg-white border-r border-[#E7E5DD] h-full overflow-y-auto">
        <div className="px-6 py-5 border-b border-[#E7E5DD]">
          <button onClick={() => onHome ? onHome() : onClose()}
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-[#047857] rounded-lg flex items-center justify-center shrink-0">
              <svg width="15" height="14" viewBox="0 0 15 14" fill="none">
                <path d="M1.5 13V6.2L7.5 2l6 4.2V13H10V9H5v4H1.5z" fill="white"/>
              </svg>
            </div>
            <span className="text-[#111827] font-bold text-[19px] tracking-tight" style={{ fontFamily: SERIF }}>Portfolai</span>
          </button>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <button key={item.label}
              onClick={() => {
                if (item.label === 'Market Insights') onMarketIntel?.(data)
                else if (item.label === 'Dashboard') onHome ? onHome() : onClose()
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left ${
                item.active ? 'bg-[#ECFDF5] text-[#047857]' : 'text-[#374151] hover:bg-[#F6F3EC]'
              }`}>
              <span className="text-sm w-5 text-center">{item.icon}</span>
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="px-4 pb-4 space-y-3">
          <div className="bg-[#FFF7E6] border border-[#F5D48A] rounded-2xl p-4">
            <p className="text-[11px] font-bold text-[#B7791F] mb-1">⭐ Upgrade to Premium</p>
            <p className="text-[11px] text-[#6B7280] mb-3 leading-relaxed">Unlock advanced analytics, off-market deals and priority support.</p>
            <button className="w-full bg-[#047857] text-white text-xs font-semibold py-2 rounded-lg hover:bg-[#065F46] transition-colors">
              Upgrade Now →
            </button>
          </div>
          <div className="bg-[#F6F3EC] rounded-2xl p-4">
            <p className="text-[11px] font-bold text-[#374151] mb-1">Need help?</p>
            <p className="text-[11px] text-[#6B7280] mb-2">Talk to our property investment experts.</p>
            <button className="text-xs text-[#047857] font-semibold hover:underline">Book a Call →</button>
          </div>
        </div>
      </aside>}

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {!inline && <header className="shrink-0 bg-white/90 backdrop-blur-md border-b border-[#E7E5DD] px-6 lg:px-8 h-[68px] flex items-center justify-between gap-4 z-10">
          <PropertySearchBar
            onSelectProperty={onSearchProperty ?? (() => {})}
            placeholder="Search properties, areas, or insights…"
            className="flex-1 max-w-[420px]"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onAI}
              className="hidden sm:flex items-center gap-1.5 bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] text-xs font-semibold px-3 py-2 rounded-xl hover:bg-[#D1FAE5] transition-colors">
              🤖 AI Analysis
            </button>
            <button onClick={isSaved ? undefined : onAddPortfolio}
              className={`hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition-colors ${isSaved ? 'bg-[#FFF7E6] border border-[#F5D48A] text-[#B7791F] cursor-default' : 'bg-[#FFF7E6] border border-[#F5D48A] text-[#B7791F] hover:bg-[#FEF3C7]'}`}>
              {isSaved ? '★ Saved' : '★ Save'}
            </button>
            <button onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#E7E5DD] bg-white text-[#6B7280] hover:bg-[#F6F3EC] transition-colors text-sm font-medium">
              ✕
            </button>
          </div>
        </header>}

        {/* ── Sticky scroll summary ── */}
        <div className={`shrink-0 overflow-hidden transition-all duration-300 ${scrolled ? 'max-h-[56px] border-b border-[#E7E5DD]' : 'max-h-0'}`}>
          <div className="bg-white/95 backdrop-blur-sm px-6 lg:px-8 h-14 flex items-center justify-between gap-6">
            <p className="text-sm font-semibold text-[#111827] truncate" style={{ fontFamily: SERIF }}>{address.split(',')[0]}</p>
            <div className="flex items-center gap-5 shrink-0">
              {estimatedCurrentValue > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[#9CA3AF]">Est. Value</span>
                  <span className="text-sm font-bold text-[#047857]" style={{ fontFamily: SERIF }}>£{(estimatedCurrentValue / 1000).toFixed(0)}k</span>
                </div>
              )}
              {netYield > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[#9CA3AF]">Net Yield</span>
                  <span className="text-sm font-bold text-[#047857]" style={{ fontFamily: SERIF }}>{netYield}%</span>
                </div>
              )}
              {totalROI > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[#9CA3AF]">Total ROI</span>
                  <span className="text-sm font-bold text-[#B7791F]" style={{ fontFamily: SERIF }}>{totalROI}%</span>
                </div>
              )}
              <button onClick={isSaved ? undefined : onAddPortfolio}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${isSaved ? 'bg-[#FFF7E6] border border-[#F5D48A] text-[#B7791F] cursor-default' : 'bg-[#047857] text-white hover:bg-[#065F46]'}`}>
                {isSaved ? '★ Saved' : '+ Portfolio'}
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6">

            {/* ── Property header ── */}
            <div className="mb-6">
              <button onClick={onClose}
                className="flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#047857] transition-colors mb-4 group">
                <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
                <span>Back to Properties</span>
              </button>

              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div className="min-w-0 flex-1">
                  <h1 className="text-[32px] sm:text-[40px] font-bold text-[#111827] leading-[1.08] mb-3"
                    style={{ fontFamily: SERIF, letterSpacing: '-0.02em' }}>
                    {address}
                  </h1>
                  <div className="flex items-center gap-2 flex-wrap">
                    {postcode && (
                      <span className="inline-flex items-center bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] text-[13px] font-semibold px-3 py-1 rounded-full">
                        {postcode}
                      </span>
                    )}
                    {propType && (
                      <span className="inline-flex items-center bg-white text-[#374151] border border-[#E7E5DD] text-[13px] font-medium px-3 py-1 rounded-full">
                        ⌂ {propType}
                      </span>
                    )}
                    {cityName && (
                      <span className="inline-flex items-center bg-white text-[#374151] border border-[#E7E5DD] text-[13px] font-medium px-3 py-1 rounded-full">
                        ◎ {cityName}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#047857] font-medium">
                      <span className="w-1.5 h-1.5 bg-[#047857] rounded-full animate-pulse" />
                      Analysis updated today · Source: Multiple verified sources
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button className="border border-[#E7E5DD] bg-white text-[#374151] text-sm font-medium px-4 py-2 rounded-xl hover:bg-[#F6F3EC] transition-colors">
                    ↗ Share
                  </button>
                  <button onClick={isSaved ? undefined : onAddPortfolio}
                    className={`text-sm font-medium px-4 py-2 rounded-xl transition-colors ${isSaved ? 'bg-[#FFF7E6] border border-[#F5D48A] text-[#B7791F] cursor-default' : 'border border-[#E7E5DD] bg-white text-[#374151] hover:bg-[#F6F3EC]'}`}>
                    {isSaved ? '★ Saved' : '☆ Save'}
                  </button>
                  <button className="bg-[#047857] text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-[#065F46] transition-colors">
                    ↓ Export
                  </button>
                </div>
              </div>
            </div>

            {/* ── KPI strip ── */}
            {isLoading ? (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                {[...Array(5)].map((_, i) => <SkeletonCard key={i} className={i === 0 ? 'col-span-2 lg:col-span-1' : ''} />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 mb-6">
                <div className="col-span-2 lg:col-span-1 bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.05)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-2">Estimated Current Value</p>
                  <p className="font-bold text-[38px] leading-none text-[#047857] mb-2"
                    style={{ fontFamily: SERIF, letterSpacing: '-0.03em' }}>
                    {estimatedCurrentValue ? `£${estimatedCurrentValue.toLocaleString()}` : '—'}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {confidenceScore && bedroomsOverride === null && (
                      <span className="bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] text-[11px] font-semibold px-2 py-0.5 rounded-full">
                        {confidenceScore}% confidence
                      </span>
                    )}
                    {bedroomsOverride !== null ? (
                      <p className="text-xs text-[#047857] font-medium">Recalculated using corrected bedroom count</p>
                    ) : price && p?.last_sold_date ? (
                      <p className="text-xs text-[#6B7280]">Est. from {String(p.last_sold_date).slice(0, 4)} sale price</p>
                    ) : null}
                  </div>
                </div>

                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.05)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-2">Last Sold Price</p>
                  <p className="font-bold text-[28px] leading-none text-[#111827] mb-2"
                    style={{ fontFamily: SERIF, letterSpacing: '-0.03em' }}>
                    {price ? `£${price.toLocaleString()}` : '—'}
                  </p>
                  {p?.last_sold_date && (
                    <p className="text-xs text-[#6B7280]">Sold {String(p.last_sold_date).slice(0, 4)}</p>
                  )}
                </div>

                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.05)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-2">Gross Yield</p>
                  <p className={`font-bold text-[28px] leading-none mb-2 ${grossYield > 6 ? 'text-[#047857]' : 'text-[#111827]'}`}
                    style={{ fontFamily: SERIF, letterSpacing: '-0.03em' }}>
                    {grossYield ? `${grossYield}%` : '—'}
                  </p>
                  {cityData && <p className="text-xs text-[#6B7280]">Area avg {cityData.avgYield}%</p>}
                  {yieldPriceSource === 'estimated_current_value' && (
                    <p className="text-[10px] text-[#B7791F] mt-0.5">Based on est. value</p>
                  )}
                </div>

                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.05)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-2">Net Yield</p>
                  <p className={`font-bold text-[28px] leading-none mb-2 ${netYield > 4 ? 'text-[#047857]' : 'text-[#111827]'}`}
                    style={{ fontFamily: SERIF, letterSpacing: '-0.03em' }}>
                    {netYield ? `${netYield}%` : '—'}
                  </p>
                  <p className="text-xs text-[#6B7280]">After all costs</p>
                  {yieldPriceSource === 'estimated_current_value' && (
                    <p className="text-[10px] text-[#B7791F] mt-0.5">Based on est. value</p>
                  )}
                </div>

                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.05)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-2">Total ROI</p>
                  <p className="font-bold text-[28px] leading-none text-[#B7791F] mb-2"
                    style={{ fontFamily: SERIF, letterSpacing: '-0.03em' }}>
                    {totalROI ? `${totalROI}%` : '—'}
                  </p>
                  <p className="text-xs text-[#6B7280]">Net yield + cap growth</p>
                </div>
              </div>
            )}

            {/* ── Confidence + data quality bar ── */}
            <div className="flex items-center justify-between gap-4 mb-5 px-1 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                {comparablesCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#047857] bg-[#ECFDF5] border border-[#A7F3D0] px-3 py-1 rounded-full">
                    ✓ High confidence · Based on {comparablesCount} local transaction{comparablesCount !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280] bg-white border border-[#E7E5DD] px-3 py-1 rounded-full">
                  📊 Data quality: {dataQuality}%
                </span>
                <span className="inline-flex items-center text-[11px] text-[#9CA3AF]">
                  {localMarketType}
                </span>
              </div>
              <p className="text-[11px] text-[#9CA3AF]">
                Sources: Land Registry · EPC Open Data · Homedata · UK HPI
              </p>
            </div>

            {/* ── Tab bar ── */}
            <div className="flex gap-0 border-b border-[#E7E5DD] mb-6 overflow-x-auto">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`shrink-0 px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
                    tab === t.id
                      ? 'border-[#047857] text-[#047857]'
                      : 'border-transparent text-[#6B7280] hover:text-[#374151]'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* OVERVIEW TAB                                                    */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {tab === 'overview' && (
              <div className="grid grid-cols-12 gap-5">

                {/* ── Property Details ── */}
                <div className="col-span-12 lg:col-span-4 bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Property Details</h3>
                  <div>
                    {([
                      { icon: '🛏', label: 'Bedrooms',  value: bedsLabel,                          inferred: bedroomsOverride === null ? bedsInferred : false,   epc: false, verified: false,           verifiedSource: undefined },
                      { icon: '🛁', label: 'Bathrooms', value: bathsLabel,                         inferred: bathsInferred,  epc: false, verified: false,           verifiedSource: undefined },
                      { icon: '⊞', label: 'Floor Area', value: floorArea ? `${floorArea} m²` : '', inferred: floorAreaInferred, epc: false, verified: floorAreaVerified, verifiedSource: floorAreaSource ?? undefined },
                      { icon: '⚡', label: 'EPC Rating', value: epcKnown ? epcRating : '',          inferred: false,          epc: true,  verified: false,           verifiedSource: undefined },
                      { icon: '🌿', label: 'Garden',    value: gardenLabel,                         inferred: gardenInferred, epc: false, verified: false,           verifiedSource: undefined },
                      { icon: '🏠', label: 'Type',      value: propType,                            inferred: false,          epc: false, verified: false,           verifiedSource: undefined },
                      { icon: '📋', label: 'Tenure',    value: tenureLabel,                         inferred: tenureInferred, epc: false, verified: false,           verifiedSource: undefined },
                    ] as Array<{ icon: string; label: string; value: string; inferred: boolean; epc: boolean; verified: boolean; verifiedSource?: string }>)
                      .filter(r => r.value || r.label === 'Bedrooms')
                      .map(row => (
                      <div key={row.label} className="flex items-center justify-between py-3 border-b border-[#F3F4F6] last:border-0">
                        <div className="flex items-center gap-2.5">
                          <span className="text-base w-5 text-center">{row.icon}</span>
                          <span className="text-sm text-[#475569]">{row.label}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {row.label === 'Bedrooms' ? (
                            editingBeds ? (
                              <div className="flex items-center gap-1 flex-wrap justify-end">
                                {[1, 2, 3, 4, 5, 6].map(n => (
                                  <button key={n} type="button"
                                    aria-label={`Set bedroom count to ${n}`}
                                    onClick={() => { setBedroomsOverride(n); setEditingBeds(false) }}
                                    className="w-7 h-7 flex items-center justify-center text-xs font-semibold rounded-lg border border-[#E7E5DD] bg-white text-[#111827] hover:bg-[#ECFDF5] hover:border-[#A7F3D0] hover:text-[#047857] transition-colors">
                                    {n}
                                  </button>
                                ))}
                                <button type="button" aria-label="Cancel bedroom correction"
                                  onClick={() => setEditingBeds(false)}
                                  className="text-[11px] text-[#6B7280] ml-1 px-1 hover:text-[#111827] transition-colors">
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className={`text-sm font-semibold ${bedroomsOverride !== null ? 'text-[#047857]' : bedsInferred ? 'text-[#B7791F]' : 'text-[#111827]'}`}>
                                  {bedsLabel}{bedroomsOverride !== null ? ' ✓' : bedsInferred ? ' *' : ''}
                                </span>
                                <button type="button" aria-label="Correct bedroom count"
                                  onClick={() => setEditingBeds(true)}
                                  className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] hover:bg-[#D1FAE5] transition-colors">
                                  {bedroomsOverride !== null ? 'Edit' : 'Correct?'}
                                </button>
                              </div>
                            )
                          ) : row.epc ? (
                            <span className={`text-sm font-bold px-2.5 py-0.5 rounded-lg border ${epcBadgeClass}`}>
                              {row.value}
                            </span>
                          ) : (
                            <span className={`text-sm font-semibold ${row.inferred ? 'text-[#B7791F]' : 'text-[#111827]'}`}>
                              {row.value}{row.inferred ? ' *' : ''}
                            </span>
                          )}
                          {row.label !== 'Bedrooms' && row.verified && (
                            <span className="text-[10px] bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] px-1.5 py-0.5 rounded font-bold">
                              {row.verifiedSource || 'EPC'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {anyInferred && (
                    <p className="text-[11px] text-[#9CA3AF] mt-3">
                      * Estimated from floor area and local property norms.
                      {floorAreaInferred ? ' Floor area from Homedata property record.' : ''}
                    </p>
                  )}
                  <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
                    <p className="text-[11px] text-[#9CA3AF]">Sources: Land Registry · EPC Open Data · Homedata · UK HPI</p>
                  </div>
                </div>

                {/* ── Investment Signals ── */}
                <div className="col-span-12 lg:col-span-5 bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-1">Investment Signals</h3>
                  <p className="text-[11px] text-[#9CA3AF] mb-4">Scores are based on 100-point scale. Higher is better.</p>
                  {cityData ? (
                    <>
                      <div className="flex justify-around py-4">
                        {[
                          { score: cityData.demandScore,          label: 'Demand'         },
                          { score: 100 - cityData.supplyScore,    label: 'Supply Gap'     },
                          { score: cityData.regenerationScore,    label: 'Regeneration'   },
                          { score: cityData.infrastructureScore,  label: 'Infrastructure' },
                        ].map(ring => {
                          const color = ring.score >= 75 ? '#047857' : ring.score >= 50 ? '#B7791F' : '#D1D5DB'
                          const wordLabel = ring.score >= 80 ? 'Very Strong' : ring.score >= 65 ? 'Strong' : ring.score >= 50 ? 'Good' : 'Moderate'
                          const wordColor = ring.score >= 75 ? 'text-[#047857]' : ring.score >= 50 ? 'text-[#B7791F]' : 'text-[#9CA3AF]'
                          const circ = 2 * Math.PI * 28
                          return (
                            <div key={ring.label} className="flex flex-col items-center gap-2">
                              <svg width="72" height="72" viewBox="0 0 72 72">
                                <circle cx="36" cy="36" r="28" fill="none" stroke="#F3F4F6" strokeWidth="8"/>
                                <circle cx="36" cy="36" r="28" fill="none"
                                  stroke={color} strokeWidth="8" strokeLinecap="round"
                                  strokeDasharray={`${(ring.score / 100) * circ} ${circ}`}
                                  transform="rotate(-90 36 36)"
                                  style={{ transition: 'stroke-dasharray 0.6s ease' }}
                                />
                                <text x="36" y="41" textAnchor="middle" fontSize="15" fontWeight="700" fill="#111827">
                                  {ring.score}
                                </text>
                              </svg>
                              <div className="text-center">
                                <p className="text-[11px] font-semibold text-[#374151]">{ring.label}</p>
                                <p className={`text-[10px] font-medium ${wordColor}`}>{wordLabel}</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-3 mt-2">
                        <p className="text-xs text-[#047857] leading-relaxed">
                          {cityData.demandScore >= 75 ? 'Strong demand' : 'Moderate demand'} and infrastructure support long-term rental resilience in {cityName}.
                          {cityData.capitalGrowth5yr > 15 ? ` ${cityData.capitalGrowth5yr}% capital growth over 5 years.` : ''}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="py-10 text-center">
                      <p className="text-sm text-[#9CA3AF]">City investment data unavailable for this area.</p>
                    </div>
                  )}
                </div>

                {/* ── History Preview ── */}
                <div className="col-span-12 lg:col-span-3 bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">History Preview</h3>
                    <button onClick={() => setTab('history')} className="text-xs text-[#047857] font-semibold hover:underline">
                      View all →
                    </button>
                  </div>
                  {transactions && transactions.length > 0 ? (
                    <div className="space-y-0">
                      {transactions.slice(0, 3).map((t, i) => (
                        <div key={i} className={`${i > 0 ? 'border-t border-[#F3F4F6] pt-4 mt-4' : ''}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-[#6B7280] bg-[#F6F3EC] px-2 py-0.5 rounded">
                              {String(t.date ?? '').slice(0, 10)}
                            </span>
                            <span className="text-[11px] text-[#9CA3AF]">{String(t.transaction_type ?? 'Purchase')}</span>
                          </div>
                          <p className="text-xl font-bold text-[#111827] tracking-tight" style={{ fontFamily: SERIF }}>
                            £{Number(t.price ?? 0).toLocaleString()}
                          </p>
                          {i === 0 && (
                            <div className="mt-1 space-y-0.5">
                              <p className="text-[11px] text-[#9CA3AF]">Source: HM Land Registry</p>
                              {tenureLabel && <p className="text-[11px] text-[#9CA3AF]">Tenure: {tenureLabel}</p>}
                            </div>
                          )}
                        </div>
                      ))}
                      <button onClick={() => setTab('history')}
                        className="w-full mt-5 border border-[#E7E5DD] text-[#374151] text-xs font-medium py-2.5 rounded-xl hover:bg-[#F6F3EC] transition-colors">
                        View all transactions
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-2xl mb-2">📋</p>
                      <p className="text-sm font-medium text-[#475569] mb-1">No transactions on record</p>
                      <p className="text-xs text-[#9CA3AF]">May be newly built or not yet registered with Land Registry.</p>
                    </div>
                  )}
                </div>

                {/* Data bar */}
                <div className="col-span-12 bg-[#F6F3EC] border border-[#E7E5DD] rounded-xl px-5 py-3 flex gap-6 flex-wrap text-xs text-[#6B7280]">
                  <span>UPRN: <strong className="text-[#374151]">{String(p?.uprn ?? '')}</strong></span>
                  <span>Postcode: <strong className="text-[#374151]">{postcode}</strong></span>
                  <span>Last sold: <strong className="text-[#374151]">{String(p?.last_sold_date ?? '') || 'No record'}</strong></span>
                  {price ? <span>At: <strong className="text-[#374151]">£{price.toLocaleString()}</strong></span> : null}
                  {enriched?.valuationMethod && (
                    <span>Method: <strong className="text-[#374151]">{String(enriched.valuationMethod)}</strong></span>
                  )}
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* FINANCIALS TAB                                                  */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {tab === 'financials' && (
              <div className="space-y-5">
                <div className="bg-white border border-[#A7F3D0] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Monthly Rent (£)</h3>
                  <div className="flex gap-3 items-center">
                    <input
                      type="number"
                      value={rent || ''}
                      onChange={e => { setRent(Number(e.target.value)); setRentSet(true) }}
                      placeholder={`Estimated: £${enriched?.estimatedRent || '—'}`}
                      className="flex-1 bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-4 py-3 text-[#111827] text-sm outline-none focus:border-[#047857] focus:ring-2 focus:ring-[#047857]/10"
                    />
                    <button
                      onClick={() => { setServiceCharge(defaultServiceCharge(p)); setGroundRent(p?.tenure === 'Leasehold' ? 200 : 0) }}
                      className="border border-[#E7E5DD] bg-white text-[#374151] text-xs font-medium px-4 py-3 rounded-xl hover:bg-[#F6F3EC] transition-colors whitespace-nowrap">
                      Set defaults
                    </button>
                  </div>
                  <p className="text-xs text-[#6B7280] mt-2">
                    💡 Verify with local letting agents. Estimate based on {cityName} {String(p?.bedrooms ?? '')}-bed market rate.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Annual Costs</h3>
                    <div className="space-y-4">
                      {[
                        { label: 'Service charge (£/yr)', val: serviceCharge, set: setServiceCharge, step: 100, min: 0, max: 10000, display: `£${serviceCharge.toLocaleString()}` },
                        { label: 'Ground rent (£/yr)',    val: groundRent,    set: setGroundRent,    step: 50,  min: 0, max: 1000,  display: `£${groundRent}` },
                        { label: `Management fee`,         val: mgmtFee,       set: setMgmtFee,       step: 1,   min: 0, max: 20,    display: `${mgmtFee}%` },
                        { label: `Maintenance`,            val: maintenance,   set: setMaintenance,   step: 0.5, min: 0, max: 5,     display: `${maintenance}%` },
                        { label: `Void weeks/yr`,          val: voidWks,       set: setVoidWks,       step: 0.5, min: 0, max: 8,     display: `${voidWks} wk` },
                      ].map(f => (
                        <div key={f.label}>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-[#6B7280]">{f.label}</span>
                            <span className="text-[#111827] font-semibold">{f.display}</span>
                          </div>
                          <input type="range" min={f.min} max={f.max} step={f.step} value={f.val}
                            onChange={e => f.set(Number(e.target.value))}
                            className="w-full h-1.5 accent-[#047857]" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Annual P&amp;L</h3>
                    {[
                      { k: 'Gross rent',              v: `+£${(effectiveRent * 12).toLocaleString()}`,                            col: 'text-[#047857]' },
                      { k: `Voids (${voidWks}wk)`,   v: `-£${Math.round(effectiveRent * voidWks / 4.33).toLocaleString()}`,       col: 'text-[#DC2626]' },
                      { k: `Mgmt (${mgmtFee}%)`,     v: `-£${Math.round(effectiveRent * 12 * mgmtFee / 100).toLocaleString()}`,   col: 'text-[#DC2626]' },
                      { k: 'Maintenance',             v: `-£${Math.round((price || 0) * maintenance / 100).toLocaleString()}`,    col: 'text-[#DC2626]' },
                      ...(serviceCharge > 0 ? [{ k: 'Service charge', v: `-£${serviceCharge.toLocaleString()}`, col: 'text-[#DC2626]' }] : []),
                      ...(groundRent    > 0 ? [{ k: 'Ground rent',    v: `-£${groundRent.toLocaleString()}`,    col: 'text-[#DC2626]' }] : []),
                    ].map(row => (
                      <div key={row.k} className="flex justify-between py-2.5 border-b border-[#F3F4F6] text-sm">
                        <span className="text-[#475569]">{row.k}</span>
                        <span className={`font-semibold ${row.col}`}>{row.v}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-4 items-baseline">
                      <span className="text-sm font-bold text-[#111827]">Net Income</span>
                      <span className="font-bold text-[#B7791F] text-2xl" style={{ fontFamily: SERIF, letterSpacing: '-0.03em' }}>
                        £{(netMonthly * 12).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mortgage modeller */}
                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Mortgage Cashflow Modeller</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-5">
                    {[
                      { label: `Deposit: £${deposit.toLocaleString()} (${price ? Math.round(deposit / price * 100) : 0}%)`, val: deposit,   set: setDeposit,   min: price * 0.2, max: price * 0.5, step: 5000 },
                      { label: `Rate: ${mortRate}% p.a.`,                                                                    val: mortRate,  set: setMortRate,  min: 3.0,          max: 9.0,          step: 0.1  },
                      { label: `Term: ${mortYears} years`,                                                                   val: mortYears, set: setMortYears, min: 5,            max: 35,           step: 5    },
                    ].map(f => (
                      <div key={f.label}>
                        <p className="text-xs text-[#6B7280] mb-2">{f.label}</p>
                        <input type="range" min={f.min} max={f.max} step={f.step} value={f.val}
                          onChange={e => f.set(Number(e.target.value))}
                          className="w-full h-1.5 accent-[#047857]" />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: 'LTV',        value: mort ? `${mort.ltv}%`                         : '—', color: 'text-[#111827]'  },
                      { label: 'Mortgage',   value: mort ? `£${mort.monthly.toLocaleString()}/mo` : '—', color: 'text-[#DC2626]'  },
                      { label: 'Net Income', value: `£${netMonthly.toLocaleString()}/mo`,                color: 'text-[#047857]'  },
                      { label: 'Cashflow',   value: `£${cashflow.toLocaleString()}/mo`,                  color: cashflow >= 0 ? 'text-[#047857]' : 'text-[#DC2626]' },
                    ].map(kpi => (
                      <div key={kpi.label} className="bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl p-4">
                        <p className="text-[10px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-1.5">{kpi.label}</p>
                        <p className={`font-bold text-lg ${kpi.color}`} style={{ fontFamily: SERIF, letterSpacing: '-0.02em' }}>{kpi.value}</p>
                      </div>
                    ))}
                  </div>
                  {price && (
                    <p className="text-xs text-[#6B7280] mt-4">
                      SDLT (additional property): <strong className="text-[#374151]">£{sdlt.toLocaleString()}</strong>
                    </p>
                  )}
                </div>

                {/* Section 24 Tax Calculator */}
                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">Section 24 Tax Calculator</h3>
                    <button
                      onClick={() => setShowSection24(v => !v)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors ${
                        showSection24
                          ? 'bg-[#047857] border-[#047857] text-white'
                          : 'bg-white border-[#E7E5DD] text-[#374151] hover:bg-[#F6F3EC]'
                      }`}>
                      {showSection24 ? 'Hide' : 'Calculate'}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#9CA3AF] mb-4">
                    Estimate your after-tax cash income under Section 24 mortgage interest relief rules (2026/27 thresholds).
                  </p>

                  {showSection24 && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                        <div>
                          <label className="text-xs text-[#6B7280] mb-1.5 block">Other annual income (employment/pension) £</label>
                          <input
                            type="number"
                            value={otherAnnualIncome || ''}
                            onChange={e => setOtherAnnualIncome(Number(e.target.value))}
                            placeholder="e.g. 35000"
                            className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-4 py-3 text-[#111827] text-sm outline-none focus:border-[#047857] focus:ring-2 focus:ring-[#047857]/10"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[#6B7280] mb-1.5 block">Annual mortgage interest £</label>
                          <input
                            type="number"
                            value={annualMortgageInterest || ''}
                            onChange={e => setAnnualMortgageInterest(Number(e.target.value))}
                            placeholder={mort ? `e.g. ${Math.round(mort.monthly * 12 * mortRate / 100 / 12 * 100) / 100}` : 'e.g. 8400'}
                            className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-4 py-3 text-[#111827] text-sm outline-none focus:border-[#047857] focus:ring-2 focus:ring-[#047857]/10"
                          />
                        </div>
                      </div>

                      {s24 && (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                            <div className="bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl p-4">
                              <p className="text-[10px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-0.5">Taxable Rental Profit</p>
                              <p className="text-[10px] text-[#9CA3AF] mb-1.5">Before mortgage interest relief</p>
                              <p className="font-bold text-lg text-[#111827]" style={{ fontFamily: SERIF, letterSpacing: '-0.02em' }}>
                                £{s24.taxableRentalProfit.toLocaleString()}
                              </p>
                            </div>
                            <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl p-4">
                              <p className="text-[10px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-0.5">Tax Paid on Rent</p>
                              <p className="text-[10px] text-[#9CA3AF] mb-0.5">After Section 24 credit</p>
                              <p className="text-[10px] text-[#9CA3AF] mb-1.5">{s24.taxBand === 'higher' ? 'Higher rate taxpayer' : s24.taxBand === 'additional' ? 'Additional rate taxpayer' : 'Basic rate taxpayer'}</p>
                              <p className="font-bold text-lg text-[#DC2626]" style={{ fontFamily: SERIF, letterSpacing: '-0.02em' }}>
                                £{s24.taxOnRent.toLocaleString()}
                              </p>
                            </div>
                            <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-4">
                              <p className="text-[10px] uppercase tracking-[0.08em] text-[#9CA3AF] mb-0.5">After-Tax Cash Income</p>
                              <p className="text-[10px] text-[#9CA3AF] mb-1.5">After costs, interest &amp; tax</p>
                              <p className={`font-bold text-lg ${s24.afterTaxCashIncome >= 0 ? 'text-[#047857]' : 'text-[#DC2626]'}`} style={{ fontFamily: SERIF, letterSpacing: '-0.02em' }}>
                                £{s24.afterTaxCashIncome.toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <p className="text-[11px] text-[#9CA3AF]">
                            Taxable rental profit excludes mortgage interest under Section 24 — only a 20% tax credit applies regardless of your rate. Figures use 2026/27 UK income tax thresholds. Consult a tax adviser for personalised guidance.
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* HISTORY TAB                                                     */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {tab === 'history' && (
              <div className="space-y-5">
                {transactions && transactions.length > 0 ? (
                  <>
                    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Price History — Land Registry</h3>
                      {transactions.length >= 2 && (
                        <div className="mb-5 bg-[#FAF9F5] rounded-xl p-4">
                          <LineChart
                            series={[{ name: 'Sale price', data: transactions.slice().reverse().map(t => Number(t.price ?? 0)), color: '#047857' }]}
                            labels={transactions.slice().reverse().map(t => String(t.date ?? '').slice(0, 7))}
                            height={100}
                          />
                        </div>
                      )}
                      <div>
                        {transactions.map((t, i) => (
                          <div key={i} className="flex items-center justify-between py-3.5 border-b border-[#F3F4F6] last:border-0">
                            <span className="text-sm text-[#475569]">{String(t.date ?? '')}</span>
                            <span className="font-bold text-xl text-[#111827]" style={{ fontFamily: SERIF, letterSpacing: '-0.02em' }}>
                              £{Number(t.price ?? 0).toLocaleString()}
                            </span>
                            <span className="text-xs text-[#9CA3AF]">{String(t.transaction_type ?? '')}</span>
                            {i < transactions.length - 1 && (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${
                                Number(t.price ?? 0) > Number(transactions[i + 1].price ?? 0)
                                  ? 'bg-[#ECFDF5] text-[#047857]'
                                  : 'bg-[#FEF2F2] text-[#DC2626]'
                              }`}>
                                {Number(t.price ?? 0) > Number(transactions[i + 1].price ?? 0) ? '↑' : '↓'}
                                {Math.abs(Math.round((Number(t.price ?? 0) / Number(transactions[i + 1].price ?? 1) - 1) * 100))}%
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[#F6F3EC] border border-[#E7E5DD] rounded-xl px-5 py-3">
                      <p className="text-xs text-[#6B7280]">
                        Transaction data provided by HM Land Registry via Homedata API. Includes all registered sales at market value. Data updated monthly.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                    <p className="text-4xl mb-3">📋</p>
                    <p className="font-semibold text-[#111827] mb-2">No transactions on record yet</p>
                    <p className="text-sm text-[#6B7280]">This property may be newly built or not yet registered with HM Land Registry.</p>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* RISKS TAB                                                       */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {tab === 'risks' && (
              <div className="space-y-5">
                <div className={`bg-white rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)] border ${
                  epcKnown && !epcCompliant ? 'border-[#FCA5A5]' : epcKnown ? 'border-[#A7F3D0]' : 'border-[#E7E5DD]'
                }`}>
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">EPC Compliance</h3>
                  <div className="flex items-start gap-5">
                    <div className={`text-6xl font-bold leading-none ${epcColor}`} style={{ fontFamily: SERIF }}>
                      {epcKnown ? epcRating : '?'}
                    </div>
                    <div>
                      <p className={`text-base font-semibold mb-1 ${!epcKnown ? 'text-[#9CA3AF]' : epcCompliant ? 'text-[#047857]' : 'text-[#B7791F]'}`}>
                        {!epcKnown
                          ? 'EPC not assessed — contact local authority'
                          : epcCompliant
                          ? '✓ Compliant with proposed 2028 EPC-C rules'
                          : '⚠ At risk — upgrade required before 2028'}
                      </p>
                      {epcKnown && <p className="text-sm text-[#6B7280]">Score: {String(epc?.current_energy_efficiency ?? '?')}/100 · Potential: {String(epc?.potential_energy_efficiency ?? '?')}/100</p>}
                      {epcKnown && <p className="text-sm text-[#6B7280]">Cert date: {String(epc?.last_epc_date ?? epc?.inspection_date ?? 'Unknown')}</p>}
                      {epc?.source === 'epc_open_data' && <p className="text-xs text-[#9CA3AF] mt-0.5">Source: EPC Open Data Register</p>}
                      {epcKnown && !epcCompliant && (
                        <p className="text-sm text-[#DC2626] mt-1 font-medium">Estimated upgrade cost: £4,000–£12,000 depending on works needed</p>
                      )}
                    </div>
                  </div>
                </div>

                {risks && risks.length > 0 && (
                  <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Environmental Risks — Homedata</h3>
                    {risks.map((r, i) => {
                      const score    = Number(r.score ?? 0)
                      const label    = String(r.label ?? '')
                      const riskType = String(r.risk_type ?? '').replace(/_/g, ' ')
                      const badgeCls = score <= 1
                        ? 'bg-[#ECFDF5] text-[#047857]'
                        : score <= 2
                        ? 'bg-[#FFF7E6] text-[#B7791F]'
                        : 'bg-[#FEF2F2] text-[#DC2626]'
                      return (
                        <div key={i} className="flex justify-between items-center py-3 border-b border-[#F3F4F6] last:border-0">
                          <span className="text-sm text-[#475569] capitalize">{riskType}</span>
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${badgeCls}`}>{label}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Investment Risk Factors</h3>
                  <div className="space-y-3">
                    {[
                      { risk: 'Rental void risk',    note: `${voidWks} weeks/yr = £${Math.round(effectiveRent * voidWks / 4.33).toLocaleString()} lost income`, severity: voidWks > 4 ? 'high' : 'med' },
                      { risk: 'Capital growth risk', note: `${cityName} 1yr: ${capitalGrowth > 0 ? '+' : ''}${capitalGrowth}% vs national avg +${MARKET_DATA.macro.hpiGrowthForecast}%`, severity: capitalGrowth < 2 ? 'high' : 'low' },
                      { risk: 'EPC compliance',      note: !epcKnown ? 'EPC not assessed — verify with EPC register' : epcCompliant ? 'Compliant — no action needed' : `Rating ${epcRating} — works needed before 2028`, severity: !epcKnown ? 'med' : epcCompliant ? 'low' : 'high' },
                      { risk: 'Leasehold risk',      note: p?.tenure === 'Leasehold' ? 'Leasehold — check years remaining and extension cost' : 'Freehold — no leasehold risk', severity: p?.tenure === 'Leasehold' ? 'med' : 'low' },
                      { risk: 'Interest rate risk',  note: `At ${mortRate}% BTL rate — stress test at +2% (${(mortRate + 2).toFixed(1)}%)`, severity: 'med' },
                    ].map(r => (
                      <div key={r.risk} className={`flex gap-4 p-4 rounded-xl border ${
                        r.severity === 'high' ? 'bg-[#FEF2F2] border-[#FCA5A5]' :
                        r.severity === 'med'  ? 'bg-[#FFF7E6] border-[#F5D48A]' :
                                                'bg-[#ECFDF5] border-[#A7F3D0]'
                      }`}>
                        <span className="text-lg shrink-0">{r.severity === 'high' ? '🔴' : r.severity === 'med' ? '🟡' : '🟢'}</span>
                        <div>
                          <p className="text-sm font-semibold text-[#111827]">{r.risk}</p>
                          <p className="text-xs text-[#475569] mt-0.5">{r.note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* MARKET COMPARISON TAB                                           */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {tab === 'market' && (
              <LightCityMarketPanel
                cityName={cityName}
                cityData={cityData as Record<string, number>}
                propertyPrice={price}
                estimatedCurrentValue={estimatedCurrentValue}
                propertyGrossYield={grossYield}
                propertyNetYield={netYield}
                propertyRent={effectiveRent}
                propertyBeds={propertyBeds}
                fullWidth
              />
            )}

          </div>
        </div>
      </div>

      <style>{`
        @keyframes shimmer-light {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .skeleton-light {
          background: linear-gradient(90deg, #F3F4F6 25%, #E9EAEC 50%, #F3F4F6 75%);
          background-size: 200% 100%;
          animation: shimmer-light 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}

// ── Light-themed Market Comparison Panel ─────────────────────────────────────
function LightCityMarketPanel({
  cityName, cityData, propertyPrice, estimatedCurrentValue,
  propertyGrossYield, propertyNetYield, propertyRent, propertyBeds, fullWidth
}: {
  cityName: string
  cityData: Record<string, number>
  propertyPrice: number
  estimatedCurrentValue: number
  propertyGrossYield: number
  propertyNetYield: number
  propertyRent: number
  propertyBeds: number
  fullWidth?: boolean
}) {
  const [selectedCity, setSelectedCity] = useState(cityName)
  const bedKey        = (n: number) => n === 0 ? 'studio' : `${n}bed`
  const defaultBedKey = bedKey(propertyBeds)
  const [selectedBed, setSelectedBed] = useState(defaultBedKey)

  const cities      = Object.keys(MARKET_DATA.cities)
  const cityAvg     = MARKET_DATA.cities[selectedCity as keyof typeof MARKET_DATA.cities] || cityData
  const bedroomData = (MARKET_DATA.cityByBedroom as Record<string, Record<string, { avgPrice: number; avgRent: number; avgYield: number }>>)[selectedCity]?.[selectedBed]

  const compAvgPrice = bedroomData?.avgPrice ?? cityAvg.avgPrice
  const compAvgRent  = bedroomData?.avgRent  ?? cityAvg.avgRent
  const compAvgYield = bedroomData?.avgYield ?? cityAvg.avgYield
  const displayPrice = estimatedCurrentValue || propertyPrice

  const BEDS = [
    { key: 'studio', label: 'Studio' },
    { key: '1bed',   label: '1 Bed'  },
    { key: '2bed',   label: '2 Bed'  },
    { key: '3bed',   label: '3 Bed'  },
    { key: '4bed',   label: '4 Bed'  },
  ]

  const fmt = (v: number) => v ? `£${v.toLocaleString()}` : '—'
  const pct = (v: number) => v ? `${v.toFixed(1)}%` : '—'

  const rows = [
    { label: 'Estimated Value', sub: estimatedCurrentValue ? '(est.)' : '(last sold)', prop: fmt(displayPrice),       city: fmt(compAvgPrice),  propRaw: 0,                  cityRaw: 0 },
    { label: 'Gross Yield',     sub: undefined,                                          prop: pct(propertyGrossYield), city: pct(compAvgYield),  propRaw: propertyGrossYield, cityRaw: compAvgYield },
    { label: 'Net Yield',       sub: undefined,                                          prop: pct(propertyNetYield),   city: '—',                propRaw: 0,                  cityRaw: 0 },
    { label: 'Monthly Rent',    sub: undefined,                                          prop: propertyRent ? fmt(propertyRent) : 'Set rent', city: fmt(compAvgRent), propRaw: 0, cityRaw: 0 },
    { label: '1yr Growth',      sub: undefined,                                          prop: `${cityAvg.capitalGrowth1yr > 0 ? '+' : ''}${cityAvg.capitalGrowth1yr}%`, city: `${cityAvg.capitalGrowth1yr > 0 ? '+' : ''}${cityAvg.capitalGrowth1yr}%`, propRaw: 0, cityRaw: 0 },
    { label: '5yr Growth',      sub: undefined,                                          prop: `+${cityAvg.capitalGrowth5yr}%`, city: `+${cityAvg.capitalGrowth5yr}%`, propRaw: 0, cityRaw: 0 },
  ]

  return (
    <div className={`bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_10px_30px_rgba(17,24,39,0.04)] h-full ${fullWidth ? '' : ''}`}>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">Market Comparison</h3>
        <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)}
          className="bg-[#FAF9F5] border border-[#E7E5DD] text-[#374151] text-xs font-medium rounded-xl px-3 py-1.5 outline-none focus:border-[#047857] cursor-pointer">
          {cities.map(c => (
            <option key={c} value={c}>{c}{c === cityName ? ' ★' : ''}</option>
          ))}
        </select>
      </div>

      {cityName && (
        <p className="text-[11px] text-[#9CA3AF] mb-4">
          {BEDS.find(b => b.key === selectedBed)?.label} market · {selectedCity}
          {selectedCity !== cityName && ` (your property is in ${cityName})`}
        </p>
      )}

      <div className="flex gap-1.5 mb-4 flex-wrap items-center">
        {BEDS.map(b => (
          <button key={b.key} onClick={() => setSelectedBed(b.key)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all border ${
              selectedBed === b.key
                ? 'bg-[#047857] border-[#047857] text-white'
                : 'bg-white border-[#E7E5DD] text-[#6B7280] hover:border-[#047857] hover:text-[#047857]'
            }`}>
            {b.label}
            {b.key === defaultBedKey && <span className="ml-1 text-[9px] opacity-60">★</span>}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[#9CA3AF]">★ matches property</span>
      </div>

      {selectedCity !== cityName && (
        <div className="mb-4 px-3 py-2 bg-[#FFF7E6] border border-[#F5D48A] rounded-xl">
          <p className="text-[11px] text-[#B7791F] font-medium">Comparing {cityName} property vs {selectedCity} market</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[#E7E5DD]">
        <div className="grid grid-cols-3 bg-[#FAF9F5] px-4 py-2.5 border-b border-[#E7E5DD]">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9CA3AF]">Metric</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#047857] text-center">This Property</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9CA3AF] text-right">
            {BEDS.find(b => b.key === selectedBed)?.label} · {selectedCity}
          </span>
        </div>
        {rows.map((row, i) => (
          <div key={row.label} className={`grid grid-cols-3 px-4 py-3.5 border-b border-[#F3F4F6] last:border-0 ${i % 2 !== 0 ? 'bg-[#FAFAF8]' : ''}`}>
            <div>
              <span className="text-sm text-[#475569]">{row.label}</span>
              {row.sub && <span className="text-[10px] text-[#9CA3AF] ml-1">{row.sub}</span>}
            </div>
            <div className="text-center">
              <span className="text-sm font-semibold text-[#047857]">{row.prop}</span>
              {row.propRaw > 0 && row.cityRaw > 0 && (
                <span className={`text-[10px] ml-1.5 font-mono ${row.propRaw > row.cityRaw ? 'text-[#047857]' : 'text-[#DC2626]'}`}>
                  {row.propRaw > row.cityRaw ? '+' : ''}{(row.propRaw - row.cityRaw).toFixed(1)}
                </span>
              )}
            </div>
            <span className="text-sm text-[#374151] text-right">{row.city}</span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-[#9CA3AF] mt-3">
        {bedroomData
          ? `${BEDS.find(b => b.key === selectedBed)?.label} avg for ${selectedCity} · Zoopla 2026 · REalyse`
          : `City-wide avg for ${selectedCity} · ONS HPI · Zoopla April 2026`}
      </p>
    </div>
  )
}

function defaultServiceCharge(p: Record<string, unknown>): number {
  const type = String(p?.property_type ?? '').toLowerCase()
  return type.includes('flat') || type.includes('apartment') ? 2000 : 0
}
