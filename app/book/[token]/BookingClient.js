'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DAY_NAMES, fmtTime, freeRanges, addDays, weekdayOf, todayStr, arabicDate } from '@/lib/time'

const DAYS_AHEAD = 14

export default function Booking({ token }) {
  const [db, setDb] = useState(null)
  const [hallId, setHallId] = useState(null)
  const [date, setDate] = useState(null)
  const [start, setStart] = useState(null)
  const [end, setEnd] = useState(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState(null)

  const load = useCallback(() => {
    fetch('/api/state').then(r => r.json()).then(j => { if (j && j.settings) setDb(j) }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const halls = db?.halls || []
  const open = db?.settings?.openTime ?? 480
  const close = db?.settings?.closeTime ?? 1380
  const placeName = db?.settings?.placeName || 'الacademy'
  const placeNameEn = db?.settings?.placeNameEn || ''
  const today = todayStr()
  const dates = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today])

  const avail = useMemo(() => {
    const m = {}
    if (!db) return m
    for (const d of dates) {
      m[d] = {}
      for (const h of halls) {
        const ranges = freeRanges(db.bookings, h.id, d, open, close)
        const freeH = ranges.reduce((s, r) => s + (r.end - r.start) / 60, 0)
        m[d][h.id] = { ranges, freeH }
      }
    }
    return m
  }, [db, halls, dates, open, close])

  const ranges = useMemo(() => {
    if (!hallId || !date || !db) return []
    return avail[date]?.[hallId]?.ranges || []
  }, [hallId, date, avail, db])

  function pickRange(r) { setStart(r.start); setEnd(r.end) }

  async function submit() {
    setErr(null)
    if (!hallId || !date || start == null || end == null) return setErr('اختر القاعة واليوم والوقت')
    if (!name.trim()) return setErr('اكتب اسمك')
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 15) return setErr('رقم واتساب غير صحيح')
    setBusy(true)
    try {
      const r = await fetch('/api/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Booking-Token': token },
        body: JSON.stringify({ action: 'requestBooking', hallId, date, start: fmtTime(start), end: fmtTime(end), teacherName: name.trim(), phone: digits, title: title.trim() })
      })
      const j = await r.json()
      if (!r.ok || j.ok === false) throw new Error(j.error || 'حدث خطأ')
      setDone(true); load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const step = done ? 4 : hallId == null ? 1 : date == null ? 2 : 3

  return (
    <div className="container">
      <div className="book-head">
        <div className="book-logo">A</div>
        <h1>{placeName}</h1>
        {placeNameEn && <p className="muted" style={{ marginTop: -4 }}>{placeNameEn}</p>}
        <p className="muted">اختر القاعة والوقت المناسب، وسيتم التواصل معك لتأكيد الحجز</p>
      </div>

      {!done && (
        <div className="book-steps">
          {['القاعة', 'اليوم', 'الوقت وبياناتك'].map((s, i) => <span key={s} className={`step-pill ${step === i + 1 ? 'active' : ''}`}>{i + 1}. {s}</span>)}
        </div>
      )}

      {done ? (
        <div className="card success-wrap">
          <div className="big">✓</div>
          <h2>تم استلام طلبك</h2>
          <p className="muted">{halls.find(h => h.id === hallId)?.name} — {arabicDate(date)} — {fmtTime(start)}-{fmtTime(end)}</p>
          <p className="muted">سيتم التواصل معك على واتساب لتأكيد الحجز.</p>
          <button className="btn btn-primary" onClick={() => { setDone(false); setHallId(null); setDate(null); setStart(null); setEnd(null); setName(''); setPhone(''); setTitle('') }}>حجز آخر</button>
        </div>
      ) : (
        <>
          <div className="hall-pick">
            {halls.map(h => (
              <div key={h.id} className={`hall-opt ${hallId === h.id ? 'sel' : ''}`} onClick={() => { setHallId(h.id); setDate(null); setStart(null); setEnd(null) }}>
                <h3><span className="dot" style={{ background: h.color }} />{h.name}</h3>
                <div className="price">{h.pricePerHour} جنيه / ساعة</div>
                <div className="small muted">اليوم: {avail[today]?.[h.id]?.freeH > 0 ? `${Math.round(avail[today][h.id].freeH * 2) / 2} ساعة متاحة` : 'مكتمل'}</div>
              </div>
            ))}
          </div>
          {halls.length === 0 && <p className="muted">لا توجد قاعات متاحة</p>}

          {hallId && <>
            <h3 style={{ marginBottom: 8, marginTop: 24 }}>اختر اليوم</h3>
            <div className="date-pills">
              {dates.map(d => {
                const freeH = avail[d]?.[hallId]?.freeH || 0
                const cls = freeH === 0 ? 'no' : freeH < 4 ? 'part' : 'free'
                return (
                  <div key={d} className={`date-pill ${date === d ? 'sel' : ''}`} onClick={() => { setDate(d); setStart(null); setEnd(null) }}>
                    <div className="dw">{DAY_NAMES[weekdayOf(d)]}</div>
                    <div className="dd">{d.slice(5)}</div>
                    <div className={`av ${cls}`}>{freeH === 0 ? 'مكتمل' : `${Math.round(freeH * 2) / 2} س`}</div>
                  </div>
                )
              })}
            </div>
          </>}

          {date && <>
            <h3 style={{ marginBottom: 8, marginTop: 24 }}>اختر الوقت</h3>
            {ranges.length === 0 && <p className="muted">هذا اليوم مكتمل</p>}
            <div>{ranges.map((r, i) => <button key={i} className="free-slot" onClick={() => pickRange(r)}>{fmtTime(r.start)} - {fmtTime(r.end)}</button>)}</div>
            {start != null && end != null && (
              <div className="card" style={{ marginTop: 18 }}>
                <h3 style={{ marginTop: 0 }}>الموعد: {fmtTime(start)} - {fmtTime(end)}</h3>
                <div className="form-grid">
                  <div className="field"><span className="label">الاسم</span><input value={name} onChange={e => setName(e.target.value)} placeholder="الاسم الكامل" /></div>
                  <div className="field"><span className="label">واتساب</span><input dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div>
                  <div className="field"><span className="label">المادة (اختياري)</span><input value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: رياضيات" /></div>
                </div>
                {err && <div className="conflict-box">{err}</div>}
                <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={submit}>{busy ? 'جاري الإرسال...' : 'إرسال طلب الحجز'}</button>
              </div>
            )}
          </>}

          {halls.length > 0 && (
            <div className="card" style={{ marginTop: 26 }}>
              <h3 style={{ marginTop: 0 }}>الأسعار</h3>
              <table className="price-table"><tbody>{halls.map(h => <tr key={h.id}><td><span className="dot" style={{ background: h.color }} />{h.name}</td><td>{h.pricePerHour} ج/ساعة</td></tr>)}</tbody></table>
              <p className="small muted" style={{ marginBottom: 0 }}>يُعتبر الحجز مؤكدًا فقط بعد التواصل وتأكيد الموعد.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
