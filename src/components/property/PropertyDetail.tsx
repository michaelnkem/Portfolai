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

  // Use user-set rent or fall back to estimate
  const effectiveRent = rentSet ? rent : (enriched?.estimatedRent as number || 0)
  const price = Number(p?.last_sold_price ?? 0)

  // Estimated current value — prefer API-calculated (uses district price trends)
  // Fall back to client-side calculation if not provided
  const soldYear = Number(String(p?.last_sold_date ?? '2020').slice(0, 4))
  const yearsHeld = Math.max(0, 2026 - soldYear)
  const annualGrowth = cityData ? (cityData.capitalGrowth5yr / 5) / 100 : 0.025
  const estimatedCurrentValue = (enriched?.estimatedCurrentValue as number)
    || (price ? Math.round(price * Math.pow(1 + annualGrowth, yearsHeld)) : 0)

  // Live-calculated metrics
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

  // EPC rating
  const epcRating = String(enriched?.epcRating || p?.current_energy_rating || '?')
  const epcKnown = epcRating !== '?' && epcRating !== 'Unknown' && epcRating.length === 1
  const epcCompliant = epcKnown && epcRating <= 'C'

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview',    label: 'Overview' },
    { id: 'financials',  label: 'Financials' },
    { id: 'history',     label: 'History' },
    { id: 'risks',       label: 'Risks' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-bg/80 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
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
              {(enriched?.attrBedrooms != null || Number(p?.bedrooms) > 0) && (
                <span className="text-xs text-mid">· {String(enriched?.attrBedrooms ?? p?.bedrooms)} bed</span>
              )}
              {p?.tenure && (
                <span className="text-xs text-mid">· {String(p.tenure)}</span>
              )}
              {cityName && (
                <span className="text-xs text-mid">· {String(cityName)}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={onAI} className="btn-primary text-xs px-3 py-2">🤖 AI</button>
            <button onClick={onAddPortfolio} className="bg-gold/10 border border-gold/30 text-gold text-xs font-bold px-3 py-2 rounded-lg hover:bg-gold/20 transition-colors">+ Portfolio</button>
            <button onClick={onClose} className="btn-ghost text-xs px-3 py-2">✕</button>
          </div>
        </div>

        {/* Key metrics strip */}
        <div className="p-5 grid grid-cols-2 sm:grid-cols-5 gap-3 border-b border-border">
          <Stat label="EST. CURRENT VALUE"
            value={estimatedCurrentValue ? `£${estimatedCurrentValue.toLocaleString()}` : 'No record'}
            tone="green"
            sub={price && p?.last_sold_date ? `Est. from ${String(p.last_sold_date).slice(0,4)} sale price` : 'Based on market growth'} />
          <Stat label="LAST SOLD PRICE" value={price ? `£${price.toLocaleString()}` : 'No record'}
            sub={p?.last_sold_date ? `Sold ${String(p.last_sold_date).slice(0,4)}` : undefined} />
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

        {/* Tab content */}
        <div className="p-5 flex-1">

          {/* OVERVIEW */}
          {tab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Property attributes */}
                <div className="card p-5">
                  <p className="stat-label mb-4">PROPERTY ATTRIBUTES</p>
                  {(() => {
                    const floorArea = enriched?.epcFloorArea
                      || (epc?.total_floor_area ? Number(epc.total_floor_area) : null)
                      || p?.internal_area_sqm
                      || p?.epc_floor_area

                    const bedsLabel    = String(enriched?.attrBedroomsLabel  || (p?.bedrooms  != null ? `${p.bedrooms}`  : 'Unknown'))
                    const bathsLabel   = String(enriched?.attrBathroomsLabel || (p?.bathrooms != null ? `${p.bathrooms}` : 'Unknown'))
                    const tenureLabel  = String(enriched?.attrTenureLabel    || String(p?.tenure  ?? '') || 'Unknown')
                    const gardenLabel  = String(enriched?.attrGardenLabel    || (p?.has_garden === true ? 'Yes' : p?.has_garden === false ? 'No' : 'Unknown'))

                    const bedsInferred   = Boolean(enriched?.attrBedroomsInferred)
                    const bathsInferred  = Boolean(enriched?.attrBathroomsInferred)
                    const tenureInferred = Boolean(enriched?.attrTenureInferred)
                    const gardenInferred = Boolean(enriched?.attrGardenInferred)

                    // [label, value, isEpcHighlight, isInferred]
                    type Row = [string, string, boolean, boolean]
                    const allRows: Row[] = [
                      ['Bedrooms',   bedsLabel,                                                      false, bedsInferred],
                      ['Bathrooms',  bathsLabel,                                                     false, bathsInferred],
                      ['Floor Area', floorArea ? `${floorArea}m²` : 'Unknown',                      false, false],
                      ['EPC Rating', epcKnown ? epcRating : 'Unknown',                              epcKnown, false],
                      ['Garden',     gardenLabel,                                                    false, gardenInferred],
                      ['Type',       String(p?.property_type ?? '') || 'Unknown',                   false, false],
                      ['Tenure',     tenureLabel,                                                    false, tenureInferred],
                    ]
                    // Hide rows where value is Unknown
                    const rows = allRows.filter(([, v]) => v !== 'Unknown')
                    const anyInferred = bedsInferred || tenureInferred || gardenInferred || bathsInferred

                    return (
                      <>
                        {rows.map(([k, v, isEpc, isInferred]) => (
                          <div key={k} className="flex justify-between items-center py-2 border-b border-border text-sm">
                            <span className="text-mid">{k}</span>
                            <span className={`font-medium ${
                              isEpc
                                ? (epcRating <= 'C' ? 'text-accent' : epcRating === 'D' ? 'text-gold' : 'text-danger')
                                : isInferred ? 'text-gold' : 'text-white'
                            }`}>{v}{isInferred && <span className="text-dim ml-0.5">*</span>}</span>
                          </div>
                        ))}
                        {anyInferred && (
                          <p className="text-[10px] text-dim mt-3">* Estimated from floor area and property norms. Verify with agent.</p>
                        )}
                      </>
                    )
                  })()}
                </div>

                {/* City investment scores */}
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
                      propertyBeds={enriched?.attrBedrooms != null ? Number(enriched.attrBedrooms) : (Number(p?.bedrooms) > 0 ? Number(p.bedrooms) : 2)}
                    /></div>
                )}
              </div>

              {/* UPRN info */}
              <div className="card p-4 text-xs text-mid flex gap-4 flex-wrap">
                <span>UPRN: <strong className="text-white">{String(p?.uprn ?? '')}</strong></span>
                <span>Postcode: <strong className="text-white">{String(p?.postcode ?? '')}</strong></span>
                <span>Last sold: <strong className="text-white">{String(p?.last_sold_date ?? '') || 'No record'}</strong></span>
                {p?.last_sold_price ? <span>At: <strong className="text-white">£{Number(p.last_sold_price).toLocaleString()}</strong></span> : null}
              </div>
            </div>
          )}

          {/* FINANCIALS */}
          {tab === 'financials' && (
            <div className="space-y-5">
              {/* Rent input */}
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

              {/* Cost assumptions */}
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

                {/* P&L */}
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
                      <span className={row
