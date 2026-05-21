'use client'

import { useState } from 'react'
import { MARKET_DATA } from '@/lib/market-data'

type CityKey = keyof typeof MARKET_DATA.cities

interface HeroStatsProps {
  marketData: {
    macro: Record<string, number>
    cities?: typeof MARKET_DATA.cities
    dataAsOf?: string
  }
}

export function HeroStats({ marketData }: HeroStatsProps) {
  const [selectedCity, setSelectedCity] = useState('')
  const m = marketData.macro
  const dataAsOf = marketData.dataAsOf?.toUpperCase() || 'MAY 2026'
  const cities = Object.keys(marketData.cities ?? MARKET_DATA.cities)
  const cityData = selectedCity
    ? (marketData.cities ?? MARKET_DATA.cities)[selectedCity as CityKey]
    : null

  const stats = cityData ? [
    { label: 'AVG PRICE',      value: `£${(cityData.avgPrice/1000).toFixed(0)}k`, sub: `${selectedCity} market avg` },
    { label: 'GROSS YIELD',    value: `${cityData.avgYield}%`,                    sub: 'Gross rental yield', green: true },
    { label: '1YR HPI',        value: `${cityData.capitalGrowth1yr >= 0 ? '+' : ''}${cityData.capitalGrowth1yr}%`, sub: 'Capital growth',
      green: cityData.capitalGrowth1yr > 0, red: cityData.capitalGrowth1yr < 0 },
    { label: '5YR HPI',        value: `+${cityData.capitalGrowth5yr}%`,           sub: 'Capital growth', green: true },
    { label: 'AVG RENT',       value: `£${cityData.avgRent}/mo`,                  sub: 'Monthly PCM' },
    { label: 'DEMAND',         value: `${cityData.demandScore}/100`,              sub: 'Tenant demand', green: true },
    { label: 'REGEN',          value: `${cityData.regenerationScore}/100`,        sub: 'Regeneration score', green: true },
    { label: 'SDLT',           value: `+${m.sdltSurcharge}%`,                    sub: 'Additional property', red: true },
  ] : [
    { label: 'UK AVG PRICE',   value: `£${(m.ukAvgPrice/1000).toFixed(0)}k`,     sub: '+1.2% yr/yr · ONS' },
    { label: 'BoE BASE RATE',  value: `${m.bankRate}%`,                          sub: 'Down from 5.25% peak', green: true },
    { label: 'NAT. AVG YIELD', value: `${m.ukAvgYield}%`,                        sub: 'Gross, England & Wales' },
    { label: 'RENTAL GROWTH',  value: `+${m.rentalGrowthForecast}%`,             sub: '2026 forecast · ONS', green: true },
    { label: 'HPI FORECAST',   value: `+${m.hpiGrowthForecast}%`,               sub: 'National consensus', green: true },
    { label: 'UK HPI 1YR',     value: '+1.2%',                                   sub: 'ONS Feb 2026' },
    { label: 'N. CITIES HPI',  value: `+${m.northernCitiesHpi1yr}%`,            sub: 'Liverpool leads', green: true },
    { label: 'SDLT SURCHARGE', value: `+${m.sdltSurcharge}%`,                   sub: 'Additional property', red: true },
  ]

  return (
    <div className="bg-gradient-to-b from-[#081525] to-bg border-b border-border px-6 py-7">
      <div className="max-w-[1320px] mx-auto">
        <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-mono tracking-[2px] text-accent mb-2">
              LIVE UK MARKET DATA · {dataAsOf}
            </p>
            <h1 className="font-display font-black text-3xl md:text-4xl text-white leading-tight">
              The professional&apos;s{' '}
              <span className="text-accent">property intelligence</span> platform.
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <p className="text-[10px] font-mono text-dim whitespace-nowrap">CITY VIEW</p>
            <select
              value={selectedCity}
              onChange={e => setSelectedCity(e.target.value)}
              className="bg-white/[0.04] border border-border text-xs font-mono text-white rounded-lg px-3 py-2 outline-none focus:border-accent cursor-pointer"
            >
              <option value="">UK National</option>
              {cities.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {stats.map(s => (
            <div key={s.label} className={`bg-white/[0.025] border rounded-xl p-3 transition-colors ${
              selectedCity ? 'border-accent/20' : 'border-border'
            }`}>
              <p className="text-[9px] font-mono tracking-wide text-dim mb-1.5">{s.label}</p>
              <p className={`font-display font-black text-xl leading-none mb-1 ${
                s.green ? 'text-accent' : s.red ? 'text-danger' : 'text-white'
              }`}>{s.value}</p>
              <p className="text-[10px] text-dim">{s.sub}</p>
            </div>
          ))}
        </div>
        {selectedCity && (
          <p className="text-[10px] text-accent/50 font-mono mt-3">
            Showing {selectedCity} · <button onClick={() => setSelectedCity('')} className="underline hover:text-accent">Reset to UK</button>
          </p>
        )}
      </div>
    </div>
  )
}
