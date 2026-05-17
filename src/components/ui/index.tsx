'use client'

import { ReactNode } from 'react'

// ── Stat card ──────────────────────────────────────────────────────────────
interface StatProps {
  label: string
  value: string | number
  sub?: string
  tone?: 'neutral' | 'green' | 'gold' | 'red'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Stat({ label, value, sub, tone = 'neutral', size = 'md', className = '' }: StatProps) {
  const colors = {
    neutral: { bg: 'bg-white/[0.025]', border: 'border-border', text: 'text-white', label: 'text-mid' },
    green:   { bg: 'bg-accent/[0.07]',  border: 'border-accent/25',  text: 'text-accent', label: 'text-accent/70' },
    gold:    { bg: 'bg-gold/[0.07]',    border: 'border-gold/25',    text: 'text-gold',   label: 'text-gold/70' },
    red:     { bg: 'bg-danger/[0.07]',  border: 'border-danger/25',  text: 'text-danger', label: 'text-danger/70' },
  }
  const c = colors[tone]
  const fs = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-2xl' : 'text-lg'

  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-2.5 ${className}`}>
      <p className={`stat-label ${c.label}`}>{label}</p>
      <p className={`stat-value font-display font-black ${fs} ${c.text}`}>{value}</p>
      {sub && <p className="text-[10px] text-dim mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Score ring ─────────────────────────────────────────────────────────────
interface ScoreRingProps {
  score: number
  label: string
  size?: number
}

export function ScoreRing({ score, label, size = 52 }: ScoreRingProps) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const color = score >= 80 ? '#00d4aa' : score >= 60 ? '#f0c040' : '#ff4d6d'

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#0f2240" strokeWidth="5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${(score/100)*circ} ${circ}`}
          strokeDashoffset={circ/4}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
        <text x={size/2} y={size/2 + 4} textAnchor="middle" fontSize="12"
              fontWeight="800" fill={color}>{score}</text>
      </svg>
      <span className="text-[9px] font-mono text-dim text-center" style={{ maxWidth: size + 8 }}>
        {label}
      </span>
    </div>
  )
}

// ── Sparkline ──────────────────────────────────────────────────────────────
interface SparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
}

export function Sparkline({ data, color = '#00d4aa', width = 80, height = 28 }: SparklineProps) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 3) - 1.5}`
  ).join(' ')
  const lastPt = pts.split(' ').at(-1)!.split(',')

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="2.5" fill={color} />
    </svg>
  )
}

// ── Line chart ─────────────────────────────────────────────────────────────
interface LineSeries { name: string; data: number[]; color: string }
interface LineChartProps { series: LineSeries[]; labels: string[]; height?: number }

export function LineChart({ series, labels, height = 120 }: LineChartProps) {
  const allVals = series.flatMap(s => s.data)
  const min = Math.min(...allVals), max = Math.max(...allVals)
  const range = max - min || 1
  const W = 420, H = height
  const px = (i: number) => (i / (labels.length - 1)) * W
  const py = (v: number) => H - ((v - min) / range) * (H - 8) - 4

  const stepLabels = Math.ceil(labels.length / 6)

  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} style={{ width: '100%', height: H + 20 }}>
      {[0, 0.25, 0.5, 0.75, 1].map(t => (
        <line key={t} x1={0} y1={H - t * (H - 8) - 4} x2={W} y2={H - t * (H - 8) - 4}
              stroke="#0f2240" strokeWidth="1" />
      ))}
      {series.map(s => {
        const pts = s.data.map((v, i) => `${px(i)},${py(v)}`).join(' ')
        const last = s.data.length - 1
        return (
          <g key={s.name}>
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
            <circle cx={px(last)} cy={py(s.data[last])} r="3" fill={s.color} />
          </g>
        )
      })}
      {labels.map((l, i) => {
        if (i % stepLabels !== 0) return null
        return <text key={l} x={px(i)} y={H + 14} textAnchor="middle" fontSize="8" fill="#3a5570">{l}</text>
      })}
    </svg>
  )
}

// ── Skeleton loader ────────────────────────────────────────────────────────
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

// ── Badge ──────────────────────────────────────────────────────────────────
export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'gold' | 'red' | 'blue' }) {
  const colors = {
    green: 'bg-accent text-bg',
    gold:  'bg-gold text-bg',
    red:   'bg-danger text-white',
    blue:  'bg-blue-500 text-white',
  }
  return <span className={`tag ${colors[tone]}`}>{children}</span>
}

// ── Divider ────────────────────────────────────────────────────────────────
export function Divider({ className = '' }: { className?: string }) {
  return <div className={`border-t border-border ${className}`} />
}

// ── Section header ─────────────────────────────────────────────────────────
export function SectionHeader({ eyebrow, title, action }: {
  eyebrow?: string; title: string; action?: ReactNode
}) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        {eyebrow && <p className="text-[10px] font-mono tracking-[2px] text-accent mb-1">{eyebrow}</p>}
        <h2 className="font-display font-black text-2xl text-white">{title}</h2>
      </div>
      {action}
    </div>
  )
}
