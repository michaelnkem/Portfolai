'use client'

import { useState } from 'react'

export function SetupBanner() {
  const [dismissed, setDismissed] = useState(false)

  // In production the banner hides automatically once APIs are working
  // This just shows setup instructions for first-time users
  if (dismissed) return null

  return (
    <div className="bg-gold/10 border-b border-gold/20 px-6 py-3">
      <div className="max-w-[1320px] mx-auto flex items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-gold text-base">⚡</span>
          <span className="text-gold font-semibold">Quick setup — 2 steps to unlock live property data:</span>
          <span className="text-mid">
            1. Get a free Homedata key at{' '}
            <a href="https://homedata.co.uk/register" target="_blank" rel="noopener noreferrer"
               className="text-accent underline">homedata.co.uk/register</a>
            {' '}· 2. Copy{' '}
            <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">.env.local.example</code>
            {' '}→{' '}
            <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">.env.local</code>
            {' '}and paste your key
          </span>
        </div>
        <button onClick={() => setDismissed(true)}
                className="text-dim hover:text-white text-xs shrink-0">
          Dismiss ✕
        </button>
      </div>
    </div>
  )
}
