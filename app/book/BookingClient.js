'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DAY_NAMES, fmtTime, freeRanges, addDays, weekdayOf, todayStr, arabicDate, waLink } from '@/lib/time'

const DAYS_AHEAD = 21

export default function Booking() {
  const [db, setDb] = useState(null)
  const [hallId, setHallId] = useState(null)
  const [bookingType, setBookingType] = useState(null)
  const [date, setDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [start, setStart] = useState(null)
  const [end, setEnd] = useState(null)
  const [days, setDays] = useState([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
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

  function addSlot() {
    if (start == null || end == null || !date) return
    const exists = slots.some(s => s.date === date && s.start === start && s.end === end)
    if (exists) return setErr('هذا الموعد مضاف بالفعل')
    const conflict = slots.some(s => s.date === date && s.start < end && start < s.end)
    if (conflict) return setErr('يوجد تداخل مع موعد آخر في نفس اليوم')
    setSlots([...slots, { date, start, end }])
    setStart(null)
    setEnd(null)
    setDate(null)
    setErr(null)
  }

  function removeSlot(i) {
    setSlots(slots.filter((_, idx) => idx !== i))
  }

  function pickRange(r) { setStart(r.start); setEnd(r.end) }

  async function submit() {
    setErr(null)
    if (!hallId) return setErr('اختر القاعة')
    const digits = phone.replace(/\D/g, '')
    if (!name.trim()) return setErr('اكتب اسمك')
    if (digits.length < 10 || digits.length > 15) return setErr('رقم واتساب غير صحيح')

    let payload
    if (bookingType === 'single') {
      if (!date || start == null || end == null) return setErr('اختر اليوم والوقت')
      payload = { type: 'single', hallId, date, start: fmtTime(start), end: fmtTime(end), teacherName: name.trim(), phone: digits, title: title.trim() }
    } else if (bookingType === 'multi') {
      if (slots.length === 0) return setErr('أضف يومًا واحدًا على الأقل')
      payload = { type: 'multi', hallId, slots: slots.map(s => ({ date: s.date, start: fmtTime(s.start), end: fmtTime(s.end) })), teacherName: name.trim(), phone: digits, title: title.trim() }
    } else if (bookingType === 'contract') {
      if (!days.length) return setErr('اختر أيام التكرار')
      if (!startDate || !endDate) return setErr('اختر تاريخ البداية والنهاية')
      if (start == null || end == null) return setErr('اختر الوقت')
      payload = { type: 'recurring', hallId, days, startDate, endDate, start: fmtTime(start), end: fmtTime(end), teacherName: name.trim(), phone: digits, title: title.trim() }
    } else return setErr('اختر نوع الحجز')

    setBusy(true)
    try {
      const r = await fetch('/api/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'requestBooking', ...payload })
      })
      const j = await r.json()
      if (!r.ok || j.ok === false) throw new Error(j.error || 'حدث خطأ')
      setDone(true)
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const hall = halls.find(h => h.id === hallId)
  const waPhone = '201067949503'
  const bookingSummary = done ? (() => {
    if (bookingType === 'single') return `${hall?.name} — ${arabicDate(date)} — ${fmtTime(start)}-${fmtTime(end)}`
    if (bookingType === 'multi') return `${hall?.name} — ${slots.length} أيام`
    return `${hall?.name} — ${days.map(d => DAY_NAMES[d]).join('، ')} — ${fmtTime(start)}-${fmtTime(end)}`
  })() : ''

  const step = done ? 5 : hallId == null ? 1 : bookingType == null ? 2 :
    bookingType === 'single' ? (date == null ? 3 : 4) :
    bookingType === 'multi' ? (slots.length === 0 ? 3 : 4) :
    (start == null ? 3 : 4)

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
          {['القاعة', 'نوع الحجز', 'الأيام والوقت', 'بياناتك'].map((s, i) => <span key={s} className={`step-pill ${step === i + 1 ? 'active' : ''}`}>{i + 1}. {s}</span>)}
        </div>
      )}

      {done ? (
        <div className="card success-wrap">
          <div className="big">✓</div>
          <h2>تم استلام طلبك</h2>
          <p className="muted">{bookingSummary}</p>
          <p className="muted">سيتم التواصل معك على واتساب لتأكيد الحجز.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <a className="btn btn-primary" href={waLink(waPhone, `طلب حجز جديد:\n${bookingSummary}\nالاسم: ${name.trim()}\nالهاتف: ${digits}`)} target="_blank" rel="noreferrer">إرسال على واتساب للإدارة</a>
            <button className="btn btn-ghost" onClick={() => { setDone(false); setHallId(null); setBookingType(null); setDate(null); setSlots([]); setStart(null); setEnd(null); setDays([]); setStartDate(''); setEndDate(''); setName(''); setPhone(''); setTitle('') }}>حجز آخر</button>
          </div>
        </div>
      ) : (
        <>
          {step === 1 && (
            <div className="hall-pick">
              {halls.map(h => (
                <div key={h.id} className={`hall-opt ${hallId === h.id ? 'sel' : ''}`} onClick={() => { setHallId(h.id); setBookingType(null); setDate(null); setSlots([]); setStart(null); setEnd(null); setDays([]) }}>
                  <h3><span className="dot" style={{ background: h.color }} />{h.name}</h3>
                  <div className="price">{h.pricePerHour} جنيه / ساعة</div>
                  {h.capacity > 0 && <div className="small muted">سعة {h.capacity} فرد</div>}
                </div>
              ))}
              {halls.length === 0 && <p className="muted">لا توجد قاعات متاحة</p>}
            </div>
          )}

          {step === 2 && (
            <div className="hall-pick">
              <div className={`hall-opt ${bookingType === 'single' ? 'sel' : ''}`} onClick={() => { setBookingType('single'); setDate(null); setSlots([]); setStart(null); setEnd(null) }}>
                <h3> حجز مرة واحدة</h3>
                <div className="small muted">حجز ليوم واحد أو عدة أيام بمواعيد مختلفة</div>
              </div>
              <div className={`hall-opt ${bookingType === 'multi' ? 'sel' : ''}`} onClick={() => { setBookingType('multi'); setDate(null); setSlots([]); setStart(null); setEnd(null) }}>
                <h3> حجز متعدد الأيام</h3>
                <div className="small muted">اختر عدة أيام، كل يوم بوقته</div>
              </div>
              <div className={`hall-opt ${bookingType === 'contract' ? 'sel' : ''}`} onClick={() => { setBookingType('contract'); setDays([]); setStartDate(''); setEndDate(''); setStart(null); setEnd(null) }}>
                <h3> تعاقد دوري</h3>
                <div className="small-muted">نفس الوقت كل أسبوع لأكثر من أسبوع</div>
              </div>
            </div>
          )}

          {step === 3 && bookingType === 'single' && (
            <>
              <h3 style={{ marginBottom: 8 }}>اختر اليوم</h3>
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
              {date && <>
                <h3 style={{ marginBottom: 8, marginTop: 16 }}>اختر الوقت</h3>
                {ranges.length === 0 && <p className="muted">هذا اليوم مكتمل</p>}
                <div>{ranges.map((r, i) => <button key={i} className="free-slot" onClick={() => pickRange(r)}>{fmtTime(r.start)} - {fmtTime(r.end)}</button>)}</div>
              </>}
            </>
          )}

          {step === 3 && bookingType === 'multi' && (
            <>
              <h3 style={{ marginBottom: 8 }}>اختر الأيام والمواعيد</h3>
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
              {date && <>
                <h3 style={{ marginBottom: 8, marginTop: 16 }}>اختر الوقت لليوم {arabicDate(date)}</h3>
                {ranges.length === 0 && <p className="muted">هذا اليوم مكتمل</p>}
                <div>{ranges.map((r, i) => <button key={i} className="free-slot" onClick={() => pickRange(r)}>{fmtTime(r.start)} - {fmtTime(r.end)}</button>)}</div>
                {start != null && end != null && (
                  <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={addSlot}>إضافة هذا الموعد</button>
                )}
              </>}
              {slots.length > 0 && (
                <div className="card" style={{ marginTop: 16 }}>
                  <h3 style={{ marginTop: 0 }}>المواعيد المضافة ({slots.length})</h3>
                  {slots.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span className="dot" style={{ background: '#e11d48' }} />
                      <strong>{arabicDate(s.date)}</strong>
                      <span className="muted">{fmtTime(s.start)} - {fmtTime(s.end)}</span>
                      <span style={{ flex: 1 }} />
                      <button className="btn btn-danger btn-sm" onClick={() => removeSlot(i)}>حذف</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 3 && bookingType === 'contract' && (
            <>
              <h3 style={{ marginBottom: 8 }}>اختر أيام التكرار</h3>
              <div className="checkbox-row">
                {DAY_NAMES.map((n, i) => (
                  <label key={i}>
                    <input type="checkbox" checked={days.includes(i)} onChange={e => setDays(e.target.checked ? [...days, i] : days.filter(d => d !== i))} />
                    {n}
                  </label>
                ))}
              </div>
              {days.length > 0 && <>
                <div className="form-grid" style={{ marginTop: 16 }}>
                  <div className="field"><span className="label">من تاريخ</span><input type="date" min={today} value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
                  <div className="field"><span className="label">إلى تاريخ</span><input type="date" min={startDate || today} value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
                </div>
                {startDate && endDate && (
                  <>
                    <h3 style={{ marginBottom: 8, marginTop: 16 }}>اختر الوقت</h3>
                    <div className="form-grid">
                      <div className="field"><span className="label">من</span><select value={start ?? ''} onChange={e => setStart(Number(e.target.value))}><option value="">اختر</option>{Array.from({ length: Math.floor((close - open) / 30) }, (_, i) => open + i * 30).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select></div>
                      <div className="field"><span className="label">إلى</span><select value={end ?? ''} onChange={e => setEnd(Number(e.target.value))}><option value="">اختر</option>{Array.from({ length: Math.floor((close - open) / 30) }, (_, i) => open + i * 30).filter(m => m > (start ?? 0)).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select></div>
                    </div>
                  </>
                )}
              </>}
            </>
          )}

          {step === 4 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>بياناتك</h3>
              {bookingType === 'single' && <p className="muted" style={{ marginTop: 0 }}>{hall?.name} — {arabicDate(date)} — {fmtTime(start)}-{fmtTime(end)}</p>}
              {bookingType === 'multi' && <p className="muted" style={{ marginTop: 0 }}>{hall?.name} — {slots.length} أيام</p>}
              {bookingType === 'contract' && <p className="muted" style={{ marginTop: 0 }}>{hall?.name} — {days.map(d => DAY_NAMES[d]).join('، ')} — {fmtTime(start)}-{fmtTime(end)}</p>}
              <div className="form-grid">
                <div className="field"><span className="label">الاسم</span><input value={name} onChange={e => setName(e.target.value)} placeholder="الاسم الكامل" /></div>
                <div className="field"><span className="label">واتساب</span><input dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div>
              </div>
              <div className="field"><span className="label">المادة (اختياري)</span><input value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: رياضيات" /></div>
              {err && <div className="conflict-box">{err}</div>}
              <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={submit}>{busy ? 'جاري الإرسال...' : 'إرسال طلب الحجز'}</button>
            </div>
          )}

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
