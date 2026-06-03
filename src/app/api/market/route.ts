import { NextResponse } from 'next/server'
import { MARKET_DATA } from '@/lib/market-data'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(MARKET_DATA)
}
