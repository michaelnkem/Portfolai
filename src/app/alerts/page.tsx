'use client'

import { useState } from 'react'
import Link from 'next/link'

const SERIF = 'var(--font-baskerville), "Libre Baskerville", Georgia, serif'

export default function AlertsPage() {
  const [dismissed, setDismissed] = useState<string[]>([])

  return (
    <div className="min-h-screen bg-[#FAF9F5]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <header className="bg-white border-b border-[#E7E5DD] px-6 h-[68px] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-[#047857] rounded-lg flex items-center justify-center shrink-0">
              <svg width="15" height="14" viewBox="0 0 15 14" fill="none">
                <path d="M1.5 13V6.2L7.5 2l6 4.2V13H10V9H5v4H1.5z" fill="white" />
              </svg>
            </div>
            <span className="font-bold text-[19px] tracking-tight text-[#111827]" style={{ fontFamily: SERIF }}>Portfolai</span>
          </Link>
          <span className="text-[#E7E5DD]">/</span>
          <span className="text-sm text-[#6B7280] font-medium">Alerts</span>
        </div>
        <Link href="/"
          className="flex items-center gap-1.5 text-sm text-[#047857] font-semibold hover:underline">
          ← Back to Dashboard
        </Link>
      </header>

      {/* Content */}
      <div className="max-w-[860px] mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#047857] mb-2">NOTIFICATIONS</p>
          <h1 className="text-3xl font-bold text-[#111827]" style={{ fontFamily: SERIF }}>Alerts &amp; Updates</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Property data changes, value updates, and market alerts for your saved properties.
          </p>
        </div>

        {/* No alerts state */}
        <div className="bg-white border border-[#E7E5DD] rounded-2xl p-14 text-center shadow-[0_8px_24px_rgba(17,24,39,0.04)] mb-6">
          <p className="text-4xl mb-4">🔔</p>
          <p className="text-lg font-semibold text-[#374151] mb-2" style={{ fontFamily: SERIF }}>No new updates</p>
          <p className="text-sm text-[#6B7280] max-w-md mx-auto leading-relaxed">
            We&apos;ll notify you here when there are changes to your saved or favourited properties —
            including estimated value changes, EPC updates, new Land Registry transactions, or risk changes.
          </p>
        </div>

        {/* What we watch */}
        <div className="bg-white border border-[#E7E5DD] rounded-2xl overflow-hidden shadow-[0_8px_24px_rgba(17,24,39,0.04)] mb-6">
          <div className="px-6 py-4 border-b border-[#F3F4F6]">
            <h2 className="font-semibold text-[#111827] text-base" style={{ fontFamily: SERIF }}>What we monitor</h2>
            <p className="text-xs text-[#9CA3AF] mt-0.5">For all your saved and favourited properties</p>
          </div>
          <div className="divide-y divide-[#F3F4F6]">
            {[
              { icon: '💰', title: 'Estimated value changes',    desc: 'When our AVM model updates the estimated current value for a saved property.' },
              { icon: '⚡', title: 'EPC rating changes',         desc: 'When a new EPC certificate is registered with the EPC Open Data Register.' },
              { icon: '📋', title: 'New Land Registry transactions', desc: 'When a new sale is registered at HM Land Registry for a property you\'re tracking.' },
              { icon: '📈', title: 'Yield estimate updates',     desc: 'When estimated rental yield changes based on local market movements.' },
              { icon: '⚠️', title: 'Environmental risk changes', desc: 'When flood, subsidence, or other risk scores are updated by data providers.' },
            ].map(item => (
              <div key={item.title} className="flex items-start gap-4 px-6 py-4">
                <span className="text-xl shrink-0 mt-0.5">{item.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-[#111827]">{item.title}</p>
                  <p className="text-xs text-[#6B7280] mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl px-5 py-4 text-xs text-[#047857] leading-relaxed">
          💡 Save properties from the <Link href="/" className="font-semibold underline">Discover tab</Link> and star them as Favourites to start tracking. Alerts will appear here automatically when property data is refreshed.
        </div>
      </div>
    </div>
  )
}
