'use client'

interface HeroStatsProps {
  marketData: { macro: Record<string, number> }
}

export function HeroStats({ marketData }: HeroStatsProps) {
  const m = marketData.macro
  const stats = [
    { label: 'UK AVG PRICE',      value: `£${m.ukAvgPrice.toLocaleString()}`, sub: '+1.2% yr/yr · ONS' },
    { label: 'BoE BASE RATE',     value: `${m.bankRate}%`, sub: 'Down from 5.25% peak', green: true },
    { label: 'NAT. AVG YIELD',    value: `${m.ukAvgYield}%`, sub: 'Gross, England & Wales' },
    { label: 'RENTAL GROWTH',     value: `+${m.rentalGrowthForecast}%`, sub: '2026 forecast · ONS', green: true },
    { label: 'HPI FORECAST',      value: `+${m.hpiGrowthForecast}%`, sub: 'National consensus', green: true },
    { label: 'LONDON HPI',        value: `${m.londonHpi1yr}%`, sub: 'yr/yr · Feb 2026 ONS', red: true },
    { label: 'N. CITIES HPI',     value: `+${m.northernCitiesHpi1yr}%`, sub: 'Liverpool leads', green: true },
    { label: 'SDLT SURCHARGE',    value: `+${m.sdltSurcharge}%`, sub: 'Additional property', red: true },
  ]

  return (
    <div className="bg-gradient-to-b from-[#081525] to-bg border-b border-border px-6 py-7">
      <div className="max-w-[1320px] mx-auto">
        <div className="mb-5">
          <p className="text-[10px] font-mono tracking-[2px] text-accent mb-2">
            LIVE UK MARKET DATA · MAY 2026
          </p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-white leading-tight">
            The professional&apos;s{' '}
            <span className="text-accent">property intelligence</span> platform.
          </h1>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {stats.map(s => (
            <div key={s.label} className="bg-white/[0.025] border border-border rounded-xl p-3">
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
