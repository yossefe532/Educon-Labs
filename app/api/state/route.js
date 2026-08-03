import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { loadDB, sanitizeState } from '@/lib/storage'
import { checkSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const db = await loadDB()
  const ck = await cookies()
  const authed = checkSession(ck.get('tb_session')?.value, db.settings.adminPassword)
  return NextResponse.json(sanitizeState(db, authed))
}
