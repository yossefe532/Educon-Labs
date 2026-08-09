export const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']
export const HALL_COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#d97706', '#059669', '#db2777', '#4f46e5', '#ea580c', '#0d9488', '#9333ea', '#ca8a04', '#0369a1']
export const DEFAULT_OPEN = 8 * 60
export const DEFAULT_CLOSE = 23 * 60

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function parseLocal(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayStr() {
  return dateStr(new Date())
}

export function weekdayOf(dStr) {
  return (parseLocal(dStr).getDay() + 1) % 7
}

export function weekStartDate(d) {
  const offset = (d.getDay() + 1) % 7
  const s = new Date(d)
  s.setDate(s.getDate() - offset)
  return dateStr(s)
}

export function addDays(dStr, n) {
  const d = parseLocal(dStr)
  d.setDate(d.getDate() + n)
  return dateStr(d)
}

export function fmtTime(m) {
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function toMin(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function timeOptions(open, close, step = 30) {
  const out = []
  for (let m = open; m <= close; m += step) out.push(m)
  return out
}

export function coversDate(b, dStr) {
  if (b.status === 'rejected') return false
  if (b.type === 'single') return b.date === dStr
  if (b.type === 'multi') return (b.slots || []).some(s => s.date === dStr)
  return b.startDate <= dStr && dStr <= b.endDate && b.days.includes(weekdayOf(dStr))
}

export function bookingsForDay(bookings, hallId, dStr) {
  return bookings.filter(b => b.hallId === hallId && coversDate(b, dStr))
}

export function conflictsWith(a, b, excludeId = null) {
  if (b.id === excludeId) return false
  if (a.hallId !== b.hallId) return false
  if (a.status === 'rejected' || b.status === 'rejected') return false

  if (a.type === 'multi') {
    return (a.slots || []).some(slot => {
      const tmp = { ...a, type: 'single', date: slot.date, start: slot.start, end: slot.end }
      return conflictsWith(tmp, b, excludeId)
    })
  }
  if (b.type === 'multi') {
    return (b.slots || []).some(slot => {
      const tmp = { ...b, type: 'single', date: slot.date, start: slot.start, end: slot.end }
      return conflictsWith(a, tmp, excludeId)
    })
  }

  const aIsRec = a.type === 'recurring'
  const bIsRec = b.type === 'recurring'
  const aHasDT = aIsRec && a.dayTimes && Object.keys(a.dayTimes).length
  const bHasDT = bIsRec && b.dayTimes && Object.keys(b.dayTimes).length

  if (aHasDT) {
    return a.days.some(d => {
      const dt = a.dayTimes[d]
      if (!dt) return false
      const tmp = { ...a, type: 'single', date: null, start: dt.start, end: dt.end, _checkDay: d }
      return conflictsWith(tmp, b, excludeId)
    })
  }
  if (bHasDT) {
    return b.days.some(d => {
      const dt = b.dayTimes[d]
      if (!dt) return false
      const tmp = { ...b, type: 'single', date: null, start: dt.start, end: dt.end, _checkDay: d }
      return conflictsWith(a, tmp, excludeId)
    })
  }

  if (!(a.start < b.end && b.start < a.end)) return false
  if (!aIsRec && !bIsRec) return a.date === b.date
  if (!aIsRec) return b.startDate <= a.date && a.date <= b.endDate && b.days.includes(weekdayOf(a.date))
  if (!bIsRec) return a.startDate <= b.date && b.date <= a.endDate && a.days.includes(weekdayOf(b.date))
  const s = a.startDate < b.startDate ? b.startDate : a.startDate
  const e = a.endDate < b.endDate ? a.endDate : b.endDate
  if (s > e) return false
  return a.days.some(d => b.days.includes(d))
}

export function findConflicts(bookings, candidate, excludeId = null) {
  return bookings.filter(b => conflictsWith(candidate, b, excludeId))
}

export function freeRanges(bookings, hallId, dStr, open, close) {
  const taken = []
  for (const b of bookings) {
    if (b.hallId !== hallId || b.status === 'rejected') continue
    if (b.type === 'multi') {
      for (const s of (b.slots || [])) {
        if (s.date === dStr) taken.push({ s: s.start, e: s.end })
      }
    } else if (coversDate(b, dStr)) {
      const tr = bookingTimeRange(b, dStr)
      if (tr) taken.push({ s: tr.start, e: tr.end })
    }
  }
  taken.sort((x, y) => x.s - y.s)
  const free = []
  let cur = open
  for (const t of taken) {
    if (t.s > cur) free.push({ start: cur, end: Math.min(t.s, close) })
    if (t.e > cur) cur = t.e
    if (cur >= close) break
  }
  if (cur < close) free.push({ start: cur, end: close })
  return free
}

export function waLink(phone, text) {
  let p = String(phone || '').replace(/[^\d+]/g, '')
  if (p.startsWith('00')) p = p.slice(2)
  if (p.startsWith('0')) p = '2' + p
  p = p.replace(/^\+/, '')
  if (!p) return '#'
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`
}

export function arabicDate(dStr) {
  const d = parseLocal(dStr)
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function bookingTimeRange(b, dStr) {
  if (b.type === 'multi') {
    const slot = (b.slots || []).find(s => s.date === dStr)
    return slot ? { start: slot.start, end: slot.end } : null
  }
  if (b.type === 'recurring' && b.dayTimes) {
    const di = weekdayOf(dStr)
    const dt = b.dayTimes[di]
    if (dt) return { start: dt.start, end: dt.end }
  }
  return { start: b.start, end: b.end }
}

export function isPendingOld(b, days = 2) {
  if (b.status !== 'pending' || !b.createdAt) return false
  return Date.now() - b.createdAt > days * 24 * 60 * 60 * 1000
}

export function isBookingDatePast(b) {
  const today = todayStr()
  if (b.type === 'single') return b.date < today
  if (b.type === 'multi') return (b.slots || []).every(s => s.date < today)
  if (b.type === 'recurring') return b.endDate < today
  return false
}
