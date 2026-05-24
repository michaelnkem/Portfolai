'use client'

import { useState } from 'react'
import { LineChart } from '@/components/ui'
import type { MARKET_DATA } from '@/lib/market-data'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'

const CITY_COLORS: Record<string, string> = {
  Manchester: '#059669', Birmingham: '#B7791F', Liverpool: '#2563EB',
  Leeds: '#7C3AED', Sheffield: '#DC2626', Bristol: '#EA580C',
  Nottingham: '#047857', London: '#0369A1',
}

interface MarketIntelProps {
  marketData: typeof MARKET_DATA
  onAI: (p: null) => void
  propertyContext?: Record<string, unknown> | null
}

export function MarketIntel({ marketData, onAI, propertyContext }: MarketIntelProps) {
  const [selected, setSelected] = useState(['Manchester', 'Birmingham', 'Liverpool', 'Leeds'])
  const toggle = (c: string) => setSelected(s => s.includes(c) ? s.filter(x => x !== c) : [...s, c])

  const cities = Object.keys(marketData.cities)

  // Property context extraction
  const ctxProperty = propertyContext?.property as Record<string, unknown> | undefined
  const ctxEnriched = propertyContext?.enriched as Record<string, unknown> | undefined
  const ctxCityName = propertyContext?.cityName as string | undefined
  const ctxAddress = String(ctxProperty?.full_address || ctxProperty?.address || '')
  const ctxPostcode = String(ctxProperty?.postcode ?? '')
  const ctxType = String(ctxProperty?.property_type ?? '')
  const ctxBeds = Number(ctxProperty?.bedrooms ?? ctxEnriched?.attrBedrooms ?? 0)
  const ctxValue = Number(ctxEnriched?.estimatedCurrentValue || ctxProperty?.last_sold_price || 0)
  const ctxGrossYield = Number(ctxEnriched?.grossYield || 0)
  const ctxCityData = ctxCityName ? marketData.cities[ctxCityName as keyof typeof marketData.cities] : null

  const hpiSeries = selected.map(c => ({
    name: c,
    data: marketData.hpiHistory[c as keyof typeof marketData.hpiHistory].filter((_, i) => i % 2 === 0),
    color: CITY_COLORS[c] ?? '#047857',
  }))

  const yieldSeries = selected.map(c => ({
    name: c,
    data: marketData.yieldHistory[c as keyof typeof marketData.yieldHistory],
    color: CITY_COLORS[c] ?? '#047857',
  }))

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#047857] mb-1">
            {ctxCityName ? `${ctxCityName.toUpperCase()} MARKET INTELLIGENCE` : 'LIVE MARKET INTELLIGENCE'}
          </p>
          <h2 className="text-2xl font-bold text-[#111827]" style={{ fontFamily: SERIF }}>
            {ctxCityName ? `${ctxCityName} Investment Analysis` : 'UK City Investment Analysis'}
          </h2>
        </div>
        <button onClick={() => onAI(null)}
          className="flex items-center gap-2 bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#D1FAE5] transition-colors">
          🤖 Market Q&A
        </button>
      </div>

      {/* Property context banner */}
      {propertyContext && ctxAddress && (
        <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl p-5 mb-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#047857] mb-3">
            Viewing local market context for this property
          </p>
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-[200px]">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-lg shrink-0 border border-[#A7F3D0]">🏠</div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#111827] truncate">{ctxAddress.split(',')[0]}</p>
                <p className="text-xs text-[#047857]">{ctxPostcode} · {ctxType}{ctxBeds > 0 ? ` · ${ctxBeds} bed` : ''}</p>
              </div>
            </div>
            <div className="flex gap-5 flex-wrap">
              {ctxValue > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[#6B7280] mb-0.5">Est. Value</p>
                  <p className="text-sm font-bold text-[#111827]" style={{ fontFamily: SERIF }}>£{ctxValue.toLocaleString()}</p>
                </div>
              )}
              {ctxGrossYield > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[#6B7280] mb-0.5">Gross Yield</p>
                  <p className="text-sm font-bold text-[#047857]">{ctxGrossYield.toFixed(1)}%</p>
                </div>
              )}
              {ctxCityData && (
                <>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#6B7280] mb-0.5">City Avg Yield</p>
                    <p className="text-sm font-bold text-[#047857]">{ctxCityData.avgYield}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#6B7280] mb-0.5">City 1yr HPI</p>
                    <p className={`text-sm font-bold ${ctxCityData.capitalGrowth1yr >= 0 ? 'text-[#047857]' : 'text-[#DC2626]'}`}>
                      {ctxCityData.capitalGrowth1yr > 0 ? '+' : ''}{ctxCityData.capitalGrowth1yr}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#6B7280] mb-0.5">City Avg Rent</p>
                    <p className="text-sm font-bold text-[#111827]">£{ctxCityData.avgRent}/mo</p>
                  </div>
                </>
              )}
            </div>
          </div>
          {ctxCityData && (
            <div className="mt-4 pt-4 border-t border-[#A7F3D0] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { label: 'Demand Score',      value: `${ctxCityData.demandScore}/100`,      color: ctxCityData.demandScore >= 70 ? '#047857' : '#B7791F' },
                { label: 'Regen Score',       value: `${ctxCityData.regenerationScore}/100`, color: ctxCityData.regenerationScore >= 60 ? '#047857' : '#B7791F' },
                { label: 'Infrastructure',    value: `${ctxCityData.infrastructureScore}/100`, color: ctxCityData.infrastructureScore >= 60 ? '#047857' : '#B7791F' },
                { label: '5yr Growth',        value: `+${ctxCityData.capitalGrowth5yr}%`,   color: '#047857' },
              ].map(row => (
                <div key={row.label} className="bg-white rounded-xl px-3 py-2.5 border border-[#A7F3D0]">
                  <p className="text-[#6B7280] mb-1">{row.label}</p>
                  <p className="font-bold text-sm" style={{ color: row.color }}>{row.value}</p>
                </div>
              ))}
            </div>
          )}
          {ctxCityData?.highlight && (
            <p className="text-xs text-[#375A50] mt-3 italic">"{ctxCityData.highlight}"</p>
          )}
        </div>
      )}

      {/* City selector */}
      <div className="flex gap-2 flex-wrap mb-6">
        {cities.map(c => (
          <button key={c} onClick={() => toggle(c)}
            className="px-3.5 py-1.5 rounded-full text-xs transition-all border"
            style={selected.includes(c) ? {
              borderColor: CITY_COLORS[c] ?? '#047857',
              background: `${CITY_COLORS[c] ?? '#047857'}18`,
              color: CITY_COLORS[c] ?? '#047857',
              fontWeight: 600,
            } : {
              borderColor: '#E7E5DD',
              color: '#6B7280',
            }}>
            {c}
            {c === ctxCityName && <span className="ml-1 text-[9px]">★</span>}
          </button>
        ))}
      </div>

      {/* City score cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {selected.map(c => {
          const d = marketData.cities[c as keyof typeof marketData.cities]
          const color = CITY_COLORS[c] ?? '#047857'
          return (
            <div key={c} className="bg-white border border-[#E7E5DD] rounded-2xl p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)]"
              style={{ borderTopColor: color, borderTopWidth: 3 }}>
              <p className="text-sm font-bold mb-3" style={{ color }}>{c}</p>
              <div className="space-y-1.5">
                {[
                  ['Avg price', `£${(d.avgPrice/1000).toFixed(0)}k`],
                  ['Gross yield', `${d.avgYield}%`],
                  ['1yr growth', `${d.capitalGrowth1yr > 0 ? '+' : ''}${d.capitalGrowth1yr}%`],
                  ['Avg rent', `£${d.avgRent}/mo`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-[#6B7280]">{k}</span>
                    <span className="text-[#111827] font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1">HOUSE PRICE INDEX 2016–2026 (BASE 100)</p>
          <p className="text-[10px] text-[#9CA3AF] mb-3">Source: ONS/HM Land Registry — sampled bi-annually</p>
          <div className="flex flex-wrap gap-3 mb-3">
            {selected.map(c => (
              <span key={c} className="flex items-center gap-1.5 text-[10px]" style={{ color: CITY_COLORS[c] ?? '#047857' }}>
                <span className="w-4 h-0.5 inline-block rounded" style={{ background: CITY_COLORS[c] ?? '#047857' }} />
                {c}
              </span>
            ))}
          </div>
          <LineChart
            series={hpiSeries}
            labels={marketData.hpiLabels.filter((_, i) => i % 2 === 0)}
            height={140}
          />
        </div>

        <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1">RENTAL YIELD TREND 2016–2026 (%)</p>
          <p className="text-[10px] text-[#9CA3AF] mb-3">Source: REalyse, Land Registry, proprietary analysis</p>
          <div className="flex flex-wrap gap-3 mb-3">
            {selected.map(c => (
              <span key={c} className="flex items-center gap-1.5 text-[10px]" style={{ color: CITY_COLORS[c] ?? '#047857' }}>
                <span className="w-4 h-0.5 inline-block rounded" style={{ background: CITY_COLORS[c] ?? '#047857' }} />
                {c}
              </span>
            ))}
          </div>
          <LineChart
            series={yieldSeries}
            labels={marketData.yieldLabels}
            height={140}
          />
        </div>
      </div>

      {/* Full city comparison table */}
      <div className="bg-white border border-[#E7E5DD] rounded-2xl overflow-hidden shadow-[0_8px_24px_rgba(17,24,39,0.04)] mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] px-5 pt-5 pb-3">FULL CITY COMPARISON TABLE</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#E7E5DD]">
                {['City', 'Avg Price', 'Gross Yield', '1yr HPI', '5yr HPI', 'Avg Rent', 'Demand', 'Regen Score', 'Key Theme'].map(h => (
                  <th key={h} className="text-left py-3 px-4 font-semibold text-[#9CA3AF] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cities.map(c => {
                const d = marketData.cities[c as keyof typeof marketData.cities]
                const isCtxCity = c === ctxCityName
                return (
                  <tr key={c} className={`border-b border-[#F3F4F6] hover:bg-[#FAF9F5] transition-colors ${isCtxCity ? 'bg-[#ECFDF5]' : ''}`}>
                    <td className="py-3 px-4 font-bold" style={{ color: CITY_COLORS[c] ?? '#047857' }}>
                      {c}{isCtxCity && <span className="ml-1 text-[9px]">★</span>}
                    </td>
                    <td className="py-3 px-4 font-semibold text-[#111827]">£{d.avgPrice.toLocaleString()}</td>
                    <td className="py-3 px-4 font-semibold text-[#047857]">{d.avgYield}%</td>
                    <td className={`py-3 px-4 font-semibold ${d.capitalGrowth1yr >= 0 ? 'text-[#047857]' : 'text-[#DC2626]'}`}>
                      {d.capitalGrowth1yr > 0 ? '+' : ''}{d.capitalGrowth1yr}%
                    </td>
                    <td className="py-3 px-4 font-semibold text-[#047857]">+{d.capitalGrowth5yr}%</td>
                    <td className="py-3 px-4 text-[#374151]">£{d.avgRent}/mo</td>
                    <td className="py-3 px-4 text-[#374151]">{d.demandScore}/100</td>
                    <td className="py-3 px-4 text-[#374151]">{d.regenerationScore}/100</td>
                    <td className="py-3 px-4 text-[#6B7280] max-w-[200px] truncate">{d.highlight}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Macro panel */}
      <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-4">UK MACRO ENVIRONMENT · MAY 2026</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'BoE RATE',      value: `${marketData.macro.bankRate}%`,                  sub: 'Down from 5.25%',     color: '#047857' },
            { label: 'CPI',           value: `${marketData.macro.inflation}%`,                 sub: 'Near target',         color: '#111827' },
            { label: 'UK AVG PRICE',  value: `£${(marketData.macro.ukAvgPrice/1000).toFixed(0)}k`, sub: '+1.2% yr/yr',    color: '#111827' },
            { label: 'RENTAL GROWTH', value: `+${marketData.macro.rentalGrowthForecast}%`,     sub: '2026 forecast',       color: '#047857' },
            { label: 'HPI FORECAST',  value: `+${marketData.macro.hpiGrowthForecast}%`,        sub: 'Analyst consensus',   color: '#047857' },
            { label: 'SDLT SURCHARGE',value: `+${marketData.macro.sdltSurcharge}%`,            sub: 'Additional property', color: '#DC2626' },
          ].map(s => (
            <div key={s.label} className="bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-1.5">{s.label}</p>
              <p className="font-bold text-xl leading-none" style={{ fontFamily: SERIF, color: s.color }}>{s.value}</p>
              <p className="text-[10px] text-[#9CA3AF] mt-1">{s.sub}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-[#9CA3AF] mt-4">
          Sources: ONS HPI Feb 2026 · Zoopla HPI April 2026 · Bank of England · REalyse · Land Registry · Nationwide HPI
        </p>
      </div>
    </div>
  )
}
