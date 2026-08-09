'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DAY_NAMES, fmtTime, fmtTimeShort, bookingsForDay, addDays, weekdayOf, arabicDate, todayStr, dateStr, bookingTimeRange, overrideHallName } from '@/lib/time'

const HOUR_H = 68

function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * (1 - pct))
  const g = Math.round(((n >> 8) & 255) * (1 - pct))
  const b = Math.round((n & 255) * (1 - pct))
  return `rgb(${r},${g},${b})`
}

function blkBg(color) { return `linear-gradient(135deg, ${color} 0%, ${shade(color, 0.32)} 100%)` }

export default function Display() {
  const [db, setDb] = useState(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  const load = useCallback(() => { fetch('/api/state').then(r => r.json()).then(j => { if (j && j.settings) setDb(j) }).catch(() => {}) }, [])
  useEffect(() => { load(); const t = setInterval(load, (db?.settings?.displayRefresh || 60) * 1000); return () => clearInterval(t) }, [load, db?.settings?.displayRefresh])

  const nowMin = now.getHours() * 60 + now.getMinutes()
  const today = todayStr()
  const weekStart = useMemo(() => { const off = (now.getDay() + 1) % 7; const s = new Date(now); s.setDate(s.getDate() - off); return dateStr(s) }, [])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const halls = db?.halls || []
  const s = db?.settings
  const open = s?.openTime ?? 480, close = s?.closeTime ?? 1380
  const rows = Math.max(1, Math.round((close - open) / 60))
  const teacherMap = useMemo(() => { const m = {}; (db?.teachers || []).forEach(t => { m[t.name] = t }); return m }, [db?.teachers])

  const todayByHall = useMemo(() => {
    const out = {}; for (const h of halls) {
      const bookings = bookingsForDay(db?.bookings || [], h.id, today)
      out[h.id] = bookings.map(b => {
        const tr = bookingTimeRange(b, today)
        return tr ? { ...b, start: tr.start, end: tr.end } : b
      }).sort((a, b) => a.start - b.start)
    }
    return out
  }, [db, halls, today])

  const strip = useMemo(() => {
    const pills = []; for (const h of halls) {
      const list = todayByHall[h.id] || []
      const live = list.find(b => b.start <= nowMin && nowMin < b.end)
      const next = live ? null : list.find(b => b.start > nowMin)
      if (live) pills.push({ hall: h, b: live, live: true })
      else if (next) pills.push({ hall: h, b: next, live: false })
    }; return pills
  }, [halls, todayByHall, nowMin])

  const tickerItems = useMemo(() => {
    const items = []; for (const h of halls) for (const b of todayByHall[h.id] || []) items.push({ hall: h.name, name: b.teacherName, time: `${fmtTime(b.start)}-${fmtTime(b.end)}`, key: b.id }); return items
  }, [halls, todayByHall])

  if (!db) return <div className="display-wrap"><div className="disp-bg" /><div style={{ position: 'relative', zIndex: 2, color: '#9a8ca0', padding: 30 }}>جاري التحميل...</div></div>

  function blockState(b, d) { if (d < today) return 'past'; if (d > today) return ''; if (nowMin >= b.end) return 'past'; if (nowMin >= b.start) return 'live'; return 'upcoming' }

  return (
    <div className="display-wrap">
      <div className="disp-bg" />
      <div className="orb orb1" /><div className="orb orb2" /><div className="orb orb3" />
      <div className="disp-content">
        <header className="disp-header">
          <div className="disp-title">
            <h1>{s?.placeName || 'EDUCON ACADEMY'}</h1>
            <div className="sub">{s?.placeNameEn || 'EDUCON ACADEMY'}</div>
          </div>
          <div className="disp-clock">
            <div className="time">{(() => { const h = now.getHours(); const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h; return `${h12}:${String(now.getMinutes()).padStart(2, '0')}` })()}<span style={{ fontSize: '0.5em', opacity: 0.6 }}>:{String(now.getSeconds()).padStart(2, '0')}</span> <span style={{ fontSize: '0.45em', opacity: 0.7 }}>{now.getHours() < 12 ? 'صباحًا' : 'مساءً'}</span></div>
            <div className="date">{arabicDate(today)}</div>
          </div>
        </header>

        {halls.length > 0 && (
          <div className="now-strip">
            {strip.length === 0 && <div className="now-pill" style={{ opacity: 0.5 }}>لا توجد مواعيد الآن</div>}
            {strip.map(({ hall, b, live }) => {
              const tp = teacherMap[b.teacherName]?.photo
              return (
                <div key={b.id} className={`now-pill ${live ? 'live' : ''}`}>
                  <span className="pdot" style={{ background: live ? '#34d399' : '#fbbf24' }} />
                  {tp && <img src={tp} className="pill-avatar" />}
                  {hall.name}: <b>{b.teacherName}</b>
                  <span style={{ opacity: 0.7 }}>{fmtTime(b.start)}-{fmtTime(b.end)}</span>
                  {live && <b style={{ color: '#34d399' }}>الآن</b>}
                </div>
              )
            })}
          </div>
        )}

        <div className="disp-scroll">
          {halls.length === 0 && <p style={{ color: '#9a8ca0', padding: 30, textAlign: 'center' }}>أضف القاعات من لوحة التحكم</p>}
          {halls.map(hall => {
            const dayBookings = days.map(d => {
              const bookings = bookingsForDay(db.bookings, hall.id, d)
              return bookings.map(b => {
                const tr = bookingTimeRange(b, d)
                return tr ? { ...b, start: tr.start, end: tr.end } : b
              })
            })
            return (
              <section className="disp-hall" key={hall.id}>
                <div className="disp-hall-head"><span className="dot" style={{ background: hall.color }} />{hall.name}<span style={{ opacity: 0.6, fontWeight: 600, fontSize: 11 }}>{hall.pricePerHour} ج/ساعة</span></div>
                <div className="disp-week-grid">
                  <div style={{ width: 46, flexShrink: 0 }}><div style={{ height: 40 }} />{Array.from({ length: rows }, (_, i) => <div key={i} style={{ height: HOUR_H, fontSize: 9, color: '#565060', fontWeight: 700, paddingTop: 2, paddingRight: 6 }}>{fmtTimeShort(open + i * 60)}</div>)}</div>
                  {days.map((d, di) => {
                    const blks = dayBookings[di]; const isToday = d === today
                    return (
                      <div className={`disp-day ${isToday ? 'today' : ''}`} key={d}>
                        <div className="dhead"><div>{DAY_NAMES[weekdayOf(d)]}</div><div className="dn">{d.slice(5)}</div></div>
                        <div className="dbody" style={{ height: rows * HOUR_H, background: 'repeating-linear-gradient(to bottom, transparent 0 ' + (HOUR_H - 1) + 'px, rgba(255,255,255,0.05) ' + (HOUR_H - 1) + 'px ' + HOUR_H + 'px)' }}>
                          {isToday && nowMin >= open && nowMin <= close && <div className="now-line" style={{ top: ((nowMin - open) / (close - open)) * 100 + '%' }} />}
                          {blks.map(b => {
                            const top = ((b.start - open) / (close - open)) * 100, h = ((b.end - b.start) / (close - open)) * 100, st = blockState(b, d), tp = teacherMap[b.teacherName]?.photo
                            const ovName = overrideHallName(b, d)
                            return (
                              <div key={b.id} className={`disp-blk ${st} ${b.status === 'pending' ? 'pending' : ''} ${ovName ? 'overflow' : ''}`} style={{ top: top + '%', height: `calc(${h}% - 4px)`, background: ovName ? 'linear-gradient(135deg, #f97316, #ea580c)' : blkBg(hall.color) }}>
                                <div className="blk-row">{tp && <img src={tp} className="blk-avatar" />}<span>{b.teacherName}</span></div>
                                {b.title && <span className="bt">{b.title}</span>}
                                {b.type === 'recurring' && <span className="bt">دوري</span>}
                                {ovName && <span className="bt" style={{ color: '#fecdd3' }}>→ {ovName}</span>}
                                <span className="bt">{fmtTime(b.start)} - {fmtTime(b.end)}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <div className="ticker">
        <div className="ticker-track">
          {tickerItems.length === 0 ? <span style={{ color: '#6b5f73' }}>لا توجد مواعيد اليوم</span> : [...tickerItems, ...tickerItems].map((t, i) => <span key={t.key + i}><b>{t.hall}</b>: {t.name} <span style={{ opacity: 0.7 }}>{t.time}</span></span>)}
        </div>
      </div>
    </div>
  )
}
