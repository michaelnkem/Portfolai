'use client'

import type { Tab } from '@/app/page'

interface NavbarProps {
  tab: Tab
  setTab: (t: Tab) => void
  onAI: () => void
  portfolioCount: number
}

export function Navbar({ tab, setTab, onAI, portfolioCount }: NavbarProps) {
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'search',     label: '🔍 Discover' },
    { id: 'market',     label: '📊 Market Intel' },
    { id: 'portfolio',  label: `📂 Portfolio${portfolioCount > 0 ? ` (${portfolioCount})` : ''}` },
    { id: 'calculator', label: '🧮 Calculator' },
  ]

  return (
    <nav className="sticky top-0 z-50 bg-bg/95 backdrop-blur-lg border-b border-border h-15 flex items-center px-6 gap-4"
         style={{ height: 60 }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 mr-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-emerald-700 flex items-center justify-center font-display font-black text-bg text-sm">
          P
        </div>
        <span className="font-display font-black text-lg text-white tracking-tight">Portfolai</span>
        <span className="text-[9px] font-mono tracking-widest px-1.5 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent">
          PRO
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs transition-all ${
              tab === t.id
                ? 'bg-accent/12 border border-accent/30 text-accent'
                : 'border border-transparent text-mid hover:text-white hover:bg-white/5'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* AI button */}
      <button onClick={onAI} className="btn-primary flex items-center gap-2 text-sm">
        🤖 AI Advisor
      </button>
    </nav>
  )
}
