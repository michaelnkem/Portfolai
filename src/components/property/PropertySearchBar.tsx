'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

interface PropertySearchBarProps {
  onSelectProperty: (data: Record<string, unknown>) => void
  placeholder?: string
  className?: string
}

export function PropertySearchBar({ onSelectProperty, placeholder = 'Search any UK property...', className = '' }: PropertySearchBarProps) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Record<string, unknown>[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loadingUprn, setLoadingUprn] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

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

  const fetchProperty = useCallback(async (suggestion: Record<string, unknown>) => {
    const uprn = String(suggestion.uprn ?? '')
    if (!uprn) return
    setLoadingUprn(uprn)
    setShowDropdown(false)
    try {
      const res = await fetch(`/api/property?uprn=${uprn}`)
      const data = await res.json()
      if (data.property) {
        onSelectProperty({ ...data, suggestion })
        setQuery('')
        setSuggestions([])
      }
    } catch {}
    setLoadingUprn('')
  }, [onSelectProperty])

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="flex items-center gap-3 bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-4 py-2.5">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#9CA3AF]">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setShowDropdown(true) }}
          onKeyDown={e => { if (e.key === 'Escape') { setShowDropdown(false); setQuery('') } }}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent text-[#374151] text-sm outline-none placeholder-[#9CA3AF]"
        />
        {query && (
          <button onClick={() => { setQuery(''); setSuggestions([]); setShowDropdown(false) }}
            className="text-[#9CA3AF] hover:text-[#374151] text-lg leading-none shrink-0">×</button>
        )}
        <span className="text-[10px] font-mono text-[#9CA3AF] bg-white border border-[#E7E5DD] px-1.5 py-0.5 rounded shrink-0">⌘K</span>
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-[#E7E5DD] rounded-2xl overflow-hidden shadow-[0_16px_40px_rgba(17,24,39,0.1)] z-[100]">
          <div className="px-4 py-2 border-b border-[#F3F4F6] flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{suggestions.length} suggestions</p>
            <p className="text-[10px] text-[#9CA3AF]">Click to view analysis</p>
          </div>
          {suggestions.slice(0, 7).map((s, i) => {
            const uprn = String(s.uprn ?? '')
            const addr = String(s.full_address || s.address || '')
            const pc = String(s.postcode ?? '')
            const isLoading = loadingUprn === uprn
            return (
              <button key={uprn || i} onClick={() => fetchProperty(s)} onMouseDown={e => e.preventDefault()} disabled={!!loadingUprn}
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
  )
}
