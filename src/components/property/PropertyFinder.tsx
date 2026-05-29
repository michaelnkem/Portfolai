'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'

// ── Types ─────────────────────────────────────────────────────────────────────

type FinderTab = 'ai' | 'custom' | 'saved'
type SortBy = 'matchScore' | 'grossYield' | 'estimatedValue' | 'epc'
type TenureFilter = 'any' | 'freehold' | 'leasehold'
type EpcFilter = 'any' | 'a-c' | 'a-d' | 'exclude-e-f-g'

interface PropertyFinderResult {
  uprn: string | null
  address: string
  postcode: string
  property_type: string | null
  city: string | null
  area: string | null
  bedrooms: number | null
  estimatedValue: number | null
  grossYield: number | null
  netYield: number | null
  epcRating: string | null
  matchScore: number
  matchLabel: string
  matchReasons: string[]
}

interface BenchmarkProfile {
  propertyTypes: string[]
  minBedrooms: number
  maxBedrooms: number
  avgGrossYield: number
  avgValue: number
  minValue: number
  maxValue: number
  cities: string[]
}

interface PropertyFinderCriteria {
  targetGrossYield: number
  minValue: number
  maxValue: number
  propertyTypes: string[]
  minBedrooms: number
  maxBedrooms: number
  epcPreference: EpcFilter
  tenure: TenureFilter
}

interface FavBenchmarkItem {
  id: string
  label: string
  outcode: string
  grossYield: number
  propertyType: string
  bedrooms: number
  estimatedValue: number
  city: string
}

export interface PropertyFinderProps {
  favouriteItems: Array<Record<string, unknown>>
  favourites: Set<string>
  onToggleFavourite: (uprn: string) => void
  onAddToPortfolio: (data: Record<string, unknown>) => void
  onOpenAnalysis: (data: Record<string, unknown>) => void
  onGoToDiscover: () => void
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function extractFavBenchmarks(items: Array<Record<string, unknown>>): FavBenchmarkItem[] {
  return items.map(item => {
    const p = item.property as Record<string, unknown>
    const e = item.enriched as Record<string, unknown>
    const uprn = String(p?.uprn ?? '')
    const address = String(p?.full_address || p?.address || 'Unknown')
    const postcode = String(p?.postcode ?? '')
    const outcode = postcode.split(' ')[0] ?? ''
    const city = String(item.cityName ?? '')
    const propertyType = String(p?.property_type ?? '')
    const bedrooms = Number(e?.attrBedrooms || p?.bedrooms || 0)
    const estimatedValue = Number(e?.estimatedCurrentValue || p?.last_sold_price || 0)
    const grossYield = Number(e?.grossYield || 0)
    const shortAddr = address.split(',')[0] ?? address
    return {
      id: uprn || `fav-${address}`,
      label: `${shortAddr} · ${outcode}`,
      outcode, grossYield, propertyType, bedrooms, estimatedValue, city,
    }
  })
}

function deriveBenchmarkProfile(
  benchmarks: FavBenchmarkItem[],
  selected: string[],
): BenchmarkProfile | null {
  const active = benchmarks.filter(b => selected.includes(b.id))
  if (!active.length) return null

  const types = Array.from(new Set(active.map(b => b.propertyType).filter(Boolean)))
  const beds = active.map(b => b.bedrooms).filter(b => b > 0)
  const yields = active.map(b => b.grossYield).filter(y => y > 0)
  const values = active.map(b => b.estimatedValue).filter(v => v > 0)
  const cities = Array.from(new Set(active.map(b => b.city).filter(Boolean)))

  return {
    propertyTypes: types,
    minBedrooms: Math.max(1, (beds.length ? Math.min(...beds) : 1) - 1),
    maxBedrooms: (beds.length ? Math.max(...beds) : 5) + 1,
    avgGrossYield: yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : 5,
    avgValue: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 300000,
    minValue: values.length ? Math.min(...values) * 0.5 : 80000,
    maxValue: values.length ? Math.max(...values) * 1.5 : 900000,
    cities,
  }
}

function scoreCandidate(
  c: PropertyFinderResult,
  benchmark: BenchmarkProfile | null,
  criteria: PropertyFinderCriteria,
): { score: number; label: string; reasons: string[] } {
  const reasons: string[] = []
  if (!benchmark) return { score: 55, label: 'Fair', reasons: [] }

  let score = 0

  // Type match — 15 pts
  const typeMatch = !benchmark.propertyTypes.length ||
    (c.property_type != null &&
      benchmark.propertyTypes.some(t => t.toLowerCase() === c.property_type!.toLowerCase()))
  if (typeMatch) { score += 15; reasons.push('Similar profile') } else score += 5

  // Bedrooms — 15 pts
  if (c.bedrooms != null) {
    if (c.bedrooms >= benchmark.minBedrooms && c.bedrooms <= benchmark.maxBedrooms) score += 15
    else if (Math.abs(c.bedrooms - Math.round((benchmark.minBedrooms + benchmark.maxBedrooms) / 2)) <= 1) score += 8
  } else score += 5

  // Gross yield — 20 pts
  if (c.grossYield != null) {
    if (c.grossYield >= benchmark.avgGrossYield + 1.0) { score += 20; reasons.push('Better yield') }
    else if (c.grossYield >= benchmark.avgGrossYield + 0.2) { score += 15; reasons.push('Better yield') }
    else if (c.grossYield >= benchmark.avgGrossYield - 0.5) score += 12
    else score += 5
  } else score += 8

  // Value fit — 15 pts
  if (c.estimatedValue != null) {
    if (c.estimatedValue >= benchmark.minValue && c.estimatedValue <= benchmark.maxValue) score += 15
    else if (c.estimatedValue < benchmark.minValue) { score += 12; reasons.push('Lower entry cost') }
    else score += 4
  } else score += 8

  // EPC — 10 pts
  if (c.epcRating != null) {
    if (c.epcRating <= 'C') { score += 10; reasons.push('EPC compliant') }
    else if (c.epcRating <= 'D') score += 6
    else score += 2
  } else score += 4

  // ROI proxy via gross yield — 15 pts
  if (c.grossYield != null) {
    const benchROI = benchmark.avgGrossYield - 1.2 + 2.5
    const roi = c.grossYield - 1.2 + 2.5
    if (roi >= benchROI + 1.5) { score += 15; reasons.push('Strong ROI') }
    else if (roi >= benchROI) score += 10
    else score += 5
  } else score += 7

  // City match from criteria — 10 pts (partial if not filtering by city)
  score += 5

  // Criteria filters penalty
  if (criteria.propertyTypes.length && c.property_type &&
    !criteria.propertyTypes.includes(c.property_type)) score = Math.max(0, score - 10)

  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const label = clamped >= 90 ? 'Excellent' : clamped >= 80 ? 'Very good' : clamped >= 70 ? 'Good' : 'Fair'
  return { score: clamped, label, reasons: Array.from(new Set(reasons)) }
}

function applyEpcFilter(epc: string | null, pref: EpcFilter): boolean {
  if (pref === 'any' || epc === null) return true
  if (pref === 'a-c') return epc <= 'C'
  if (pref === 'a-d') return epc <= 'D'
  if (pref === 'exclude-e-f-g') return epc <= 'D'
  return true
}

function reasonBox(result: PropertyFinderResult, benchmarkCities: string[]): {
  bg: string; border: string; textColor: string; icon: string; message: string
} {
  const isCrossCity = result.city ? !benchmarkCities.includes(result.city) : false
  if (result.matchReasons.includes('Strong ROI') && result.grossYield != null) {
    return { bg: 'bg-[#FFF7E6]', border: 'border-[#F5D48A]', textColor: 'text-[#B7791F]', icon: '✦',
      message: `${result.grossYield.toFixed(1)}% gross yield — strong capital efficiency` }
  }
  if (isCrossCity && result.matchReasons.includes('Better yield') && result.grossYield != null) {
    return { bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]', textColor: 'text-[#1D4ED8]', icon: '↗',
      message: `Cross-city · ${result.grossYield.toFixed(1)}% yield in ${result.city ?? ''} vs benchmark` }
  }
  if (isCrossCity) {
    return { bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]', textColor: 'text-[#1D4ED8]', icon: '↗',
      message: `Cross-city opportunity${result.city ? ` · ${result.city}` : ''}` }
  }
  return { bg: 'bg-[#ECFDF5]', border: 'border-[#A7F3D0]', textColor: 'text-[#047857]', icon: '✓',
    message: 'Similar profile to your favourited properties' }
}

function fmtVal(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—'
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`
  return `£${Math.round(n / 1000)}k`
}

function mapSuggestionToResult(s: Record<string, unknown>): PropertyFinderResult {
  const enriched = (s.enriched ?? null) as Record<string, unknown> | null
  const property = (s.property ?? null) as Record<string, unknown> | null
  const epcData = (s.epc ?? null) as Record<string, unknown> | null

  const uprn = String(s.uprn ?? property?.uprn ?? '') || null
  const address = String(s.address ?? property?.full_address ?? property?.address ?? 'Unknown address')
  const postcode = String(s.postcode ?? property?.postcode ?? '')
  const property_type = String(s.property_type ?? property?.property_type ?? '') || null
  const city = String(s.city ?? s.cityName ?? '') || null
  const area = String(s.area ?? '') || null

  const bedroomsRaw = Number(s.bedrooms ?? property?.bedrooms ?? enriched?.attrBedrooms ?? 0)
  const bedrooms = bedroomsRaw > 0 ? bedroomsRaw : null
  const estimatedValueRaw = Number(enriched?.estimatedCurrentValue ?? s.estimatedValue ?? 0)
  const estimatedValue = estimatedValueRaw > 0 ? estimatedValueRaw : null
  const grossYieldRaw = Number(enriched?.grossYield ?? s.grossYield ?? 0)
  const grossYield = grossYieldRaw > 0 ? grossYieldRaw : null
  const netYieldRaw = Number(enriched?.netYield ?? s.netYield ?? 0)
  const netYield = netYieldRaw > 0 ? netYieldRaw : null

  const epcRaw = String(
    epcData?.current_energy_rating ?? enriched?.epcRating ?? s.epcRating ?? ''
  ).toUpperCase().match(/[A-G]/)?.[0] ?? null

  return {
    uprn, address, postcode, property_type, city, area, bedrooms,
    estimatedValue, grossYield, netYield, epcRating: epcRaw,
    matchScore: 0, matchLabel: 'Fair', matchReasons: [],
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

// ── MatchScoreBadge ───────────────────────────────────────────────────────────

function MatchScoreBadge({ score, label }: { score: number; label: string }) {
  const bg =
    score >= 90 ? 'bg-[#047857] text-white' :
    score >= 80 ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' :
    'bg-[#F3F4F6] text-[#374151]'
  return (
    <span className={`inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-full ${bg}`}>
      {score}% · {label}
    </span>
  )
}

// ── ResultCard ────────────────────────────────────────────────────────────────

function ResultCard({
  result,
  isFav,
  benchmarkCities,
  isOpening,
  openError,
  onToggleFav,
  onOpen,
}: {
  result: PropertyFinderResult
  isFav: boolean
  benchmarkCities: string[]
  isOpening: boolean
  openError: string | null
  onToggleFav: () => void
  onOpen: () => void
}) {
  const box = reasonBox(result, benchmarkCities)
  const isCrossCity = result.city ? !benchmarkCities.includes(result.city) : false
  const cityPillColor = isCrossCity
    ? 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]'
    : 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
  const epcColor =
    !result.epcRating ? 'text-[#9CA3AF]' :
    result.epcRating <= 'C' ? 'text-[#047857]' :
    result.epcRating <= 'D' ? 'text-[#B7791F]' : 'text-[#DC2626]'
  const cityLabel = [result.city, result.postcode ? result.postcode.split(' ')[0] : null].filter(Boolean).join(' · ')

  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] flex flex-col overflow-hidden hover:border-[#A7F3D0] transition-all">
      <div className="relative h-[120px] bg-gradient-to-br from-[#ECFDF5] to-[#F6F3EC] flex items-center justify-center">
        <span className="text-5xl opacity-30">🏠</span>
        {cityLabel && (
          <div className="absolute top-3 left-3">
            <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cityPillColor}`}>
              {cityLabel}
            </span>
          </div>
        )}
        <div className="absolute top-3 right-10">
          <MatchScoreBadge score={result.matchScore} label={result.matchLabel} />
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggleFav() }}
          aria-label={isFav ? 'Remove' : 'Save'}
          className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 hover:bg-white border border-[#E7E5DD] text-base transition-colors">
          <span className={isFav ? 'text-[#B7791F]' : 'text-[#D1D5DB]'}>{isFav ? '★' : '☆'}</span>
        </button>
      </div>

      <div className="p-4 flex flex-col flex-1">
        <div className="mb-3">
          <p className="text-sm font-semibold text-[#111827] leading-snug mb-0.5" style={{ fontFamily: SERIF }}>
            {result.address}
          </p>
          <p className="text-xs text-[#6B7280]">
            {[result.area, result.city, result.postcode].filter(Boolean).join(' · ')}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {result.property_type && (
              <span className="text-[11px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{result.property_type}</span>
            )}
            {result.bedrooms != null ? (
              <span className="text-[11px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{result.bedrooms} bed</span>
            ) : (
              <span className="text-[11px] bg-[#F6F3EC] text-[#9CA3AF] px-2 py-0.5 rounded-full">Beds not recorded</span>
            )}
            {result.epcRating != null ? (
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                result.epcRating <= 'C' ? 'bg-[#ECFDF5]' :
                result.epcRating <= 'D' ? 'bg-[#FFF7E6]' : 'bg-[#FEF2F2]'
              } ${epcColor}`}>EPC {result.epcRating}</span>
            ) : (
              <span className="text-[11px] bg-[#F3F4F6] text-[#9CA3AF] px-2 py-0.5 rounded-full">EPC unknown</span>
            )}
          </div>
        </div>

        {result.matchReasons.length > 0 && (
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {result.matchReasons.map(r => (
              <span key={r} className="text-[10px] font-semibold bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] px-2 py-0.5 rounded-full">{r}</span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: 'Est. Value', value: fmtVal(result.estimatedValue), hi: false },
            { label: 'Gross Yield', value: result.grossYield != null ? `${result.grossYield.toFixed(1)}%` : '—', hi: result.grossYield != null && result.grossYield >= 7 },
            { label: 'Net Yield', value: result.netYield != null ? `${result.netYield.toFixed(1)}%` : '—', hi: false },
          ].map(kpi => (
            <div key={kpi.label} className="bg-[#FAF9F5] border border-[#F3F4F6] rounded-xl p-2.5 text-center">
              <p className="text-[9px] uppercase tracking-[0.06em] text-[#9CA3AF] mb-0.5">{kpi.label}</p>
              <p className={`font-bold text-sm ${kpi.hi ? 'text-[#047857]' : 'text-[#111827]'}`} style={{ fontFamily: SERIF }}>{kpi.value}</p>
            </div>
          ))}
        </div>

        <div className={`rounded-xl px-3 py-2.5 border text-xs mb-3 ${box.bg} ${box.border}`}>
          <span className={`font-semibold ${box.textColor}`}>{box.icon} {box.message}</span>
        </div>

        {openError && (
          <p className="text-[11px] text-[#DC2626] mb-2 leading-snug">{openError}</p>
        )}
        {!result.uprn && !openError && (
          <p className="text-[10px] text-[#9CA3AF] mb-2">UPRN not yet resolved — analysis may require an extra search step</p>
        )}

        <button
          type="button"
          onClick={onOpen}
          disabled={isOpening}
          className="mt-auto w-full bg-[#047857] text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-[#065F46] transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {isOpening ? <><Spinner /> Loading analysis…</> : 'Open Analysis →'}
        </button>
      </div>
    </div>
  )
}

// ── Area search box (shared between tabs) ─────────────────────────────────────

function AreaSearchBox({
  value,
  onChange,
  loading,
  error,
}: {
  value: string
  onChange: (v: string) => void
  loading: boolean
  error: string | null
}) {
  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Search an area</h3>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Type a postcode, area or city (e.g. M4, NG7, Ancoats, Manchester)"
          className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-4 py-3 text-sm text-[#111827] placeholder-[#9CA3AF] outline-none focus:border-[#047857] pr-10"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner className="w-4 h-4" />
          </div>
        )}
      </div>
      {error && <p className="text-xs text-[#DC2626] mt-2">{error}</p>}
      <p className="text-[11px] text-[#9CA3AF] mt-2">
        Property Finder shows only real properties from Portfolai&apos;s live data sources.
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PropertyFinder({
  favouriteItems,
  onGoToDiscover,
  onOpenAnalysis,
}: PropertyFinderProps) {
  const [finderTab, setFinderTab] = useState<FinderTab>('ai')
  const [sortBy, setSortBy] = useState<SortBy>('matchScore')
  const [areaSearch, setAreaSearch] = useState('')
  const [rawCandidates, setRawCandidates] = useState<PropertyFinderResult[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [finderError, setFinderError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({})
  const [finderFavs, setFinderFavs] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ── Benchmark (derived from real favouriteItems) ───────────────────────────
  const favBenchmarks = useMemo(() => extractFavBenchmarks(favouriteItems), [favouriteItems])

  const [selectedBenchmarkIds, setSelectedBenchmarkIds] = useState<string[]>(() =>
    favouriteItems
      .map(item => String((item.property as Record<string, unknown>)?.uprn ?? ''))
      .filter(Boolean)
  )

  const benchmarkProfile = useMemo(
    () => deriveBenchmarkProfile(favBenchmarks, selectedBenchmarkIds),
    [favBenchmarks, selectedBenchmarkIds]
  )

  // ── Custom tab criteria ───────────────────────────────────────────────────
  const [customCriteria, setCustomCriteria] = useState<PropertyFinderCriteria>({
    targetGrossYield: 5.5,
    minValue: 100000,
    maxValue: 600000,
    propertyTypes: [],
    minBedrooms: 1,
    maxBedrooms: 5,
    epcPreference: 'any',
    tenure: 'any',
  })

  const aiCriteria: PropertyFinderCriteria = useMemo(() => ({
    targetGrossYield: benchmarkProfile?.avgGrossYield ?? 5.5,
    minValue: benchmarkProfile?.minValue ?? 80000,
    maxValue: benchmarkProfile?.maxValue ?? 900000,
    propertyTypes: benchmarkProfile?.propertyTypes ?? [],
    minBedrooms: benchmarkProfile?.minBedrooms ?? 1,
    maxBedrooms: benchmarkProfile?.maxBedrooms ?? 5,
    epcPreference: 'any',
    tenure: 'any',
  }), [benchmarkProfile])

  // ── Fetch real candidates from backend ────────────────────────────────────
  const fetchCandidates = useCallback(async (query: string) => {
    if (query.trim().length < 3) { setRawCandidates([]); return }
    setLoadingCandidates(true)
    setFinderError(null)
    try {
      const res = await fetch(`/api/property?q=${encodeURIComponent(query)}`)
      if (!res.ok) throw new Error(`Search failed: ${res.status}`)
      const data = await res.json()
      const suggestions = (data.suggestions ?? []) as Array<Record<string, unknown>>
      const results = suggestions.map(mapSuggestionToResult)
      if (process.env.NODE_ENV === 'development') {
        console.debug('[property-finder:data-source]', {
          query,
          resultCount: results.length,
          source: 'api',
          hasHardcodedCandidates: false,
          withUprn: results.filter(r => r.uprn).length,
        })
      }
      setRawCandidates(results)
    } catch (err) {
      console.error('[property-finder] search failed', err)
      setFinderError('Search failed. Please check your connection and try again.')
      setRawCandidates([])
    } finally {
      setLoadingCandidates(false)
    }
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (areaSearch.trim().length >= 3) {
      debounceRef.current = setTimeout(() => fetchCandidates(areaSearch), 400)
    } else {
      setRawCandidates([])
    }
    return () => clearTimeout(debounceRef.current)
  }, [areaSearch, fetchCandidates])

  // ── Canonical open-analysis flow ─────────────────────────────────────────
  const openVerifiedAnalysis = useCallback(async (result: PropertyFinderResult) => {
    const cardId = result.uprn ?? result.address
    setOpeningId(cardId)
    setOpenErrors(prev => { const n = { ...prev }; delete n[cardId]; return n })

    let uprn = result.uprn

    try {
      if (!uprn) {
        const searchQ = result.postcode || result.address
        try {
          const res = await fetch(`/api/property?q=${encodeURIComponent(searchQ)}`)
          if (res.ok) {
            const data = await res.json()
            const suggestions = (data.suggestions ?? []) as Array<Record<string, unknown>>
            const match = suggestions.find(s => String(s.uprn ?? '').length > 0)
            uprn = match ? String(match.uprn ?? '') || null : null
          }
        } catch {}
      }

      if (!uprn) {
        setOpenErrors(prev => ({
          ...prev,
          [cardId]: 'Unable to open analysis — property could not be matched to a verified UPRN. Try searching for it manually.',
        }))
        return
      }

      if (process.env.NODE_ENV === 'development') {
        console.debug('[property-finder:open-analysis]', { uprn, address: result.address, source: 'canonical-api' })
      }

      const res = await fetch(`/api/property?uprn=${encodeURIComponent(uprn)}`)
      if (!res.ok) throw new Error(`Property analysis request failed: ${res.status}`)
      const data = await res.json()
      if (!data?.property) throw new Error('Property analysis response missing property object')
      onOpenAnalysis(data)
    } catch (err) {
      console.error('[property-finder] open analysis failed', err)
      setOpenErrors(prev => ({
        ...prev,
        [cardId]: 'Unable to open analysis. Please try searching for this property manually.',
      }))
    } finally {
      setOpeningId(null)
    }
  }, [onOpenAnalysis])

  const toggleFinderFav = useCallback((id: string) => {
    setFinderFavs(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleBenchmark = useCallback((id: string) => {
    setSelectedBenchmarkIds(prev =>
      prev.includes(id)
        ? prev.length === 1 ? prev : prev.filter(i => i !== id)
        : [...prev, id]
    )
  }, [])

  // ── Score candidates against benchmark ────────────────────────────────────
  const scoredAiCandidates = useMemo<PropertyFinderResult[]>(() => {
    return rawCandidates.map(c => {
      const { score, label, reasons } = scoreCandidate(c, benchmarkProfile, aiCriteria)
      return { ...c, matchScore: score, matchLabel: label, matchReasons: reasons }
    })
  }, [rawCandidates, benchmarkProfile, aiCriteria])

  const scoredCustomCandidates = useMemo<PropertyFinderResult[]>(() => {
    return rawCandidates
      .filter(c => {
        if (c.grossYield != null && c.grossYield < customCriteria.targetGrossYield) return false
        if (c.estimatedValue != null &&
          (c.estimatedValue < customCriteria.minValue || c.estimatedValue > customCriteria.maxValue)) return false
        if (customCriteria.propertyTypes.length && c.property_type &&
          !customCriteria.propertyTypes.includes(c.property_type)) return false
        if (c.bedrooms != null &&
          (c.bedrooms < customCriteria.minBedrooms || c.bedrooms > customCriteria.maxBedrooms)) return false
        if (!applyEpcFilter(c.epcRating, customCriteria.epcPreference)) return false
        return true
      })
      .map(c => {
        const { score, label, reasons } = scoreCandidate(c, benchmarkProfile, customCriteria)
        return { ...c, matchScore: score, matchLabel: label, matchReasons: reasons }
      })
  }, [rawCandidates, customCriteria, benchmarkProfile])

  const activeResults = finderTab === 'ai' ? scoredAiCandidates : scoredCustomCandidates

  const sortedResults = useMemo(() => {
    const copy = [...activeResults]
    switch (sortBy) {
      case 'grossYield':    return copy.sort((a, b) => (b.grossYield ?? 0) - (a.grossYield ?? 0))
      case 'estimatedValue': return copy.sort((a, b) => (a.estimatedValue ?? Infinity) - (b.estimatedValue ?? Infinity))
      case 'epc':           return copy.sort((a, b) => (a.epcRating ?? 'Z').localeCompare(b.epcRating ?? 'Z'))
      default:              return copy.sort((a, b) => b.matchScore - a.matchScore)
    }
  }, [activeResults, sortBy])

  const citiesInResults = useMemo(
    () => Array.from(new Set(sortedResults.map(r => r.city).filter((c): c is string => c != null))).length,
    [sortedResults]
  )

  const benchmarkBest = useMemo(() =>
    favBenchmarks.filter(b => selectedBenchmarkIds.includes(b.id)).sort((a, b) => b.grossYield - a.grossYield)[0] ?? null,
    [favBenchmarks, selectedBenchmarkIds]
  )

  const bestCrossCity = useMemo(() => {
    if (!benchmarkProfile?.cities.length) return null
    return [...scoredAiCandidates]
      .filter(r => r.city && !benchmarkProfile.cities.includes(r.city))
      .sort((a, b) => (b.grossYield ?? 0) - (a.grossYield ?? 0))[0] ?? null
  }, [scoredAiCandidates, benchmarkProfile])

  const hasSearched = areaSearch.trim().length >= 3
  const hasResults = sortedResults.length > 0

  // ── Empty / loading states ────────────────────────────────────────────────
  const emptySearch = (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <p className="text-4xl mb-3">🔍</p>
      <p className="font-semibold text-[#374151] mb-2">Search an area to find matching properties</p>
      <p className="text-sm text-[#6B7280] max-w-[420px] mx-auto">
        Property Finder only shows real properties returned by Portfolai&apos;s live data sources. Type a postcode, area name or city above.
      </p>
    </div>
  )

  const loadingState = (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <Spinner className="w-8 h-8 mx-auto mb-4" />
      <p className="text-sm text-[#6B7280]">Searching live properties…</p>
    </div>
  )

  const noResults = (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
      <p className="text-4xl mb-3">🔍</p>
      <p className="font-semibold text-[#374151] mb-2">No verified matching properties found</p>
      <p className="text-sm text-[#6B7280] max-w-[420px] mx-auto mb-4">
        Property Finder only shows real properties returned by Portfolai&apos;s live data sources. Try widening your filters or searching a different area.
      </p>
      <button type="button" onClick={() => setAreaSearch('')}
        className="text-sm font-semibold text-[#047857] border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-2 rounded-xl hover:bg-[#D1FAE5] transition-colors">
        Adjust search
      </button>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6">

      {/* Header */}
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#047857] mb-2">PROPERTY FINDER</p>
        <h1 className="text-[32px] font-bold text-[#111827] mb-2" style={{ fontFamily: SERIF, letterSpacing: '-0.02em' }}>
          Find your next investment
        </h1>
        <p className="text-sm text-[#6B7280]">
          Search real properties and score them against your investment benchmark
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-[#E7E5DD] mb-6">
        {([
          { id: 'ai',     label: 'AI recommendations' },
          { id: 'custom', label: 'Custom search'       },
          { id: 'saved',  label: 'Saved searches'      },
        ] as const).map(t => (
          <button key={t.id} type="button" onClick={() => setFinderTab(t.id)}
            className={`px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
              finderTab === t.id ? 'border-[#047857] text-[#047857]' : 'border-transparent text-[#6B7280] hover:text-[#374151]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════ AI RECOMMENDATIONS TAB ═══════════════════════ */}
      {finderTab === 'ai' && (
        <div className="space-y-5">

          {/* Benchmark panel */}
          <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">Matching based on your favourites</h3>
                <p className="text-xs text-[#9CA3AF] mt-0.5">Select which favourited properties influence your recommendations</p>
              </div>
              <button type="button" onClick={onGoToDiscover}
                className="text-xs font-semibold text-[#047857] border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1.5 rounded-xl hover:bg-[#D1FAE5] transition-colors">
                View all favourites →
              </button>
            </div>

            {favBenchmarks.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-3xl mb-3">☆</p>
                <p className="text-sm font-semibold text-[#374151] mb-1">Favourite properties to unlock AI recommendations</p>
                <p className="text-xs text-[#9CA3AF] mb-4 max-w-[360px] mx-auto">
                  Save properties you like and Portfolai will find similar or better opportunities.
                </p>
                <button type="button" onClick={onGoToDiscover}
                  className="bg-[#047857] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#065F46] transition-colors">
                  Go to Discover
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 flex-wrap mb-4">
                  {favBenchmarks.map(b => {
                    const isSelected = selectedBenchmarkIds.includes(b.id)
                    return (
                      <button key={b.id} type="button" onClick={() => toggleBenchmark(b.id)} aria-pressed={isSelected}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                          isSelected ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]' : 'bg-[#F6F3EC] border-[#E7E5DD] text-[#6B7280]'
                        }`}>
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-[#047857] border-[#047857]' : 'border-[#D1D5DB]'}`}>
                          {isSelected && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </span>
                        <span>{b.label}</span>
                        {b.grossYield > 0 && <span className="text-[#047857] font-semibold">{b.grossYield.toFixed(1)}%</span>}
                        {b.propertyType && <span className="text-[#9CA3AF]">· {b.propertyType}</span>}
                        {b.bedrooms > 0 && <span className="text-[#9CA3AF]">· {b.bedrooms} bed</span>}
                      </button>
                    )
                  })}
                </div>
                {benchmarkProfile && (
                  <div className="bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-4 py-3">
                    <p className="text-xs text-[#374151] leading-relaxed">
                      <span className="font-semibold text-[#047857]">🤖 AI matching:</span>{' '}
                      {benchmarkProfile.propertyTypes.length ? benchmarkProfile.propertyTypes.join(' or ') : 'any type'}{' '}
                      · {benchmarkProfile.minBedrooms}–{benchmarkProfile.maxBedrooms} beds{' '}
                      · yield ≥{(benchmarkProfile.avgGrossYield - 0.5).toFixed(1)}%{' '}
                      · {fmtVal(benchmarkProfile.minValue)}–{fmtVal(benchmarkProfile.maxValue)}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Search */}
          <AreaSearchBox
            value={areaSearch}
            onChange={setAreaSearch}
            loading={loadingCandidates}
            error={finderError}
          />

          {/* Comparison strip — only when we have real results and a benchmark */}
          {benchmarkBest && bestCrossCity && (
            <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr]">
                <div className="p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">Your benchmark</p>
                  <p className="text-sm font-semibold text-[#111827]" style={{ fontFamily: SERIF }}>
                    {benchmarkBest.outcode || benchmarkBest.city}
                  </p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {benchmarkBest.grossYield > 0 && <span className="text-[11px] text-[#6B7280]">{benchmarkBest.grossYield.toFixed(1)}% yield</span>}
                    {benchmarkBest.estimatedValue > 0 && <span className="text-[11px] text-[#6B7280]">{fmtVal(benchmarkBest.estimatedValue)}</span>}
                    {benchmarkBest.propertyType && <span className="text-[11px] text-[#6B7280]">{benchmarkBest.propertyType}</span>}
                    {benchmarkBest.bedrooms > 0 && <span className="text-[11px] text-[#6B7280]">{benchmarkBest.bedrooms} bed</span>}
                  </div>
                </div>
                <div className="hidden md:block w-px bg-[#E7E5DD]" />
                <div className="p-5 bg-[#F6FFF8]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#047857] mb-1">Best cross-area match</p>
                  <p className="text-sm font-semibold text-[#047857]" style={{ fontFamily: SERIF }}>
                    {bestCrossCity.city}{bestCrossCity.area ? ` · ${bestCrossCity.area}` : ''}
                  </p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {bestCrossCity.grossYield != null && (
                      <span className="text-[11px] font-semibold text-[#047857]">{bestCrossCity.grossYield.toFixed(1)}% yield</span>
                    )}
                    {bestCrossCity.estimatedValue != null && (
                      <span className="text-[11px] text-[#047857]">{fmtVal(bestCrossCity.estimatedValue)}</span>
                    )}
                    {bestCrossCity.estimatedValue != null && bestCrossCity.estimatedValue < benchmarkBest.estimatedValue && (
                      <span className="text-[11px] bg-[#ECFDF5] text-[#047857] font-semibold px-2 py-0.5 rounded-full border border-[#A7F3D0]">
                        saves {fmtVal(benchmarkBest.estimatedValue - bestCrossCity.estimatedValue)}
                      </span>
                    )}
                    {bestCrossCity.grossYield != null && bestCrossCity.grossYield > benchmarkBest.grossYield && (
                      <span className="text-[11px] bg-[#ECFDF5] text-[#047857] font-semibold px-2 py-0.5 rounded-full border border-[#A7F3D0]">
                        +{(bestCrossCity.grossYield - benchmarkBest.grossYield).toFixed(1)}% yield
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Results header */}
          {hasSearched && !loadingCandidates && hasResults && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-semibold text-[#374151]">
                <span className="text-[#111827]">{sortedResults.length}</span> {sortedResults.length === 1 ? 'match' : 'matches'}
                {citiesInResults > 0 && <> across <span className="text-[#111827]">{citiesInResults}</span> {citiesInResults === 1 ? 'city' : 'cities'}</>}
              </p>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[#6B7280]">Sort:</label>
                <select value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}
                  className="bg-white border border-[#E7E5DD] text-xs font-medium text-[#374151] rounded-xl px-3 py-1.5 outline-none focus:border-[#047857] cursor-pointer">
                  <option value="matchScore">Match score</option>
                  <option value="grossYield">Highest gross yield</option>
                  <option value="estimatedValue">Lowest value</option>
                  <option value="epc">EPC rating</option>
                </select>
              </div>
            </div>
          )}

          {/* Results or state */}
          {!hasSearched ? emptySearch :
           loadingCandidates ? loadingState :
           !hasResults ? noResults : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sortedResults.map((result, i) => {
                const cardId = result.uprn ?? result.address
                return (
                  <ResultCard
                    key={result.uprn ?? `result-${i}`}
                    result={result}
                    isFav={finderFavs.has(cardId)}
                    benchmarkCities={benchmarkProfile?.cities ?? []}
                    isOpening={openingId === cardId}
                    openError={openErrors[cardId] ?? null}
                    onToggleFav={() => toggleFinderFav(cardId)}
                    onOpen={() => openVerifiedAnalysis(result)}
                  />
                )
              })}
            </div>
          )}

          {hasResults && (
            <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Why these results?</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                {[
                  { icon: '★',  label: 'Matched to your favourites', color: 'text-[#B7791F]' },
                  { icon: '📈', label: 'High yield potential',        color: 'text-[#047857]' },
                  { icon: '⊞',  label: 'Strong type similarity',      color: 'text-[#047857]' },
                  { icon: '🏙', label: 'Area momentum',               color: 'text-[#374151]' },
                ].map(it => (
                  <div key={it.label} className="text-center">
                    <p className={`text-2xl mb-1 ${it.color}`}>{it.icon}</p>
                    <p className="text-[11px] text-[#6B7280] leading-snug">{it.label}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-[#9CA3AF] leading-relaxed">
                The more properties you favourite and analyse, the smarter your recommendations become.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════ CUSTOM SEARCH TAB ════════════════════════ */}
      {finderTab === 'custom' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">

            {/* Left: filters */}
            <div className="space-y-5">
              <AreaSearchBox value={areaSearch} onChange={setAreaSearch} loading={loadingCandidates} error={finderError} />

              {/* Yield */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Yield targets</h3>
                <div className="flex justify-between text-xs mb-2">
                  <label className="text-[#6B7280]">Min gross yield</label>
                  <span className="font-semibold text-[#047857]">{customCriteria.targetGrossYield.toFixed(1)}%</span>
                </div>
                <input type="range" min={3} max={12} step={0.5} value={customCriteria.targetGrossYield}
                  onChange={e => setCustomCriteria(p => ({ ...p, targetGrossYield: Number(e.target.value) }))}
                  className="w-full h-1.5 accent-[#047857]" />
                <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>3%</span><span>12%</span></div>
              </div>

              {/* Budget */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Budget / value range</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1.5 block">Min £</label>
                    <input type="number" step={10000} value={customCriteria.minValue}
                      onChange={e => setCustomCriteria(p => ({ ...p, minValue: Number(e.target.value) }))}
                      className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#047857]" />
                  </div>
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1.5 block">Max £</label>
                    <input type="number" step={10000} value={customCriteria.maxValue}
                      onChange={e => setCustomCriteria(p => ({ ...p, maxValue: Number(e.target.value) }))}
                      className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#047857]" />
                  </div>
                </div>
              </div>

              {/* Property type */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Property type</h3>
                <div className="flex gap-2 flex-wrap">
                  {['Flat', 'Terraced', 'Semi-Detached', 'Detached', 'Bungalow'].map(t => {
                    const active = customCriteria.propertyTypes.includes(t)
                    return (
                      <button key={t} type="button" aria-pressed={active}
                        onClick={() => setCustomCriteria(p => ({
                          ...p,
                          propertyTypes: active ? p.propertyTypes.filter(x => x !== t) : [...p.propertyTypes, t],
                        }))}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          active ? 'bg-[#047857] border-[#047857] text-white' : 'bg-white border-[#E7E5DD] text-[#6B7280] hover:border-[#047857]'
                        }`}>
                        {t}
                      </button>
                    )
                  })}
                  {customCriteria.propertyTypes.length > 0 && (
                    <button type="button"
                      onClick={() => setCustomCriteria(p => ({ ...p, propertyTypes: [] }))}
                      className="px-3 py-1.5 rounded-full text-xs text-[#9CA3AF] hover:text-[#374151]">
                      Clear
                    </button>
                  )}
                </div>
                {customCriteria.propertyTypes.length === 0 && (
                  <p className="text-[11px] text-[#9CA3AF] mt-2">Any type</p>
                )}
              </div>

              {/* Bedrooms */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Bedrooms</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#6B7280] mb-2 block">Min: {customCriteria.minBedrooms}</label>
                    <input type="range" min={0} max={5} step={1} value={customCriteria.minBedrooms}
                      onChange={e => setCustomCriteria(p => ({ ...p, minBedrooms: Number(e.target.value) }))}
                      className="w-full h-1.5 accent-[#047857]" />
                    <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>Studio</span><span>5+</span></div>
                  </div>
                  <div>
                    <label className="text-xs text-[#6B7280] mb-2 block">Max: {customCriteria.maxBedrooms}</label>
                    <input type="range" min={1} max={6} step={1} value={customCriteria.maxBedrooms}
                      onChange={e => setCustomCriteria(p => ({ ...p, maxBedrooms: Number(e.target.value) }))}
                      className="w-full h-1.5 accent-[#047857]" />
                    <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>1</span><span>6+</span></div>
                  </div>
                </div>
              </div>

              {/* Tenure + EPC */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Tenure</h3>
                  <div className="flex rounded-xl border border-[#E7E5DD] overflow-hidden">
                    {(['any', 'freehold', 'leasehold'] as TenureFilter[]).map(val => (
                      <button key={val} type="button"
                        onClick={() => setCustomCriteria(p => ({ ...p, tenure: val }))}
                        className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
                          customCriteria.tenure === val ? 'bg-[#047857] text-white' : 'bg-white text-[#374151] hover:bg-[#F6F3EC]'
                        }`}>
                        {val === 'any' ? 'Any' : val.charAt(0).toUpperCase() + val.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">EPC preference</h3>
                  <div className="flex flex-col gap-1.5">
                    {([['any', 'Any rating'], ['a-c', 'A–C only'], ['a-d', 'A–D only'], ['exclude-e-f-g', 'Exclude E/F/G']] as const).map(([val, label]) => (
                      <button key={val} type="button"
                        onClick={() => setCustomCriteria(p => ({ ...p, epcPreference: val }))}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-left transition-colors ${
                          customCriteria.epcPreference === val ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' : 'text-[#6B7280] hover:bg-[#F6F3EC]'
                        }`}>
                        <span className={`w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${
                          customCriteria.epcPreference === val ? 'bg-[#047857] border-[#047857]' : 'border-[#D1D5DB]'
                        }`}>
                          {customCriteria.epcPreference === val && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: filtered results */}
            <div className="space-y-4">
              <div className="bg-white border border-[#A7F3D0] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">
                  {!hasSearched ? 'Search an area above' :
                   loadingCandidates ? 'Searching…' :
                   `${scoredCustomCandidates.length} matching ${scoredCustomCandidates.length === 1 ? 'property' : 'properties'}`}
                </p>
                {!hasSearched ? (
                  <div className="text-center py-8">
                    <p className="text-2xl mb-2">🔍</p>
                    <p className="text-sm text-[#9CA3AF]">Enter a postcode or area above</p>
                  </div>
                ) : loadingCandidates ? (
                  <div className="text-center py-8"><Spinner className="w-6 h-6 mx-auto" /></div>
                ) : scoredCustomCandidates.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-2xl mb-2">🔍</p>
                    <p className="text-sm text-[#9CA3AF]">No properties match your filters</p>
                    <p className="text-xs text-[#9CA3AF] mt-1">Try widening your criteria</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {scoredCustomCandidates.slice(0, 5).map((r, i) => {
                      const cardId = r.uprn ?? r.address
                      return (
                        <div key={r.uprn ?? `custom-${i}`}
                          className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#F3F4F6] hover:border-[#A7F3D0] transition-all cursor-pointer"
                          onClick={() => openVerifiedAnalysis(r)}>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-[#111827] truncate">{r.address}</p>
                            <p className="text-[11px] text-[#9CA3AF]">{[r.city, r.postcode].filter(Boolean).join(' · ')}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs font-bold text-[#047857]">{r.grossYield != null ? `${r.grossYield.toFixed(1)}%` : '—'}</p>
                            <p className="text-[10px] text-[#9CA3AF]">{fmtVal(r.estimatedValue)}</p>
                          </div>
                          {openingId === cardId && <Spinner className="w-4 h-4 shrink-0" />}
                        </div>
                      )
                    })}
                    {scoredCustomCandidates.length > 5 && (
                      <p className="text-xs text-center text-[#9CA3AF]">+{scoredCustomCandidates.length - 5} more — narrow your filters</p>
                    )}
                  </div>
                )}
              </div>
              <button type="button"
                onClick={() => { setSortBy('matchScore'); setFinderTab('ai') }}
                className="w-full bg-white border border-[#E7E5DD] text-[#374151] text-sm font-medium py-3 rounded-xl hover:bg-[#F6F3EC] transition-colors">
                Save search (coming soon)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════ SAVED SEARCHES TAB ═══════════════════════ */}
      {finderTab === 'saved' && (
        <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
          <p className="text-4xl mb-3">🔖</p>
          <p className="font-semibold text-[#374151] mb-2">No saved searches yet</p>
          <p className="text-sm text-[#6B7280] max-w-[360px] mx-auto mb-6">
            Create a custom search and save it to monitor new opportunities as they appear.
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
