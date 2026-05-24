'use client'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'

interface PortfolioProps {
  portfolio: Record<string, unknown>[]
  onRemove: (uprn: string) => void
  onAI: (p: null) => void
  onSelectProperty: (item: Record<string, unknown>) => void
}

function resolveEpcRating(item: Record<string, unknown>): { rating: string; known: boolean } {
  const epc      = item.epc      as Record<string, unknown> | null | undefined
  const enriched = item.enriched as Record<string, unknown> | undefined
  const property = item.property as Record<string, unknown> | undefined
  const raw = String(
    epc?.current_energy_rating || epc?.currentEnergyRating || epc?.rating || epc?.energy_rating ||
    enriched?.epcRating || enriched?.current_energy_rating ||
    property?.current_energy_rating || property?.epc_rating || ''
  ).trim().toUpperCase()
  const match = raw.match(/[A-G]/)
  const rating = match?.[0] || '?'
  return { rating, known: rating !== '?' }
}

function resolveEstimatedCurrentValue(item: Record<string, unknown>): number {
  const enriched = item.enriched as Record<string, unknown> | undefined
  const property = item.property as Record<string, unknown> | undefined
  for (const v of [enriched?.estimatedCurrentValue, property?.estimated_current_value]) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }
  const fallback = Number(property?.last_sold_price || 0)
  return Number.isFinite(fallback) ? fallback : 0
}

export function Portfolio({ portfolio, onRemove, onAI, onSelectProperty }: PortfolioProps) {
  const totalValue = portfolio.reduce((s, item) => s + resolveEstimatedCurrentValue(item), 0)
  const totalNetMonthly = portfolio.reduce((s, item) => s + (((item.enriched as Record<string, unknown>)?.netMonthly as number) || 0), 0)
  const avgROI = portfolio.length
    ? portfolio.reduce((s, item) => s + (((item.enriched as Record<string, unknown>)?.totalROI as number) || 0), 0) / portfolio.length
    : 0
  const avgYield = portfolio.length
    ? portfolio.reduce((s, item) => s + (((item.enriched as Record<string, unknown>)?.netYield as number) || 0), 0) / portfolio.length
    : 0
  const nonCompliantCount = portfolio.filter(item => {
    const { rating, known } = resolveEpcRating(item)
    return known && rating > 'C'
  }).length

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#047857] mb-1">PORTFOLIO TRACKER</p>
          <h2 className="text-2xl font-bold text-[#111827]" style={{ fontFamily: SERIF }}>My Portfolio</h2>
        </div>
        <button onClick={() => onAI(null)}
          className="flex items-center gap-2 bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#D1FAE5] transition-colors">
          🤖 Portfolio Analysis
        </button>
      </div>

      {/* KPI strip */}
      {portfolio.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'PORTFOLIO VALUE',    value: `£${(totalValue / 1000).toFixed(0)}k`,              color: '#111827', sub: undefined },
            { label: 'NET MONTHLY INCOME', value: `£${totalNetMonthly.toLocaleString()}`,              color: '#047857', sub: `£${(totalNetMonthly * 12).toLocaleString()} annual` },
            { label: 'AVG NET YIELD',      value: `${avgYield.toFixed(1)}%`,                          color: '#047857', sub: undefined },
            { label: 'AVG TOTAL ROI',      value: `${avgROI.toFixed(1)}%`,                            color: '#B7791F', sub: undefined },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-2">{kpi.label}</p>
              <p className="font-bold text-[26px] leading-none" style={{ fontFamily: SERIF, letterSpacing: '-0.03em', color: kpi.color }}>{kpi.value}</p>
              {kpi.sub && <p className="text-xs text-[#9CA3AF] mt-1">{kpi.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {portfolio.length === 0 ? (
        <div className="bg-white border border-[#E7E5DD] rounded-2xl p-16 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)]">
          <p className="text-4xl mb-4">📂</p>
          <p className="text-xl font-bold text-[#111827] mb-2" style={{ fontFamily: SERIF }}>No properties yet</p>
          <p className="text-sm text-[#6B7280] max-w-sm mx-auto">
            Search for a property in the Discover tab and save it to start tracking your investments.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {portfolio.map((item, i) => {
            const p        = item.property as Record<string, unknown>
            const enriched = item.enriched as Record<string, unknown>
            const transactions = item.transactions as Array<Record<string, unknown>> | undefined
            const uprn       = String(p?.uprn)
            const addr       = (p?.full_address || p?.address) as string
            const value      = resolveEstimatedCurrentValue(item)
            const netMonthly = (enriched?.netMonthly as number) || 0
            const netYield   = (enriched?.netYield   as number) || 0
            const totalROI   = (enriched?.totalROI   as number) || 0
            const cityName   = item.cityName as string
            const { rating: epcRating, known: epcKnown } = resolveEpcRating(item)
            const epcBadge = !epcKnown ? 'bg-[#F3F4F6] text-[#9CA3AF] border-[#E7E5DD]'
              : epcRating <= 'C' ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
              : epcRating === 'D' ? 'bg-[#FFF7E6] text-[#B7791F] border-[#F5D48A]'
              : 'bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5]'

            return (
              <div key={i}
                className="bg-white border border-[#E7E5DD] rounded-2xl p-5 shadow-[0_8px_24px_rgba(17,24,39,0.04)] hover:border-[#A7F3D0] transition-all cursor-pointer group"
                onClick={() => onSelectProperty(item)}>
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Address */}
                  <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                    <div className="w-10 h-10 bg-[#ECFDF5] rounded-xl flex items-center justify-center text-lg shrink-0">🏠</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#111827] truncate group-hover:text-[#047857] transition-colors">{addr?.split(',')[0]}</p>
                      <p className="text-xs text-[#9CA3AF]">{cityName} · {p?.property_type as string} · {p?.bedrooms as number}bd</p>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="flex gap-5 text-center">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">VALUE</p>
                      <p className="text-sm font-bold text-[#111827]" style={{ fontFamily: SERIF }}>£{(value / 1000).toFixed(0)}k</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">NET YIELD</p>
                      <p className="text-sm font-bold text-[#047857]">{netYield.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">NET/MO</p>
                      <p className="text-sm font-bold text-[#047857]">£{netMonthly.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">ROI</p>
                      <p className={`text-sm font-bold ${totalROI >= 8 ? 'text-[#B7791F]' : totalROI > 0 ? 'text-[#047857]' : 'text-[#DC2626]'}`}>
                        {totalROI.toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">EPC</p>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${epcBadge}`}>{epcKnown ? epcRating : '—'}</span>
                    </div>
                  </div>

                  {/* Price history sparkline */}
                  {transactions && transactions.length > 2 && (
                    <div className="shrink-0">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">PRICE TREND</p>
                      <div className="flex items-end gap-0.5 h-8">
                        {transactions.slice(-8).reverse().map((t, ti) => {
                          const maxP = Math.max(...transactions.slice(-8).map(x => Number(x.price ?? 0)))
                          const pct = (Number(t.price ?? 0) / maxP) * 100
                          return <div key={ti} className="flex-1 bg-[#047857]/30 rounded-sm hover:bg-[#047857]/60 transition-colors" style={{ height: `${pct}%`, minWidth: 4 }} />
                        })}
                      </div>
                    </div>
                  )}

                  {/* Remove */}
                  <button onClick={e => { e.stopPropagation(); onRemove(uprn) }}
                    className="text-[#9CA3AF] hover:text-[#DC2626] text-xs border border-[#E7E5DD] rounded-lg px-2.5 py-1.5 transition-colors shrink-0">
                    ✕
                  </button>
                </div>
              </div>
            )
          })}

          {/* Summary */}
          <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl p-4 mt-2">
            <p className="text-xs font-semibold text-[#047857] mb-1">📊 Portfolio Summary</p>
            <p className="text-xs text-[#375A50]">
              {portfolio.length} {portfolio.length === 1 ? 'property' : 'properties'} · Total value £{(totalValue / 1000).toFixed(0)}k ·
              Annual net income £{(totalNetMonthly * 12).toLocaleString()} ·
              Avg ROI {avgROI.toFixed(1)}% ·
              {nonCompliantCount > 0
                ? ` ⚠ ${nonCompliantCount} ${nonCompliantCount === 1 ? 'property needs' : 'properties need'} EPC upgrade before 2028`
                : ' ✓ All properties EPC-C compliant'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
