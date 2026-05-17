'use client'

import { useState, useCallback } from 'react'
import { Navbar } from '@/components/layout/Navbar'
import { HeroStats } from '@/components/layout/HeroStats'
import { PropertySearch } from '@/components/property/PropertySearch'
import { PropertyDetail } from '@/components/property/PropertyDetail'
import { AIAdvisor } from '@/components/ai/AIAdvisor'
import { MarketIntel } from '@/components/property/MarketIntel'
import { Portfolio } from '@/components/property/Portfolio'
import { ROICalculator } from '@/components/property/ROICalculator'
import { MARKET_DATA } from '@/lib/market-data'

export type Tab = 'search' | 'market' | 'portfolio' | 'calculator'

export default function Home() {
  const [tab, setTab] = useState<Tab>('search')
  const [selectedProperty, setSelectedProperty] = useState<Record<string, unknown> | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiProperty, setAiProperty] = useState<Record<string, unknown> | null>(null)
  const [portfolio, setPortfolio] = useState<Array<Record<string, unknown>>>([])

  const openAI = useCallback((property: Record<string, unknown> | null = null) => {
    setAiProperty(property)
    setAiOpen(true)
  }, [])

  const addToPortfolio = useCallback((property: Record<string, unknown>) => {
    setPortfolio(prev => {
      const uprn = (property.property as Record<string, unknown>)?.uprn
      if (prev.some(p => (p.property as Record<string, unknown>)?.uprn === uprn)) return prev
      return [...prev, property]
    })
  }, [])

  return (
    <>
      <Navbar tab={tab} setTab={setTab} onAI={() => openAI(null)} portfolioCount={portfolio.length} />

      <HeroStats marketData={MARKET_DATA} />

      <main className="max-w-[1320px] mx-auto px-6 py-8">
        {tab === 'search' && (
          <PropertySearch
            onSelectProperty={setSelectedProperty}
            onAI={openAI}
            onAddPortfolio={addToPortfolio}
          />
        )}

        {tab === 'market' && (
          <MarketIntel marketData={MARKET_DATA} onAI={openAI} />
        )}

        {tab === 'portfolio' && (
          <Portfolio
            portfolio={portfolio}
            onRemove={(uprn) => setPortfolio(prev => prev.filter(p =>
              (p.property as Record<string, unknown>)?.uprn !== uprn
            ))}
            onAI={openAI}
          />
        )}

        {tab === 'calculator' && (
          <ROICalculator marketData={MARKET_DATA} onAI={openAI} />
        )}
      </main>

      {/* Property detail slide-over */}
      {selectedProperty && (
        <PropertyDetail
          data={selectedProperty}
          onClose={() => setSelectedProperty(null)}
          onAI={() => openAI(selectedProperty)}
          onAddPortfolio={() => addToPortfolio(selectedProperty)}
        />
      )}

      {/* AI advisor drawer */}
      {aiOpen && (
        <AIAdvisor
          property={aiProperty}
          onClose={() => setAiOpen(false)}
        />
      )}
    </>
  )
}
