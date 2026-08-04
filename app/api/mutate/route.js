import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { loadDB, saveDB, withLock } from '@/lib/storage'
import { checkSession, makeSessionToken } from '@/lib/auth'
import crypto from 'crypto'
import { uid, findConflicts, HALL_COLORS, toMin } from '@/lib/time'

const genToken = (suffix) => crypto.createHash('sha256').update((process.env.APP_SECRET || 'educon-academy-2026') + '::' + (suffix || '')).digest('hex').slice(0, 32)

export const dynamic = 'force-dynamic'

function bad(msg) {
  return NextResponse.json({ ok: false, error: msg })
}

function validateBookingFields(body) {
  const type = body.type
  if (type !== 'single' && type !== 'recurring') return { error: 'نوع الحجز غير صحيح' }
  let start = Number(body.start)
  let end = Number(body.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return { error: 'الوقت غير صحيح' }
  const open = Number(body.openTime)
  const close = Number(body.closeTime)
  if (Number.isFinite(open) && Number.isFinite(close)) {
    if (start < open || end > close) return { error: 'الوقت خارج ساعات العمل' }
    if (start % 30 !== 0 || end % 30 !== 0) return { error: 'الوقت يجب أن يكون بنصف ساعة' }
  }
  let b = {
    type, start, end,
    hallId: body.hallId,
    teacherName: String(body.teacherName || '').trim(),
    title: String(body.title || '').trim(),
    phone: String(body.phone || '').trim()
  }
  if (!b.hallId || !b.teacherName) return { error: 'يجب اختيار القاعة واسم المدرس' }
  if (type === 'single') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return { error: 'تاريخ غير صحيح' }
    b.date = body.date
  } else {
    const days = Array.isArray(body.days) ? body.days.map(Number) : []
    if (!days.length || days.some(d => d < 0 || d > 6)) return { error: 'اختر أيام التكرار' }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate || '')) {
      return { error: 'تاريخ البداية أو النهاية غير صحيح' }
    }
    if (body.endDate < body.startDate) return { error: 'تاريخ النهاية قبل البداية' }
    b.days = days
    b.startDate = body.startDate
    b.endDate = body.endDate
  }
  return { value: b }
}

export async function POST(request) {
  const body = await request.json().catch(() => null)
  if (!body || !body.action) return bad('طلب غير صحيح')
  const db = await loadDB()
  const ck = await cookies()
  const sessionToken = ck.get('tb_session')?.value
  const authed = checkSession(sessionToken, db.settings.adminPassword)
  const hdrToken = request.headers.get('x-admin-token')
  const validAdminToken = hdrToken && hdrToken === db.settings.adminToken

  if (body.action === 'login') {
    if (!validAdminToken) return bad('رابط غير صالح')
    if (String(body.password) === String(db.settings.adminPassword)) {
      const res = NextResponse.json({ ok: true })
      res.cookies.set('tb_session', makeSessionToken(db.settings.adminPassword), {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30
      })
      return res
    }
    return bad('كلمة المرور غير صحيحة')
  }

  if (body.action === 'logout') {
    const res = NextResponse.json({ ok: true })
    res.cookies.set('tb_session', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
    return res
  }

  if (body.action === 'requestBooking') {
    const bkToken = request.headers.get('x-booking-token')
    if (db.settings.bookingToken && bkToken !== db.settings.bookingToken) return bad('رابط غير صالح')
    return withLock(async () => {
      const cur = await loadDB()
      const hall = cur.halls.find(h => h.id === body.hallId)
      if (!hall) return bad('القاعة غير موجودة')
      const v = validateBookingFields({
        type: 'single', hallId: body.hallId, date: body.date,
        start: toMin(body.start), end: toMin(body.end),
        teacherName: body.teacherName, title: body.title, phone: body.phone,
        openTime: cur.settings.openTime, closeTime: cur.settings.closeTime
      })
      if (v.error) return bad(v.error)
      if (!/^\d{10,15}$/.test(String(body.phone || '').replace(/\D/g, ''))) return bad('رقم التواصل غير صحيح')
      const b = { ...v.value, id: uid(), hallName: hall.name, status: 'pending', source: 'public', createdAt: Date.now() }
      const conflicts = findConflicts(cur.bookings, b)
      if (conflicts.length) return bad('هذا الموعد محجوز بالفعل، اختر وقتًا آخر')
      cur.bookings.push(b)
      await saveDB(cur)
      return NextResponse.json({ ok: true })
    })
  }

  if (!authed) return bad('غير مسموح')
  return withLock(async () => {
    const cur = await loadDB()
    let hall, teacher, b
    switch (body.action) {
      case 'addHall': {
        const name = String(body.name || '').trim()
        const price = Number(body.pricePerHour)
        if (!name) return bad('اكتب اسم القاعة')
        if (!Number.isFinite(price) || price < 0) return bad('سعر الساعة غير صحيح')
        const existingColors = cur.halls.map(h => h.color)
        const color = HALL_COLORS.find(c => !existingColors.includes(c)) || HALL_COLORS[cur.halls.length % HALL_COLORS.length]
        cur.halls.push({ id: uid(), name, pricePerHour: price, color })
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'updateHall': {
        hall = cur.halls.find(h => h.id === body.id)
        if (!hall) return bad('القاعة غير موجودة')
        const name = String(body.name ?? hall.name).trim()
        const price = Number(body.pricePerHour ?? hall.pricePerHour)
        if (!name) return bad('اكتب اسم القاعة')
        if (!Number.isFinite(price) || price < 0) return bad('سعر الساعة غير صحيح')
        hall.name = name
        hall.pricePerHour = price
        if (body.color) hall.color = body.color
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'deleteHall': {
        cur.halls = cur.halls.filter(h => h.id !== body.id)
        cur.bookings = cur.bookings.filter(x => x.hallId !== body.id)
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'addTeacher': {
        const name = String(body.name || '').trim()
        if (!name) return bad('اكتب اسم المدرس')
        if (cur.teachers.some(t => t.name === name)) return bad('هذا المدرس موجود بالفعل')
        cur.teachers.push({ id: uid(), name, phone: String(body.phone || '').trim(), photo: String(body.photo || '').trim() })
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'updateTeacher': {
        teacher = cur.teachers.find(t => t.id === body.id)
        if (!teacher) return bad('المدرس غير موجود')
        const name = String(body.name ?? teacher.name).trim()
        if (!name) return bad('اكتب اسم المدرس')
        teacher.name = name
        if (body.phone !== undefined) teacher.phone = String(body.phone).trim()
        if (body.photo !== undefined) teacher.photo = String(body.photo).trim()
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'deleteTeacher': {
        cur.teachers = cur.teachers.filter(t => t.id !== body.id)
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'addBooking': {
        const v = validateBookingFields({ ...body, openTime: cur.settings.openTime, closeTime: cur.settings.closeTime })
        if (v.error) return bad(v.error)
        hall = cur.halls.find(h => h.id === v.value.hallId)
        if (!hall) return bad('القاعة غير موجودة')
        b = { ...v.value, id: uid(), hallName: hall.name, status: body.status === 'pending' ? 'pending' : 'confirmed', source: 'admin', createdAt: Date.now() }
        const conflicts = findConflicts(cur.bookings, b)
        if (conflicts.length) return NextResponse.json({ ok: false, conflict: true, conflicts: conflicts.slice(0, 3) })
        cur.bookings.push(b)
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'updateBooking': {
        b = cur.bookings.find(x => x.id === body.id)
        if (!b) return bad('الحجز غير موجود')
        const v = validateBookingFields({ ...body, openTime: cur.settings.openTime, closeTime: cur.settings.closeTime })
        if (v.error) return bad(v.error)
        hall = cur.halls.find(h => h.id === v.value.hallId)
        if (!hall) return bad('القاعة غير موجودة')
        const next = { ...b, ...v.value, id: b.id, hallName: hall.name, status: body.status === 'pending' ? 'pending' : 'confirmed' }
        const conflicts = findConflicts(cur.bookings, next, b.id)
        if (conflicts.length) return NextResponse.json({ ok: false, conflict: true, conflicts: conflicts.slice(0, 3) })
        cur.bookings[cur.bookings.indexOf(b)] = next
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'deleteBooking': {
        cur.bookings = cur.bookings.filter(x => x.id !== body.id)
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'approveBooking': {
        b = cur.bookings.find(x => x.id === body.id)
        if (!b) return bad('الطلب غير موجود')
        b.status = 'confirmed'
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'updateSettings': {
        const s = cur.settings
        if (body.placeName !== undefined) s.placeName = String(body.placeName).trim() || s.placeName
        if (body.placeNameEn !== undefined) s.placeNameEn = String(body.placeNameEn).trim()
        if (body.openTime !== undefined) s.openTime = Number(body.openTime)
        if (body.closeTime !== undefined) s.closeTime = Number(body.closeTime)
        if (s.closeTime <= s.openTime) return bad('ساعات العمل غير صحيحة')
        if (body.displayRefresh !== undefined) s.displayRefresh = Math.max(10, Number(body.displayRefresh) || 60)
        if (body.newPassword !== undefined && body.newPassword !== '') {
          if (String(body.newPassword).length < 4) return bad('كلمة المرور قصيرة جدًا')
          s.adminPassword = String(body.newPassword)
        }
        if (body.regenerateAdminToken) {
          const version = (cur.settings._adminTokenVersion || 0) + 1
          cur.settings._adminTokenVersion = version
          s.adminToken = genToken('admin-v' + version)
        }
        if (body.regenerateBookingToken) {
          const version = (cur.settings._bookingTokenVersion || 0) + 1
          cur.settings._bookingTokenVersion = version
          s.bookingToken = genToken('booking-v' + version)
        }
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      default:
        return bad('إجراء غير معروف')
    }
  })
}
