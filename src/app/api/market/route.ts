import { NextResponse } from 'next/server'
import { MARKET_DATA } from '@/lib/market-data'

export async function GET() {
  return NextResponse.json(MARKET_DATA)
}
