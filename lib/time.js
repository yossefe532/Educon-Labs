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
  const h24 = Math.floor(m / 60)
  const mm = m % 60
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24
  const period = h24 < 12 ? 'ص' : 'م'
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`
}

export function fmtTimeShort(m) {
  const h24 = Math.floor(m / 60)
  const mm = m % 60
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24
  const period = h24 < 12 ? 'ص' : 'م'
  return `${h12}:${String(mm).padStart(2, '0')}${period}`
}

export function toMin(t) {
  if (typeof t === 'number') return t
  if (typeof t === 'string') {
    const isPM = t.includes('م')
    const isAM = t.includes('ص')
    const cleaned = t.replace(/[صم]/g, '').trim()
    if (cleaned.includes(':')) {
      let [h, m] = cleaned.split(':').map(Number)
      if (isPM && h < 12) h += 12
      if (isAM && h === 12) h = 0
      return h * 60 + (m || 0)
    }
    return Number(cleaned) || 0
  }
  return 0
}

export function timeOptions(open, close, step = 30) {
  const out = []
  for (let m = open; m <= close; m += step) out.push(m)
  return out
}

function firstOccurrence(dayOfWeek, startDate, endDate) {
  const d = parseLocal(startDate)
  const end = parseLocal(endDate)
  for (let i = 0; i < 7; i++) {
    const candidate = dateStr(d)
    if (candidate > endDate) return null
    if (weekdayOf(candidate) === dayOfWeek) return candidate
    d.setDate(d.getDate() + 1)
  }
  return null
}

export function coversDate(b, dStr) {
  if (b.status === 'rejected') return false
  if (b.type === 'single') return b.date === dStr
  if (b.type === 'multi') return (b.slots || []).some(s => s.date === dStr)
  if (b.overrideHalls && b.overrideHalls[dStr]) return false
  return b.startDate <= dStr && dStr <= b.endDate && b.days.includes(weekdayOf(dStr))
}

export function effectiveHallId(b, dStr) {
  if (b.overrideHalls && b.overrideHalls[dStr]) return b.overrideHalls[dStr].hallId
  return b.hallId
}

export function overrideHallName(b, dStr) {
  if (b.overrideHalls && b.overrideHalls[dStr]) return b.overrideHalls[dStr].hallName
  return null
}

export function bookingsForDay(bookings, hallId, dStr) {
  return bookings.filter(b => {
    const eHall = effectiveHallId(b, dStr)
    if (eHall !== hallId) return false
    return coversDate(b, dStr)
  })
}

export function conflictsWith(a, b, excludeId = null) {
  if (b.id === excludeId) return false
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
      const realDate = firstOccurrence(d, a.startDate, a.endDate)
      if (!realDate) return false
      const tmp = { ...a, type: 'single', date: realDate, start: dt.start, end: dt.end }
      return conflictsWith(tmp, b, excludeId)
    })
  }
  if (bHasDT) {
    return b.days.some(d => {
      const dt = b.dayTimes[d]
      if (!dt) return false
      const realDate = firstOccurrence(d, b.startDate, b.endDate)
      if (!realDate) return false
      const tmp = { ...b, type: 'single', date: realDate, start: dt.start, end: dt.end }
      return conflictsWith(a, tmp, excludeId)
    })
  }

  const aHall = aIsRec && a.overrideHalls && a.date ? (a.overrideHalls[a.date]?.hallId || a.hallId) : a.hallId
  const bHall = bIsRec && b.overrideHalls && b.date ? (b.overrideHalls[b.date]?.hallId || b.hallId) : b.hallId
  if (aHall !== bHall) return false

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
    const eHall = effectiveHallId(b, dStr)
    if (eHall !== hallId || b.status === 'rejected') continue
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

export function analyzeConflicts(bookings, candidate, halls, excludeId = null) {
  const results = { free: [], conflicting: [], altHalls: {} }
  function getConfEnd(conf) {
    if (conf.type === 'recurring') return conf.endDate
    if (conf.type === 'multi' && conf.slots?.length) return conf.slots[conf.slots.length - 1].date
    return conf.date
  }
  if (candidate.type === 'single') {
    const conflicts = findConflicts(bookings, candidate, excludeId)
    if (conflicts.length) {
      const conf = conflicts[0]
      results.conflicting.push({ date: candidate.date, conflictWith: conf, conflictEndDate: getConfEnd(conf) })
      for (const h of halls) {
        if (h.id === candidate.hallId) continue
        const test = { ...candidate, hallId: h.id }
        if (!findConflicts(bookings, test, excludeId).length) {
          if (!results.altHalls[candidate.date]) results.altHalls[candidate.date] = []
          results.altHalls[candidate.date].push(h)
        }
      }
    } else {
      results.free.push(candidate.date)
    }
  } else if (candidate.type === 'multi') {
    for (const slot of (candidate.slots || [])) {
      const test = { ...candidate, type: 'single', date: slot.date, start: slot.start, end: slot.end }
      const conflicts = findConflicts(bookings, test, excludeId)
      if (conflicts.length) {
        results.conflicting.push({ date: slot.date, conflictWith: conflicts[0], conflictEndDate: getConfEnd(conflicts[0]) })
        for (const h of halls) {
          if (h.id === candidate.hallId) continue
          const t2 = { ...test, hallId: h.id }
          if (!findConflicts(bookings, t2, excludeId).length) {
            if (!results.altHalls[slot.date]) results.altHalls[slot.date] = []
            results.altHalls[slot.date].push(h)
          }
        }
      } else {
        results.free.push(slot.date)
      }
    }
  } else if (candidate.type === 'recurring') {
    const days = candidate.days || []
    const sd = parseLocal(candidate.startDate)
    const ed = parseLocal(candidate.endDate)
    const d = new Date(sd)
    while (d <= ed) {
      const ds = dateStr(d)
      for (const di of days) {
        if (weekdayOf(ds) === di) {
          const dt = candidate.dayTimes?.[di]
          const start = dt ? dt.start : candidate.start
          const end = dt ? dt.end : candidate.end
          const test = { ...candidate, type: 'single', date: ds, start, end, dayTimes: undefined }
          const conflicts = findConflicts(bookings, test, excludeId)
          if (conflicts.length) {
            results.conflicting.push({ date: ds, conflictWith: conflicts[0], dayOfWeek: di, conflictEndDate: getConfEnd(conflicts[0]) })
            for (const h of halls) {
              if (h.id === candidate.hallId) continue
              const t2 = { ...test, hallId: h.id }
              if (!findConflicts(bookings, t2, excludeId).length) {
                if (!results.altHalls[ds]) results.altHalls[ds] = []
                results.altHalls[ds].push(h)
              }
            }
          } else {
            results.free.push(ds)
          }
        }
      }
      d.setDate(d.getDate() + 1)
    }
  }
  return results
}
