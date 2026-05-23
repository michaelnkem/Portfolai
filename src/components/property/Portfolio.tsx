'use client'

import { Stat, Sparkline, SectionHeader } from '@/components/ui'

interface PortfolioProps {
  portfolio: Record<string, unknown>[]
  onRemove: (uprn: string) => void
  onAI: (p: null) => void
  onSelectProperty: (item: Record<string, unknown>) => void
}

// EPC resolver — epc register data first, then enriched, then property record
function resolveEpcRating(item: Record<string, unknown>): { rating: string; known: boolean } {
  const epc      = item.epc      as Record<string, unknown> | null | undefined
  const enriched = item.enriched as Record<string, unknown> | undefined
  const property = item.property as Record<string, unknown> | undefined

  const raw = String(
    epc?.current_energy_rating ||
    epc?.currentEnergyRating ||
    epc?.rating ||
    epc?.energy_rating ||
    enriched?.epcRating ||
    enriched?.current_energy_rating ||
    property?.current_energy_rating ||
    property?.epc_rating ||
    ''
  ).trim().toUpperCase()

  const match = raw.match(/[A-G]/)
  const rating = match?.[0] || '?'
  return { rating, known: rating !== '?' }
}

// Value resolver — estimatedCurrentValue first, last_sold_price as final fallback
function resolveEstimatedCurrentValue(item: Record<string, unknown>): number {
  const enriched = item.enriched as Record<string, unknown> | undefined
  const property = item.property as Record<string, unknown> | undefined

  const candidates = [
    enriched?.estimatedCurrentValue,
    (item as Record<string, unknown>).estimatedCurrentValue,
    property?.estimated_current_value,
  ]

  for (const v of candidates) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }

  const fallback = Number(property?.last_sold_price || 0)
  return Number.isFinite(fallback) ? fallback : 0
}

export function Portfolio({ portfolio, onRemove, onAI, onSelectProperty }: PortfolioProps) {
  const totalValue = portfolio.reduce((s, item) => s + resolveEstimatedCurrentValue(item), 0)

  const totalNetMonthly = portfolio.reduce((s, item) => {
    const enriched = item.enriched as Record<string, unknown>
    return s + ((enriched?.netMonthly as number) || 0)
  }, 0)

  const avgROI = portfolio.length
    ? portfolio.reduce((s, item) => {
        const enriched = item.enriched as Record<string, unknown>
        return s + ((enriched?.totalROI as number) || 0)
      }, 0) / portfolio.length
    : 0

  const avgYield = portfolio.length
    ? portfolio.reduce((s, item) => {
        const enriched = item.enriched as Record<string, unknown>
        return s + ((enriched?.netYield as number) || 0)
      }, 0) / portfolio.length
    : 0

  const nonCompliantCount = portfolio.filter(item => {
    const { rating, known } = resolveEpcRating(item)
    return known && rating > 'C'
  }).length

  return (
    <div>
      <SectionHeader
        eyebrow="PORTFOLIO TRACKER"
        title="My Portfolio"
        action={
          <button onClick={() => onAI(null)}
            className="bg-accent/10 border border-accent/30 text-accent text-sm font-bold px-4 py-2 rounded-xl hover:bg-accent/20 transition-colors">
            🤖 Portfolio Analysis
          </button>
        }
      />

      {portfolio.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Stat label="PORTFOLIO VALUE" value={`£${(totalValue/1000).toFixed(0)}k`} size="lg" />
          <Stat label="NET MONTHLY INCOME" value={`£${totalNetMonthly.toLocaleString()}`} tone="green" size="lg"
                sub={`£${(totalNetMonthly * 12).toLocaleString()} annual`} />
          <Stat label="AVG NET YIELD" value={`${avgYield.toFixed(1)}%`} tone="green" size="lg" />
          <Stat label="AVG TOTAL ROI" value={`${avgROI.toFixed(1)}%`} tone="gold" size="lg" />
        </div>
      )}

      {portfolio.length === 0 ? (
        <div className="card p-16 text-center">
          <p className="text-4xl mb-4">📂</p>
          <p className="text-xl font-display font-bold text-white mb-2">No properties yet</p>
          <p className="text-mid text-sm max-w-sm mx-auto">
            Search for a property in the Discover tab and click &quot;+ Portfolio&quot; to start tracking your investments.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {portfolio.map((item, i) => {
            const p        = item.property as Record<string, unknown>
            const enriched = item.enriched as Record<string, unknown>
            const transactions = item.transactions as Array<Record<string, unknown>> | undefined
            const uprn     = String(p?.uprn)
            const addr     = (p?.full_address || p?.address) as string
            const value    = resolveEstimatedCurrentValue(item)
            const netMonthly = (enriched?.netMonthly as number) || 0
            const netYield   = (enriched?.netYield   as number) || 0
            const totalROI   = (enriched?.totalROI   as number) || 0
            const cityName   = item.cityName as string
            const { rating: epcRating, known: epcKnown } = resolveEpcRating(item)

            return (
              <div
                key={i}
                className="card p-4 hover:border-mid transition-colors cursor-pointer"
                onClick={() => onSelectProperty(item)}
              >
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Address */}
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-semibold text-white line-clamp-1">{addr?.split(',')[0]}</p>
                    <p className="text-xs text-mid">{cityName} · {p?.property_type as string} · {p?.bedrooms as number}bd</p>
                  </div>

                  {/* Metrics */}
                  <div className="flex gap-4 text-center">
                    <div>
                      <p className="text-[9px] font-mono text-dim">VALUE</p>
                      <p className="text-sm font-bold text-white">£{(value/1000).toFixed(0)}k</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-dim">NET YIELD</p>
                      <p className="text-sm font-bold text-accent">{netYield.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-dim">NET/MO</p>
                      <p className="text-sm font-bold text-accent">£{netMonthly.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-dim">ROI</p>
                      <p className="text-sm font-bold text-gold">{totalROI.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-dim">EPC</p>
                      <p className={`text-sm font-bold ${
                        !epcKnown ? 'text-dim' :
                        epcRating <= 'C' ? 'text-accent' :
                        epcRating === 'D' ? 'text-gold' : 'text-danger'
                      }`}>
                        {epcKnown ? epcRating : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Price sparkline */}
                  {transactions && transactions.length > 2 && (
                    <div>
                      <p className="text-[9px] font-mono text-dim mb-1">PRICE TREND</p>
                      <Sparkline
                        data={transactions.slice().reverse().map(t => t.price as number)}
                        width={70}
                        height={24}
                      />
                    </div>
                  )}

                  {/* Remove — stopPropagation so row click doesn't fire */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(uprn) }}
                    className="text-dim hover:text-danger text-xs border border-border rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}

          {/* Summary insight */}
          <div className="card p-4 bg-accent/5 border-accent/20 mt-4">
            <p className="text-xs text-accent font-semibold mb-1">📊 Portfolio Summary</p>
            <p className="text-xs text-mid">
              {portfolio.length} properties · Total value £{(totalValue/1000).toFixed(0)}k ·
              Annual net income £{(totalNetMonthly * 12).toLocaleString()} ·
              Avg ROI {avgROI.toFixed(1)}% ·
              {nonCompliantCount > 0
                ? ` ⚠ ${nonCompliantCount} properties need EPC upgrade before 2028`
                : ' ✓ All properties EPC-C compliant'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
