'use client'

import { useState } from 'react'
import { LineChart } from '@/components/ui'
import {
  calcGrossYield, calcNetYield, calcNetMonthlyIncome,
  calcMortgagePayment, calcSDLT, calcProjection, MARKET_DATA
} from '@/lib/market-data'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'

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
  const totalAcquisition = price + sdlt + 2000

  const projection = calcProjection(price, rent, capitalGrowth, marketData.macro.rentalGrowthForecast,
    serviceCharge, groundRent, mgmtFee, maintenance, voidWks)

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#047857] mb-1">ROI CALCULATOR</p>
          <h2 className="text-2xl font-bold text-[#111827]" style={{ fontFamily: SERIF }}>Investment Modeller</h2>
        </div>
        <button onClick={() => onAI(null)}
          className="flex items-center gap-2 bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#D1FAE5] transition-colors">
          🤖 Ask AI to analyse
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Inputs */}
        <div className="space-y-4">

          {/* City selector */}
          <div className="bg-white border border-[#E7E5DD] rounded-2xl p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-3">CITY / LOCATION</p>
            <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)}
              className="w-full bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl px-3 py-2 text-[#111827] text-sm outline-none focus:border-[#047857] cursor-pointer">
              {Object.keys(marketData.cities).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="mt-3 text-xs text-[#6B7280] space-y-1">
              <p>Avg price: <strong className="text-[#111827]">£{cityData.avgPrice.toLocaleString()}</strong></p>
              <p>Avg yield: <strong className="text-[#047857]">{cityData.avgYield}%</strong></p>
              <p>1yr growth: <strong className={capitalGrowth >= 0 ? 'text-[#047857]' : 'text-[#DC2626]'}>{capitalGrowth > 0 ? '+' : ''}{capitalGrowth}%</strong></p>
            </div>
          </div>

          {/* Property inputs */}
          <div className="bg-white border border-[#E7E5DD] rounded-2xl p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)] space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">PROPERTY FINANCIALS</p>
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
                <p className="text-xs text-[#6B7280] mb-1.5">{f.label}</p>
                <input type="range" min={f.min} max={f.max} step={f.step} value={f.val}
                  onChange={e => f.set(Number(e.target.value))}
                  className="w-full h-1.5 accent-[#047857]" />
              </div>
            ))}
          </div>

          {/* Mortgage inputs */}
          <div className="bg-white border border-[#E7E5DD] rounded-2xl p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)] space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">MORTGAGE</p>
            {[
              { label: `Deposit: £${deposit.toLocaleString()} (${Math.round(deposit/price*100)}% · LTV: ${100-Math.round(deposit/price*100)}%)`, val: deposit, set: setDeposit, min: price*0.2, max: price*0.5, step: 5000 },
              { label: `Rate: ${mortRate}% p.a.`, val: mortRate, set: setMortRate, min: 2.5, max: 9.0, step: 0.1 },
              { label: `Term: ${mortYears} years`, val: mortYears, set: setMortYears, min: 5, max: 35, step: 5 },
            ].map(f => (
              <div key={f.label}>
                <p className="text-xs text-[#6B7280] mb-1.5">{f.label}</p>
                <input type="range" min={f.min} max={f.max} step={f.step} value={f.val}
                  onChange={e => f.set(Number(e.target.value))}
                  className="w-full h-1.5 accent-[#047857]" />
              </div>
            ))}
            <label className="flex items-center gap-2 text-xs text-[#6B7280] cursor-pointer">
              <input type="checkbox" checked={isAdditional} onChange={e => setIsAdditional(e.target.checked)}
                className="accent-[#047857]" />
              Additional property (BTL / 2nd home) — +5% SDLT surcharge
            </label>
          </div>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">

          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'GROSS YIELD', value: `${grossYield.toFixed(1)}%`, sub: `Area avg ${cityData.avgYield}%`, color: grossYield > cityData.avgYield ? '#047857' : '#111827' },
              { label: 'NET YIELD',   value: `${netYield.toFixed(1)}%`,   sub: 'after all costs',                color: netYield > 4 ? '#047857' : '#111827' },
              { label: 'TOTAL ROI',   value: `${totalROI}%`,              sub: 'net + cap growth',               color: '#B7791F' },
              { label: 'NET MONTHLY', value: `£${netMonthly.toLocaleString()}`, sub: 'before mortgage',         color: netMonthly > 0 ? '#047857' : '#DC2626' },
            ].map(kpi => (
              <div key={kpi.label} className="bg-white border border-[#E7E5DD] rounded-2xl p-4 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-2">{kpi.label}</p>
                <p className="font-bold text-[26px] leading-none" style={{ fontFamily: SERIF, letterSpacing: '-0.03em', color: kpi.color }}>{kpi.value}</p>
                <p className="text-xs text-[#9CA3AF] mt-1">{kpi.sub}</p>
              </div>
            ))}
          </div>

          {/* P&L + acquisition costs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-3">ANNUAL P&amp;L</p>
              {[
                { k: 'Gross rent',             v: `+£${(rent*12).toLocaleString()}`,                          c: 'text-[#047857]' },
                { k: `Voids (${voidWks}wk)`,   v: `-£${Math.round(rent*voidWks/4.33).toLocaleString()}`,      c: 'text-[#DC2626]' },
                { k: `Management (${mgmtFee}%)`, v: `-£${Math.round(rent*12*mgmtFee/100).toLocaleString()}`,  c: 'text-[#DC2626]' },
                { k: 'Maintenance',            v: `-£${Math.round(price*maintenance/100).toLocaleString()}`,   c: 'text-[#DC2626]' },
                { k: 'Service charge',         v: `-£${serviceCharge.toLocaleString()}`,                       c: 'text-[#DC2626]' },
                { k: 'Ground rent',            v: `-£${groundRent.toLocaleString()}`,                          c: 'text-[#DC2626]' },
                { k: 'NET INCOME',             v: `£${(netMonthly*12).toLocaleString()}`,                      c: 'text-[#B7791F] font-bold' },
              ].map(row => (
                <div key={row.k} className="flex justify-between py-2 border-b border-[#F3F4F6] last:border-0 text-sm">
                  <span className="text-[#6B7280]">{row.k}</span>
                  <span className={row.c}>{row.v}</span>
                </div>
              ))}
            </div>

            <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-3">ACQUISITION COSTS</p>
              {[
                { k: 'Purchase price',                       v: `£${price.toLocaleString()}`,                c: 'text-[#111827]', bold: false },
                { k: `SDLT${isAdditional ? ' (+ surcharge)' : ''}`, v: `£${sdlt.toLocaleString()}`,         c: 'text-[#DC2626]', bold: false },
                { k: 'Legal fees (est.)',                    v: `£2,000`,                                    c: 'text-[#374151]', bold: false },
                { k: 'Survey (est.)',                        v: `£600`,                                      c: 'text-[#374151]', bold: false },
                { k: 'TOTAL ACQUISITION',                    v: `£${(price + sdlt + 2600).toLocaleString()}`, c: 'text-[#111827]', bold: true },
                { k: 'Deposit required',                     v: `£${deposit.toLocaleString()}`,              c: 'text-[#374151]', bold: false },
                { k: 'Mortgage (monthly)',                   v: `£${mort.monthly.toLocaleString()}/mo`,       c: 'text-[#DC2626]', bold: false },
                { k: 'Monthly cashflow',                     v: `£${cashflow.toLocaleString()}`,              c: cashflow >= 0 ? 'text-[#047857]' : 'text-[#DC2626]', bold: false },
              ].map(row => (
                <div key={row.k} className={`flex justify-between py-2 border-b border-[#F3F4F6] last:border-0 text-sm ${row.bold ? 'font-bold' : ''}`}>
                  <span className="text-[#6B7280]">{row.k}</span>
                  <span className={row.c}>{row.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 10yr projection chart */}
          <div className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1">10-YEAR PROJECTION</p>
            <p className="text-[10px] text-[#9CA3AF] mb-4">
              Assumes {capitalGrowth}% annual capital growth · {marketData.macro.rentalGrowthForecast}% rental growth · costs held constant
            </p>
            <LineChart
              series={[
                { name: 'Property value',      data: projection.map(y => y.propertyValue),      color: '#047857' },
                { name: 'Cumulative cashflow', data: projection.map(y => y.cumulativeCashflow), color: '#B7791F' },
                { name: 'Total return',        data: projection.map(y => y.totalReturn),        color: '#2563EB' },
              ]}
              labels={projection.map(y => String(y.year))}
              height={130}
            />
            <div className="flex gap-4 mt-2 flex-wrap">
              {[['Property value', '#047857'], ['Cumulative cashflow', '#B7791F'], ['Total return', '#2563EB']].map(([l, c]) => (
                <span key={l} className="flex items-center gap-1.5 text-[10px] text-[#6B7280]">
                  <span className="w-3 h-0.5 inline-block rounded" style={{ background: c }} />{l}
                </span>
              ))}
            </div>
            {projection.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mt-4">
                {[
                  { label: '10yr VALUE',     value: `£${(projection[9].propertyValue/1000).toFixed(0)}k`,      color: '#047857' },
                  { label: 'TOTAL CASHFLOW', value: `£${(projection[9].cumulativeCashflow/1000).toFixed(0)}k`, color: '#B7791F' },
                  { label: 'TOTAL RETURN',   value: `£${(projection[9].totalReturn/1000).toFixed(0)}k`,        color: '#047857',
                    sub: `${Math.round(projection[9].totalReturn/price*100)}% on cost` },
                ].map(kpi => (
                  <div key={kpi.label} className="bg-[#FAF9F5] border border-[#E7E5DD] rounded-xl p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-1.5">{kpi.label}</p>
                    <p className="font-bold text-lg leading-none" style={{ fontFamily: SERIF, color: kpi.color }}>{kpi.value}</p>
                    {(kpi as Record<string, unknown>).sub && <p className="text-[10px] text-[#9CA3AF] mt-1">{(kpi as Record<string, unknown>).sub as string}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Acquisition total note */}
          <div className="bg-[#F6F3EC] border border-[#E7E5DD] rounded-xl px-5 py-3">
            <p className="text-xs text-[#6B7280]">
              Total acquisition cost (inc. SDLT + legal): <strong className="text-[#111827]">£{totalAcquisition.toLocaleString()}</strong>
              {isAdditional && <span className="text-[#DC2626] ml-2">· Includes +5% additional property SDLT surcharge</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
