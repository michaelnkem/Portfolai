'use client'

import { useState, useEffect, useRef } from 'react'

interface AIAdvisorProps {
  property: Record<string, unknown> | null
  onClose: () => void
}

interface Message { role: 'user' | 'assistant'; content: string }

export function AIAdvisor({ property, onClose }: AIAdvisorProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [initialising, setInitialising] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  useEffect(() => {
    runInitial()
    setTimeout(() => inputRef.current?.focus(), 300)
  }, [])

  const streamMessage = async (userMessages: Message[]) => {
    setStreaming(true)
    const cityName = property?.cityName as string | undefined

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: userMessages, property, cityName }),
      })

      if (!res.body) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

        for (const line of lines) {
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.delta?.text || parsed.delta?.content?.[0]?.text || ''
            if (delta) {
              assistantText += delta
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: assistantText }
                return updated
              })
            }
          } catch { /* skip malformed chunks */ }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error — please try again.' }])
    }
    setStreaming(false)
  }

  const runInitial = async () => {
    setInitialising(true)
    const prompt = property
      ? `Provide a comprehensive investor analysis for this property. Cover: 1) 📊 Investment Scorecard (/10 with clear reasoning), 2) 💰 Real financial breakdown (gross vs net yield, monthly cashflow after all costs), 3) 📈 Growth thesis and city fundamentals, 4) ⚠️ Top 3 risks with severity ratings, 5) 🎯 Verdict — Strong Buy / Buy / Watch / Pass. Note that rent is estimated and should be verified with local agents. Use all available Land Registry, EPC and market data.`
      : `Give me the 3 most important UK property investment insights right now based on live 2026 data. Then tell me what you can help with. Be direct and data-driven.`
    await streamMessage([{ role: 'user', content: prompt }])
    setInitialising(false)
  }

  const send = async () => {
    if (!input.trim() || streaming) return
    const msg = input.trim()
    setInput('')
    const newMessages: Message[] = [...messages, { role: 'user', content: msg }]
    setMessages(newMessages)
    await streamMessage(newMessages)
  }

  const p = property?.property as Record<string, unknown> | undefined
  const cityName = property?.cityName as string | undefined

  const suggestions = property ? [
    'What\'s the net yield after all costs?',
    `Is this priced fairly for ${cityName}?`,
    'Best mortgage strategy for this property?',
    '10-year cashflow projection?',
    'HMO conversion potential?',
    'How does this compare to the city average?',
  ] : [
    'Best UK cities for yield in 2026?',
    'BTL vs HMO — which is better?',
    'Build me a £500k portfolio strategy',
    'How does the BoE rate affect my returns?',
    'EPC compliance — what do I need to know?',
    'Liverpool vs Manchester — which to invest in?',
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-bg/85 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-panel border border-accent/30 rounded-2xl flex flex-col shadow-2xl shadow-accent/10"
           style={{ height: 'min(85vh, 700px)' }}>

        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-emerald-700 flex items-center justify-center text-lg">🤖</div>
            <div>
              <p className="font-display font-bold text-white text-base">Portfolai AI</p>
              <p className="text-[10px] font-mono text-accent">
                {property
                  ? `Analysing: ${((p?.full_address as string) || (p?.address as string) || '').split(',')[0]}`
                  : 'Live 2026 UK market data · Anthropic Claude'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost text-xs px-3 py-1.5">✕ Close</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {initialising && messages.length === 0 && (
            <div className="flex gap-2 items-center text-mid">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-accent animate-pulse-dot"
                     style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
              <span className="text-sm font-mono">
                {property ? 'Analysing property with live market data...' : 'Loading market intelligence...'}
              </span>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-accent/10 border border-accent/25 text-white rounded-br-md'
                  : 'bg-white/[0.03] border border-border text-white rounded-bl-md ai-prose'
              }`}>
                {m.content}
                {streaming && i === messages.length - 1 && m.role === 'assistant' && (
                  <span className="inline-block w-1 h-4 bg-accent ml-0.5 animate-pulse-dot" />
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        {!streaming && messages.length > 0 && (
          <div className="px-5 pb-2 flex gap-2 flex-wrap">
            {suggestions.slice(0, 4).map(q => (
              <button key={q} onClick={() => setInput(q)}
                className="text-[10px] border border-border text-mid rounded-full px-3 py-1 hover:border-accent hover:text-accent transition-colors">
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-border flex gap-3">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={property ? 'Ask about this property...' : 'Ask about UK property investment...'}
            className="flex-1 bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-dim outline-none focus:border-accent transition-colors"
          />
          <button onClick={send} disabled={streaming || !input.trim()} className="btn-primary text-sm px-5 disabled:opacity-40">
            {streaming ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
