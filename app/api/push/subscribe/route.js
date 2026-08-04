import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { loadDB, saveDB, withLock } from '@/lib/storage'
import { checkSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const body = await request.json().catch(() => null)
  if (!body || !body.subscription) return NextResponse.json({ ok: false, error: 'بيانات غير صحيحة' })
  if (!body.subscription.endpoint) return NextResponse.json({ ok: false, error: 'endpoint مفقود' })
  if (!body.role || !['admin', 'teacher'].includes(body.role)) return NextResponse.json({ ok: false, error: 'نوع الاشتراك غير صحيح' })

  const ck = await cookies()
  const sessionToken = ck.get('tb_session')?.value
  const db = await loadDB()
  const authed = checkSession(sessionToken, db.settings.adminPassword)

  if (body.role === 'admin' && !authed) {
    return NextResponse.json({ ok: false, error: 'غير مسموح' })
  }

  return withLock(async () => {
    const cur = await loadDB()
    if (!cur.pushSubscriptions) cur.pushSubscriptions = []

    const existing = cur.pushSubscriptions.find(s => s.endpoint === body.subscription.endpoint)
    if (existing) {
      existing.role = body.role
      existing.teacherName = body.teacherName || ''
      existing.updatedAt = Date.now()
    } else {
      cur.pushSubscriptions.push({
        endpoint: body.subscription.endpoint,
        keys: body.subscription.keys,
        role: body.role,
        teacherName: body.teacherName || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    }

    await saveDB(cur)
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(request) {
  const body = await request.json().catch(() => null)
  if (!body || !body.endpoint) return NextResponse.json({ ok: false, error: 'endpoint مفقود' })

  return withLock(async () => {
    const cur = await loadDB()
    if (!cur.pushSubscriptions) cur.pushSubscriptions = []
    cur.pushSubscriptions = cur.pushSubscriptions.filter(s => s.endpoint !== body.endpoint)
    await saveDB(cur)
    return NextResponse.json({ ok: true })
  })
}
