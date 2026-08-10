import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { loadDB, saveDB, withLock, defaultDB } from '@/lib/storage'
import { checkSession, makeSessionToken } from '@/lib/auth'
import crypto from 'crypto'
import { uid, findConflicts, HALL_COLORS, toMin, fmtTime, isPendingOld, isBookingDatePast, dateStr, weekdayOf, parseLocal } from '@/lib/time'
import { notifyAdmin, notifyTeacher, cleanupExpiredSubscriptions } from '@/lib/notifications'

const genToken = (suffix) => crypto.createHash('sha256').update((process.env.APP_SECRET || 'educon-academy-2026') + '::' + (suffix || '')).digest('hex').slice(0, 32)

export const dynamic = 'force-dynamic'

function bad(msg) {
  return NextResponse.json({ ok: false, error: msg })
}

function validateBookingFields(body) {
  const type = body.type
  if (type !== 'single' && type !== 'recurring' && type !== 'multi') return { error: 'نوع الحجز غير صحيح' }

  let b = {
    type,
    hallId: body.hallId,
    teacherName: String(body.teacherName || '').trim(),
    title: String(body.title || '').trim(),
    phone: String(body.phone || '').trim()
  }
  if (!b.hallId || !b.teacherName) return { error: 'يجب اختيار القاعة واسم المدرس' }

  if (type === 'multi') {
    const slots = Array.isArray(body.slots) ? body.slots : []
    if (!slots.length) return { error: 'اختر يومًا واحدًا على الأقل' }
    const open = Number(body.openTime)
    const close = Number(body.closeTime)
    const validSlots = []
    for (const sl of slots) {
      let st = Number(sl.start)
      let en = Number(sl.end)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sl.date || '')) return { error: 'تاريخ غير صحيح' }
      if (!Number.isFinite(st) || !Number.isFinite(en) || st >= en) return { error: 'الوقت غير صحيح' }
      if (Number.isFinite(open) && Number.isFinite(close)) {
        if (st < open || en > close) return { error: `${sl.date}: الوقت خارج ساعات العمل` }
        if (st % 30 !== 0 || en % 30 !== 0) return { error: `${sl.date}: الوقت يجب أن يكون بنصف ساعة` }
      }
      validSlots.push({ date: sl.date, start: st, end: en })
    }
    validSlots.sort((a, c) => a.date.localeCompare(c.date) || a.start - c.start)
    b.slots = validSlots
    b.start = Math.min(...validSlots.map(s => s.start))
    b.end = Math.max(...validSlots.map(s => s.end))
    return { value: b }
  }

  let start = Number(body.start)
  let end = Number(body.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return { error: 'الوقت غير صحيح' }
  const open = Number(body.openTime)
  const close = Number(body.closeTime)
  if (Number.isFinite(open) && Number.isFinite(close)) {
    if (start < open || end > close) return { error: 'الوقت خارج ساعات العمل' }
    if (start % 30 !== 0 || end % 30 !== 0) return { error: 'الوقت يجب أن يكون بنصف ساعة' }
  }
  b.start = start
  b.end = end

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
    if (body.dayTimes && typeof body.dayTimes === 'object') {
      const dt = {}
      for (const d of days) {
        const t = body.dayTimes[d]
        if (t && Number.isFinite(Number(t.start)) && Number.isFinite(Number(t.end)) && Number(t.start) < Number(t.end)) {
          dt[d] = { start: Number(t.start), end: Number(t.end) }
        }
      }
      if (Object.keys(dt).length) b.dayTimes = dt
    }
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
  const def = defaultDB()
  const validAdminToken = hdrToken && (hdrToken === db.settings.adminToken || hdrToken === def.settings.adminToken)

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
    return withLock(async () => {
      const cur = await loadDB()
      const hall = cur.halls.find(h => h.id === body.hallId)
      if (!hall) return bad('القاعة غير موجودة')

      const bookingType = body.type || 'single'
      let v
      if (bookingType === 'multi') {
        const slots = Array.isArray(body.slots) ? body.slots.map(s => ({
          date: s.date, start: toMin(s.start), end: toMin(s.end)
        })) : []
        v = validateBookingFields({
          type: 'multi', hallId: body.hallId, slots,
          teacherName: body.teacherName, title: body.title, phone: body.phone,
          openTime: cur.settings.openTime, closeTime: cur.settings.closeTime
        })
      } else if (bookingType === 'recurring') {
        const dayTimes = body.dayTimes ? Object.fromEntries(Object.entries(body.dayTimes).map(([d, t]) => [Number(d), { start: toMin(t.start ?? t.start), end: toMin(t.end ?? t.end) }])) : undefined
        v = validateBookingFields({
          type: 'recurring', hallId: body.hallId,
          days: body.days, startDate: body.startDate, endDate: body.endDate,
          start: toMin(body.start), end: toMin(body.end),
          dayTimes,
          teacherName: body.teacherName, title: body.title, phone: body.phone,
          openTime: cur.settings.openTime, closeTime: cur.settings.closeTime
        })
      } else {
        v = validateBookingFields({
          type: 'single', hallId: body.hallId, date: body.date,
          start: toMin(body.start), end: toMin(body.end),
          teacherName: body.teacherName, title: body.title, phone: body.phone,
          openTime: cur.settings.openTime, closeTime: cur.settings.closeTime
        })
      }
      if (v.error) return bad(v.error)
      if (!/^\d{10,15}$/.test(String(body.phone || '').replace(/\D/g, ''))) return bad('رقم التواصل غير صحيح')
      const b = { ...v.value, id: uid(), hallName: hall.name, status: 'pending', source: 'student', createdAt: Date.now() }
      const conflicts = findConflicts(cur.bookings, b)
      if (conflicts.length) return bad('هذا الموعد محجوز بالفعل، اختر وقتًا آخر')
      cur.bookings.push(b)
      await saveDB(cur)
      notifyAdmin(cur, 'طلب حجز جديد', `${b.teacherName} طلب حجز في ${b.hallName} يوم ${b.date} من ${fmtTime(b.start)} إلى ${fmtTime(b.end)}`, `/manage/${cur.settings.adminToken}`).then(results => {
        loadDB().then(d => { cleanupExpiredSubscriptions(d, results); saveDB(d) })
      }).catch(() => {})
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
        cur.halls.push({
          id: uid(), name, pricePerHour: price, color,
          capacity: Number(body.capacity) || 0,
          hasScreen: !!body.hasScreen,
          acCount: Number(body.acCount) || 0,
          boardsCount: Number(body.boardsCount) || 0,
          hasInteractiveScreen: !!body.hasInteractiveScreen
        })
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
        if (body.capacity !== undefined) hall.capacity = Number(body.capacity) || 0
        if (body.hasScreen !== undefined) hall.hasScreen = !!body.hasScreen
        if (body.acCount !== undefined) hall.acCount = Number(body.acCount) || 0
        if (body.boardsCount !== undefined) hall.boardsCount = Number(body.boardsCount) || 0
        if (body.hasInteractiveScreen !== undefined) hall.hasInteractiveScreen = !!body.hasInteractiveScreen
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
        if (v.value.teacherName && !cur.teachers.some(t => t.name === v.value.teacherName)) {
          cur.teachers.push({ id: uid(), name: v.value.teacherName, phone: String(body.phone || '').trim(), photo: '' })
        }
        b = { ...v.value, id: uid(), hallName: hall.name, status: body.status === 'pending' ? 'pending' : 'confirmed', source: body.source || 'admin', createdAt: Date.now() }
        const overflowOverrides = body.overflowOverrides && typeof body.overflowOverrides === 'object' ? body.overflowOverrides : null
        if (overflowOverrides && Object.keys(overflowOverrides).length) {
          const allDates = []
          if (b.type === 'single') {
            allDates.push({ date: b.date, start: b.start, end: b.end })
          } else if (b.type === 'multi') {
            for (const s of (b.slots || [])) allDates.push({ date: s.date, start: s.start, end: s.end })
          } else {
            const sd = parseLocal(b.startDate)
            const ed = parseLocal(b.endDate)
            const d = new Date(sd)
            while (d <= ed) {
              const ds = dateStr(d)
              const dow = weekdayOf(ds)
              if (b.days.includes(dow)) {
                const dt = b.dayTimes?.[dow]
                allDates.push({ date: ds, start: dt?.start ?? b.start, end: dt?.end ?? b.end })
              }
              d.setDate(d.getDate() + 1)
            }
          }
          const overflowErrors = []
          const overrideHalls = {}
          for (const item of allDates) {
            const altId = overflowOverrides[item.date]
            if (altId) {
              const altHall = cur.halls.find(h => h.id === altId)
              if (!altHall) { overflowErrors.push(item.date + ': القاعة البديلة غير موجودة'); continue }
              overrideHalls[item.date] = { hallId: altHall.id, hallName: altHall.name }
              const testB = { ...b, type: 'single', date: item.date, start: item.start, end: item.end, hallId: altHall.id, dayTimes: undefined }
              const c = findConflicts(cur.bookings, testB, null)
              if (c.length) overflowErrors.push(item.date + ': القاعة البديلة ' + altHall.name + ' محجوزة')
            } else {
              const testB = { ...b, type: 'single', date: item.date, start: item.start, end: item.end, dayTimes: undefined }
              const c = findConflicts(cur.bookings, testB, null)
              if (c.length) overflowErrors.push(item.date + ': يوجد تعارض')
            }
          }
          if (overflowErrors.length) return bad(overflowErrors.slice(0, 3).join(' | '))
          if (Object.keys(overrideHalls).length) b.overrideHalls = overrideHalls
          b.status = 'confirmed'
        } else {
          const conflicts = findConflicts(cur.bookings, b)
          if (conflicts.length) return NextResponse.json({ ok: false, conflict: true, conflicts: conflicts.slice(0, 3) })
        }
        cur.bookings.push(b)
        await saveDB(cur)
        return NextResponse.json({ ok: true, id: b.id })
      }
      case 'updateBooking': {
        b = cur.bookings.find(x => x.id === body.id)
        if (!b) return bad('الحجز غير موجود')
        const v = validateBookingFields({ ...body, openTime: cur.settings.openTime, closeTime: cur.settings.closeTime })
        if (v.error) return bad(v.error)
        hall = cur.halls.find(h => h.id === v.value.hallId)
        if (!hall) return bad('القاعة غير موجودة')
        if (v.value.teacherName && !cur.teachers.some(t => t.name === v.value.teacherName)) {
          cur.teachers.push({ id: uid(), name: v.value.teacherName, phone: String(body.phone || '').trim(), photo: '' })
        }
        const next = { ...b, ...v.value, id: b.id, hallName: hall.name, status: body.status === 'pending' ? 'pending' : 'confirmed' }
        const updOverflowOverrides = body.overflowOverrides && typeof body.overflowOverrides === 'object' ? body.overflowOverrides : null
        if (updOverflowOverrides && Object.keys(updOverflowOverrides).length) {
          const allDates = []
          if (next.type === 'single') {
            allDates.push({ date: next.date, start: next.start, end: next.end })
          } else if (next.type === 'multi') {
            for (const s of (next.slots || [])) allDates.push({ date: s.date, start: s.start, end: s.end })
          } else {
            const sd = parseLocal(next.startDate)
            const ed = parseLocal(next.endDate)
            const d = new Date(sd)
            while (d <= ed) {
              const ds = dateStr(d)
              const dow = weekdayOf(ds)
              if (next.days.includes(dow)) {
                const dt = next.dayTimes?.[dow]
                allDates.push({ date: ds, start: dt?.start ?? next.start, end: dt?.end ?? next.end })
              }
              d.setDate(d.getDate() + 1)
            }
          }
          const overflowErrors = []
          const overrideHalls = {}
          for (const item of allDates) {
            const altId = updOverflowOverrides[item.date]
            if (altId) {
              const altHall = cur.halls.find(h => h.id === altId)
              if (!altHall) { overflowErrors.push(item.date + ': القاعة البديلة غير موجودة'); continue }
              overrideHalls[item.date] = { hallId: altHall.id, hallName: altHall.name }
              const testB = { ...next, type: 'single', date: item.date, start: item.start, end: item.end, hallId: altHall.id, dayTimes: undefined }
              const c = findConflicts(cur.bookings, testB, next.id)
              if (c.length) overflowErrors.push(item.date + ': القاعة البديلة ' + altHall.name + ' محجوزة')
            } else {
              const testB = { ...next, type: 'single', date: item.date, start: item.start, end: item.end, dayTimes: undefined }
              const c = findConflicts(cur.bookings, testB, next.id)
              if (c.length) overflowErrors.push(item.date + ': يوجد تعارض')
            }
          }
          if (overflowErrors.length) return bad(overflowErrors.slice(0, 3).join(' | '))
          if (Object.keys(overrideHalls).length) next.overrideHalls = overrideHalls
          next.status = 'confirmed'
        } else {
          const conflicts = findConflicts(cur.bookings, next, next.id)
          if (conflicts.length) return NextResponse.json({ ok: false, conflict: true, conflicts: conflicts.slice(0, 3) })
        }
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
        notifyTeacher(cur, b.teacherName, 'تم اعتماد حجزك ✅', `حجزك في ${b.hallName} يوم ${b.date} من ${fmtTime(b.start)} إلى ${fmtTime(b.end)} تم اعتماده`, `/book`).then(results => {
          loadDB().then(d => { cleanupExpiredSubscriptions(d, results); saveDB(d) })
        }).catch(() => {})
        return NextResponse.json({ ok: true })
      }
      case 'setOverride': {
        b = cur.bookings.find(x => x.id === body.bookingId)
        if (!b) return bad('الحجز غير موجود')
        if (b.type !== 'recurring') return bad('التحويل متاح للعقود الدوري فقط')
        const altHall = cur.halls.find(h => h.id === body.altHallId)
        if (!altHall) return bad('القاعة البديلة غير موجودة')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return bad('تاريخ غير صحيح')
        if (!b.overrideHalls) b.overrideHalls = {}
        b.overrideHalls[body.date] = { hallId: altHall.id, hallName: altHall.name }
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'clearOverride': {
        b = cur.bookings.find(x => x.id === body.bookingId)
        if (!b) return bad('الحجز غير موجود')
        if (b.overrideHalls && b.overrideHalls[body.date]) {
          delete b.overrideHalls[body.date]
          if (Object.keys(b.overrideHalls).length === 0) delete b.overrideHalls
        }
        await saveDB(cur)
        return NextResponse.json({ ok: true })
      }
      case 'clearOverridesRange': {
        b = cur.bookings.find(x => x.id === body.bookingId)
        if (!b) return bad('الحجز غير موجود')
        if (b.overrideHalls) {
          const from = body.fromDate || ''
          const to = body.toDate || ''
          for (const d of Object.keys(b.overrideHalls)) {
            if ((!from || d >= from) && (!to || d <= to)) delete b.overrideHalls[d]
          }
          if (Object.keys(b.overrideHalls).length === 0) delete b.overrideHalls
        }
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
