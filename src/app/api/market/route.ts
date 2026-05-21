import { NextResponse } from 'next/server'
import { getLiveMarketData } from '@/lib/live-market-data'

// Revalidate once per day — Homedata price trends update monthly so daily is ample
export const revalidate = 86400

export async function GET() {
  const data = await getLiveMarketData()
  return NextResponse.json(data)
}
