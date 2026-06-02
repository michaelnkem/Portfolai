import { NextResponse } from 'next/server'
export async function GET() {
  return NextResponse.json({
    hasPropertyData: !!process.env.PROPERTYDATA_API_KEY,
    hasHomedata: !!process.env.HOMEDATA_API_KEY,
    propertyDataPrefix: process.env.PROPERTYDATA_API_KEY?.slice(0, 6) || 'not set',
  })
}
