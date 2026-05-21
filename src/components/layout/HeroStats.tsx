'use client'

import { useState } from 'react'
import { MARKET_DATA } from '@/lib/market-data'

type CityKey = keyof typeof MARKET_DATA.cities

interface HeroStatsProps {
  marketData: { macro: Record<string, number> }
}

export function HeroStats({ marketData }: HeroStatsProps) {
  const [selectedCity, setSelectedCity] = useState<CityKey | ''>('')
  const m = marketData.macro
  const cityKeys = Object.keys(MARKET_DATA.cities) as CityKey[]
  const cityData = selectedCity ? MARKET_DATA.cities[selectedCity] : null

  const stats = cityData
    ? [
        { label: 'AVG PRICE',       value: `£${cityData.avgPrice.toLocaleString()}`,           sub: `${selectedCity} avg · 2026` },
        { label: 'BoE BASE RATE',   value: `${m.bankRate}%`,                                   sub: 'Down from 5.25% peak', green: true },
        { label: 'AVG YIELD',       value: `${cityData.avgYield}%`,                            sub: 'Gross rental yield', green: true },
        { label: 'RENTAL GROWTH',   value: `+${m.rentalGrowthForecast}%`,                      sub: '2026 forecast · ONS', green: true },
        { label: 'HPI FORECAST',    value: `+${m.hpiGrowthForecast}%`,                         sub: 'National consensus', green: true },
        { label: 'CITY HPI 1YR',    value: `${cityData.capitalGrowth1yr > 0 ? '+' : ''}${cityData.capitalGrowth1yr}%`, sub: `${selectedCity} yr/yr · 2026`, green: cityData.capitalGrowth1yr > 0, red: cityData.capitalGrowth1yr < 0 },
        { label: '5YR HPI',         value: `+${cityData.capitalGrowth5yr}%`,                   sub: `${selectedCity} 5yr growth`, green: true },
        { label: 'SDLT SURCHARGE',  value: `+${m.sdltSurcharge}%`,                             sub: 'Additional property', red: true },
      ]
    : [
        { label: 'UK AVG PRICE',    value: `£${m.ukAvgPrice.toLocaleString()}`,                sub: '+1.2% yr/yr · ONS' },
        { label: 'BoE BASE RATE',   value: `${m.bankRate}%`,                                   sub: 'Down from 5.25% peak', green: true },
        { label: 'NAT. AVG YIELD',  value: `${m.ukAvgYield}%`,                                 sub: 'Gross, England & Wales' },
        { label: 'RENTAL GROWTH',   value: `+${m.rentalGrowthForecast}%`,                      sub: '2026 forecast · ONS', green: true },
        { label: 'HPI FORECAST',    value: `+${m.hpiGrowthForecast}%`,                         sub: 'National consensus', green: true },
        { label: 'UK HPI 1YR',      value: `+${m.ukHpi1yr}%`,                                  sub: 'yr/yr · ONS Feb 2026', green: true },
        { label: 'N. CITIES HPI',   value: `+${m.northernCitiesHpi1yr}%`,                      sub: 'Liverpool leads', green: true },
        { label: 'SDLT SURCHARGE',  value: `+${m.sdltSurcharge}%`,                             sub: 'Additional property', red: true },
      ]

  return (
    <div className="bg-gradient-to-b from-[#081525] to-bg border-b border-border px-6 py-7">
      <div className="max-w-[1320px] mx-auto">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <p className="text-[10px] font-mono tracking-[2px] text-accent mb-2">
              {selectedCity ? `${selectedCity.toUpperCase()} MARKET DATA` : 'LIVE UK MARKET DATA'} · MAY 2026
            </p>
            <h1 className="font-display font-black text-3xl md:text-4xl text-white leading-tight">
              The professional&apos;s{' '}
              <span className="text-accent">property intelligence</span> platform.
            </h1>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <select
              value={selectedCity}
              onChange={e => setSelectedCity(e.target.value as CityKey | '')}
              className="bg-white/[0.05] border border-border rounded-lg text-xs text-white font-mono px-3 py-2 appearance-none cursor-pointer hover:border-accent/40 transition-colors focus:outline-none focus:border-accent/60"
            >
              <option value="">UK National</option>
              {cityKeys.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
            {selectedCity && (
              <button
                onClick={() => setSelectedCity('')}
                className="text-[10px] text-dim hover:text-accent transition-colors font-mono whitespace-nowrap"
              >
                ✕ Reset
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {stats.map(s => (
            <div key={s.label} className={`bg-white/[0.025] border rounded-xl p-3 transition-colors ${selectedCity ? 'border-accent/20' : 'border-border'}`}>
              <p className="text-[9px] font-mono tracking-wide text-dim mb-1.5">{s.label}</p>
              <p className={`font-display font-black text-xl leading-none mb-1 ${
                s.green ? 'text-accent' : s.red ? 'text-danger' : 'text-white'
              }`}>{s.value}</p>
              <p className="text-[10px] text-dim">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
