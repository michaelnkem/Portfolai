'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Stat, Badge, Skeleton } from '@/components/ui'

interface PropertySearchProps {
  onSelectProperty: (data: Record<string, unknown>) => void
  onAI: (data: Record<string, unknown>) => void
  onAddPortfolio: (data: Record<string, unknown>) => void
}

export function PropertySearch({ onSelectProperty, onAI, onAddPortfolio }: PropertySearchProps) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Record<string, unknown>[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingUprn, setLoadingUprn] = useState('')
  const [savedProperties, setSavedProperties] = useState<Record<string, unknown>[]>([])
  const [noResults, setNoResults] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout>()

  const searchAddresses = useCallback(async (q: string) => {
    if (q.length < 4) { setSuggestions([]); setNoResults(false); return }
    setLoading(true)
    setNoResults(false)
    try {
      const res = await fetch(`/api/property?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      const results = data.suggestions || []
      setSuggestions(results)
      setShowSuggestions(true)
      if (results.length === 0) setNoResults(true)
    } catch { setSuggestions([]) }
    setLoading(false)
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchAddresses(query), 400)
    return () => clearTimeout(debounceRef.current)
  }, [query, searchAddresses])

  // Press Enter — pick first result or search with what's typed
  const handleEnter = async () => {
    if (suggestions.length > 0) {
      // Select first suggestion automatically
      await fetchProperty(suggestions[0])
    } else if (query.length >= 4) {
      // Force a fresh search
      await searchAddresses(query)
    }
  }

  const fetchProperty = async (suggestion: Record<string, unknown>) => {
    const uprn = suggestion.uprn as string
    if (!uprn) return
    setLoadingUprn(uprn)
    setShowSuggestions(false)
    setNoResults(false)
    setQuery(suggestion.full_address as string || suggestion.address as string)
    try {
      const res = await fetch(`/api/property?uprn=${uprn}`)
      const data = await res.json()
      if (!data.error) {
        const full = { ...data, suggestion }
        onSelectProperty(full)
        setSavedProperties(prev => {
          const exists = prev.find(p => (p.property as Record<string, unknown>)?.uprn === uprn)
          return exists ? prev : [full, ...prev.slice(0, 7)]
        })
      }
    } catch (e) { console.error(e) }
    setLoadingUprn('')
  }

  return (
    <div>
      {/* Search header */}
      <div className="mb-8">
        <p className="text-[10px] font-mono tracking-[2px] text-accent mb-2">PROPERTY LOOKUP</p>
        <h2 className="font-display font-black text-3xl text-white mb-1">
          Search any UK property
        </h2>
        <p className="text-mid text-sm">
          Powered by Homedata · Land Registry · EPC Register · 29M properties
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-8 max-w-2xl">
        <div className="relative flex gap-3">
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-mid text-lg">🔍</span>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setNoResults(false) }}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onKeyDown={e => e.key === 'Enter' && handleEnter()}
              placeholder="Type an address, postcode or street name..."
              className="w-full pl-11 pr-4 py-4 bg-panel border border-border rounded-2xl text-white text-sm placeholder-dim focus:border-accent outline-none transition-colors"
            />
            {loading && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
            )}
          </div>
          {/* Search button */}
          <button
            onClick={handleEnter}
            disabled={query.length < 4 || !!loadingUprn}
            className="btn-primary px-6 text-sm disabled:opacity-40 shrink-0"
          >
            Search
          </button>
        </div>

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-[88px] mt-2 bg-panel border border-border rounded-2xl overflow-hidden z-40 shadow-2xl shadow-black/50">
            {suggestions.slice(0, 8).map((s, i) => {
              const uprn = s.uprn as string
              const addr = (s.full_address || s.address) as string
              const pc = s.postcode as string
              return (
                <button key={uprn || i}
                  onClick={() => fetchProperty(s)}
                  disabled={!!loadingUprn}
                  className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors border-b border-border last:border-0 flex items-center justify-between group"
                >
                  <div>
                    <p className="text-sm text-white group-hover:text-accent transition-colors">{addr}</p>
                    <p className="text-xs text-dim">{pc} · UPRN: {uprn}</p>
                  </div>
                  {loadingUprn === uprn ? (
                    <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
                  ) : (
                    <span className="text-mid group-hover:text-accent transition-colors">→</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* No results message */}
        {noResults && !loading && query.length >= 4 && (
          <div className="absolute top-full left-0 right-[88px] mt-2 bg-panel border border-border rounded-2xl overflow-hidden z-40 shadow-2xl shadow-black/50 px-4 py-4">
            <p className="text-sm text-white mb-1">No exact matches found for <strong className="text-accent">"{query}"</strong></p>
            <p className="text-xs text-mid mb-3">Try a more specific address, postcode or street name.</p>
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono text-dim tracking-wide">TIPS</p>
              <p className="text-xs text-mid">· Try just the postcode — e.g. <span className="text-accent">SW1A 1AA</span></p>
              <p className="text-xs text-mid">· Try house number and street — e.g. <span className="text-accent">14 Downing Street</span></p>
              <p className="text-xs text-mid">· Try street and town — e.g. <span className="text-accent">Oxford Street London</span></p>
            </div>
          </div>
        )}
      </div>

      {/* Recent / example properties */}
      {savedProperties.length === 0 ? (
        <ExampleProperties onSearch={setQuery} />
      ) : (
        <div>
          <p className="text-[10px] font-mono tracking-wide text-mid mb-4">RECENTLY SEARCHED</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {savedProperties.map((p, i) => (
              <PropertyCard
                key={i}
                data={p}
                onSelect={() => onSelectProperty(p)}
                onAI={() => onAI(p)}
                onSave={() => onAddPortfolio(p)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ExampleProperties({ onSearch }: { onSearch: (q: string) => void }) {
  const examples = [
    { label: 'Manchester city centre flat', query: 'Deansgate Square Manchester M3' },
    { label: 'Liverpool Baltic Triangle', query: 'Jamaica Street Liverpool L1' },
    { label: 'Birmingham Jewellery Quarter', query: 'Vyse Street Birmingham B18' },
    { label: 'Leeds HMO corridor', query: 'Meanwood Road Leeds LS7' },
    { label: 'Sheffield student zone', query: 'Ecclesall Road Sheffield S11' },
    { label: 'London Zone 4 BTL', query: 'Barking Riverside London IG11' },
  ]

  return (
    <div>
      <p className="text-[10px] font-mono tracking-wide text-mid mb-4">TRY AN EXAMPLE SEARCH</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {examples.map(e => (
          <button key={e.label} onClick={() => onSearch(e.query)}
            className="card p-4 text-left hover:border-accent transition-all group">
            <span className="text-mid text-base mb-2 block">🏠</span>
            <p className="text-sm text-white group-hover:text-accent transition-colors font-medium">
              {e.label}
            </p>
            <p className="text-xs text-dim mt-1">{e.query}</p>
          </button>
        ))}
      </div>
      <div className="mt-8 p-4 bg-accent/5 border border-accent/20 rounded-2xl max-w-xl">
        <p className="text-sm text-accent font-semibold mb-1">📡 Live data from Homedata API</p>
        <p className="text-xs text-mid">
          Search returns real Land Registry data, EPC ratings, transaction history and
          risk scores for any of the 29 million properties in England & Wales.
          Add your API key to <code className="bg-white/10 px-1 rounded">.env.local</code> to activate.
        </p>
      </div>
    </div>
  )
}

function PropertyCard({ data, onSelect, onAI, onSave }: {
  data: Record<string, unknown>
  onSelect: () => void
  onAI: () => void
  onSave: () => void
}) {
  const p = data.property as Record<string, unknown> | undefined
  const enriched = data.enriched as Record<string, unknown> | undefined
  const epc = data.epc as Record<string, unknown> | undefined

  if (!p) return null

  const addr = (p.full_address || p.address) as string
  const price = (p.last_sold_price || 0) as number
  const beds = p.bedrooms as number
  const type = p.property_type as string
  const tenure = p.tenure as string
  const epcRating = (enriched?.epcRating || p.current_energy_rating || '?') as string
  const grossYield = enriched?.grossYield as number | undefined
  const netYield = enriched?.netYield as number | undefined
  const totalROI = enriched?.totalROI as number | undefined
  const cityName = data.cityName as string
  const transactions = data.transactions as Array<Record<string, unknown>> | undefined

  const epcColor = (r: string) => r <= 'B' ? 'text-accent' : r <= 'D' ? 'text-gold' : 'text-danger'

  return (
    <div className="card p-5 hover:border-accent transition-all cursor-pointer group"
         onClick={onSelect}>
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs text-white font-semibold leading-snug mb-1 line-clamp-2 group-hover:text-accent transition-colors">
          {addr}
        </p>
        <p className="text-[11px] text-mid">
          {type} · {beds}bd · {cityName}
          {tenure && ` · ${tenure}`}
        </p>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Stat label="LAST SOLD" value={price ? `£${(price/1000).toFixed(0)}k` : 'N/A'} size="sm" />
        <Stat label="EST. YIELD" value={grossYield ? `${grossYield.toFixed(1)}%` : 'Enter rent'} tone={grossYield && grossYield > 6 ? 'green' : 'neutral'} size="sm" />
        <Stat label="TOTAL ROI" value={totalROI ? `${totalROI.toFixed(1)}%` : '—'} tone={totalROI && totalROI > 8 ? 'gold' : 'neutral'} size="sm" />
      </div>

      {/* Tags row */}
      <div className="flex gap-2 items-center mb-4 flex-wrap">
        <Badge tone={epcColor(epcRating) === 'text-accent' ? 'green' : epcColor(epcRating) === 'text-gold' ? 'gold' : 'red'}>
          EPC {epcRating}
        </Badge>
        {transactions && transactions.length > 0 && (
          <span className="text-[10px] text-mid">
            {transactions.length} sales recorded
          </span>
        )}
        {netYield && netYield > 5 && <Badge>Strong yield</Badge>}
      </div>

      {/* Sparkline if we have transaction history */}
      {transactions && transactions.length > 2 && (
        <div className="mb-3">
          <p className="text-[9px] font-mono text-dim mb-1">PRICE HISTORY</p>
          {/* Simple bar representation */}
          <div className="flex items-end gap-0.5 h-8">
            {transactions.slice(-8).reverse().map((t, i) => {
              const maxP = Math.max(...transactions.slice(-8).map(x => Number(x.price ?? 0)))
              const pct = (Number(t.price ?? 0) / maxP) * 100
              return (
                <div key={i} className="flex-1 bg-accent/40 rounded-sm transition-all hover:bg-accent"
                     style={{ height: `${pct}%` }} title={`£${Number(t.price ?? 0).toLocaleString()} (${String(t.date ?? '')})`} />
              )
            })}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-3 border-t border-border" onClick={e => e.stopPropagation()}>
        <button onClick={onAI}
          className="flex-1 bg-accent/10 border border-accent/30 text-accent text-xs font-bold py-2 rounded-lg hover:bg-accent/20 transition-colors">
          🤖 AI Analysis
        </button>
        <button onClick={onSelect}
          className="flex-1 btn-ghost text-xs py-2">
          Full Detail →
        </button>
        <button onClick={onSave}
          className="bg-gold/10 border border-gold/30 text-gold text-xs font-bold px-3 py-2 rounded-lg hover:bg-gold/20 transition-colors">
          +
        </button>
      </div>
    </div>
  )
}
