'use client'

import { useState } from 'react'
import { LineChart, Stat, SectionHeader } from '@/components/ui'
import type { MARKET_DATA } from '@/lib/market-data'

const CITY_COLORS: Record<string, string> = {
  Manchester: '#00d4aa', Birmingham: '#f0c040', Liverpool: '#4d9fff',
  Leeds: '#ff6b9d', Sheffield: '#a78bfa', Bristol: '#fb923c',
  Nottingham: '#34d399', London: '#f87171',
}

interface MarketIntelProps {
  marketData: typeof MARKET_DATA
  onAI: (p: null) => void
}

export function MarketIntel({ marketData, onAI }: MarketIntelProps) {
  const [selected, setSelected] = useState(['Manchester', 'Birmingham', 'Liverpool', 'Leeds'])
  const toggle = (c: string) => setSelected(s => s.includes(c) ? s.filter(x => x !== c) : [...s, c])

  const cities = Object.keys(marketData.cities)

  const hpiSeries = selected.map(c => ({
    name: c,
    data: marketData.hpiHistory[c as keyof typeof marketData.hpiHistory].filter((_, i) => i % 2 === 0),
    color: CITY_COLORS[c],
  }))

  const yieldSeries = selected.map(c => ({
    name: c,
    data: marketData.yieldHistory[c as keyof typeof marketData.yieldHistory],
    color: CITY_COLORS[c],
  }))

  return (
    <div>
      <SectionHeader
        eyebrow="LIVE MARKET INTELLIGENCE"
        title="UK City Investment Analysis"
        action={
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-dim">
              avgPrice &amp; 1yr growth live · {marketData.dataAsOf}
            </span>
            <button onClick={() => onAI(null)} className="btn-primary text-sm">
              🤖 Market Q&A
            </button>
          </div>
        }
      />

      {/* City selector */}
      <div className="flex gap-2 flex-wrap mb-6">
        {cities.map(c => (
          <button key={c} onClick={() => toggle(c)}
            className={`px-3.5 py-1.5 rounded-full text-xs transition-all border ${
              selected.includes(c)
                ? `border-[${CITY_COLORS[c]}] text-white`
                : 'border-border text-mid hover:border-mid'
            }`}
            style={selected.includes(c) ? {
              borderColor: CITY_COLORS[c],
              background: `${CITY_COLORS[c]}15`,
              color: CITY_COLORS[c],
            } : {}}>
            {c}
          </button>
        ))}
      </div>

      {/* City score cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {selected.map(c => {
          const d = marketData.cities[c as keyof typeof marketData.cities]
          const color = CITY_COLORS[c]
          return (
            <div key={c} className="card p-4" style={{ borderTopColor: color, borderTopWidth: 3 }}>
              <p className="text-sm font-bold mb-3" style={{ color }}>{c}</p>
              <div className="space-y-1.5">
                {[
                  ['Avg price', `£${(d.avgPrice/1000).toFixed(0)}k`],
                  ['Gross yield', `${d.avgYield}%`],
                  ['1yr growth', `${d.capitalGrowth1yr > 0 ? '+' : ''}${d.capitalGrowth1yr}%`],
                  ['Avg rent', `£${d.avgRent}/mo`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-mid">{k}</span>
                    <span className="text-white font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        <div className="card p-5">
          <p className="stat-label mb-1">HOUSE PRICE INDEX 2016–2026 (base 100)</p>
          <p className="text-[10px] text-dim mb-3">Source: ONS/HM Land Registry — sampled bi-annually</p>
          <div className="flex flex-wrap gap-3 mb-3">
            {selected.map(c => (
              <span key={c} className="flex items-center gap-1.5 text-[10px]" style={{ color: CITY_COLORS[c] }}>
                <span className="w-4 h-0.5 inline-block rounded" style={{ background: CITY_COLORS[c] }} />
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

        <div className="card p-5">
          <p className="stat-label mb-1">RENTAL YIELD TREND 2016–2026 (%)</p>
          <p className="text-[10px] text-dim mb-3">Source: REalyse, Land Registry, proprietary analysis</p>
          <div className="flex flex-wrap gap-3 mb-3">
            {selected.map(c => (
              <span key={c} className="flex items-center gap-1.5 text-[10px]" style={{ color: CITY_COLORS[c] }}>
                <span className="w-4 h-0.5 inline-block rounded" style={{ background: CITY_COLORS[c] }} />
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
      <div className="card overflow-hidden mb-5">
        <p className="stat-label p-5 pb-0 mb-3">FULL CITY COMPARISON TABLE</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {['City', 'Avg Price', 'Gross Yield', '1yr HPI', '5yr HPI', 'Avg Rent', 'Demand', 'Regen Score', 'Key Theme'].map(h => (
                  <th key={h} className="text-left py-3 px-4 font-mono text-dim">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cities.map(c => {
                const d = marketData.cities[c as keyof typeof marketData.cities]
                return (
                  <tr key={c} className="border-b border-border hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4 font-bold" style={{ color: CITY_COLORS[c] }}>{c}</td>
                    <td className="py-3 px-4 text-white">£{d.avgPrice.toLocaleString()}</td>
                    <td className="py-3 px-4 text-accent font-semibold">{d.avgYield}%</td>
                    <td className={`py-3 px-4 font-semibold ${d.capitalGrowth1yr >= 0 ? 'text-accent' : 'text-danger'}`}>
                      {d.capitalGrowth1yr > 0 ? '+' : ''}{d.capitalGrowth1yr}%
                    </td>
                    <td className="py-3 px-4 text-accent">+{d.capitalGrowth5yr}%</td>
                    <td className="py-3 px-4 text-white">£{d.avgRent}/mo</td>
                    <td className="py-3 px-4 text-white">{d.demandScore}/100</td>
                    <td className="py-3 px-4 text-white">{d.regenerationScore}/100</td>
                    <td className="py-3 px-4 text-mid max-w-[200px] truncate">{d.highlight}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Macro panel */}
      <div className="card p-5">
        <p className="stat-label mb-4">UK MACRO ENVIRONMENT · MAY 2026</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'BoE RATE', value: `${marketData.macro.bankRate}%`, sub: 'Down from 5.25%', tone: 'green' as const },
            { label: 'CPI', value: `${marketData.macro.inflation}%`, sub: 'Near target', tone: 'neutral' as const },
            { label: 'UK AVG PRICE', value: `£${(marketData.macro.ukAvgPrice/1000).toFixed(0)}k`, sub: '+1.2% yr/yr', tone: 'neutral' as const },
            { label: 'RENTAL GROWTH', value: `+${marketData.macro.rentalGrowthForecast}%`, sub: '2026 forecast', tone: 'green' as const },
            { label: 'HPI FORECAST', value: `+${marketData.macro.hpiGrowthForecast}%`, sub: 'Analyst consensus', tone: 'green' as const },
            { label: 'SDLT SURCHARGE', value: `+${marketData.macro.sdltSurcharge}%`, sub: 'Additional property', tone: 'red' as const },
          ].map(s => <Stat key={s.label} {...s} size="sm" />)}
        </div>
        <p className="text-[10px] text-dim mt-4">
          Sources: ONS HPI Feb 2026 · Zoopla HPI April 2026 · Bank of England · REalyse · Land Registry · Nationwide HPI
        </p>
      </div>
    </div>
  )
}
