'use client'

import { Stat, Sparkline, SectionHeader } from '@/components/ui'
import { calcGrossYield, calcNetYield, calcNetMonthlyIncome } from '@/lib/market-data'

interface PortfolioProps {
  portfolio: Record<string, unknown>[]
  onRemove: (uprn: string) => void
  onAI: (p: null) => void
  onSelectProperty: (data: Record<string, unknown>) => void
}

export function Portfolio({ portfolio, onRemove, onAI, onSelectProperty }: PortfolioProps) {
  const totalValue = portfolio.reduce((s, item) => {
    const p = item.property as Record<string, unknown>
    return s + ((p?.last_sold_price as number) || 0)
  }, 0)

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
            const p = item.property as Record<string, unknown>
            const enriched = item.enriched as Record<string, unknown>
            const transactions = item.transactions as Array<Record<string, unknown>> | undefined
            const uprn = String(p?.uprn)
            const addr = (p?.full_address || p?.address) as string
            const price = (p?.last_sold_price as number) || 0
            const netMonthly = (enriched?.netMonthly as number) || 0
            const netYield = (enriched?.netYield as number) || 0
            const totalROI = (enriched?.totalROI as number) || 0
            const epcRating = (enriched?.epcRating || p?.current_energy_rating || '?') as string
            const cityName = item.cityName as string

            return (
              <div key={i} className="card p-4 hover:border-mid transition-colors cursor-pointer"
                onClick={() => onSelectProperty(item)}>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-semibold text-white line-clamp-1">{addr?.split(',')[0]}</p>
                    <p className="text-xs text-mid">{cityName} · {p?.property_type as string} · {p?.bedrooms as number}bd</p>
                  </div>

                  <div className="flex gap-4 text-center">
                    <div>
                      <p className="text-[9px] font-mono text-dim">VALUE</p>
                      <p className="text-sm font-bold text-white">£{(price/1000).toFixed(0)}k</p>
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
                      <p className={`text-sm font-bold ${epcRating <= 'C' ? 'text-accent' : epcRating === 'D' ? 'text-gold' : 'text-danger'}`}>
                        {epcRating}
                      </p>
                    </div>
                  </div>

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

                  <button onClick={(e) => { e.stopPropagation(); onRemove(uprn) }}
                    className="text-dim hover:text-danger text-xs border border-border rounded-lg px-2.5 py-1.5 transition-colors">
                    ✕
                  </button>
                </div>
              </div>
            )
          })}

          <div className="card p-4 bg-accent/5 border-accent/20 mt-4">
            <p className="text-xs text-accent font-semibold mb-1">📊 Portfolio Summary</p>
            <p className="text-xs text-mid">
              {portfolio.length} properties · Total value £{(totalValue/1000).toFixed(0)}k ·
              Annual net income £{(totalNetMonthly * 12).toLocaleString()} ·
              Avg ROI {avgROI.toFixed(1)}% ·
              {portfolio.filter(item => ((item.enriched as Record<string, unknown>)?.epcRating as string) > 'C').length > 0
                ? ` ⚠ ${portfolio.filter(item => ((item.enriched as Record<string, unknown>)?.epcRating as string) > 'C').length} properties need EPC upgrade before 2028`
                : ' ✓ All properties EPC-C compliant'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
