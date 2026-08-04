import { NextResponse } from 'next/server'
import { getVapidKeys } from '@/lib/vapid'

export const dynamic = 'force-dynamic'

export async function GET() {
  const keys = getVapidKeys()
  return NextResponse.json({ publicKey: keys.publicKey })
}
