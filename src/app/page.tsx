'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { PropertyDetail } from '@/components/property/PropertyDetail'
import { AIAdvisor } from '@/components/ai/AIAdvisor'
import { MarketIntel } from '@/components/property/MarketIntel'
import { Portfolio } from '@/components/property/Portfolio'
import { ROICalculator } from '@/components/property/ROICalculator'
import { MARKET_DATA } from '@/lib/market-data'
import { PropertyFinder } from '@/components/property/PropertyFinder'

export type Tab = 'search' | 'market' | 'portfolio' | 'calculator' | 'favourites' | 'alerts' | 'property-finder' | 'property-analysis'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'

function fmtVal(n: number): string {
  if (!n || n <= 0) return '—'
  if (n >= 1_000_000) return `£${n.toLocaleString()}`
  return `£${Math.round(n / 1000)}k`
}
type CityKey = keyof typeof MARKET_DATA.cities

const SPARKLINES = [
  'M0,14 C10,12 20,16 35,11 C50,7 65,13 80,10',
  'M0,16 C15,16 25,14 40,13 C55,12 65,13 80,11',
  'M0,15 C12,13 22,10 35,9 C48,8 62,11 80,9',
  'M0,14 C15,14 25,12 40,11 C55,10 65,13 80,10',
  'M0,16 C12,15 22,12 38,10 C54,8 68,12 80,10',
  'M0,15 C10,14 22,11 38,10 C54,9 65,12 80,11',
]

function TinySparkline({ color = '#047857', d }: { color?: string; d: string }) {
  return (
    <svg width="100%" height="20" viewBox="0 0 80 20" preserveAspectRatio="none" className="mt-2 opacity-60">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function resolveEpc(item: Record<string, unknown>) {
  const epc = item.epc as Record<string, unknown> | null
  const enriched = item.enriched as Record<string, unknown>
  const property = item.property as Record<string, unknown>
  const raw = String(
    epc?.current_energy_rating || epc?.currentEnergyRating || epc?.rating ||
    enriched?.epcRating || property?.current_energy_rating || ''
  ).trim().toUpperCase()
  const r = raw.match(/[A-G]/)?.[0] ?? '?'
  return { rating: r, known: r !== '?' }
}

function resolveValue(item: Record<string, unknown>): number {
  const e = item.enriched as Record<string, unknown>
  const p = item.property as Record<string, unknown>
  return Number(e?.estimatedCurrentValue || p?.last_sold_price || 0) || 0
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('search')
  const [marketPropertyContext, setMarketPropertyContext] = useState<Record<string, unknown> | null>(null)

  const handleTabChange = useCallback((newTab: Tab) => {
    if (newTab !== 'market') setMarketPropertyContext(null)
    setTab(newTab)
  }, [])
  const [selectedProperty, setSelectedProperty] = useState<Record<string, unknown> | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiProperty, setAiProperty] = useState<Record<string, unknown> | null>(null)
  const [portfolio, setPortfolio] = useState<Array<Record<string, unknown>>>([])
  const [favourites, setFavourites] = useState<Set<string>>(new Set())
  const [selectedCity, setSelectedCity] = useState<CityKey | ''>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSuggestions, setSearchSuggestions] = useState<Record<string, unknown>[]>([])
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [loadingUprn, setLoadingUprn] = useState('')

  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<NodeJS.Timeout>()

  const handleSelectProperty = useCallback((data: Record<string, unknown>) => {
    setSelectedProperty(data)
    handleTabChange('property-analysis')
  }, [handleTabChange])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 3) { setSearchSuggestions([]); setShowSearchDropdown(false); return }
    try {
      const res = await fetch(`/api/property?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      const results = data.suggestions || []
      setSearchSuggestions(results)
      if (results.length > 0) setShowSearchDropdown(true)
    } catch { setSearchSuggestions([]) }
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (searchQuery.trim().length >= 3) {
      debounceRef.current = setTimeout(() => fetchSuggestions(searchQuery), 350)
    } else {
      setSearchSuggestions([])
      setShowSearchDropdown(false)
    }
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery, fetchSuggestions])

  const fetchProperty = useCallback(async (suggestion: Record<string, unknown>) => {
    const uprn = String(suggestion.uprn ?? '')
    if (!uprn) return
    setLoadingUprn(uprn)
    setShowSearchDropdown(false)
    try {
      const res = await fetch(`/api/property?uprn=${uprn}`)
      const data = await res.json()
      if (data.property) {
        handleSelectProperty({ ...data, suggestion })
        setSearchQuery('')
        setSearchSuggestions([])
      }
    } catch {}
    setLoadingUprn('')
  }, [handleSelectProperty])

  const openAI = useCallback((property: Record<string, unknown> | null = null) => {
    setAiProperty(property)
    setAiOpen(true)
  }, [])

  const addToPortfolio = useCallback((property: Record<string, unknown>) => {
    setPortfolio(prev => {
      const uprn = (property.property as Record<string, unknown>)?.uprn
      if (prev.some(p => (p.property as Record<string, unknown>)?.uprn === uprn)) return prev
      return [...prev, property]
    })
  }, [])

  const removeFromPortfolio = useCallback((uprn: string) => {
    setPortfolio(prev => prev.filter(p => (p.property as Record<string, unknown>)?.uprn !== uprn))
    setFavourites(prev => { const n = new Set(prev); n.delete(uprn); return n })
  }, [])

  const toggleFavourite = useCallback((uprn: string) => {
    setFavourites(prev => {
      const next = new Set(prev)
      if (next.has(uprn)) next.delete(uprn); else next.add(uprn)
      return next
    })
  }, [])

  const m = MARKET_DATA.macro
  const cityKeys = Object.keys(MARKET_DATA.cities) as CityKey[]
  const cityData = selectedCity ? MARKET_DATA.cities[selectedCity] : null

  const kpiStats = cityData ? [
    { label: 'AVG PRICE',     value: `£${cityData.avgPrice.toLocaleString()}`,    sub: `${selectedCity} avg · 2026`,    color: '#111827', si: 0 },
    { label: 'BOE BASE RATE', value: `${m.bankRate}%`,                            sub: 'Down from 5.25% peak',          color: '#047857', si: 1 },
    { label: 'AVG YIELD',     value: `${cityData.avgYield}%`,                     sub: 'Gross rental yield',            color: '#047857', si: 2 },
    { label: 'RENTAL GROWTH', value: `+${m.rentalGrowthForecast}%`,               sub: '2026 forecast · ONS',           color: '#047857', si: 3 },
    { label: 'HPI FORECAST',  value: `+${m.hpiGrowthForecast}%`,                 sub: 'National consensus',            color: '#047857', si: 4 },
    { label: 'CITY HPI 1YR',  value: `${cityData.capitalGrowth1yr >= 0 ? '+' : ''}${cityData.capitalGrowth1yr}%`, sub: `${selectedCity} yr/yr`, color: cityData.capitalGrowth1yr >= 0 ? '#047857' : '#DC2626', si: 5 },
  ] : [
    { label: 'UK AVG PRICE',   value: `£${m.ukAvgPrice.toLocaleString()}`,        sub: '+1.2% yr/yr · ONS',             color: '#111827', si: 0 },
    { label: 'BOE BASE RATE',  value: `${m.bankRate}%`,                           sub: 'Down from 5.25% peak',          color: '#047857', si: 1 },
    { label: 'NAT. AVG YIELD', value: `${m.ukAvgYield}%`,                         sub: 'Gross, England & Wales',        color: '#047857', si: 2 },
    { label: 'RENTAL GROWTH',  value: `+${m.rentalGrowthForecast}%`,              sub: '2026 forecast · ONS',           color: '#047857', si: 3 },
    { label: 'HPI FORECAST',   value: `+${m.hpiGrowthForecast}%`,                sub: 'National consensus',            color: '#047857', si: 4 },
    { label: 'UK HPI 1YR',     value: `+${m.ukHpi1yr}%`,                         sub: 'yr/yr · ONS Feb 2026',          color: '#047857', si: 5 },
  ]

  const favouriteItems = portfolio.filter(item =>
    favourites.has(String((item.property as Record<string, unknown>)?.uprn ?? ''))
  )

  const NAV_ITEMS: Array<{ icon: string; label: string; id: Tab; action?: () => void }> = [
    { icon: '⊞', label: 'Discover',          id: 'search'            },
    { icon: '📈', label: 'Market Intel',      id: 'market'            },
    { icon: '🔍', label: 'Property Analysis', id: 'property-analysis' },
    { icon: '📂', label: 'Portfolio',         id: 'portfolio'         },
    { icon: '★',  label: 'Favourites',        id: 'favourites'        },
    { icon: '🧮', label: 'Calculator',        id: 'calculator'        },
    { icon: '🤖', label: 'AI Analysis',       id: 'search',           action: () => openAI(null) },
    { icon: '🔍', label: 'Property Finder',    id: 'property-finder'   },
    { icon: '🔔', label: 'Alerts',            id: 'alerts'            },
  ]

  return (
    <div className="flex h-screen bg-[#FAF9F5] overflow-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="flex flex-col w-14 lg:w-[248px] shrink-0 bg-white border-r border-[#E7E5DD] h-full overflow-y-auto">
        <div className="px-3 lg:px-6 py-5 border-b border-[#E7E5DD]">
          <button onClick={() => handleTabChange('search')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-[#047857] rounded-lg flex items-center justify-center shrink-0">
              <svg width="15" height="14" viewBox="0 0 15 14" fill="none">
                <path d="M1.5 13V6.2L7.5 2l6 4.2V13H10V9H5v4H1.5z" fill="white" />
              </svg>
            </div>
            <span className="hidden lg:block font-bold text-[19px] tracking-tight text-[#111827]" style={{ fontFamily: SERIF }}>Portfolai</span>
          </button>
        </div>

        <nav className="flex-1 px-2 lg:px-4 py-4 space-y-0.5">
          {NAV_ITEMS.map(item => {
            const isActive = item.action ? (item.label === 'AI Analysis' && aiOpen) : tab === item.id
            return (
              <button key={item.label} onClick={() => item.action ? item.action() : handleTabChange(item.id)} title={item.label}
                className={`w-full flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-3 py-2.5 rounded-xl transition-colors text-left ${
                  isActive ? 'bg-[#ECFDF5] text-[#047857]' : 'text-[#374151] hover:bg-[#F6F3EC]'
                }`}>
                <span className="text-sm w-5 text-center shrink-0">{item.icon}</span>
                <span className="hidden lg:block text-sm font-medium">{item.label}</span>
                {item.id === 'portfolio' && !item.action && portfolio.length > 0 && (
                  <span className="hidden lg:flex ml-auto text-[10px] font-bold bg-[#047857] text-white w-5 h-5 rounded-full items-center justify-center">
                    {portfolio.length}
                  </span>
                )}
                {item.id === 'favourites' && !item.action && favourites.size > 0 && (
                  <span className="hidden lg:flex ml-auto text-[10px] font-bold bg-[#B7791F] text-white w-5 h-5 rounded-full items-center justify-center">
                    {favourites.size}
                  </span>
                )}
              </button>
            )
          })}
          <div className="border-t border-[#E7E5DD] my-2" />
          {[{ icon: '⚙', label: 'Settings' }, { icon: '?', label: 'Help' }].map(item => (
            <div key={item.label} title={item.label} className="flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-3 py-2.5 rounded-xl cursor-pointer text-[#374151] hover:bg-[#F6F3EC] transition-colors">
              <span className="text-sm w-5 text-center shrink-0">{item.icon}</span>
              <span className="hidden lg:block text-sm font-medium">{item.label}</span>
            </div>
          ))}
        </nav>

        <div className="hidden lg:block px-4 pb-4 space-y-3">
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
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top header */}
        <header className="shrink-0 bg-white/90 backdrop-blur-md border-b border-[#E7E5DD] px-6 lg:px-8 h-[68px] flex items-center gap-4 z-20">
          <div ref={searchRef} className="relative flex-1 max-w-[560px]">
            <div className="flex items-center gap-3 bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-4 py-2.5">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#9CA3AF]">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => searchSuggestions.length > 0 && setShowSearchDropdown(true)}
                onKeyDown={e => { if (e.key === 'Escape') { setShowSearchDropdown(false); setSearchQuery('') } }}
                placeholder="Search any UK property by address, postcode or street name..."
                className="flex-1 min-w-0 bg-transparent text-[#374151] text-sm outline-none placeholder-[#9CA3AF]"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchSuggestions([]); setShowSearchDropdown(false) }}
                  className="text-[#9CA3AF] hover:text-[#374151] text-lg leading-none shrink-0">×</button>
              )}
              <span className="text-[10px] font-mono text-[#9CA3AF] bg-white border border-[#E7E5DD] px-1.5 py-0.5 rounded shrink-0">⌘K</span>
            </div>

            {showSearchDropdown && searchSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-[#E7E5DD] rounded-2xl overflow-hidden shadow-[0_16px_40px_rgba(17,24,39,0.1)] z-50">
                <div className="px-4 py-2 border-b border-[#F3F4F6] flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{searchSuggestions.length} suggestions</p>
                  <p className="text-[10px] text-[#9CA3AF]">Click to view analysis</p>
                </div>
                {searchSuggestions.slice(0, 7).map((s, i) => {
                  const uprn = String(s.uprn ?? '')
                  const addr = String(s.full_address || s.address || '')
                  const pc = String(s.postcode ?? '')
                  const isLoading = loadingUprn === uprn
                  return (
                    <button key={uprn || i} onClick={() => fetchProperty(s)} disabled={!!loadingUprn}
                      className="w-full text-left px-4 py-3 hover:bg-[#FAF9F5] transition-colors border-b border-[#F3F4F6] last:border-0 flex items-center justify-between group">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#111827] group-hover:text-[#047857] transition-colors truncate font-medium">{addr}</p>
                        <p className="text-xs text-[#9CA3AF] mt-0.5">{pc}</p>
                      </div>
                      {isLoading
                        ? <div className="w-4 h-4 border-2 border-[#047857] border-t-transparent rounded-full animate-spin ml-3 shrink-0" />
                        : <span className="text-[#047857] ml-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">→</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <button onClick={() => openAI(null)}
              className="hidden sm:flex items-center gap-1.5 bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] text-xs font-semibold px-3 py-2 rounded-xl hover:bg-[#D1FAE5] transition-colors">
              🤖 AI Analysis
            </button>
            <button onClick={() => handleTabChange('alerts')}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#E7E5DD] bg-white text-[#6B7280] hover:bg-[#F6F3EC] transition-colors text-base">
              🔔
            </button>
            <div className="w-9 h-9 bg-[#047857] rounded-full flex items-center justify-center text-white text-sm font-bold cursor-pointer shrink-0">
              M
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── DISCOVER ────────────────────────────────────────────────── */}
          {tab === 'search' && (
            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">

              {/* Hero + KPI */}
              <div className="mb-6">
                <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#047857] mb-2">
                      {selectedCity ? `${selectedCity.toUpperCase()} MARKET DATA` : 'LIVE UK MARKET DATA'}
                    </p>
                    <h1 className="text-[36px] sm:text-[44px] font-bold text-[#111827] leading-[1.05] max-w-[780px]"
                      style={{ fontFamily: SERIF, letterSpacing: '-0.025em' }}>
                      The professional&apos;s{' '}
                      <span className="text-[#047857]">property intelligence</span> platform.
                    </h1>
                  </div>
                  <div className="flex items-center gap-2 bg-white border border-[#E7E5DD] rounded-xl px-3 py-2 mt-1">
                    <span className="text-[#6B7280] text-sm">🌐</span>
                    <select value={selectedCity} onChange={e => setSelectedCity(e.target.value as CityKey | '')}
                      className="bg-transparent text-sm text-[#374151] font-medium outline-none cursor-pointer">
                      <option value="">UK National</option>
                      {cityKeys.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                  {kpiStats.map(s => (
                    <div key={s.label} className="bg-white border border-[#E7E5DD] rounded-[18px] p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1.5">{s.label}</p>
                      <p className="font-bold text-[26px] leading-none mb-1" style={{ fontFamily: SERIF, letterSpacing: '-0.03em', color: s.color }}>
                        {s.value}
                      </p>
                      <p className="text-[11px] text-[#9CA3AF]">{s.sub}</p>
                      <TinySparkline color={s.color === '#DC2626' ? '#DC2626' : '#047857'} d={SPARKLINES[s.si]} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Two-column layout */}
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">

                {/* Left */}
                <div className="space-y-5 min-w-0">

                  {/* Saved Properties table */}
                  <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] overflow-hidden">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                      <div className="flex items-center gap-2">
                        <span>📂</span>
                        <h2 className="font-bold text-[#111827] text-base" style={{ fontFamily: SERIF }}>Saved Properties</h2>
                      </div>
                      <div className="flex items-center gap-3">
                        {portfolio.length > 0 && <span className="text-sm text-[#6B7280]">{portfolio.length} saved</span>}
                        <button onClick={() => setTab('portfolio')} className="text-sm text-[#047857] font-semibold hover:underline">View all →</button>
                      </div>
                    </div>

                    {portfolio.length === 0 ? (
                      <div className="px-6 py-12 text-center">
                        <p className="text-3xl mb-3">📂</p>
                        <p className="text-sm font-semibold text-[#374151] mb-1">No saved properties yet</p>
                        <p className="text-xs text-[#9CA3AF]">Search for a property above and save it to your portfolio.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px]">
                          <thead>
                            <tr className="border-b border-[#F3F4F6]">
                              {['PROPERTY', 'TYPE / LOCATION', 'EST. VALUE', 'EST. YIELD', 'TOTAL ROI', 'EPC', 'SAVED', 'FAVOURITE', 'ANALYSIS'].map(col => (
                                <th key={col} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-[0.07em] text-[#9CA3AF] whitespace-nowrap">{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {portfolio.map((item, i) => {
                              const p = item.property as Record<string, unknown>
                              const enriched = item.enriched as Record<string, unknown>
                              const uprn = String(p?.uprn ?? '')
                              const addr = String(p?.full_address || p?.address || '')
                              const value = resolveValue(item)
                              const { rating: epc, known: epcKnown } = resolveEpc(item)
                              const grossYield = Number(enriched?.grossYield || 0)
                              const totalROI = Number(enriched?.totalROI || 0)
                              const isFav = favourites.has(uprn)
                              const epcBadge = !epcKnown ? 'bg-[#F3F4F6] text-[#9CA3AF] border border-[#E7E5DD]'
                                : epc <= 'C' ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]'
                                : epc === 'D' ? 'bg-[#FFF7E6] text-[#B7791F] border border-[#F5D48A]'
                                : 'bg-[#FEF2F2] text-[#DC2626] border border-[#FCA5A5]'

                              return (
                                <tr key={i} className="border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAF9F5] transition-colors cursor-pointer group"
                                  onClick={() => handleSelectProperty(item)}>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 bg-[#F6F3EC] rounded-lg flex items-center justify-center shrink-0 text-sm">🏠</div>
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold text-[#111827] truncate max-w-[160px] group-hover:text-[#047857] transition-colors">{addr.split(',')[0]}</p>
                                        <p className="text-xs text-[#9CA3AF] truncate max-w-[160px]">{addr.split(',').slice(1, 3).join(',').trim()}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <p className="text-sm text-[#374151]">{String(p?.property_type ?? '')}</p>
                                    <p className="text-xs text-[#9CA3AF]">{String(item.cityName ?? '')}</p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <p className="text-sm font-semibold text-[#111827]" style={{ fontFamily: SERIF }}>{value ? `£${value.toLocaleString()}` : '—'}</p>
                                    <p className="text-[10px] text-[#047857] font-medium">High confidence</p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <p className={`text-sm font-semibold ${grossYield > 6 ? 'text-[#047857]' : 'text-[#374151]'}`}>{grossYield ? `${grossYield.toFixed(1)}%` : '—'}</p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <p className={`text-sm font-bold ${totalROI >= 8 ? 'text-[#B7791F]' : totalROI > 0 ? 'text-[#047857]' : 'text-[#DC2626]'}`}>
                                      {totalROI ? `${totalROI > 0 ? '+' : ''}${totalROI.toFixed(1)}%` : '—'}
                                    </p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${epcBadge}`}>{epcKnown ? epc : '—'}</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <button onClick={e => { e.stopPropagation(); removeFromPortfolio(uprn) }}
                                      className="text-[#047857] hover:text-[#DC2626] transition-colors text-base" title="Remove from saved">
                                      🔖
                                    </button>
                                  </td>
                                  <td className="px-4 py-3">
                                    <button onClick={e => { e.stopPropagation(); toggleFavourite(uprn) }}
                                      className={`text-xl transition-colors ${isFav ? 'text-[#B7791F]' : 'text-[#D1D5DB] hover:text-[#B7791F]'}`}>
                                      {isFav ? '★' : '☆'}
                                    </button>
                                  </td>
                                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                    <button onClick={() => handleSelectProperty(item)}
                                      className="flex items-center gap-1 text-xs font-semibold text-[#047857] border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1.5 rounded-lg hover:bg-[#D1FAE5] transition-colors whitespace-nowrap">
                                      Open Analysis →
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {portfolio.length > 0 && (
                      <div className="px-6 py-3 border-t border-[#F3F4F6]">
                        <button onClick={() => setTab('portfolio')} className="text-sm text-[#047857] font-semibold hover:underline">
                          View all saved properties →
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Favourites */}
                  <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] overflow-hidden">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                      <div className="flex items-center gap-2">
                        <span className="text-[#B7791F]">★</span>
                        <h2 className="font-bold text-[#111827] text-base" style={{ fontFamily: SERIF }}>Favourites</h2>
                      </div>
                      <div className="flex items-center gap-3">
                        {favouriteItems.length > 0 && <span className="text-sm text-[#6B7280]">{favouriteItems.length} favourites</span>}
                        <button onClick={() => setTab('favourites')} className="text-sm text-[#047857] font-semibold hover:underline">View all →</button>
                      </div>
                    </div>

                    {favouriteItems.length === 0 ? (
                      <div className="px-6 py-10 text-center">
                        <p className="text-2xl mb-2 text-[#D1D5DB]">☆</p>
                        <p className="text-sm font-semibold text-[#374151] mb-1">No favourites yet</p>
                        <p className="text-xs text-[#9CA3AF]">Click the star icon on saved properties to add them here.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5">
                        {favouriteItems.slice(0, 4).map((item, i) => {
                          const p = item.property as Record<string, unknown>
                          const enriched = item.enriched as Record<string, unknown>
                          const addr = String(p?.full_address || p?.address || '')
                          const value = resolveValue(item)
                          const grossYield = Number(enriched?.grossYield || 0)
                          return (
                            <div key={i}
                              className="flex items-center gap-3 bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl p-4 cursor-pointer hover:border-[#A7F3D0] transition-colors group"
                              onClick={() => handleSelectProperty(item)}>
                              <div className="w-14 h-14 bg-[#ECFDF5] rounded-xl flex items-center justify-center text-2xl shrink-0">🏠</div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-[#111827] truncate group-hover:text-[#047857] transition-colors">{addr.split(',')[0]}</p>
                                <p className="text-xs text-[#9CA3AF] truncate">{String(p?.property_type ?? '')} · {String(item.cityName ?? '')}</p>
                                <div className="flex items-center gap-3 mt-1.5">
                                  <span className="text-sm font-bold text-[#047857]" style={{ fontFamily: SERIF }}>
                                    {fmtVal(value)}
                                  </span>
                                  {grossYield > 0 && <span className="text-xs text-[#B7791F] font-semibold">{grossYield.toFixed(1)}% yield</span>}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2 shrink-0">
                                <span className="text-[#B7791F]">★</span>
                                <button onClick={e => { e.stopPropagation(); handleSelectProperty(item) }}
                                  className="text-xs font-semibold text-[#047857] border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-1 rounded-lg hover:bg-[#D1FAE5] transition-colors whitespace-nowrap">
                                  Open Analysis
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {favouriteItems.length > 0 && (
                      <div className="px-6 py-3 border-t border-[#F3F4F6]">
                        <button onClick={() => setTab('favourites')} className="text-sm text-[#047857] font-semibold hover:underline">
                          View all favourites →
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right column */}
                <div className="space-y-4">

                  {/* Market Spotlight */}
                  <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[#F3F4F6]">
                      <h3 className="font-bold text-[#111827] text-sm" style={{ fontFamily: SERIF }}>Market Spotlight</h3>
                      <button onClick={() => setTab('market')} className="text-xs text-[#047857] font-semibold hover:underline">View full report →</button>
                    </div>
                    <div className="h-[140px] bg-gradient-to-br from-[#ECFDF5] via-[#D1FAE5] to-[#6EE7B7] flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-5xl mb-1">🏙</p>
                        <p className="text-xs font-semibold text-[#047857]">London Property Market</p>
                      </div>
                    </div>
                    <div className="p-5">
                      <h4 className="font-semibold text-[#111827] text-sm mb-1" style={{ fontFamily: SERIF }}>
                        London rental yields strengthen in Q2
                      </h4>
                      <p className="text-xs text-[#6B7280] leading-relaxed mb-3">
                        Average yields up +0.3pp QoQ to 5.8%. Demand remains strong across the capital.
                      </p>
                      <div className="flex gap-1.5">
                        {[0, 1, 2, 3].map(d => (
                          <div key={d} className={`w-1.5 h-1.5 rounded-full ${d === 0 ? 'bg-[#047857]' : 'bg-[#E7E5DD]'}`} />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* AI Analysis */}
                  <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-4 border-b border-[#F3F4F6]">
                      <span>🤖</span>
                      <h3 className="font-bold text-[#111827] text-sm" style={{ fontFamily: SERIF }}>AI Analysis</h3>
                      <span className="text-[10px] font-bold bg-[#047857] text-white px-1.5 py-0.5 rounded-full ml-1">New</span>
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-[#6B7280] mb-4 leading-relaxed">
                        Let our AI analyse market trends, property performance and investment opportunities.
                      </p>
                      <div className="space-y-2 mb-4">
                        {[
                          { icon: '🔍', title: 'Ask a market question', sub: 'Get instant insights from AI' },
                          { icon: '📍', title: 'Analyse an area', sub: 'Deep dive into any location' },
                        ].map(item => (
                          <button key={item.title} onClick={() => openAI(null)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#E7E5DD] hover:bg-[#FAF9F5] transition-colors text-left group">
                            <span className="text-base shrink-0">{item.icon}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[#374151] group-hover:text-[#047857] transition-colors">{item.title}</p>
                              <p className="text-[10px] text-[#9CA3AF]">{item.sub}</p>
                            </div>
                            <span className="text-[#9CA3AF] group-hover:text-[#047857] transition-colors shrink-0 text-lg">›</span>
                          </button>
                        ))}
                      </div>
                      <button onClick={() => openAI(null)}
                        className="w-full bg-[#047857] text-white text-sm font-semibold py-3 rounded-xl hover:bg-[#065F46] transition-colors">
                        🤖 Launch AI Assistant →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── MARKET ──────────────────────────────────────────────────── */}
          {tab === 'market' && (
            <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <MarketIntel marketData={MARKET_DATA} onAI={() => openAI(null)} propertyContext={marketPropertyContext} />
            </div>
          )}

          {/* ── PORTFOLIO ───────────────────────────────────────────────── */}
          {tab === 'portfolio' && (
            <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <Portfolio
                portfolio={portfolio}
                onRemove={removeFromPortfolio}
                onAI={() => openAI(null)}
                onSelectProperty={handleSelectProperty}
              />
            </div>
          )}

          {/* ── CALCULATOR ──────────────────────────────────────────────── */}
          {tab === 'calculator' && (
            <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <ROICalculator marketData={MARKET_DATA} onAI={() => openAI(null)} />
            </div>
          )}

          {/* ── ALERTS ──────────────────────────────────────────────────── */}
          {tab === 'alerts' && (
            <div className="max-w-[800px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-[#111827]" style={{ fontFamily: SERIF }}>Alerts</h2>
                <p className="text-sm text-[#6B7280] mt-1">Updates for your favourited properties</p>
              </div>
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-12 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)] mb-5">
                <p className="text-4xl mb-3">🔔</p>
                <p className="font-semibold text-[#374151] mb-2">No new updates</p>
                <p className="text-sm text-[#6B7280] max-w-[360px] mx-auto">
                  Favourite properties from your saved list to start receiving alerts about value changes, EPC updates, and more.
                </p>
                <button onClick={() => handleTabChange('favourites')}
                  className="mt-5 bg-[#047857] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#065F46] transition-colors">
                  View Favourites →
                </button>
              </div>
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-sm font-bold text-[#111827] mb-4" style={{ fontFamily: SERIF }}>What we monitor</h3>
                <div className="space-y-3">
                  {[
                    { icon: '📈', label: 'Estimated value changes', sub: 'Based on Land Registry + HPI data' },
                    { icon: '⚡', label: 'EPC rating updates', sub: 'New certificates filed for your properties' },
                    { icon: '📋', label: 'New Land Registry sales', sub: 'Comparable transactions in your areas' },
                    { icon: '💰', label: 'Rental yield shifts', sub: 'Area rental market movements' },
                    { icon: '⚠', label: 'Environmental risk alerts', sub: 'Flood, subsidence or planning changes' },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-3 py-2 border-b border-[#F3F4F6] last:border-0">
                      <span className="text-base mt-0.5">{item.icon}</span>
                      <div>
                        <p className="text-sm font-semibold text-[#374151]">{item.label}</p>
                        <p className="text-xs text-[#9CA3AF]">{item.sub}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── FAVOURITES ──────────────────────────────────────────────── */}
          {tab === 'favourites' && (
            <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-[#111827]" style={{ fontFamily: SERIF }}>Favourites</h2>
                <p className="text-sm text-[#6B7280] mt-1">{favouriteItems.length} favourited {favouriteItems.length === 1 ? 'property' : 'properties'}</p>
              </div>
              {favouriteItems.length === 0 ? (
                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                  <p className="text-4xl mb-3 text-[#D1D5DB]">☆</p>
                  <p className="font-semibold text-[#374151] mb-2">No favourites yet</p>
                  <p className="text-sm text-[#6B7280]">Star properties from your Saved Properties list to keep them here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {favouriteItems.map((item, i) => {
                    const p = item.property as Record<string, unknown>
                    const enriched = item.enriched as Record<string, unknown>
                    const uprn = String(p?.uprn ?? '')
                    const addr = String(p?.full_address || p?.address || '')
                    const value = resolveValue(item)
                    const grossYield = Number(enriched?.grossYield || 0)
                    const totalROI = Number(enriched?.totalROI || 0)
                    const { rating: epc, known: epcKnown } = resolveEpc(item)
                    return (
                      <div key={i}
                        className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)] cursor-pointer hover:border-[#A7F3D0] transition-all group"
                        onClick={() => handleSelectProperty(item)}>
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-12 h-12 bg-[#ECFDF5] rounded-xl flex items-center justify-center text-2xl shrink-0">🏠</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-[#111827] truncate group-hover:text-[#047857] transition-colors">{addr.split(',')[0]}</p>
                            <p className="text-xs text-[#9CA3AF] truncate">{addr.split(',').slice(1, 3).join(',').trim()}</p>
                            <p className="text-xs text-[#6B7280] mt-0.5">{String(p?.property_type ?? '')} · {String(item.cityName ?? '')}</p>
                          </div>
                          <button onClick={e => { e.stopPropagation(); toggleFavourite(uprn) }}
                            className="text-[#B7791F] text-xl shrink-0">★</button>
                        </div>
                        <div className="grid grid-cols-3 gap-3 mb-4">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-[#9CA3AF] mb-1">Value</p>
                            <p className="text-sm font-bold text-[#111827]" style={{ fontFamily: SERIF }}>{fmtVal(value)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-[#9CA3AF] mb-1">Yield</p>
                            <p className="text-sm font-bold text-[#047857]">{grossYield ? `${grossYield.toFixed(1)}%` : '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-[#9CA3AF] mb-1">EPC</p>
                            <p className={`text-sm font-bold ${!epcKnown ? 'text-[#9CA3AF]' : epc <= 'C' ? 'text-[#047857]' : epc === 'D' ? 'text-[#B7791F]' : 'text-[#DC2626]'}`}>
                              {epcKnown ? epc : '—'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-bold ${totalROI >= 8 ? 'text-[#B7791F]' : totalROI > 0 ? 'text-[#047857]' : 'text-[#DC2626]'}`}>
                            {totalROI ? `${totalROI > 0 ? '+' : ''}${totalROI.toFixed(1)}% ROI` : '—'}
                          </span>
                          <button onClick={e => { e.stopPropagation(); handleSelectProperty(item) }}
                            className="text-xs font-semibold text-[#047857] border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1.5 rounded-xl hover:bg-[#D1FAE5] transition-colors">
                            Open Analysis →
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── PROPERTY ANALYSIS ───────────────────────────────────────── */}
          {tab === 'property-analysis' && (
            selectedProperty ? (
              <PropertyDetail
                data={selectedProperty}
                inline
                onClose={() => setSelectedProperty(null)}
                onAI={() => openAI(selectedProperty)}
                onAddPortfolio={() => addToPortfolio(selectedProperty)}
                onHome={() => handleTabChange('search')}
                onMarketIntel={(propertyData) => { setMarketPropertyContext(propertyData); handleTabChange('market') }}
                onSearchProperty={handleSelectProperty}
                isSaved={portfolio.some(p => (p.property as Record<string, unknown>)?.uprn === (selectedProperty.property as Record<string, unknown>)?.uprn)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 px-4 py-20">
                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-14 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)] max-w-[560px] w-full">
                  <div className="w-16 h-16 bg-[#ECFDF5] rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6">🔍</div>
                  <h2 className="text-2xl font-bold text-[#111827] mb-3" style={{ fontFamily: SERIF }}>
                    Search for a property to begin
                  </h2>
                  <p className="text-sm text-[#6B7280] leading-relaxed mb-8 max-w-[380px] mx-auto">
                    Use the search bar above to analyse a UK property — view investment metrics, valuation, yield, risks, transaction history and local market comparison.
                  </p>
                  <button
                    onClick={() => searchInputRef.current?.focus()}
                    className="bg-[#047857] text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-[#065F46] transition-colors">
                    Focus search bar →
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 max-w-[560px] w-full">
                  {[
                    { icon: '📊', title: 'Investment Scorecard', desc: 'AI-generated /10 score with full reasoning.' },
                    { icon: '💰', title: 'Full Financials', desc: 'Gross vs net yield, cashflow and 10-year projections.' },
                    { icon: '⚠️', title: 'Risk Assessment', desc: 'EPC compliance, flood risk and environmental data.' },
                  ].map(f => (
                    <div key={f.title} className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)] text-left">
                      <p className="text-xl mb-2">{f.icon}</p>
                      <p className="text-xs font-bold text-[#111827] mb-1" style={{ fontFamily: SERIF }}>{f.title}</p>
                      <p className="text-[11px] text-[#6B7280] leading-relaxed">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* ── PROPERTY FINDER ─────────────────────────────────────────── */}
          {tab === 'property-finder' && (
            <PropertyFinder
              favouriteItems={favouriteItems}
              favourites={favourites}
              onToggleFavourite={toggleFavourite}
              onAddToPortfolio={addToPortfolio}
              onOpenAnalysis={handleSelectProperty}
              onGoToDiscover={() => handleTabChange('favourites')}
            />
          )}
        </div>
      </div>

      {/* AI Advisor modal */}
      {aiOpen && <AIAdvisor property={aiProperty} onClose={() => setAiOpen(false)} />}
    </div>
  )
}
