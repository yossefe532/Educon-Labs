import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { loadDB, saveDB, sanitizeState } from '@/lib/storage'
import { checkSession } from '@/lib/auth'
import { isPendingOld, isBookingDatePast } from '@/lib/time'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const db = await loadDB()
  const ck = await cookies()
  const authed = checkSession(ck.get('tb_session')?.value, db.settings.adminPassword)

  if (authed) {
    let changed = false
    for (const b of db.bookings) {
      if (b.status === 'pending' && (isPendingOld(b, 2) || isBookingDatePast(b))) {
        b.status = 'rejected'
        b.rejectReason = isBookingDatePast(b) ? 'expired' : 'timeout'
        changed = true
      }
    }
    if (changed) await saveDB(db)
  }

  return NextResponse.json(sanitizeState(db, authed))
}
