'use client'

import { useState, useMemo, useCallback } from 'react'
import { MARKET_DATA } from '@/lib/market-data'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'
const ALL_CITIES = ['London', 'Manchester', 'Liverpool', 'Nottingham', 'Birmingham', 'Sheffield', 'Leeds', 'Bristol']

// ── Types ─────────────────────────────────────────────────────────────────────

type FinderTab = 'ai' | 'custom' | 'saved'
type SortBy = 'matchScore' | 'grossYield' | 'netYield' | 'valueLowToHigh' | 'roi' | 'epc'
type TenureFilter = 'any' | 'freehold' | 'leasehold'
type EpcFilter = 'any' | 'a-c' | 'a-d' | 'exclude-e-f-g'

interface FinderCandidate {
  id: string
  address: string
  postcode: string
  city: string
  area: string
  propertyType: string
  bedrooms: number
  tenure: string
  epcRating: string
  estimatedValue: number
  grossYield: number
  netYield: number
  totalROI: number
}

interface FinderResult extends FinderCandidate {
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
  selectedCities: string[]
  targetGrossYield: number
  targetNetYield: number
  minValue: number
  maxValue: number
  propertyTypes: string[]
  minBedrooms: number
  maxBedrooms: number
  tenure: TenureFilter
  epcPreference: EpcFilter
  useFavouritesAsBenchmark: boolean
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

// ── Mock candidate properties ─────────────────────────────────────────────────
// Placeholder data representative of real search results — replace with live
// API response when the property search backend is available.

const ALL_CANDIDATES: FinderCandidate[] = [
  // Manchester
  { id: 'man-1', city: 'Manchester', area: 'Ancoats',       postcode: 'M4 6AH',  address: '47 Great Ancoats Street',   propertyType: 'Flat',          bedrooms: 2, tenure: 'Leasehold', epcRating: 'B', estimatedValue: 248000, grossYield: 6.5, netYield: 5.0, totalROI: 10.4 },
  { id: 'man-2', city: 'Manchester', area: 'Didsbury',      postcode: 'M20 3JR', address: '14 Palatine Road',          propertyType: 'Semi-Detached', bedrooms: 3, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 310000, grossYield: 6.4, netYield: 4.9, totalROI: 10.3 },
  { id: 'man-3', city: 'Manchester', area: 'Salford Quays', postcode: 'M50 1EZ', address: '8 Exchange Quay',           propertyType: 'Flat',          bedrooms: 1, tenure: 'Leasehold', epcRating: 'C', estimatedValue: 185000, grossYield: 6.8, netYield: 5.2, totalROI: 10.7 },
  { id: 'man-4', city: 'Manchester', area: 'Chorlton',      postcode: 'M21 9HH', address: '33 Wilbraham Road',         propertyType: 'Terraced',      bedrooms: 4, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 385000, grossYield: 6.5, netYield: 5.0, totalROI: 10.4 },
  // Liverpool
  { id: 'liv-1', city: 'Liverpool',  area: 'Kensington',    postcode: 'L7 0BG',  address: '88 Edge Lane',              propertyType: 'Terraced',      bedrooms: 4, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 185000, grossYield: 8.1, netYield: 6.4, totalROI: 12.6 },
  { id: 'liv-2', city: 'Liverpool',  area: 'Wavertree',     postcode: 'L15 3HT', address: '22 Allerton Road',          propertyType: 'Semi-Detached', bedrooms: 3, tenure: 'Freehold',  epcRating: 'C', estimatedValue: 228000, grossYield: 7.6, netYield: 5.9, totalROI: 12.1 },
  { id: 'liv-3', city: 'Liverpool',  area: 'Aigburth',      postcode: 'L17 4JQ', address: '5 Aigburth Vale',           propertyType: 'Flat',          bedrooms: 2, tenure: 'Leasehold', epcRating: 'B', estimatedValue: 165000, grossYield: 7.6, netYield: 5.9, totalROI: 12.1 },
  { id: 'liv-4', city: 'Liverpool',  area: 'Woolton',       postcode: 'L25 7TA', address: '61 Menlove Avenue',         propertyType: 'Detached',      bedrooms: 4, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 295000, grossYield: 6.7, netYield: 5.1, totalROI: 11.2 },
  // Nottingham
  { id: 'not-1', city: 'Nottingham', area: 'Lenton',        postcode: 'NG7 2BY', address: '19 Derby Road',             propertyType: 'Terraced',      bedrooms: 3, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 215000, grossYield: 7.5, netYield: 5.8, totalROI: 10.4 },
  { id: 'not-2', city: 'Nottingham', area: 'West Bridgford', postcode: 'NG2 6AE', address: '7 Radcliffe Road',         propertyType: 'Semi-Detached', bedrooms: 3, tenure: 'Freehold',  epcRating: 'C', estimatedValue: 260000, grossYield: 7.0, netYield: 5.4, totalROI: 9.9  },
  { id: 'not-3', city: 'Nottingham', area: 'Beeston',       postcode: 'NG9 2JN', address: '44 High Road',              propertyType: 'Terraced',      bedrooms: 2, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 198000, grossYield: 7.7, netYield: 5.9, totalROI: 10.6 },
  // Birmingham
  { id: 'bir-1', city: 'Birmingham', area: 'Edgbaston',     postcode: 'B16 9RF', address: '12 Hagley Road',            propertyType: 'Flat',          bedrooms: 2, tenure: 'Leasehold', epcRating: 'C', estimatedValue: 210000, grossYield: 6.7, netYield: 5.1, totalROI: 9.8  },
  { id: 'bir-2', city: 'Birmingham', area: 'Erdington',     postcode: 'B24 0HR', address: '74 Sutton Road',            propertyType: 'Semi-Detached', bedrooms: 3, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 265000, grossYield: 7.5, netYield: 5.8, totalROI: 10.6 },
  { id: 'bir-3', city: 'Birmingham', area: 'Harborne',      postcode: 'B17 9LT', address: '3 Court Oak Road',          propertyType: 'Terraced',      bedrooms: 4, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 355000, grossYield: 6.1, netYield: 4.7, totalROI: 9.2  },
  // Sheffield
  { id: 'she-1', city: 'Sheffield',  area: 'Crookes',       postcode: 'S10 1UB', address: '28 Crookes Road',           propertyType: 'Terraced',      bedrooms: 4, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 248000, grossYield: 7.0, netYield: 5.4, totalROI: 10.3 },
  { id: 'she-2', city: 'Sheffield',  area: 'Hillsborough',  postcode: 'S6 4BE',  address: '15 Middlewood Road',        propertyType: 'Semi-Detached', bedrooms: 3, tenure: 'Freehold',  epcRating: 'C', estimatedValue: 215000, grossYield: 7.1, netYield: 5.5, totalROI: 10.4 },
  { id: 'she-3', city: 'Sheffield',  area: 'Nether Edge',   postcode: 'S7 1SQ',  address: '6 Brocco Bank',             propertyType: 'Flat',          bedrooms: 2, tenure: 'Leasehold', epcRating: 'B', estimatedValue: 175000, grossYield: 7.2, netYield: 5.6, totalROI: 10.5 },
  // Leeds
  { id: 'lee-1', city: 'Leeds',      area: 'Headingley',    postcode: 'LS6 3JA', address: '41 Otley Road',             propertyType: 'Terraced',      bedrooms: 4, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 290000, grossYield: 6.7, netYield: 5.2, totalROI: 10.3 },
  { id: 'lee-2', city: 'Leeds',      area: 'Chapel Allerton', postcode: 'LS7 4DS', address: '17 Harrogate Road',      propertyType: 'Semi-Detached', bedrooms: 3, tenure: 'Freehold',  epcRating: 'C', estimatedValue: 260000, grossYield: 6.9, netYield: 5.3, totalROI: 10.5 },
  { id: 'lee-3', city: 'Leeds',      area: 'Meanwood',      postcode: 'LS6 4BN', address: '9 Stonegate Road',          propertyType: 'Terraced',      bedrooms: 3, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 235000, grossYield: 7.2, netYield: 5.6, totalROI: 10.8 },
  // Bristol
  { id: 'bri-1', city: 'Bristol',    area: 'Bedminster',    postcode: 'BS3 3AX', address: '56 North Street',           propertyType: 'Terraced',      bedrooms: 3, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 375000, grossYield: 5.6, netYield: 4.2, totalROI: 7.7  },
  { id: 'bri-2', city: 'Bristol',    area: 'Clifton',       postcode: 'BS8 4ES', address: '3 Whiteladies Road',        propertyType: 'Flat',          bedrooms: 2, tenure: 'Leasehold', epcRating: 'C', estimatedValue: 380000, grossYield: 5.8, netYield: 4.4, totalROI: 7.9  },
  // London
  { id: 'lon-1', city: 'London',     area: 'Enfield',       postcode: 'EN3 6HY', address: '121 Albany Park Avenue',    propertyType: 'Terraced',      bedrooms: 4, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 520000, grossYield: 5.1, netYield: 3.8, totalROI: 1.8  },
  { id: 'lon-2', city: 'London',     area: 'Ilford',        postcode: 'IG1 1EX', address: '45 Cranbrook Road',         propertyType: 'Semi-Detached', bedrooms: 3, tenure: 'Freehold',  epcRating: 'D', estimatedValue: 455000, grossYield: 5.6, netYield: 4.2, totalROI: 2.3  },
  { id: 'lon-3', city: 'London',     area: 'Hackney',       postcode: 'N16 8QS', address: '12 Stoke Newington High St', propertyType: 'Flat',         bedrooms: 2, tenure: 'Leasehold', epcRating: 'C', estimatedValue: 565000, grossYield: 5.8, netYield: 4.4, totalROI: 2.5  },
]

// ── Helper functions ──────────────────────────────────────────────────────────

function extractFavBenchmarks(favouriteItems: Array<Record<string, unknown>>): FavBenchmarkItem[] {
  return favouriteItems.map(item => {
    const p = item.property as Record<string, unknown>
    const e = item.enriched as Record<string, unknown>
    const uprn = String(p?.uprn ?? '')
    const address = String(p?.full_address || p?.address || 'Unknown address')
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
      outcode,
      grossYield,
      propertyType,
      bedrooms,
      estimatedValue,
      city,
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

  const minBeds = beds.length ? Math.min(...beds) : 1
  const maxBeds = beds.length ? Math.max(...beds) : 5
  const avgYield = yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : 5
  const avgValue = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 300000
  const minValue = values.length ? Math.min(...values) * 0.5 : 80000
  const maxValue = values.length ? Math.max(...values) * 1.5 : 900000

  return {
    propertyTypes: types.length ? types : [],
    minBedrooms: Math.max(1, minBeds - 1),
    maxBedrooms: maxBeds + 1,
    avgGrossYield: avgYield,
    avgValue,
    minValue,
    maxValue,
    cities,
  }
}

function buildAiSummary(
  benchmark: BenchmarkProfile | null,
  criteria: PropertyFinderCriteria,
): string {
  if (!benchmark) return 'Set your criteria or favourite properties to generate AI matching summary.'
  const typeStr = benchmark.propertyTypes.length
    ? benchmark.propertyTypes.join(' or ')
    : 'any type'
  const bedStr = `${benchmark.minBedrooms}–${benchmark.maxBedrooms} beds`
  const yieldStr = `yield ≥${(benchmark.avgGrossYield - 0.5).toFixed(1)}%`
  const valStr = `£${Math.round(benchmark.minValue / 1000)}k–£${Math.round(benchmark.maxValue / 1000)}k`
  const cityStr = criteria.selectedCities.length <= 3
    ? criteria.selectedCities.join(', ')
    : `${criteria.selectedCities.length} cities`
  return `AI matching on: ${typeStr} · ${bedStr} · ${yieldStr} · ${valStr} · ${cityStr}`
}

function scoreCandidate(
  c: FinderCandidate,
  benchmark: BenchmarkProfile | null,
  criteria: PropertyFinderCriteria,
): { score: number; label: string; reasons: string[] } {
  const reasons: string[] = []

  if (!benchmark) {
    const inCity = criteria.selectedCities.includes(c.city)
    const score = inCity ? 72 : 60
    return { score, label: score >= 70 ? 'Good' : 'Fair', reasons: ['Matches city preference'] }
  }

  let score = 0

  // Property type match (15 pts)
  const typeMatch = !benchmark.propertyTypes.length ||
    benchmark.propertyTypes.some(t => t.toLowerCase() === c.propertyType.toLowerCase())
  if (typeMatch) { score += 15; reasons.push('Similar profile') }
  else score += 5

  // Bedroom range match (15 pts)
  if (c.bedrooms >= benchmark.minBedrooms && c.bedrooms <= benchmark.maxBedrooms) score += 15
  else if (Math.abs(c.bedrooms - Math.round((benchmark.minBedrooms + benchmark.maxBedrooms) / 2)) <= 1) score += 8

  // Yield vs benchmark (20 pts)
  if (c.grossYield >= benchmark.avgGrossYield + 1.0) { score += 20; reasons.push('Better yield') }
  else if (c.grossYield >= benchmark.avgGrossYield + 0.2) { score += 15; reasons.push('Better yield') }
  else if (c.grossYield >= benchmark.avgGrossYield - 0.5) score += 12
  else score += 5

  // Value/budget fit (15 pts)
  if (c.estimatedValue >= benchmark.minValue && c.estimatedValue <= benchmark.maxValue) score += 15
  else if (c.estimatedValue < benchmark.minValue) { score += 12; reasons.push('Lower entry cost') }
  else score += 4

  // City preference (10 pts)
  if (criteria.selectedCities.includes(c.city)) score += 10

  // EPC/tenure (10 pts)
  if (c.epcRating <= 'C') { score += 10; reasons.push('EPC compliant') }
  else if (c.epcRating <= 'D') score += 6
  else score += 2

  // ROI / capital efficiency (15 pts)
  const benchROI = benchmark.avgGrossYield - 1.2 + 2.5
  if (c.totalROI >= benchROI + 1.5) { score += 15; reasons.push('Strong ROI') }
  else if (c.totalROI >= benchROI) score += 10
  else score += 5

  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const label = clamped >= 90 ? 'Excellent' : clamped >= 80 ? 'Very good' : clamped >= 70 ? 'Good' : 'Fair'
  return { score: clamped, label, reasons: Array.from(new Set(reasons)) }
}

function reasonBox(result: FinderResult, benchmarkCities: string[]): {
  bg: string; border: string; textColor: string; icon: string; message: string
} {
  const isCrossCity = !benchmarkCities.includes(result.city)
  if (result.matchReasons.includes('Strong ROI')) {
    return { bg: 'bg-[#FFF7E6]', border: 'border-[#F5D48A]', textColor: 'text-[#B7791F]', icon: '✦', message: `${result.totalROI.toFixed(1)}% total ROI — strong capital efficiency` }
  }
  if (isCrossCity && result.matchReasons.includes('Better yield')) {
    return { bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]', textColor: 'text-[#1D4ED8]', icon: '↗', message: `Cross-city · ${result.grossYield.toFixed(1)}% yield in ${result.city} vs benchmark` }
  }
  if (isCrossCity) {
    return { bg: 'bg-[#EFF6FF]', border: 'border-[#BFDBFE]', textColor: 'text-[#1D4ED8]', icon: '↗', message: `Cross-city opportunity · ${result.city} ${result.area}` }
  }
  return { bg: 'bg-[#ECFDF5]', border: 'border-[#A7F3D0]', textColor: 'text-[#047857]', icon: '✓', message: 'Similar profile to your favourited properties' }
}

function applyEpcFilter(epc: string, pref: EpcFilter): boolean {
  if (pref === 'any') return true
  if (pref === 'a-c') return epc <= 'C'
  if (pref === 'a-d') return epc <= 'D'
  if (pref === 'exclude-e-f-g') return epc <= 'D'
  return true
}

function candidateToPropertyData(c: FinderCandidate): Record<string, unknown> {
  return {
    property: {
      full_address: `${c.address}, ${c.area}, ${c.city}`,
      address: c.address,
      postcode: c.postcode,
      property_type: c.propertyType,
      bedrooms: c.bedrooms,
      tenure: c.tenure,
      last_sold_price: c.estimatedValue,
    },
    enriched: {
      estimatedCurrentValue: c.estimatedValue,
      estimatedRent: Math.round((c.estimatedValue * c.grossYield) / 100 / 12),
      grossYield: c.grossYield,
      epcRating: c.epcRating,
      attrBedrooms: c.bedrooms,
    },
    epc: { current_energy_rating: c.epcRating },
    transactions: [],
    cityName: c.city,
    risks: [],
  }
}

function fmtVal(n: number): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`
  return `£${Math.round(n / 1000)}k`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MatchScoreBadge({ score, label }: { score: number; label: string }) {
  const bg = score >= 90 ? 'bg-[#047857] text-white' : score >= 80 ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' : 'bg-[#F3F4F6] text-[#374151]'
  return (
    <span className={`inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-full ${bg}`}>
      {score}% · {label}
    </span>
  )
}

function ResultCard({
  result,
  isFav,
  benchmarkCities,
  onToggleFav,
  onOpen,
}: {
  result: FinderResult
  isFav: boolean
  benchmarkCities: string[]
  onToggleFav: () => void
  onOpen: () => void
}) {
  const box = reasonBox(result, benchmarkCities)
  const isCrossCity = !benchmarkCities.includes(result.city)
  const cityPillColor = isCrossCity
    ? 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]'
    : 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
  const epcColor = result.epcRating <= 'C' ? 'text-[#047857]' : result.epcRating <= 'D' ? 'text-[#B7791F]' : 'text-[#DC2626]'

  return (
    <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] flex flex-col overflow-hidden hover:border-[#A7F3D0] transition-all">
      {/* Image / Header */}
      <div className="relative h-[120px] bg-gradient-to-br from-[#ECFDF5] to-[#F6F3EC] flex items-center justify-center">
        <span className="text-5xl opacity-30">🏠</span>
        <div className="absolute top-3 left-3">
          <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cityPillColor}`}>
            {result.city} · {result.postcode.split(' ')[0]}
          </span>
        </div>
        <div className="absolute top-3 right-10">
          <MatchScoreBadge score={result.matchScore} label={result.matchLabel} />
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggleFav() }}
          aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
          className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 hover:bg-white transition-colors border border-[#E7E5DD] text-base">
          <span className={isFav ? 'text-[#B7791F]' : 'text-[#D1D5DB]'}>{isFav ? '★' : '☆'}</span>
        </button>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1">
        {/* Address + tags */}
        <div className="mb-3">
          <p className="text-sm font-semibold text-[#111827] leading-snug mb-0.5" style={{ fontFamily: SERIF }}>
            {result.address}
          </p>
          <p className="text-xs text-[#6B7280]">{result.area} · {result.city} · {result.postcode}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[11px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{result.propertyType}</span>
            <span className="text-[11px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{result.bedrooms} bed</span>
            <span className="text-[11px] bg-[#F6F3EC] text-[#374151] px-2 py-0.5 rounded-full">{result.tenure}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${result.epcRating <= 'C' ? 'bg-[#ECFDF5]' : result.epcRating <= 'D' ? 'bg-[#FFF7E6]' : 'bg-[#FEF2F2]'} ${epcColor}`}>
              EPC {result.epcRating}
            </span>
          </div>
        </div>

        {/* Match reason tags */}
        {result.matchReasons.length > 0 && (
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {result.matchReasons.map(r => (
              <span key={r} className="text-[10px] font-semibold bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] px-2 py-0.5 rounded-full">{r}</span>
            ))}
          </div>
        )}

        {/* KPI tiles */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: 'Est. Value', value: fmtVal(result.estimatedValue), color: 'text-[#111827]' },
            { label: 'Gross Yield', value: `${result.grossYield.toFixed(1)}%`, color: result.grossYield >= 7 ? 'text-[#047857]' : 'text-[#111827]' },
            { label: 'Total ROI', value: `${result.totalROI.toFixed(1)}%`, color: result.totalROI >= 10 ? 'text-[#B7791F]' : 'text-[#111827]' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-[#FAF9F5] border border-[#F3F4F6] rounded-xl p-2.5 text-center">
              <p className="text-[9px] uppercase tracking-[0.06em] text-[#9CA3AF] mb-0.5">{kpi.label}</p>
              <p className={`font-bold text-sm ${kpi.color}`} style={{ fontFamily: SERIF }}>{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Reason box */}
        <div className={`rounded-xl px-3 py-2.5 border text-xs mb-3 ${box.bg} ${box.border}`}>
          <span className={`font-semibold ${box.textColor}`}>{box.icon} {box.message}</span>
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={onOpen}
          className="mt-auto w-full bg-[#047857] text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-[#065F46] transition-colors">
          Open Analysis →
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PropertyFinder({
  favouriteItems,
  favourites,
  onToggleFavourite,
  onAddToPortfolio,
  onOpenAnalysis,
  onGoToDiscover,
}: PropertyFinderProps) {

  const [finderTab, setFinderTab] = useState<FinderTab>('ai')
  const [sortBy, setSortBy] = useState<SortBy>('matchScore')

  // ── AI tab state ──
  const favBenchmarks = useMemo(() => extractFavBenchmarks(favouriteItems), [favouriteItems])

  const [selectedBenchmarkIds, setSelectedBenchmarkIds] = useState<string[]>(() =>
    favouriteItems.map(item => String((item.property as Record<string, unknown>)?.uprn ?? ''))
  )

  // Keep selectedBenchmarkIds in sync if favouriteItems changes (e.g. new favourite added)
  // We don't use useEffect here to avoid unnecessary re-renders — user can manually toggle

  const [selectedCities, setSelectedCities] = useState<string[]>(ALL_CITIES)

  // ── Custom tab state ──
  const [customCriteria, setCustomCriteria] = useState<PropertyFinderCriteria>({
    selectedCities: ALL_CITIES,
    targetGrossYield: 5.5,
    targetNetYield: 4.0,
    minValue: 100000,
    maxValue: 600000,
    propertyTypes: [],
    minBedrooms: 1,
    maxBedrooms: 5,
    tenure: 'any',
    epcPreference: 'any',
    useFavouritesAsBenchmark: true,
  })

  // ── Local finder favourites (for result cards) ────────────────────────────
  // Tracks which result cards the user has starred in this session.
  const [finderFavs, setFinderFavs] = useState<Set<string>>(new Set())
  const toggleFinderFav = useCallback((id: string, candidate: FinderCandidate) => {
    setFinderFavs(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        onAddToPortfolio(candidateToPropertyData(candidate))
      }
      return next
    })
  }, [onAddToPortfolio])

  // ── Benchmark derivation ──────────────────────────────────────────────────
  const benchmarkProfile = useMemo(
    () => deriveBenchmarkProfile(favBenchmarks, selectedBenchmarkIds),
    [favBenchmarks, selectedBenchmarkIds]
  )

  const aiCriteria: PropertyFinderCriteria = useMemo(() => ({
    selectedCities,
    targetGrossYield: benchmarkProfile?.avgGrossYield ?? 5.5,
    targetNetYield: (benchmarkProfile?.avgGrossYield ?? 5.5) - 1.5,
    minValue: benchmarkProfile?.minValue ?? 80000,
    maxValue: benchmarkProfile?.maxValue ?? 900000,
    propertyTypes: benchmarkProfile?.propertyTypes ?? [],
    minBedrooms: benchmarkProfile?.minBedrooms ?? 1,
    maxBedrooms: benchmarkProfile?.maxBedrooms ?? 5,
    tenure: 'any',
    epcPreference: 'any',
    useFavouritesAsBenchmark: true,
  }), [selectedCities, benchmarkProfile])

  const aiSummary = useMemo(() => buildAiSummary(benchmarkProfile, aiCriteria), [benchmarkProfile, aiCriteria])

  // ── Scored & filtered results (AI tab) ────────────────────────────────────
  const aiResults = useMemo<FinderResult[]>(() => {
    return ALL_CANDIDATES
      .filter(c => selectedCities.includes(c.city))
      .map(c => {
        const { score, label, reasons } = scoreCandidate(c, benchmarkProfile, aiCriteria)
        return { ...c, matchScore: score, matchLabel: label, matchReasons: reasons }
      })
  }, [selectedCities, benchmarkProfile, aiCriteria])

  // ── Scored & filtered results (Custom tab) ────────────────────────────────
  const customResults = useMemo<FinderResult[]>(() => {
    return ALL_CANDIDATES
      .filter(c => {
        if (!customCriteria.selectedCities.includes(c.city)) return false
        if (c.grossYield < customCriteria.targetGrossYield) return false
        if (c.estimatedValue < customCriteria.minValue || c.estimatedValue > customCriteria.maxValue) return false
        if (customCriteria.propertyTypes.length && !customCriteria.propertyTypes.includes(c.propertyType)) return false
        if (c.bedrooms < customCriteria.minBedrooms || c.bedrooms > customCriteria.maxBedrooms) return false
        if (customCriteria.tenure !== 'any' && c.tenure.toLowerCase() !== customCriteria.tenure) return false
        if (!applyEpcFilter(c.epcRating, customCriteria.epcPreference)) return false
        return true
      })
      .map(c => {
        const { score, label, reasons } = scoreCandidate(c, benchmarkProfile, customCriteria)
        return { ...c, matchScore: score, matchLabel: label, matchReasons: reasons }
      })
  }, [customCriteria, benchmarkProfile])

  // ── Sorted display results ────────────────────────────────────────────────
  const activeResults = finderTab === 'ai' ? aiResults : customResults

  const sortedResults = useMemo(() => {
    const copy = [...activeResults]
    switch (sortBy) {
      case 'grossYield':    return copy.sort((a, b) => b.grossYield - a.grossYield)
      case 'netYield':      return copy.sort((a, b) => b.netYield - a.netYield)
      case 'valueLowToHigh': return copy.sort((a, b) => a.estimatedValue - b.estimatedValue)
      case 'roi':           return copy.sort((a, b) => b.totalROI - a.totalROI)
      case 'epc':           return copy.sort((a, b) => a.epcRating.localeCompare(b.epcRating))
      default:              return copy.sort((a, b) => b.matchScore - a.matchScore)
    }
  }, [activeResults, sortBy])

  // ── Best cross-city match (for comparison strip) ─────────────────────────
  const bestCrossCity = useMemo(() => {
    if (!benchmarkProfile?.cities.length) return null
    return [...aiResults]
      .filter(r => !benchmarkProfile.cities.includes(r.city))
      .sort((a, b) => b.grossYield - a.grossYield)[0] ?? null
  }, [aiResults, benchmarkProfile])

  const benchmarkBest = useMemo(() => {
    if (!favBenchmarks.length) return null
    return favBenchmarks
      .filter(b => selectedBenchmarkIds.includes(b.id))
      .sort((a, b) => b.grossYield - a.grossYield)[0] ?? null
  }, [favBenchmarks, selectedBenchmarkIds])

  const citiesInResults = useMemo(
    () => Array.from(new Set(sortedResults.map(r => r.city))).length,
    [sortedResults]
  )

  // ── Toggle helpers ────────────────────────────────────────────────────────
  const toggleCity = useCallback((city: string) => {
    setSelectedCities(prev => {
      if (prev.includes(city)) {
        if (prev.length === 1) return prev // keep at least one
        return prev.filter(c => c !== city)
      }
      return [...prev, city]
    })
  }, [])

  const toggleBenchmark = useCallback((id: string) => {
    setSelectedBenchmarkIds(prev => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev // keep at least one
        return prev.filter(i => i !== id)
      }
      return [...prev, id]
    })
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#047857] mb-2">PROPERTY FINDER</p>
        <h1 className="text-[32px] font-bold text-[#111827] mb-2" style={{ fontFamily: SERIF, letterSpacing: '-0.02em' }}>
          Find your next investment
        </h1>
        <p className="text-sm text-[#6B7280]">
          AI matches properties across UK cities — same profile, better or equal returns
        </p>
      </div>

      {/* ── Internal tabs ───────────────────────────────────────────────── */}
      <div className="flex gap-0 border-b border-[#E7E5DD] mb-6">
        {([
          { id: 'ai',     label: 'AI recommendations' },
          { id: 'custom', label: 'Custom search'       },
          { id: 'saved',  label: 'Saved searches'      },
        ] as const).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFinderTab(t.id)}
            className={`px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
              finderTab === t.id
                ? 'border-[#047857] text-[#047857]'
                : 'border-transparent text-[#6B7280] hover:text-[#374151]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* AI RECOMMENDATIONS TAB                                              */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {finderTab === 'ai' && (
        <div className="space-y-5">

          {/* Benchmark favourites panel */}
          <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280]">Matching based on your favourites</h3>
                <p className="text-xs text-[#9CA3AF] mt-0.5">Select which favourited properties influence your recommendations</p>
              </div>
              <button
                type="button"
                onClick={onGoToDiscover}
                className="text-xs font-semibold text-[#047857] border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1.5 rounded-xl hover:bg-[#D1FAE5] transition-colors">
                View all favourites →
              </button>
            </div>

            {favBenchmarks.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-3xl mb-3">☆</p>
                <p className="text-sm font-semibold text-[#374151] mb-1">Favourite properties to unlock AI recommendations</p>
                <p className="text-xs text-[#9CA3AF] mb-4 max-w-[360px] mx-auto">
                  Save properties you like and Portfolai will find similar or better opportunities across selected cities.
                </p>
                <button
                  type="button"
                  onClick={onGoToDiscover}
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
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => toggleBenchmark(b.id)}
                        aria-pressed={isSelected}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                          isSelected
                            ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                            : 'bg-[#F6F3EC] border-[#E7E5DD] text-[#6B7280]'
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
                {selectedBenchmarkIds.length === 0 && (
                  <p className="text-xs text-[#DC2626] mb-2">Select at least one favourite to generate recommendations</p>
                )}
                {/* AI summary */}
                <div className="bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-4 py-3">
                  <p className="text-xs text-[#374151] leading-relaxed">
                    <span className="font-semibold text-[#047857]">🤖 AI matching:</span>{' '}
                    {aiSummary}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* City selector */}
          <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Search across cities</h3>
            <div className="flex gap-2 flex-wrap">
              {ALL_CITIES.map(city => {
                const isHome = city === 'London'
                const isSelected = selectedCities.includes(city)
                return (
                  <button
                    key={city}
                    type="button"
                    onClick={() => toggleCity(city)}
                    aria-pressed={isSelected}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                      isSelected && isHome
                        ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8]'
                        : isSelected
                        ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
                        : 'bg-white border-[#E7E5DD] text-[#9CA3AF]'
                    }`}>
                    {isHome ? `${city} (home)` : city}
                    {isSelected && <span className="ml-1">✓</span>}
                  </button>
                )
              })}
            </div>
            {selectedCities.length === 0 && (
              <p className="text-xs text-[#DC2626] mt-2">Select at least one city</p>
            )}
          </div>

          {/* Comparison strip */}
          {benchmarkBest && (
            <div className="bg-white border border-[#E7E5DD] rounded-2xl shadow-[0_8px_24px_rgba(17,24,39,0.04)] overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr]">
                {/* Left: benchmark */}
                <div className="p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9CA3AF] mb-1">Your benchmark</p>
                  <p className="text-sm font-semibold text-[#111827]" style={{ fontFamily: SERIF }}>
                    {benchmarkBest.outcode || benchmarkBest.city}
                  </p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span className="text-[11px] text-[#6B7280]">{benchmarkBest.grossYield.toFixed(1)}% yield</span>
                    {benchmarkBest.estimatedValue > 0 && (
                      <span className="text-[11px] text-[#6B7280]">{fmtVal(benchmarkBest.estimatedValue)}</span>
                    )}
                    {benchmarkBest.propertyType && <span className="text-[11px] text-[#6B7280]">{benchmarkBest.propertyType}</span>}
                    {benchmarkBest.bedrooms > 0 && <span className="text-[11px] text-[#6B7280]">{benchmarkBest.bedrooms} bed</span>}
                  </div>
                </div>
                <div className="hidden md:block w-px bg-[#E7E5DD]" />
                {/* Right: best cross-city */}
                <div className="p-5 bg-[#F6FFF8]">
                  {bestCrossCity ? (
                    <>
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#047857] mb-1">Best cross-city match</p>
                      <p className="text-sm font-semibold text-[#047857]" style={{ fontFamily: SERIF }}>
                        {bestCrossCity.city} · {bestCrossCity.area}
                      </p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-[11px] font-semibold text-[#047857]">{bestCrossCity.grossYield.toFixed(1)}% yield</span>
                        <span className="text-[11px] text-[#047857]">{fmtVal(bestCrossCity.estimatedValue)}</span>
                        {bestCrossCity.estimatedValue < (benchmarkBest.estimatedValue || 0) && (
                          <span className="text-[11px] bg-[#ECFDF5] text-[#047857] font-semibold px-2 py-0.5 rounded-full border border-[#A7F3D0]">
                            saves {fmtVal(benchmarkBest.estimatedValue - bestCrossCity.estimatedValue)}
                          </span>
                        )}
                        {bestCrossCity.grossYield > benchmarkBest.grossYield && (
                          <span className="text-[11px] bg-[#ECFDF5] text-[#047857] font-semibold px-2 py-0.5 rounded-full border border-[#A7F3D0]">
                            +{(bestCrossCity.grossYield - benchmarkBest.grossYield).toFixed(1)}% yield
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-[#9CA3AF]">No stronger cross-city equivalent found yet</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Results header */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm font-semibold text-[#374151]">
              <span className="text-[#111827]">{sortedResults.length}</span> matches across{' '}
              <span className="text-[#111827]">{citiesInResults}</span> {citiesInResults === 1 ? 'city' : 'cities'}
            </p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#6B7280]">Sort:</label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortBy)}
                className="bg-white border border-[#E7E5DD] text-xs font-medium text-[#374151] rounded-xl px-3 py-1.5 outline-none focus:border-[#047857] cursor-pointer">
                <option value="matchScore">Match score</option>
                <option value="grossYield">Highest gross yield</option>
                <option value="netYield">Highest net yield</option>
                <option value="valueLowToHigh">Lowest value</option>
                <option value="roi">Highest ROI</option>
                <option value="epc">EPC rating</option>
              </select>
            </div>
          </div>

          {/* Results grid */}
          {sortedResults.length === 0 ? (
            <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
              <p className="text-4xl mb-3">🔍</p>
              <p className="font-semibold text-[#374151] mb-2">No matching properties found</p>
              <p className="text-sm text-[#6B7280] max-w-[360px] mx-auto">
                Try selecting more cities or widening your yield, budget, or property-type filters.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sortedResults.map(result => (
                <ResultCard
                  key={result.id}
                  result={result}
                  isFav={finderFavs.has(result.id)}
                  benchmarkCities={benchmarkProfile?.cities ?? []}
                  onToggleFav={() => toggleFinderFav(result.id, result)}
                  onOpen={() => onOpenAnalysis(candidateToPropertyData(result))}
                />
              ))}
            </div>
          )}

          {/* Right-hand insight note */}
          <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-4">Why these results?</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {[
                { icon: '★', label: 'Matched to your favourites', color: 'text-[#B7791F]' },
                { icon: '📈', label: 'High yield potential',        color: 'text-[#047857]' },
                { icon: '⊞', label: 'Strong type similarity',      color: 'text-[#047857]' },
                { icon: '🏙', label: 'Area momentum',               color: 'text-[#374151]' },
              ].map(i => (
                <div key={i.label} className="text-center">
                  <p className={`text-2xl mb-1 ${i.color}`}>{i.icon}</p>
                  <p className="text-[11px] text-[#6B7280] leading-snug">{i.label}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-[#9CA3AF] leading-relaxed">
              The more properties you favourite and analyse, the smarter your recommendations become.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* CUSTOM SEARCH TAB                                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {finderTab === 'custom' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">

            {/* Left: filter form */}
            <div className="space-y-5">

              {/* Yield targets */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Yield targets</h3>
                <div className="space-y-5">
                  <div>
                    <div className="flex justify-between text-xs mb-2">
                      <label className="text-[#6B7280]">Min gross yield</label>
                      <span className="font-semibold text-[#047857]">{customCriteria.targetGrossYield.toFixed(1)}%</span>
                    </div>
                    <input type="range" min={3} max={12} step={0.5} value={customCriteria.targetGrossYield}
                      onChange={e => setCustomCriteria(p => ({ ...p, targetGrossYield: Number(e.target.value) }))}
                      className="w-full h-1.5 accent-[#047857]" />
                    <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>3%</span><span>12%</span></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-2">
                      <label className="text-[#6B7280]">Min net yield</label>
                      <span className="font-semibold text-[#047857]">{customCriteria.targetNetYield.toFixed(1)}%</span>
                    </div>
                    <input type="range" min={2} max={10} step={0.5} value={customCriteria.targetNetYield}
                      onChange={e => setCustomCriteria(p => ({ ...p, targetNetYield: Number(e.target.value) }))}
                      className="w-full h-1.5 accent-[#047857]" />
                    <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>2%</span><span>10%</span></div>
                  </div>
                </div>
              </div>

              {/* Budget */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-5">Budget / value range</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1.5 block">Min value £</label>
                    <input type="number" step={10000} value={customCriteria.minValue}
                      onChange={e => setCustomCriteria(p => ({ ...p, minValue: Number(e.target.value) }))}
                      className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-3 py-2.5 text-sm text-[#111827] outline-none focus:border-[#047857]" />
                  </div>
                  <div>
                    <label className="text-xs text-[#6B7280] mb-1.5 block">Max value £</label>
                    <input type="number" step={10000} value={customCriteria.maxValue}
                      onChange={e => setCustomCriteria(p => ({ ...p, maxValue: Number(e.target.value) }))}
                      className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-3 py-2.5 text-sm text-[#111827] outline-none focus:border-[#047857]" />
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
                      <button key={t} type="button"
                        onClick={() => setCustomCriteria(p => ({
                          ...p,
                          propertyTypes: active ? p.propertyTypes.filter(x => x !== t) : [...p.propertyTypes, t],
                        }))}
                        aria-pressed={active}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${active ? 'bg-[#047857] border-[#047857] text-white' : 'bg-white border-[#E7E5DD] text-[#6B7280] hover:border-[#047857] hover:text-[#047857]'}`}>
                        {t}
                      </button>
                    )
                  })}
                  {customCriteria.propertyTypes.length > 0 && (
                    <button type="button"
                      onClick={() => setCustomCriteria(p => ({ ...p, propertyTypes: [] }))}
                      className="px-3 py-1.5 rounded-full text-xs text-[#9CA3AF] hover:text-[#374151] transition-colors">
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
                    <label className="text-xs text-[#6B7280] mb-2 block">Min bedrooms: {customCriteria.minBedrooms}</label>
                    <input type="range" min={0} max={5} step={1} value={customCriteria.minBedrooms}
                      onChange={e => setCustomCriteria(p => ({ ...p, minBedrooms: Number(e.target.value) }))}
                      className="w-full h-1.5 accent-[#047857]" />
                    <div className="flex justify-between text-[10px] text-[#9CA3AF] mt-1"><span>Studio</span><span>5+</span></div>
                  </div>
                  <div>
                    <label className="text-xs text-[#6B7280] mb-2 block">Max bedrooms: {customCriteria.maxBedrooms}</label>
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
                    {([['any', 'Any'], ['freehold', 'Freehold'], ['leasehold', 'Leasehold']] as const).map(([val, label]) => (
                      <button key={val} type="button"
                        onClick={() => setCustomCriteria(p => ({ ...p, tenure: val }))}
                        className={`flex-1 py-2 text-xs font-medium transition-colors ${customCriteria.tenure === val ? 'bg-[#047857] text-white' : 'bg-white text-[#374151] hover:bg-[#F6F3EC]'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">EPC preference</h3>
                  <div className="flex flex-col gap-1.5">
                    {([
                      ['any', 'Any rating'],
                      ['a-c', 'A–C only'],
                      ['a-d', 'A–D only'],
                      ['exclude-e-f-g', 'Exclude E/F/G'],
                    ] as const).map(([val, label]) => (
                      <button key={val} type="button"
                        onClick={() => setCustomCriteria(p => ({ ...p, epcPreference: val }))}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-left transition-colors ${customCriteria.epcPreference === val ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' : 'text-[#6B7280] hover:bg-[#F6F3EC]'}`}>
                        <span className={`w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${customCriteria.epcPreference === val ? 'bg-[#047857] border-[#047857]' : 'border-[#D1D5DB]'}`}>
                          {customCriteria.epcPreference === val && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Cities */}
              <div className="bg-white border border-[#E7E5DD] rounded-2xl p-6 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">Area / cities</h3>
                <div className="flex gap-2 flex-wrap">
                  {ALL_CITIES.map(city => {
                    const active = customCriteria.selectedCities.includes(city)
                    return (
                      <button key={city} type="button"
                        onClick={() => setCustomCriteria(p => ({
                          ...p,
                          selectedCities: active
                            ? p.selectedCities.length > 1 ? p.selectedCities.filter(c => c !== city) : p.selectedCities
                            : [...p.selectedCities, city],
                        }))}
                        aria-pressed={active}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${active ? 'bg-[#047857] border-[#047857] text-white' : 'bg-white border-[#E7E5DD] text-[#6B7280]'}`}>
                        {city}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Right: results */}
            <div className="space-y-4">
              <div className="bg-white border border-[#A7F3D0] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6B7280] mb-3">
                  {customResults.length} matching {customResults.length === 1 ? 'property' : 'properties'}
                </p>
                {customResults.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-2xl mb-2">🔍</p>
                    <p className="text-sm text-[#9CA3AF]">No matching properties</p>
                    <p className="text-xs text-[#9CA3AF] mt-1">Try widening your yield, budget, area or property-type filters.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {customResults.slice(0, 5).map(r => (
                      <div key={r.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#F3F4F6] hover:border-[#A7F3D0] transition-all cursor-pointer"
                        onClick={() => onOpenAnalysis(candidateToPropertyData(r))}>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-[#111827] truncate">{r.address}</p>
                          <p className="text-[11px] text-[#9CA3AF]">{r.city} · {r.postcode}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-bold text-[#047857]">{r.grossYield.toFixed(1)}%</p>
                          <p className="text-[10px] text-[#9CA3AF]">{fmtVal(r.estimatedValue)}</p>
                        </div>
                      </div>
                    ))}
                    {customResults.length > 5 && (
                      <p className="text-xs text-center text-[#9CA3AF]">+{customResults.length - 5} more — adjust filters to narrow</p>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setSortBy('matchScore'); setFinderTab('ai') }}
                className="w-full bg-white border border-[#E7E5DD] text-[#374151] text-sm font-medium py-3 rounded-xl hover:bg-[#F6F3EC] transition-colors">
                Save search (coming soon)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SAVED SEARCHES TAB                                                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {finderTab === 'saved' && (
        <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
          <p className="text-4xl mb-3">🔖</p>
          <p className="font-semibold text-[#374151] mb-2">No saved searches yet</p>
          <p className="text-sm text-[#6B7280] max-w-[360px] mx-auto mb-6">
            Create a custom search and save it to monitor new opportunities as they appear.
          </p>
          <button
            type="button"
            onClick={() => setFinderTab('custom')}
            className="bg-[#047857] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#065F46] transition-colors">
            Create search →
          </button>
        </div>
      )}
    </div>
  )
}
