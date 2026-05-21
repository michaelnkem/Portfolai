'use client'

import { useState } from 'react'
import { Stat, ScoreRing, Badge, LineChart, Divider } from '@/components/ui'
import { calcSDLT, calcMortgagePayment, calcNetMonthlyIncome, MARKET_DATA } from '@/lib/market-data'

interface PropertyDetailProps {
  data: Record<string, unknown>
  onClose: () => void
  onAI: () => void
  onAddPortfolio: () => void
}

type DetailTab = 'overview' | 'financials' | 'history' | 'risks'

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = dateStr.split('T')[0]
  const parts = d.split('-')
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`
  return dateStr
}

export function PropertyDetail({ data, onClose, onAI, onAddPortfolio }: PropertyDetailProps) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [rent, setRent] = useState<number>(0)
  const [deposit, setDeposit] = useState(0)
  const [mortRate, setMortRate] = useState(4.8)
  const [mortYears, setMortYears] = useState(25)
  const [serviceCharge, setServiceCharge] = useState(0)
  const [groundRent, setGroundRent] = useState(0)
  const [mgmtFee, setMgmtFee] = useState(10)
  const [maintenance, setMaintenance] = useState(1.5)
  const [voidWks, setVoidWks] = useState(2)
  const [rentSet, setRentSet] = useState(false)

  const p = data.property as Record<string, unknown>
  const enriched = data.enriched as Record<string, unknown>
  const epc = data.epc as Record<string, unknown> | null
  const risks = data.risks as Array<Record<string, unknown>> | undefined
  const transactions = data.transactions as Array<Record<string, unknown>> | undefined
  const cityName = data.cityName as string
  const cityData = cityName ? MARKET_DATA.cities[cityName as keyof typeof MARKET_DATA.cities] : null

  const effectiveRent = rentSet ? rent : (enriched?.estimatedRent as number || 0)
  const price = Number(p?.last_sold_price ?? 0)

  const soldYear = Number(String(p?.last_sold_date ?? '2020').slice(0, 4))
  const yearsHeld = Math.max(0, new Date().getFullYear() - soldYear)
  const annualGrowth = cityData ? (cityData.capitalGrowth5yr / 5) / 100 : 0.025
  const estimatedCurrentValue = (enriched?.estimatedCurrentValue as number)
    || (price ? Math.round(price * Math.pow(1 + annualGrowth, yearsHeld)) : 0)

  const grossYield = price && effectiveRent ? parseFloat(((effectiveRent * 12 / price) * 100).toFixed(2)) : 0
  const netYield = price && effectiveRent ? parseFloat((
    calcNetMonthlyIncome(price, effectiveRent, serviceCharge, groundRent, mgmtFee, maintenance, voidWks)
    * 12 / price * 100
  ).toFixed(2)) : 0
  const netMonthly = price && effectiveRent ? calcNetMonthlyIncome(price, effectiveRent, serviceCharge, groundRent, mgmtFee, maintenance, voidWks) : 0
  const capitalGrowth = cityData?.capitalGrowth1yr || 0
  const totalROI = parseFloat((netYield + capitalGrowth).toFixed(1))
  const sdlt = price ? calcSDLT(price, true) : 0
  const mort = price && deposit ? calcMortgagePayment(price, deposit, mortRate, mortYears) : null
  const cashflow = mort ? netMonthly - mort.monthly : netMonthly

  const epcRating = String(enriched?.epcRating || p?.current_energy_rating || '?')

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview',   label: 'Overview' },
    { id: 'financials', label: 'Financials' },
    { id: 'history',    label: 'History' },
    { id: 'risks',      label: 'Risks' },
  ]

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-bg/80 backdrop-blur-sm" onClick={onClose} />

      <div className="w-full max-w-3xl bg-panel border-l border-border overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-panel border-b border-border p-5 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-mono tracking-wide text-accent mb-2">PROPERTY ANALYSIS</p>
            <h2 className="font-display font-black text-2xl text-white leading-tight mb-1">
              {String(p?.full_address || p?.address || 'Unknown Address')}
            </h2>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {p?.postcode && (
                <span className="text-xs font-mono bg-accent/10 border border-accent/20 text-accent px-2 py-0.5 rounded">
                  {String(p.postcode)}
                </span>
              )}
              {p?.property_type && (
                <span className="text-xs text-mid">{String(p.property_type)}</span>
              )}
              {(p?.bedrooms != null && p?.bedrooms !== '') && (
                <span className="text-xs text-mid">· {String(p.bedrooms)} bed</span>
              )}
              {cityName && (
                <span className="text-xs text-mid">· {String(cityName)}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0 items-center">
            <button onClick={onAI} className="btn-primary text-xs px-3 py-2">🤖 AI</button>
            <button
              onClick={onAddPortfolio}
              className="bg-gold/15 border border-gold/40 text-gold text-xs font-bold px-4 py-2 rounded-lg hover:bg-gold/25 transition-colors whitespace-nowrap"
            >
              + Add to Portfolio
            </button>
            <button onClick={onClose} className="btn-ghost text-xs px-3 py-2">✕</button>
          </div>
        </div>

        {/* Key metrics */}
        <div className="p-5 grid grid-cols-2 sm:grid-cols-5 gap-3 border-b border-border">
          <Stat
            label="EST. CURRENT VALUE"
            value={estimatedCurrentValue ? `£${estimatedCurrentValue.toLocaleString()}` : 'No record'}
            tone="green"
          />
          <Stat
            label="LAST SOLD PRICE"
            value={price ? `£${price.toLocaleString()}` : 'No record'}
            sub={p?.last_sold_date ? `Sold ${formatDate(String(p.last_sold_date))}` : undefined}
          />
          <Stat label="GROSS YIELD" value={grossYield ? `${grossYield}%` : 'Set rent →'}
                tone={grossYield > 6 ? 'green' : 'neutral'}
                sub={cityData ? `Area avg ${cityData.avgYield}%` : undefined} />
          <Stat label="NET YIELD" value={netYield ? `${netYield}%` : '—'} tone={netYield > 4 ? 'green' : 'neutral'} sub="after all costs" />
          <Stat label="TOTAL ROI" value={totalROI ? `${totalROI}%` : '—'} tone="gold" sub="net yield + cap growth" />
        </div>

        {/* Tabs */}
        <div className="px-5 pt-4 flex gap-1 border-b border-border pb-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-xs rounded-t-lg border-b-2 transition-all ${
                tab === t.id
                  ? 'border-accent text-accent bg-accent/5'
                  : 'border-transparent text-mid hover:text-white'
              }`}>{t.label}</button>
          ))}
        </div>

        <div className="p-5 flex-1">

          {/* OVERVIEW */}
          {tab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="card p-5">
                  <p className="stat-label mb-4">PROPERTY ATTRIBUTES</p>
                  {[
                    ['Type', String(p?.property_type ?? '')],
                    ['Bedrooms', (p?.bedrooms != null && p?.bedrooms !== '') ? String(p.bedrooms) : null],
                    ['Floor area', p?.internal_area_sqm ? `${p.internal_area_sqm}m²` : p?.epc_floor_area ? `${p.epc_floor_area}m²` : null],
                  ].filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                    <div key={k as string} className="flex justify-between py-2 border-b border-border text-sm">
                      <span className="text-mid">{k}</span>
                      <span className="text-white font-medium">{v as string}</span>
                    </div>
                  ))}
                </div>

                {cityData && (
                  <div className="space-y-4">
                    <div className="card p-5">
                      <p className="stat-label mb-4">CITY INVESTMENT SCORES</p>
                      <div className="flex justify-around">
                        <ScoreRing score={cityData.demandScore} label="DEMAND" />
                        <ScoreRing score={100 - cityData.supplyScore} label="SUPPLY GAP" />
                        <ScoreRing score={cityData.regenerationScore} label="REGEN" />
                        <ScoreRing score={cityData.infrastructureScore} label="INFRA" />
                      </div>
                    </div>
                    <CityMarketPanel
                      cityName={cityName}
                      cityData={cityData}
                      propertyPrice={price}
                      estimatedCurrentValue={estimatedCurrentValue}
                      propertyGrossYield={grossYield}
                      propertyNetYield={netYield}
                      propertyRent={effectiveRent}
                      propertyBeds={Number(p?.bedrooms ?? 2)}
                    />
                  </div>
                )}
              </div>

              <div className="card p-4 text-xs text-mid flex gap-4 flex-wrap">
                <span>UPRN: <strong className="text-white">{String(p?.uprn ?? '')}</strong></span>
                <span>Postcode: <strong className="text-white">{String(p?.postcode ?? '')}</strong></span>
                <span>Last sold: <strong className="text-white">{formatDate(String(p?.last_sold_date ?? '')) || 'No record'}</strong></span>
                {p?.last_sold_price ? <span>At: <strong className="text-white">£{Number(p.last_sold_price).toLocaleString()}</strong></span> : null}
              </div>
            </div>
          )}

          {/* FINANCIALS */}
          {tab === 'financials' && (
            <div className="space-y-5">
              <div className="card p-5 border-accent/30">
                <p className="stat-label mb-3">ENTER MONTHLY RENT (£)</p>
                <div className="flex gap-3 items-center">
                  <input
                    type="number"
                    value={rent || ''}
                    onChange={e => { setRent(Number(e.target.value)); setRentSet(true) }}
                    placeholder={`Estimated: £${enriched?.estimatedRent || '—'}`}
                    className="flex-1 bg-bg border border-border rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    {[defaultServiceCharge(p), 0].map(v => v).filter(Boolean).map(v => (
                      <button key={v} onClick={() => { setServiceCharge(v); setGroundRent(p?.tenure === 'Leasehold' ? 200 : 0) }}
                        className="btn-ghost text-xs py-2 px-3">
                        Set defaults
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-mid mt-2">
                  💡 Verify with local letting agents. Estimate based on {String(cityName)} {String(p?.bedrooms ?? '')}-bed market rate.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="card p-4 space-y-3">
                  <p className="stat-label">ANNUAL COSTS</p>
                  {[
                    { label: `Service charge (£/yr)`, val: serviceCharge, set: setServiceCharge, step: 100, min: 0, max: 10000 },
                    { label: `Ground rent (£/yr)`, val: groundRent, set: setGroundRent, step: 50, min: 0, max: 1000 },
                  ].map(f => (
                    <div key={f.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-mid">{f.label}</span>
                        <span className="text-white">£{f.val}</span>
                      </div>
                      <input type="range" min={f.min} max={f.max} step={f.step} value={f.val}
                        onChange={e => f.set(Number(e.target.value))}
                        className="w-full accent-accent" />
                    </div>
                  ))}
                  {[
                    { label: `Management fee (${mgmtFee}%)`, val: mgmtFee, set: setMgmtFee, step: 1, min: 0, max: 20 },
                    { label: `Maintenance (${maintenance}% of value)`, val: maintenance, set: setMaintenance, step: 0.5, min: 0, max: 5 },
                    { label: `Void weeks/yr: ${voidWks}`, val: voidWks, set: setVoidWks, step: 0.5, min: 0, max: 8 },
                  ].map(f => (
                    <div key={f.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-mid">{f.label}</span>
                      </div>
                      <input type="range" min={f.min} max={f.max} step={f.step} value={f.val}
                        onChange={e => f.set(Number(e.target.value))}
                        className="w-full accent-accent" />
                    </div>
                  ))}
                </div>

                <div className="card p-4">
                  <p className="stat-label mb-3">ANNUAL P&L</p>
                  {[
                    { k: 'Gross rent', v: `+£${(effectiveRent * 12).toLocaleString()}`, green: true },
                    { k: `Voids (${voidWks}wk)`, v: `-£${Math.round(effectiveRent * voidWks / 4.33).toLocaleString()}`, red: true },
                    { k: `Mgmt (${mgmtFee}%)`, v: `-£${Math.round(effectiveRent * 12 * mgmtFee / 100).toLocaleString()}`, red: true },
                    { k: `Maintenance`, v: `-£${Math.round((price || 0) * maintenance / 100).toLocaleString()}`, red: true },
                    { k: 'Service charge', v: `-£${serviceCharge.toLocaleString()}`, red: serviceCharge > 0 },
                    { k: 'Ground rent', v: `-£${groundRent.toLocaleString()}`, red: groundRent > 0 },
                    { k: 'NET INCOME', v: `£${(netMonthly * 12).toLocaleString()}`, bold: true },
                  ].map(row => (
                    <div key={row.k} className={`flex justify-between py-2 border-b border-border text-sm ${row.bold ? 'font-bold' : ''}`}>
                      <span className="text-mid">{row.k}</span>
                      <span className={row.bold ? 'text-gold' : row.green ? 'text-accent' : row.red ? 'text-danger' : 'text-white'}>
                        {row.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-5">
                <p className="stat-label mb-4">MORTGAGE CASHFLOW MODELLER</p>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  {[
                    { label: `Deposit: £${deposit.toLocaleString()} (${price ? Math.round(deposit/price*100) : 0}%)`, val: deposit, set: setDeposit, min: price * 0.2, max: price * 0.5, step: 5000 },
                    { label: `Rate: ${mortRate}% p.a.`, val: mortRate, set: setMortRate, min: 3.0, max: 9.0, step: 0.1 },
                    { label: `Term: ${mortYears} years`, val: mortYears, set: setMortYears, min: 5, max: 35, step: 5 },
                  ].map(f => (
                    <div key={f.label}>
                      <p className="text-xs text-mid mb-2">{f.label}</p>
                      <input type="range" min={f.min} max={f.max} step={f.step} value={f.val}
                        onChange={e => f.set(Number(e.target.value))}
                        className="w-full accent-accent" />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <Stat label="LTV" value={mort ? `${mort.ltv}%` : '—'} />
                  <Stat label="MORTGAGE PMT" value={mort ? `£${mort.monthly.toLocaleString()}/mo` : '—'} tone="red" />
                  <Stat label="NET INCOME" value={`£${netMonthly.toLocaleString()}/mo`} tone="green" />
                  <Stat label="CASHFLOW" value={`£${cashflow.toLocaleString()}/mo`}
                        tone={cashflow >= 0 ? 'green' : 'red'}
                        sub={cashflow >= 0 ? 'Positive ✓' : 'Negative ⚠'} />
                </div>
                {price && <p className="text-xs text-mid mt-3">SDLT (additional property): <strong className="text-white">£{sdlt.toLocaleString()}</strong> · Total acquisition cost: <strong className="text-white">£{(price + sdlt).toLocaleString()}</strong></p>}
              </div>
            </div>
          )}

          {/* HISTORY */}
          {tab === 'history' && (
            <div className="space-y-5">
              {transactions && transactions.length > 0 ? (
                <>
                  <div className="card p-5">
                    <p className="stat-label mb-4">PRICE HISTORY — LAND REGISTRY</p>
                    {transactions.length >= 2 && (
                      <div className="mb-4">
                        <LineChart
                          series={[{ name: 'Sale price', data: transactions.slice().reverse().map(t => Number(t.price ?? 0)), color: '#00d4aa' }]}
                          labels={transactions.slice().reverse().map(t => String(t.date ?? '').slice(0, 7))}
                          height={100}
                        />
                      </div>
                    )}
                    <div className="space-y-0">
                      {transactions.map((t, i) => (
                        <div key={i} className="flex justify-between py-2.5 border-b border-border text-sm">
                          <span className="text-mid">{formatDate(String(t.date ?? ''))}</span>
                          <span className="text-white font-semibold">£{Number(t.price ?? 0).toLocaleString()}</span>
                          <span className="text-dim text-xs">{String(t.transaction_type ?? '')}</span>
                          {i < transactions.length - 1 && (
                            <span className={`text-xs ${Number(t.price ?? 0) > Number(transactions[i+1].price ?? 0) ? 'text-accent' : 'text-danger'}`}>
                              {Number(t.price ?? 0) > Number(transactions[i+1].price ?? 0) ? '↑' : '↓'}
                              {Math.abs(Math.round((Number(t.price ?? 0)/Number(transactions[i+1].price ?? 1) - 1) * 100))}%
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="card p-4">
                    <p className="stat-label mb-2">DATA SOURCE</p>
                    <p className="text-xs text-mid">Transaction data provided by HM Land Registry via Homedata API. Includes all registered sales at market value. Data updated monthly.</p>
                  </div>
                </>
              ) : (
                <div className="card p-8 text-center">
                  <p className="text-3xl mb-3">📋</p>
                  <p className="text-white font-semibold mb-2">No transaction history found</p>
                  <p className="text-mid text-sm">This property may be newly built or not yet registered with HM Land Registry.</p>
                </div>
              )}
            </div>
          )}

          {/* RISKS */}
          {tab === 'risks' && (
            <div className="space-y-4">
              <div className="card p-5">
                <p className="stat-label mb-3">EPC RATING</p>
                <div className="flex items-center gap-4">
                  <div className={`text-5xl font-display font-black ${
                    epcRating <= 'B' ? 'text-accent' : epcRating <= 'D' ? 'text-gold' : 'text-danger'
                  }`}>{epcRating}</div>
                  <div className="space-y-1">
                    <p className="text-sm text-white font-semibold">Energy Performance Certificate</p>
                    {epc?.current_energy_efficiency && (
                      <p className="text-xs text-mid">
                        Score: {String(epc.current_energy_efficiency)}/100 · Potential: {String(epc?.potential_energy_efficiency ?? '?')}/100
                      </p>
                    )}
                    <p className="text-xs text-mid">
                      Last assessed: {epc?.last_epc_date ? formatDate(String(epc.last_epc_date)) : 'Unknown'}
                    </p>
                  </div>
                </div>
              </div>

              {risks && risks.length > 0 && (
                <div className="card p-5">
                  <p className="stat-label mb-3">ENVIRONMENTAL RISKS — HOMEDATA</p>
                  <div className="space-y-2">
                    {risks.map((r, i) => {
                      const score = Number(r.score ?? 0)
                      const label = String(r.label ?? '')
                      const riskType = String(r.risk_type ?? '')
                      const tone = score <= 1 ? 'text-accent' : score <= 2 ? 'text-gold' : 'text-danger'
                      return (
                        <div key={i} className="flex justify-between items-center py-2 border-b border-border text-sm">
                          <span className="text-mid capitalize">{riskType.replace(/_/g, ' ')}</span>
                          <span className={`font-semibold ${tone}`}>{label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="card p-5">
                <p className="stat-label mb-3">INVESTMENT RISK FACTORS</p>
                {[
                  { risk: 'Rental void risk', note: `${voidWks} weeks/yr = £${Math.round(effectiveRent * voidWks / 4.33).toLocaleString()} lost income`, severity: voidWks > 4 ? 'high' : 'med' },
                  { risk: 'Capital growth risk', note: `${cityName} 1yr: ${capitalGrowth > 0 ? '+' : ''}${capitalGrowth}% vs national avg +${MARKET_DATA.macro.hpiGrowthForecast}%`, severity: capitalGrowth < 2 ? 'high' : 'low' },
                  { risk: 'Leasehold risk', note: p?.tenure === 'Leasehold' ? 'Leasehold — check years remaining and extension cost' : 'Freehold — no leasehold risk', severity: p?.tenure === 'Leasehold' ? 'med' : 'low' },
                  { risk: 'Interest rate risk', note: `At ${mortRate}% BTL rate — stress test at +2% (${(mortRate + 2).toFixed(1)}%)`, severity: 'med' },
                ].map(r => (
                  <div key={r.risk} className="flex gap-3 p-3 rounded-lg mb-2" style={{
                    background: r.severity === 'high' ? 'rgba(255,77,109,0.06)' : r.severity === 'med' ? 'rgba(240,192,64,0.06)' : 'rgba(0,212,170,0.06)',
                    border: `1px solid ${r.severity === 'high' ? 'rgba(255,77,109,0.2)' : r.severity === 'med' ? 'rgba(240,192,64,0.2)' : 'rgba(0,212,170,0.2)'}`,
                  }}>
                    <span>{r.severity === 'high' ? '🔴' : r.severity === 'med' ? '🟡' : '🟢'}</span>
                    <div>
                      <p className="text-sm font-semibold text-white">{r.risk}</p>
                      <p className="text-xs text-mid">{r.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function CityMarketPanel({
  cityName, cityData, propertyPrice, estimatedCurrentValue, propertyGrossYield, propertyNetYield, propertyRent, propertyBeds
}: {
  cityName: string
  cityData: Record<string, number>
  propertyPrice: number
  estimatedCurrentValue: number
  propertyGrossYield: number
  propertyNetYield: number
  propertyRent: number
  propertyBeds: number
}) {
  const [selectedCity, setSelectedCity] = useState(cityName)
  const bedroomKey = (beds: number) => beds === 0 ? 'studio' : `${beds}bed`
  const defaultBedKey = bedroomKey(propertyBeds)
  const [selectedBed, setSelectedBed] = useState(defaultBedKey)

  const cities = Object.keys(MARKET_DATA.cities)
  const cityAvg = MARKET_DATA.cities[selectedCity as keyof typeof MARKET_DATA.cities] || cityData
  const bedroomData = (MARKET_DATA.cityByBedroom as Record<string, Record<string, { avgPrice: number; avgRent: number; avgYield: number }>>)[selectedCity]?.[selectedBed]

  const compAvgPrice = bedroomData?.avgPrice ?? cityAvg.avgPrice
  const compAvgRent  = bedroomData?.avgRent  ?? cityAvg.avgRent
  const compAvgYield = bedroomData?.avgYield ?? cityAvg.avgYield
  const displayPrice = estimatedCurrentValue || propertyPrice

  const BEDS = [
    { key: 'studio', label: 'Studio' },
    { key: '1bed',   label: '1 Bed' },
    { key: '2bed',   label: '2 Bed' },
    { key: '3bed',   label: '3 Bed' },
    { key: '4bed',   label: '4 Bed' },
  ]

  const fmt = (v: number) => v ? `£${v.toLocaleString()}` : '—'
  const pct = (v: number) => v ? `${v.toFixed(1)}%` : '—'
  const diff = (prop: number, city: number, higherIsBetter = true) => {
    if (!prop || !city) return null
    const d = prop - city
    const better = higherIsBetter ? d > 0 : d < 0
    return (
      <span className={`text-[10px] ml-1.5 font-mono ${better ? 'text-accent' : 'text-danger'}`}>
        {d > 0 ? '+' : ''}{d.toFixed(1)}{city < 100 ? '%' : ''}
      </span>
    )
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="stat-label">MARKET COMPARISON</p>
        <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)}
          className="bg-bg border border-border text-accent text-xs font-mono rounded-lg px-3 py-1.5 outline-none focus:border-accent cursor-pointer">
          {cities.map(c => (
            <option key={c} value={c}>{c}{c === cityName ? ' ★' : ''}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap items-center">
        {BEDS.map(b => (
          <button key={b.key} onClick={() => setSelectedBed(b.key)}
            className={`px-3 py-1 rounded-lg text-[11px] font-mono transition-all ${
              selectedBed === b.key
                ? 'bg-accent/20 border border-accent/40 text-accent'
                : 'bg-white/[0.03] border border-border text-dim hover:text-mid'
            }`}>
            {b.label}
            {b.key === defaultBedKey && <span className="ml-1 text-[9px] text-accent/50">★</span>}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-dim">★ matches this property</span>
      </div>

      {selectedCity !== cityName && (
        <div className="mb-3 px-3 py-2 bg-gold/10 border border-gold/20 rounded-lg">
          <p className="text-[10px] text-gold font-mono">Comparing {cityName} property vs {selectedCity} market</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-3 bg-white/5 px-3 py-2 border-b border-border">
          <span className="text-[10px] font-mono text-dim">METRIC</span>
          <span className="text-[10px] font-mono text-accent text-center">THIS PROPERTY</span>
          <span className="text-[10px] font-mono text-mid text-right">
            {BEDS.find(b => b.key === selectedBed)?.label} {selectedCity}
          </span>
        </div>

        {[
          {
            label: 'Est. value', sublabel: estimatedCurrentValue ? '(est.)' : '(last sold)',
            prop: fmt(displayPrice), city: fmt(compAvgPrice),
            propRaw: 0, cityRaw: 0, higherIsBetter: false, isPct: false,
          },
          {
            label: 'Gross yield', sublabel: undefined,
            prop: pct(propertyGrossYield), city: pct(compAvgYield),
            propRaw: propertyGrossYield, cityRaw: compAvgYield,
            higherIsBetter: true, isPct: true,
          },
          {
            label: 'Net yield', sublabel: undefined,
            prop: pct(propertyNetYield), city: '—',
            propRaw: 0, cityRaw: 0, higherIsBetter: true, isPct: false,
          },
          {
            label: 'Monthly rent', sublabel: undefined,
            prop: propertyRent ? `£${propertyRent.toLocaleString()}` : 'Set rent',
            city: fmt(compAvgRent),
            propRaw: 0, cityRaw: 0, higherIsBetter: true, isPct: false,
          },
          {
            label: '1yr growth', sublabel: undefined,
            prop: `${cityAvg.capitalGrowth1yr > 0 ? '+' : ''}${cityAvg.capitalGrowth1yr}%`,
            city: `${cityAvg.capitalGrowth1yr > 0 ? '+' : ''}${cityAvg.capitalGrowth1yr}%`,
            propRaw: 0, cityRaw: 0, higherIsBetter: true, isPct: false,
          },
          {
            label: '5yr growth', sublabel: undefined,
            prop: `+${cityAvg.capitalGrowth5yr}%`,
            city: `+${cityAvg.capitalGrowth5yr}%`,
            propRaw: 0, cityRaw: 0, higherIsBetter: true, isPct: false,
          },
        ].map((row, i) => (
          <div key={row.label}
            className={`grid grid-cols-3 px-3 py-2.5 border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
            <div>
              <span className="text-mid text-xs">{row.label}</span>
              {row.sublabel && <span className="text-[9px] text-dim ml-1">{row.sublabel}</span>}
            </div>
            <span className="text-accent font-semibold text-center text-xs">
              {row.prop}
              {row.isPct && row.propRaw && row.cityRaw
                ? diff(row.propRaw, row.cityRaw, row.higherIsBetter) : null}
            </span>
            <span className="text-white text-right text-xs">{row.city}</span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-dim mt-3">
        {bedroomData
          ? `${BEDS.find(b => b.key === selectedBed)?.label} avg for ${selectedCity} · Zoopla 2026 · REalyse`
          : `City-wide avg for ${selectedCity} · ONS HPI · Zoopla April 2026`}
      </p>
    </div>
  )
}

function defaultServiceCharge(p: Record<string, unknown>): number {
  const type = String(p?.property_type ?? '').toLowerCase()
  return type.includes('flat') || type.includes('apartment') ? 2000 : 0
}
