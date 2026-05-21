import { NextResponse } from 'next/server'
import { getLiveMarketData } from '@/lib/live-market-data'

export const revalidate = 86400

export async function GET() {
  const data = await getLiveMarketData()
  return NextResponse.json(data)
}
