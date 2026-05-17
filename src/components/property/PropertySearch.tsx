'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Stat, Badge } from '@/components/ui'

interface PropertySearchProps {
  onSelectProperty: (data: Record<string, unknown>) => void
  onAI: (data: Record<string, unknown>) => void
  onAddPortfolio: (data: Record<string, unknown>) => void
}

type SearchState = 'idle' | 'searching' | 'results' | 'empty'

export function PropertySearch({ onSelectProperty, onAI, onAddPortfolio }: PropertySearchProps) {
  const [query, setQuery] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Record<string, unknown>[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const [loadingUprn, setLoadingUprn] = useState('')
  const [recentProperties, setRecentProperties] = useState<Record<string, unknown>[]>([])
  const debounceRef = useRef<NodeJS.Timeout>()
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch dropdown suggestions as user types
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 3) { setSuggestions([]); setShowDropdown(false); return }
    try {
      const res = await fetch(`/api/property?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      const results = data.suggestions || []
      setSuggestions(results)
      if (results.length > 0) setShowDropdown(true)
    } catch { setSuggestions([]) }
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.trim().length >= 3) {
      debounceRef.current = setTimeout(() => fetchSuggestions(query), 350)
    } else {
      setSuggestions([])
      setShowDropdown(false)
    }
    return () => clearTimeout(debounceRef.current)
  }, [query, fetchSuggestions])

  // Full results page search
  const doFullSearch = useCallback(async (q: string) => {
    if (q.trim().length < 3) return
    setShowDropdown(false)
    setSearchState('searching')
    setCommittedQuery(q)
    try {
      const res = await fetch(`/api/property?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      const results = data.suggestions || []
      setSuggestions(results)
      setSearchState(results.length > 0 ? 'results' : 'empty')
    } catch { setSuggestions([]); setSearchState('empty') }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); doFullSearch(query) }
    if (e.key === 'Escape') setShowDropdown(false)
  }

  const clearSearch = () => {
    setQuery('')
    setSuggestions([])
    setShowDropdown(false)
    setSearchState('idle')
    setCommittedQuery('')
    inputRef.current?.focus()
  }

  const fetchProperty = async (suggestion: Record<string, unknown>) => {
    const uprn = String(suggestion.uprn ?? '')
    if (!uprn) return
    setLoadingUprn(uprn)
    setShowDropdown(false)
    try {
      const res = await fetch(`/api/property?uprn=${uprn}`)
      const data = await res.json()
      if (!data.error) {
        const full = { ...data, suggestion }
        onSelectProperty(full)
        setRecentProperties(prev => {
          const exists = prev.find(p => (p.property as Record<string, unknown>)?.uprn === uprn)
          return exists ? prev : [full, ...prev.slice(0, 5)]
        })
        setQuery('')
        setSuggestions([])
        setSearchState('idle')
        setCommittedQuery('')
      }
    } catch (e) { console.error(e) }
    setLoadingUprn('')
  }

  const showResultsPage = searchState === 'results' || searchState === 'empty' || searchState === 'searching'

  return (
    <div>
      <div className="mb-6">
        <p className="text-[10px] font-mono tracking-[2px] text-accent mb-2">PROPERTY LOOKUP</p>
        <h2 className="font-display font-black text-3xl text-white mb-1">Search any UK property</h2>
      </div>

      {/* Search bar */}
      <div className="max-w-2xl mb-6" ref={wrapperRef} style={{ position: 'relative' }}>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-mid text-lg">🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
              onKeyDown={handleKeyDown}
              placeholder="Address, postcode or street name..."
              className="w-full pl-11 pr-10 py-4 bg-panel border border-border rounded-2xl text-white text-sm placeholder-dim focus:border-accent outline-none transition-colors"
            />
            {query.length > 0 && (
              <button onClick={clearSearch}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-dim hover:text-white text-xl leading-none">×</button>
            )}
          </div>
          <button onClick={() => doFullSearch(query)} disabled={query.trim().length < 3}
            className="btn-primary px-6 text-sm disabled:opacity-40 shrink-0">
            {searchState === 'searching'
              ? <span className="flex items-center gap-2"><span className="w-3.5 h-3.5 border-2 border-bg border-t-transparent rounded-full animate-spin-slow" />Searching</span>
              : 'Search'}
          </button>
        </div>

        {/* Dropdown — shows as user types */}
        {showDropdown && suggestions.length > 0 && (
          <div className="absolute left-0 right-[88px] mt-2 bg-panel border border-border rounded-2xl overflow-hidden shadow-2xl shadow-black/60" style={{ zIndex: 50 }}>
            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
              <p className="text-[10px] font-mono text-dim tracking-wide">{suggestions.length} SUGGESTIONS</p>
              <p className="text-[10px] text-dim">Press Enter for full results</p>
            </div>
            {suggestions.slice(0, 6).map((s, i) => {
              const uprn = String(s.uprn ?? '')
              const addr = String(s.full_address || s.address || '')
              const pc = String(s.postcode ?? '')
              const isLoading = loadingUprn === uprn
              return (
                <button key={uprn || i} onClick={() => fetchProperty(s)} disabled={!!loadingUprn}
                  className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors border-b border-border last:border-0 flex items-center justify-between group">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white group-hover:text-accent transition-colors truncate">{addr}</p>
                    <p className="text-xs text-dim mt-0.5">{pc}</p>
                  </div>
                  {isLoading
                    ? <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin-slow ml-3" />
                    : <span className="text-mid group-hover:text-accent ml-3 transition-colors">→</span>}
                </button>
              )
            })}
            {suggestions.length > 6 && (
              <button onClick={() => doFullSearch(query)}
                className="w-full px-4 py-3 text-xs text-accent hover:bg-accent/5 transition-colors text-center font-semibold">
                See all {suggestions.length} results →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Full results page — shows after Enter or Search click */}
      {showResultsPage && (
        <div className="max-w-2xl mb-8">
          <div className="flex items-center justify-between mb-3">
            <div>
              {searchState === 'searching' && <p className="text-sm text-mid">Searching for <strong className="text-white">"{committedQuery}"</strong>...</p>}
              {searchState === 'results' && (
                <p className="text-sm text-mid">
                  <strong className="text-white">{suggestions.length}</strong> results for <strong className="text-accent">"{committedQuery}"</strong>
                  <span className="text-dim ml-2 text-xs">— click any property to view its full analysis</span>
                </p>
              )}
              {searchState === 'empty' && <p className="text-sm text-mid">No results for <strong className="text-accent">"{committedQuery}"</strong></p>}
            </div>
            <button onClick={clearSearch} className="text-xs text-dim hover:text-mid transition-colors ml-4 shrink-0">Clear ×</button>
          </div>

          {searchState === 'results' && (
            <div className="bg-panel border border-border rounded-2xl overflow-hidden">
              {suggestions.map((s, i) => {
                const uprn = String(s.uprn ?? '')
                const addr = String(s.full_address || s.address || '')
                const pc = String(s.postcode ?? '')
                const isLoading = loadingUprn === uprn
                return (
                  <button key={uprn || i} onClick={() => fetchProperty(s)} disabled={!!loadingUprn}
                    className="w-full text-left px-5 py-4 hover:bg-white/5 transition-colors border-b border-border last:border-0 flex items-center justify-between group">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white group-hover:text-accent transition-colors font-medium">{addr}</p>
                      <p className="text-xs text-dim mt-0.5">{pc} · UPRN: {uprn}</p>
                    </div>
                    <div className="ml-4 shrink-0">
                      {isLoading
                        ? <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
                        : <span className="text-xs text-accent font-semibold opacity-0 group-hover:opacity-100 transition-opacity">View analysis →</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {searchState === 'empty' && (
            <div className="bg-panel border border-border rounded-2xl p-5 space-y-2">
              <p className="text-sm text-white font-semibold mb-3">Try refining your search:</p>
              <p className="text-xs text-mid">· Use just the postcode — e.g. <span className="text-accent font-mono">SW1A 1AA</span></p>
              <p className="text-xs text-mid">· Use house number and street — e.g. <span className="text-accent font-mono">14 Downing Street</span></p>
              <p className="text-xs text-mid">· Use street name and town — e.g. <span className="text-accent font-mono">Oxford Street London</span></p>
            </div>
          )}
        </div>
      )}

      {/* Recently viewed */}
      {searchState === 'idle' && recentProperties.length > 0 && (
        <div className="mb-8">
          <p className="text-[10px] font-mono tracking-wide text-mid mb-4">RECENTLY VIEWED</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {recentProperties.map((p, i) => (
              <PropertyCard key={i} data={p}
                onSelect={() => onSelectProperty(p)}
                onAI={() => onAI(p)}
                onSave={() => onAddPortfolio(p)} />
            ))}
          </div>
        </div>
      )}

      {/* Example searches */}
      {searchState === 'idle' && recentProperties.length === 0 && (
        <ExampleProperties onSearch={(q) => { setQuery(q); doFullSearch(q) }} />
      )}
    </div>
  )
}

function ExampleProperties({ onSearch }: { onSearch: (q: string) => void }) {
  const examples = [
    { label: 'Manchester city centre', query: 'Deansgate Manchester M3' },
    { label: 'Liverpool Baltic Triangle', query: 'Jamaica Street Liverpool L1' },
    { label: 'Birmingham Jewellery Quarter', query: 'Vyse Street Birmingham B18' },
    { label: 'Leeds HMO corridor', query: 'Meanwood Road Leeds LS7' },
    { label: 'Sheffield student zone', query: 'Ecclesall Road Sheffield S11' },
    { label: 'London Zone 4', query: 'Barking Riverside London IG11' },
  ]
  return (
    <div>
      <p className="text-[10px] font-mono tracking-wide text-mid mb-4">EXAMPLE SEARCHES</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {examples.map(e => (
          <button key={e.label} onClick={() => onSearch(e.query)}
            className="card p-4 text-left hover:border-accent transition-all group">
            <span className="text-mid text-base mb-2 block">🏠</span>
            <p className="text-sm text-white group-hover:text-accent transition-colors font-medium">{e.label}</p>
            <p className="text-xs text-dim mt-1">{e.query}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function PropertyCard({ data, onSelect, onAI, onSave }: {
  data: Record<string, unknown>; onSelect: () => void; onAI: () => void; onSave: () => void
}) {
  const p = data.property as Record<string, unknown> | undefined
  const enriched = data.enriched as Record<string, unknown> | undefined
  if (!p) return null
  const addr = String(p.full_address || p.address || '')
  const price = Number(p.last_sold_price ?? 0)
  const beds = String(p.bedrooms ?? '')
  const type = String(p.property_type ?? '')
  const tenure = String(p.tenure ?? '')
  const epcRating = String(enriched?.epcRating || p.current_energy_rating || '?')
  const grossYield = enriched?.grossYield as number | undefined
  const netYield = enriched?.netYield as number | undefined
  const totalROI = enriched?.totalROI as number | undefined
  const cityName = String(data.cityName ?? '')
  const transactions = data.transactions as Array<Record<string, unknown>> | undefined
  const epcTone = epcRating <= 'B' ? 'green' as const : epcRating <= 'D' ? 'gold' as const : 'red' as const

  return (
    <div className="card p-5 hover:border-accent transition-all cursor-pointer group" onClick={onSelect}>
      <div className="mb-4">
        <p className="text-xs text-white font-semibold leading-snug mb-1 line-clamp-2 group-hover:text-accent transition-colors">{addr}</p>
        <p className="text-[11px] text-mid">{type}{beds ? ` · ${beds}bd` : ''}{cityName ? ` · ${cityName}` : ''}{tenure ? ` · ${tenure}` : ''}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Stat label="LAST SOLD" value={price ? `£${(price/1000).toFixed(0)}k` : 'N/A'} size="sm" />
        <Stat label="EST. YIELD" value={grossYield ? `${grossYield.toFixed(1)}%` : '—'} tone={grossYield && grossYield > 6 ? 'green' : 'neutral'} size="sm" />
        <Stat label="TOTAL ROI" value={totalROI ? `${totalROI.toFixed(1)}%` : '—'} tone={totalROI && totalROI > 8 ? 'gold' : 'neutral'} size="sm" />
      </div>
      <div className="flex gap-2 items-center mb-4 flex-wrap">
        <Badge tone={epcTone}>EPC {epcRating}</Badge>
        {transactions && transactions.length > 0 && <span className="text-[10px] text-mid">{transactions.length} sales on record</span>}
        {netYield && netYield > 5 && <Badge>Strong yield</Badge>}
      </div>
      {transactions && transactions.length > 2 && (
        <div className="mb-3">
          <p className="text-[9px] font-mono text-dim mb-1">PRICE HISTORY</p>
          <div className="flex items-end gap-0.5 h-8">
            {transactions.slice(-8).reverse().map((t, i) => {
              const maxP = Math.max(...transactions.slice(-8).map(x => Number(x.price ?? 0)))
              const pct = (Number(t.price ?? 0) / maxP) * 100
              return <div key={i} className="flex-1 bg-accent/40 rounded-sm hover:bg-accent transition-colors" style={{ height: `${pct}%` }} title={`£${Number(t.price ?? 0).toLocaleString()}`} />
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2 pt-3 border-t border-border" onClick={e => e.stopPropagation()}>
        <button onClick={onAI} className="flex-1 bg-accent/10 border border-accent/30 text-accent text-xs font-bold py-2 rounded-lg hover:bg-accent/20 transition-colors">🤖 AI Analysis</button>
        <button onClick={onSelect} className="flex-1 btn-ghost text-xs py-2">Full Detail →</button>
        <button onClick={onSave} className="bg-gold/10 border border-gold/30 text-gold text-xs font-bold px-3 py-2 rounded-lg hover:bg-gold/20 transition-colors">+</button>
      </div>
    </div>
  )
}
