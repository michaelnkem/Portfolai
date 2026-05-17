'use client'

import { useState } from 'react'
import { Stat, LineChart, SectionHeader } from '@/components/ui'
import {
  calcGrossYield, calcNetYield, calcNetMonthlyIncome,
  calcMortgagePayment, calcSDLT, calcProjection, MARKET_DATA
} from '@/lib/market-data'

interface ROICalculatorProps {
  marketData: typeof MARKET_DATA
  onAI: (p: null) => void
}

export function ROICalculator({ marketData, onAI }: ROICalculatorProps) {
  const [price, setPrice] = useState(250000)
  const [rent, setRent] = useState(1200)
  const [serviceCharge, setServiceCharge] = useState(2000)
  const [groundRent, setGroundRent] = useState(200)
  const [mgmtFee, setMgmtFee] = useState(10)
  const [maintenance, setMaintenance] = useState(1.5)
  const [voidWks, setVoidWks] = useState(2)
  const [deposit, setDeposit] = useState(62500)
  const [mortRate, setMortRate] = useState(4.8)
  const [mortYears, setMortYears] = useState(25)
  const [selectedCity, setSelectedCity] = useState('Manchester')
  const [isAdditional, setIsAdditional] = useState(true)

  const cityData = marketData.cities[selectedCity as keyof typeof marketData.cities]
  const capitalGrowth = cityData.capitalGrowth1yr

  const grossYield = calcGrossYield(price, rent)
  const netYield = calcNetYield(price, rent, serviceCharge, groundRent, mgmtFee, maintenance, voidWks)
  const netMonthly = calcNetMonthlyIncome(price, rent, serviceCharge, groundRent, mgmtFee, maintenance, voidWks)
  const totalROI = parseFloat((netYield + capitalGrowth).toFixed(1))
  const sdlt = calcSDLT(price, isAdditional)
  const mort = calcMortgagePayment(price, deposit, mortRate, mortYears)
  const cashflow = netMonthly - mort.monthly
  const totalAcquisition = price + sdlt + 2000 // +£2k legal fees estimate

  const projection = calcProjection(price, rent, capitalGrowth, marketData.macro.rentalGrowthForecast,
    serviceCharge, groundRent, mgmtFee, maintenance, voidWks)

  return (
    <div>
      <SectionHeader
        eyebrow="ROI CALCULATOR"
        title="Investment Modeller"
        action={
          <button onClick={() => onAI(null)} className="btn-primary text-sm">
            🤖 Ask AI to analyse
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Inputs */}
        <div className="space-y-4">
          {/* City selector */}
          <div className="card p-4">
            <p className="stat-label mb-3">CITY / LOCATION</p>
            <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)}
              className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-accent">
              {Object.keys(marketData.cities).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="mt-3 text-xs text-mid space-y-1">
              <p>Avg price: <strong className="text-white">£{cityData.avgPrice.toLocaleString()}</strong></p>
              <p>Avg yield: <strong className="text-accent">{cityData.avgYield}%</strong></p>
              <p>1yr growth: <strong className={capitalGrowth >= 0 ? 'text-accent' : 'text-danger'}>{capitalGrowth > 0 ? '+' : ''}{capitalGrowth}%</strong></p>
            </div>
          </div>

          {/* Property inputs */}
          <div className="card p-4 space-y-4">
            <p className="stat-label">PROPERTY FINANCIALS</p>
            {[
              { label: `Purchase price: £${price.toLocaleString()}`, val: price, set: setPrice, min: 50000, max: 800000, step: 5000 },
              { label: `Monthly rent: £${rent.toLocaleString()}`, val: rent, set: setRent, min: 300, max: 5000, step: 50 },
              { label: `Service charge: £${serviceCharge.toLocaleString()}/yr`, val: serviceCharge, set: setServiceCharge, min: 0, max: 8000, step: 100 },
              { label: `Ground rent: £${groundRent}/yr`, val: groundRent, set: setGroundRent, min: 0, max: 1000, step: 50 },
              { label: `Management: ${mgmtFee}%`, val: mgmtFee, set: setMgmtFee, min: 0, max: 20, step: 1 },
              { label: `Maintenance: ${maintenance}% of value`, val: maintenance, set: setMaintenance, min: 0, max: 5, step: 0.5 },
              { label: `Void weeks: ${voidWks}/yr`, val: voidWks, set: setVoidWks, min: 0, max: 8, step: 0.5 },
            ].map(f => (
              <div key={f.label}>
                <p className="text-xs text-mid mb-1.5">{f.label}</p>
                <input type="range" min={f.min} max={f.max} step={f.step} value={f.val}
                  onChange={e => f.set(Number(e.target.value))}
                  className="w-full accent-accent" />
              </div>
            ))}
          </div>

          {/* Mortgage inputs */}
          <div className="card p-4 space-y-4">
            <p className="stat-label">MORTGAGE</p>
            {[
              { label: `Deposit: £${deposit.toLocaleString()} (${Math.round(deposit/price*100)}% LTV: ${100-Math.round(deposit/price*100)}%)`, val: deposit, set: setDeposit, min: price*0.2, max: price*0.5, step: 5000 },
              { label: `Rate: ${mortRate}% p.a.`, val: mortRate, set: setMortRate, min: 2.5, max: 9.0, step: 0.1 },
              { label: `Term: ${mortYears} years`, val: mortYears, set: setMortYears, min: 5, max: 35, step: 5 },
            ].map(f => (
              <div key={f.label}>
                <p className="text-xs text-mid mb-1.5">{f.label}</p>
                <input type="range" min={f.min} max={f.max} step={f.step} value={f.val}
                  onChange={e => f.set(Number(e.target.value))}
                  className="w-full accent-accent" />
              </div>
            ))}
            <label className="flex items-center gap-2 text-xs text-mid cursor-pointer">
              <input type="checkbox" checked={isAdditional} onChange={e => setIsAdditional(e.target.checked)}
                className="accent-accent" />
              Additional property (BTL / 2nd home) — +5% SDLT surcharge
            </label>
          </div>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="GROSS YIELD" value={`${grossYield.toFixed(1)}%`} tone={grossYield > cityData.avgYield ? 'green' : 'neutral'} sub={`Area avg ${cityData.avgYield}%`} size="lg" />
            <Stat label="NET YIELD" value={`${netYield.toFixed(1)}%`} tone={netYield > 4 ? 'green' : 'neutral'} sub="after all costs" size="lg" />
            <Stat label="TOTAL ROI" value={`${totalROI}%`} tone="gold" sub="net + cap growth" size="lg" />
            <Stat label="NET MONTHLY" value={`£${netMonthly.toLocaleString()}`} tone={netMonthly > 0 ? 'green' : 'red'} sub="before mortgage" size="lg" />
          </div>

          {/* P&L + acquisition costs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5">
              <p className="stat-label mb-3">ANNUAL P&L</p>
              {[
                { k: 'Gross rent', v: `+£${(rent*12).toLocaleString()}`, c: 'text-accent' },
                { k: `Voids (${voidWks}wk)`, v: `-£${Math.round(rent*voidWks/4.33).toLocaleString()}`, c: 'text-danger' },
                { k: `Management (${mgmtFee}%)`, v: `-£${Math.round(rent*12*mgmtFee/100).toLocaleString()}`, c: 'text-danger' },
                { k: 'Maintenance', v: `-£${Math.round(price*maintenance/100).toLocaleString()}`, c: 'text-danger' },
                { k: 'Service charge', v: `-£${serviceCharge.toLocaleString()}`, c: 'text-danger' },
                { k: 'Ground rent', v: `-£${groundRent.toLocaleString()}`, c: 'text-danger' },
                { k: 'NET INCOME', v: `£${(netMonthly*12).toLocaleString()}`, c: 'text-gold font-bold' },
              ].map(row => (
                <div key={row.k} className="flex justify-between py-2 border-b border-border text-sm">
                  <span className="text-mid">{row.k}</span>
                  <span className={row.c}>{row.v}</span>
                </div>
              ))}
            </div>

            <div className="card p-5">
              <p className="stat-label mb-3">ACQUISITION COSTS</p>
              {[
                { k: 'Purchase price', v: `£${price.toLocaleString()}` },
                { k: `SDLT${isAdditional ? ' (+ surcharge)' : ''}`, v: `£${sdlt.toLocaleString()}` },
                { k: 'Legal fees (est.)', v: `£2,000` },
                { k: 'Survey (est.)', v: `£600` },
                { k: 'TOTAL ACQUISITION', v: `£${(price + sdlt + 2600).toLocaleString()}`, bold: true },
                { k: 'Deposit required', v: `£${deposit.toLocaleString()}` },
                { k: 'Mortgage (monthly)', v: `£${mort.monthly.toLocaleString()}/mo` },
                { k: 'Monthly cashflow', v: `£${cashflow.toLocaleString()}`, colored: cashflow >= 0 ? 'text-accent' : 'text-danger' },
              ].map(row => (
                <div key={row.k} className={`flex justify-between py-2 border-b border-border text-sm ${row.bold ? 'font-bold' : ''}`}>
                  <span className="text-mid">{row.k}</span>
                  <span className={(row as Record<string, unknown>).colored as string || 'text-white'}>{row.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 10yr projection chart */}
          <div className="card p-5">
            <p className="stat-label mb-1">10-YEAR PROJECTION</p>
            <p className="text-[10px] text-dim mb-4">
              Assumes {capitalGrowth}% annual capital growth · {marketData.macro.rentalGrowthForecast}% rental growth · costs held constant
            </p>
            <LineChart
              series={[
                { name: 'Property value', data: projection.map(y => y.propertyValue), color: '#00d4aa' },
                { name: 'Cumulative cashflow', data: projection.map(y => y.cumulativeCashflow), color: '#f0c040' },
                { name: 'Total return', data: projection.map(y => y.totalReturn), color: '#4d9fff' },
              ]}
              labels={projection.map(y => String(y.year))}
              height={130}
            />
            <div className="flex gap-4 mt-2 flex-wrap">
              {[['Property value', '#00d4aa'], ['Cumulative cashflow', '#f0c040'], ['Total return', '#4d9fff']].map(([l, c]) => (
                <span key={l} className="flex items-center gap-1.5 text-[10px] text-mid">
                  <span className="w-3 h-0.5 inline-block rounded" style={{ background: c }} />{l}
                </span>
              ))}
            </div>
            {projection.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mt-4">
                <Stat label="10yr VALUE" value={`£${(projection[9].propertyValue/1000).toFixed(0)}k`} tone="green" size="sm" />
                <Stat label="TOTAL CASHFLOW" value={`£${(projection[9].cumulativeCashflow/1000).toFixed(0)}k`} tone="gold" size="sm" />
                <Stat label="TOTAL RETURN" value={`£${(projection[9].totalReturn/1000).toFixed(0)}k`} tone="green" size="sm"
                  sub={`${Math.round(projection[9].totalReturn/price*100)}% on cost`} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
