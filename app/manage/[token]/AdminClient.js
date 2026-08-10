'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DAY_NAMES, fmtTime, fmtTimeShort, timeOptions, bookingsForDay, waLink, addDays, weekdayOf, dateStr, todayStr, bookingTimeRange, arabicDate, overrideHallName, analyzeConflicts
} from '@/lib/time'

const HOUR_H = 46

function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * (1 - pct))
  const g = Math.round(((n >> 8) & 255) * (1 - pct))
  const b = Math.round((n & 255) * (1 - pct))
  return `rgb(${r},${g},${b})`
}

function blkBg(color) {
  return `linear-gradient(135deg, ${color} 0%, ${shade(color, 0.3)} 100%)`
}

function resizeImage(file, maxSize = 160, quality = 0.55) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        let w = img.width, h = img.height
        if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize } }
        else { if (h > maxSize) { w = w * maxSize / h; h = maxSize } }
        c.width = w; c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', quality))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

function field(label, node, key) {
  return <div className="field" key={key}><span className="label">{label}</span>{node}</div>
}

export default function Admin({ token }) {
  const [db, setDb] = useState(null)
  const [authed, setAuthed] = useState(false)
  const [tab, setTab] = useState('schedule')
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(null)
  const [notifSupported, setNotifSupported] = useState(false)
  const [notifSubscribed, setNotifSubscribed] = useState(false)
  const [notifPerm, setNotifPerm] = useState('default')

  const showToast = useCallback((msg, err) => {
    setToast({ msg, err })
    setTimeout(() => setToast(null), 3200)
  }, [])

  const fetchState = useCallback(async () => {
    const r = await fetch('/api/state')
    const j = await r.json()
    if (j && j.settings) setDb(j)
    return j
  }, [])

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(j => {
      setAuthed(j.authed)
      fetchState()
    }).catch(() => fetchState())
  }, [fetchState])

  useEffect(() => {
    if (!authed || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    setNotifSupported(true)
    setNotifPerm(Notification.permission)
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setNotifSubscribed(!!sub)
      })
    }).catch(() => {})
  }, [authed])

  const mutate = useCallback(async (payload) => {
    const headers = { 'Content-Type': 'application/json' }
    if (payload.action === 'login') headers['X-Admin-Token'] = token
    const r = await fetch('/api/mutate', { method: 'POST', headers, body: JSON.stringify(payload) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'حدث خطأ')
    if (j.ok === false) {
      if (j.conflict) throw new Error('تعارض مع: ' + j.conflicts.map(c => `${c.teacherName} (${fmtTime(c.start)}-${fmtTime(c.end)})`).join('، '))
      throw new Error(j.error || 'حدث خطأ')
    }
    await fetchState()
    return j
  }, [fetchState, token])

  const run = useCallback(async (action, payload, msg) => {
    try {
      const r = await mutate({ action, ...payload })
      if (msg) showToast(msg)
      return r
    } catch (e) { showToast(e.message, true); return null }
  }, [mutate, showToast])

  const toggleNotif = useCallback(async () => {
    if (!notifSupported) return
    try {
      const reg = await navigator.serviceWorker.ready
      if (notifSubscribed) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
          await sub.unsubscribe()
          setNotifSubscribed(false)
          showToast('تم إيقاف الاشعارات')
        }
      } else {
        const perm = await Notification.requestPermission()
        setNotifPerm(perm)
        if (perm !== 'granted') { showToast('تم رفض الاذن', true); return }
        const vkRes = await fetch('/api/push/vapid-key')
        const vk = await vkRes.json()
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vk.publicKey
        })
        const subObj = sub.toJSON()
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: { endpoint: subObj.endpoint, keys: subObj.keys }, role: 'admin' })
        })
        setNotifSubscribed(true)
        showToast('تم تفعيل الاشعارات')
      }
    } catch (e) {
      showToast('حدث خطأ: ' + e.message, true)
    }
  }, [notifSupported, notifSubscribed, showToast])

  if (!db) return <div className="login-wrap"><div className="card"><p className="muted">جاري التحميل...</p></div></div>

  if (!authed) return <LoginCard onOk={async pw => {
    try { await mutate({ action: 'login', password: pw }); setAuthed(true); await fetchState() }
    catch (e) { showToast(e.message, true) }
  }} defaultPw={db.settings.defaultPassword} />

  const s = db.settings
  const open = s.openTime, close = s.closeTime
  const rows = Math.max(1, Math.round((close - open) / 60))
  const pending = db.bookings.filter(b => b.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)

  return (
    <div className="container">
      <div className="admin-topbar">
        <div>
          <h2>{s.placeName}</h2>
          <div className="small muted">{s.placeNameEn || 'EDUCON ACADEMY'} — لوحة التحكم</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {notifSupported && (
            <button className={`btn btn-sm ${notifSubscribed ? 'btn-ok' : 'btn-ghost'}`} onClick={toggleNotif} title={notifSubscribed ? 'إيقاف الاشعارات' : 'تفعيل الاشعارات'}>
              {notifSubscribed ? '🔔' : '🔕'}
            </button>
          )}
          <a className="btn btn-ghost btn-sm" href="/">الرئيسية</a>
          <button className="btn btn-ghost btn-sm" onClick={() => run('logout').then(() => setAuthed(false))}>خروج</button>
        </div>
      </div>

      {s.storageMode !== 'redis' && (
        <div className="card" style={{ background: '#fef2f2', border: '1px solid #fca5a5', marginBottom: 12 }}>
          <p style={{ margin: 0, color: '#991b1b', fontSize: 13 }}>
            <strong>تنبيه:</strong> البيانات محفوظة في الذاكرة فقط. سيتم حذف جميع الحجوزات والبيانات عند كل تحديث أو إعادة تشغيل للسيرفر. يجب إعداد Vercel KV لحفظ البيانات بشكل دائم.
          </p>
        </div>
      )}

      <div className="tabbar">
        {[['schedule', 'المواعيد'], ['requests', `الطلبات${pending.length ? ` (${pending.length})` : ''}`], ['halls', 'القاعات والأسعار'], ['teachers', 'المدرسون'], ['settings', 'الإعدادات']].map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'schedule' && <ScheduleTab db={db} open={open} close={close} rows={rows} onAdd={p => setModal({ kind: 'booking', initial: p })} onBlock={b => setModal({ kind: 'detail', booking: b })} />}
      {tab === 'requests' && <RequestsTab db={db} run={run} waLink={waLink} />}
      {tab === 'halls' && <HallsTab db={db} run={run} onEdit={h => setModal({ kind: 'hall', hall: h })} />}
      {tab === 'teachers' && <TeachersTab db={db} run={run} onEdit={t => setModal({ kind: 'teacher', teacher: t })} />}
      {tab === 'settings' && <SettingsTab db={db} run={run} token={token} />}

      {modal?.kind === 'booking' && <BookingModal initial={modal.initial} db={db} open={open} close={close} editId={modal.editId} onClose={() => setModal(null)} run={run} mutate={mutate} fetchState={fetchState} onSave={async p => { const r = await run(modal.editId ? 'updateBooking' : 'addBooking', modal.editId ? { id: modal.editId, ...p } : p, modal.editId ? 'تم التعديل' : 'تمت الإضافة'); if (r) { setModal(null); return r } return null }} />}
      {modal?.kind === 'detail' && <DetailModal booking={modal.booking} db={db} run={run} onClose={() => setModal(null)} onEdit={() => { const b = modal.booking; setModal({ kind: 'booking', initial: b.type === 'single' ? { hallId: b.hallId, type: 'single', date: b.date, days: [], startDate: '', endDate: '', start: b.start, end: b.end, teacherName: b.teacherName, title: b.title, status: b.status, source: b.source || 'admin' } : { hallId: b.hallId, type: b.type || 'recurring', date: '', days: b.days, startDate: b.startDate, endDate: b.endDate, start: b.start, end: b.end, teacherName: b.teacherName, title: b.title, status: b.status, source: b.source || 'admin', dayTimes: b.dayTimes || {}, slots: b.slots || [] }, editId: b.id }) }} onApprove={() => run('approveBooking', { id: modal.booking.id }, 'تم الاعتماد').then(() => setModal(null))} onDelete={() => { if (confirm('حذف؟')) run('deleteBooking', { id: modal.booking.id }, 'تم الحذف').then(() => setModal(null)) }} />}
      {modal?.kind === 'hall' && <HallModal hall={modal.hall} onClose={() => setModal(null)} onSave={async p => { if (await run('updateHall', { id: modal.hall.id, ...p }, 'تم التحديث')) setModal(null) }} />}
      {modal?.kind === 'teacher' && <TeacherModal teacher={modal.teacher} onClose={() => setModal(null)} onSave={async p => { if (await run('updateTeacher', { id: modal.teacher.id, ...p }, 'تم التحديث')) setModal(null) }} />}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  )
}

function LoginCard({ onOk, defaultPw }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="login-icon">A</div>
        <h2>لوحة التحكم</h2>
        <p className="small muted">أدخل كلمة المرور للدخول</p>
        {defaultPw && <p className="small" style={{ color: '#e11d48', fontWeight: 700 }}>الافتراضية: admin123</p>}
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="كلمة المرور"
          onKeyDown={e => { if (e.key === 'Enter' && pw) { setBusy(true); onOk(pw).finally(() => setBusy(false)) } }} />
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={!pw || busy}
          onClick={() => { setBusy(true); onOk(pw).finally(() => setBusy(false)) }}>
          {busy ? '...' : 'دخول'}
        </button>
      </div>
    </div>
  )
}

function ScheduleTab({ db, open, close, rows, onAdd, onBlock }) {
  const [weekStart, setWeekStart] = useState(() => { const d = new Date(); const off = (d.getDay() + 1) % 7; const s = new Date(d); s.setDate(s.getDate() - off); return dateStr(s) })
  const [hallFilter, setHallFilter] = useState('all')
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const today = useMemo(() => todayStr(), [])
  const halls = hallFilter === 'all' ? db.halls : db.halls.filter(h => h.id === hallFilter)
  const teacherMap = useMemo(() => { const m = {}; db.teachers.forEach(t => { m[t.name] = t }); return m }, [db.teachers])

  function dayBodyClick(hallId, dStr, e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientY - rect.top) / rect.height
    const minutes = open + frac * (close - open)
    const snap = Math.min(Math.floor(minutes / 30) * 30, close - 30)
    onAdd({ hallId, date: dStr, start: snap, end: snap + 60 <= close ? snap + 60 : close })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="week-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { const d = new Date(); const off = (d.getDay() + 1) % 7; const s = new Date(d); s.setDate(s.getDate() - off); setWeekStart(dateStr(s)) }}>هذا الأسبوع</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
        </div>
        <button className="btn btn-primary" onClick={() => onAdd({ hallId: db.halls[0]?.id || '', type: 'single', date: today, start: open, end: Math.min(open + 60, close), days: [], startDate: today, endDate: addDays(today, 365), teacherName: '', title: '', status: 'confirmed', source: 'admin' })}>+ إضافة موعد</button>
      </div>
      <div className="chip-row">
        <button className={`chip ${hallFilter === 'all' ? 'active' : ''}`} onClick={() => setHallFilter('all')}>الكل</button>
        {db.halls.map(h => <button key={h.id} className={`chip ${hallFilter === h.id ? 'active' : ''}`} onClick={() => setHallFilter(h.id)}>{h.name}</button>)}
      </div>
      {halls.length === 0 && <p className="muted">أضف قاعة أولًا من تبويب «القاعات»</p>}
      {halls.map(hall => {
        const dayBookings = days.map(d => bookingsForDay(db.bookings, hall.id, d))
        return (
          <div className="hall-sec" key={hall.id}>
            <div className="hall-head"><span className="dot" style={{ background: hall.color }} />{hall.name}<span className="muted small"> — {hall.pricePerHour} ج/ساعة</span></div>
            <div className="week-grid">
              <div className="time-col">{Array.from({ length: rows }, (_, i) => <div className="hcell" key={i}>{fmtTimeShort(open + i * 60)}</div>)}</div>
              {days.map((d, di) => (
                <div className="day-col" key={d}>
                  <div className={`day-head ${d === today ? 'today' : ''}`}><div>{DAY_NAMES[weekdayOf(d)]}</div><div className="dnum">{d.slice(5)}</div></div>
                  <div className="day-body" style={{ height: rows * HOUR_H }} onClick={e => dayBodyClick(hall.id, d, e)}>
                    {Array.from({ length: rows - 1 }, (_, i) => <div key={i} className="hour-line" style={{ top: ((i + 1) / rows) * 100 + '%' }} />)}
                    {dayBookings[di].map(b => {
                      const tr = bookingTimeRange(b, d)
                      if (!tr) return null
                      const top = ((tr.start - open) / (close - open)) * 100
                      const h = ((tr.end - tr.start) / (close - open)) * 100
                      const tPhoto = teacherMap[b.teacherName]?.photo
                      const isCancelled = b.status === 'cancelled'
                      const isCompleted = b.status === 'completed'
                      const ovName = overrideHallName(b, d)
                      return (
                        <div key={b.id} className={`blk ${b.status === 'pending' ? 'pending' : ''} ${isCancelled ? 'cancelled' : ''} ${isCompleted ? 'completed' : ''} ${ovName ? 'overflow' : ''}`} style={{ top: top + '%', height: `calc(${h}% - 4px)`, background: ovName ? 'linear-gradient(135deg, #f97316, #ea580c)' : isCancelled ? '#9ca3af' : isCompleted ? '#6366f1' : blkBg(hall.color), opacity: isCancelled ? 0.5 : isCompleted ? 0.6 : 1 }} onClick={e => { e.stopPropagation(); onBlock(b) }}>
                          <div className="blk-row">{tPhoto && <img src={tPhoto} className="blk-avatar" />}<span>{b.teacherName}</span></div>
                          {b.title && <span className="t">{b.title}</span>}
                          <span className="t">{fmtTime(tr.start)} - {fmtTime(tr.end)}</span>
                          {ovName && <span className="t" style={{ color: '#fecdd3' }}>→ {ovName}</span>}
                          {isCancelled && <span className="t" style={{ color: '#fecdd3' }}>ملغي</span>}
                          {b.source && !ovName && <span className="t" style={{ opacity: 0.7 }}>{b.source === 'admin' ? 'أدمن' : b.source === 'student' ? 'طالب' : b.source === 'contract' ? 'عقد' : ''}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RequestsTab({ db, run, waLink }) {
  const pending = db.bookings.filter(b => b.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
  const old = db.bookings.filter(b => b.status === 'rejected' && b.rejectReason && (b.rejectReason === 'timeout' || b.rejectReason === 'expired')).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5)

  function bookingSummary(b) {
    if (b.type === 'multi') return `${b.hallName} — ${b.slots?.length || 0} أيام`
    if (b.type === 'recurring') {
      if (b.dayTimes && Object.keys(b.dayTimes).length) {
        return `${b.hallName} — ${b.days?.map(d => `${DAY_NAMES[d]} ${fmtTime(b.dayTimes[d].start)}-${fmtTime(b.dayTimes[d].end)}`).join('، ')}`
      }
      return `${b.hallName} — ${b.days?.map(d => DAY_NAMES[d]).join('، ')} — ${fmtTime(b.start)}-${fmtTime(b.end)}`
    }
    return `${b.hallName} — ${DAY_NAMES[weekdayOf(b.date)]} ${b.date} — ${fmtTime(b.start)}-${fmtTime(b.end)}`
  }

  function bookingDetails(b) {
    if (b.type === 'multi' && b.slots) {
      return b.slots.map(s => `${arabicDate(s.date)} ${fmtTime(s.start)}-${fmtTime(s.end)}`).join('، ')
    }
    if (b.type === 'recurring') {
      return `${b.startDate} حتى ${b.endDate}`
    }
    return `${b.phone || ''}`
  }

  return (
    <div>
      <h3 className="muted" style={{ fontSize: 15, fontWeight: 700 }}>طلبات الحجز الواردة</h3>
      {pending.length === 0 && <p className="muted">لا توجد طلبات</p>}
      {pending.map(b => (
        <div className="req-card" key={b.id}>
          <span className="req-badge">بانتظار الاعتماد</span>
          {b.source && <span style={{ background: '#e0e7ff', color: '#3730a3', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '2px 8px' }}>{b.source === 'student' ? 'طالب' : b.source === 'contract' ? 'عقد' : b.source}</span>}
          <div className="who">
            <h4>{b.teacherName} {b.title && <span className="muted">({b.title})</span>}</h4>
            <div className="small muted">{bookingSummary(b)}</div>
            {b.type === 'multi' && <div className="small muted">{bookingDetails(b)}</div>}
            {b.phone && <div className="small muted" dir="ltr">{b.phone}</div>}
          </div>
          <button className="btn btn-ok btn-sm" onClick={() => run('approveBooking', { id: b.id }, 'تم الاعتماد')}>اعتماد</button>
          {b.phone && <a className="btn btn-whatsapp btn-sm" target="_blank" rel="noreferrer" href={waLink(b.phone, `أهلًا ${b.teacherName}، تم اعتماد حجزك في ${b.hallName}`)}>واتساب</a>}
          <button className="btn btn-danger btn-sm" onClick={() => { if (confirm('حذف؟')) run('deleteBooking', { id: b.id }, 'تم الحذف') }}>حذف</button>
        </div>
      ))}
      {old.length > 0 && (
        <>
          <h3 className="muted" style={{ fontSize: 13, fontWeight: 700, marginTop: 20 }}>طلبات مرفوضة تلقائيًا (أكتر من يومين / تاريخ منتهي)</h3>
          {old.map(b => (
            <div className="req-card" key={b.id} style={{ opacity: 0.6 }}>
              <span className="req-badge" style={{ background: '#fee2e2', color: '#991b1b' }}>{b.rejectReason === 'expired' ? 'تاريخ منتهي' : 'أكتر من يومين'}</span>
              <div className="who">
                <h4>{b.teacherName}</h4>
                <div className="small muted">{bookingSummary(b)}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('إعادة الطلب؟')) run('updateBooking', { id: b.id, status: 'pending' }, 'تمت إعادة الطلب') }}>إعادة</button>
              <button className="btn btn-danger btn-sm" onClick={() => { if (confirm('حذف؟')) run('deleteBooking', { id: b.id }, 'تم الحذف') }}>حذف</button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function BookingModal({ initial, db, open, close, editId, onClose, onSave, run, mutate, fetchState }) {
  const [f, setF] = useState({ ...initial })
  const [busy, setBusy] = useState(false)
  const [conflictAnalysis, setConflictAnalysis] = useState(null)
  const [overflowPlan, setOverflowPlan] = useState({})
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const hours = timeOptions(open, close, 30)

  function buildCandidate() {
    const p = { hallId: f.hallId, type: f.type, start: Number(f.start), end: Number(f.end), teacherName: f.teacherName.trim(), title: (f.title || '').trim(), status: f.status || 'confirmed', phone: f.phone || '', source: f.source || 'admin' }
    if (f.type === 'single') p.date = f.date
    else if (f.type === 'multi') { p.slots = f.slots || []; p.date = f.slots[0]?.date || f.date }
    else {
      p.days = f.days; p.startDate = f.startDate; p.endDate = f.endDate
      if (f.dayTimes && Object.keys(f.dayTimes).length) {
        p.dayTimes = {}
        for (const d of f.days) {
          const dt = f.dayTimes[d]
          if (dt) p.dayTimes[d] = { start: Number(dt.start), end: Number(dt.end) }
        }
        p.start = Math.min(...Object.values(p.dayTimes).map(t => t.start))
        p.end = Math.max(...Object.values(p.dayTimes).map(t => t.end))
      }
    }
    return p
  }

  function submit() {
    if (!f.hallId) return alert('اختر القاعة')
    if (f.type === 'recurring' && (!f.days || !f.days.length)) return alert('اختر الأيام')
    if (f.type === 'multi' && (!f.slots || !f.slots.length)) return alert('أضف موعدًا واحدًا على الأقل')
    if (Number(f.end) <= Number(f.start) && f.type !== 'multi') return alert('وقت النهاية بعد البداية')
    if (!f.teacherName?.trim()) return alert('اسم المدرس')
    const candidate = buildCandidate()
    const analysis = analyzeConflicts(db.bookings, candidate, db.halls, editId)
    if (analysis.conflicting.length > 0) {
      const plan = {}
      for (const c of analysis.conflicting) {
        const alts = analysis.altHalls[c.date]
        if (alts && alts.length) plan[c.date] = alts[0].id
      }
      setOverflowPlan(plan)
      setConflictAnalysis(analysis)
      return
    }
    setBusy(true)
    onSave(candidate).finally(() => setBusy(false))
  }

  async function saveWithOverflow() {
    const candidate = buildCandidate()
    setBusy(true)
    try {
      const payload = { action: editId ? 'updateBooking' : 'addBooking', ...(editId ? { id: editId, ...candidate } : candidate), overflowOverrides: overflowPlan }
      const r = await mutate(payload)
      if (!r || !r.ok) {
        showToast(r?.error || 'حدث خطأ في الحفظ', true)
        return
      }
      showToast('تم الحفظ مع التحويل')
      await fetchState()
      setConflictAnalysis(null)
      onClose()
    } catch (e) {
      showToast(e.message || 'حدث خطأ', true)
    } finally {
      setBusy(false)
    }
  }

  async function saveFreeOnly() {
    const candidate = buildCandidate()
    const freeDates = new Set(conflictAnalysis.free)
    if (candidate.type === 'single') {
      if (!freeDates.has(candidate.date)) { alert('هذا اليوم متعارض'); return }
    } else if (candidate.type === 'multi') {
      candidate.slots = (candidate.slots || []).filter(s => freeDates.has(s.date))
      if (!candidate.slots.length) { alert('كل الأيام متعارضة'); return }
    } else if (candidate.type === 'recurring') {
      candidate.days = candidate.days.filter(d => {
        const dates = []
        const d2 = new Date(candidate.startDate)
        const end = new Date(candidate.endDate)
        while (d2 <= end) {
          if ((d2.getDay() + 1) % 7 === d && freeDates.has(dateStr(d2))) dates.push(dateStr(d2))
          d2.setDate(d2.getDate() + 1)
        }
        return dates.length > 0
      })
      if (!candidate.days.length) { alert('كل الأيام متعارضة'); return }
    }
    setBusy(true)
    try {
      await onSave(candidate)
      setConflictAnalysis(null)
    } catch (e) {
      showToast(e.message || 'حدث خطأ', true)
    } finally {
      setBusy(false)
    }
  }

  function pickTeacher(id) {
    const t = db.teachers.find(x => x.id === id)
    if (t) setF({ ...f, teacherName: t.name, phone: t.phone || '' })
  }

  function addSlot() {
    if (!f.date) return alert('اختر التاريخ أولاً')
    const slot = { date: f.date, start: Number(f.start), end: Number(f.end) }
    setF({ ...f, slots: [...(f.slots || []), slot] })
  }

  function removeSlot(i) {
    setF({ ...f, slots: f.slots.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>{editId ? 'تعديل الموعد' : 'موعد جديد'}</h3>
        <div className="form-grid">
          {field('القاعة', <select value={f.hallId} onChange={set('hallId')}><option value="">اختر</option>{db.halls.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select>, 'h')}
          {field('النوع', <select value={f.type} onChange={e => setF({ ...f, type: e.target.value, days: f.days || [], startDate: f.startDate || todayStr(), endDate: f.endDate || addDays(todayStr(), 365), slots: f.slots || [] })}><option value="single">يوم واحد</option><option value="multi">مواعيد متعددة</option><option value="recurring">التعاقد الدوري</option></select>, 't')}
        </div>
        {f.type === 'single' && field('التاريخ', <input type="date" value={f.date} onChange={set('date')} />, 'd')}
        {f.type === 'multi' && (
          <>
            <div className="form-grid">
              {field('التاريخ', <input type="date" value={f.date} onChange={set('date')} />, 'd2')}
              {field('من الساعة', <select value={f.start} onChange={set('start')}>{hours.filter(m => m < close).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select>, 'ms')}
              {field('إلى الساعة', <select value={f.end} onChange={set('end')}>{hours.filter(m => m > f.start).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select>, 'me')}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={addSlot} style={{ marginBottom: 8 }}>+ إضافة موعد</button>
            {f.slots && f.slots.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {f.slots.map((s, i) => (
                  <div key={i} className="req-card" style={{ padding: '6px 10px', marginBottom: 4 }}>
                    <span className="small muted">{arabicDate(s.date)} — {fmtTime(s.start)}-{fmtTime(s.end)}</span>
                    <button className="btn btn-danger btn-sm" onClick={() => removeSlot(i)}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {f.type === 'recurring' && (
          <>
            <div className="field"><span className="label">الأيام والمواعيد</span><div className="checkbox-row">{DAY_NAMES.map((n, i) => <label key={i}><input type="checkbox" checked={f.days?.includes(i)} onChange={e => {
              const newDays = e.target.checked ? [...(f.days || []), i] : (f.days || []).filter(d => d !== i)
              const newDayTimes = { ...f.dayTimes }
              if (e.target.checked && !newDayTimes[i]) newDayTimes[i] = { start: f.start || open, end: Math.min((Number(f.start) || open) + 60, close) }
              if (!e.target.checked) delete newDayTimes[i]
              setF({ ...f, days: newDays, dayTimes: newDayTimes })
            }} />{n}</label>)}</div></div>
            <div className="form-grid">{field('من', <input type="date" value={f.startDate} onChange={set('startDate')} />, 'sd')}{field('إلى', <input type="date" value={f.endDate} onChange={set('endDate')} />, 'ed')}</div>
            {(f.days || []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                {(f.days || []).map(di => (
                  <div key={di} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: 13, minWidth: 50 }}>{DAY_NAMES[di]}</span>
                    <select value={f.dayTimes?.[di]?.start ?? f.start ?? open} onChange={e => setF({ ...f, dayTimes: { ...f.dayTimes, [di]: { ...f.dayTimes?.[di], start: Number(e.target.value) } } })} style={{ padding: '6px 10px', borderRadius: 8, border: '1.5px solid var(--line)', fontSize: 13 }}>
                      {hours.filter(m => m < close).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}
                    </select>
                    <span style={{ fontWeight: 700 }}>→</span>
                    <select value={f.dayTimes?.[di]?.end ?? f.end ?? close} onChange={e => setF({ ...f, dayTimes: { ...f.dayTimes, [di]: { ...f.dayTimes?.[di], end: Number(e.target.value) } } })} style={{ padding: '6px 10px', borderRadius: 8, border: '1.5px solid var(--line)', fontSize: 13 }}>
                      {hours.filter(m => m > (f.dayTimes?.[di]?.start ?? f.start ?? open)).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {f.type === 'single' && (
          <div className="form-grid">
            {field('من الساعة', <select value={f.start} onChange={set('start')}>{hours.filter(m => m < close).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select>, 's')}
            {field('إلى الساعة', <select value={f.end} onChange={set('end')}>{hours.filter(m => m > f.start).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select>, 'e')}
          </div>
        )}
        {field('اسم المدرس', <input value={f.teacherName || ''} onChange={set('teacherName')} placeholder="اكتب الاسم مباشرة — لو جديد هيتسجل تلقائيًا" />, 'tn2')}
        <div className="form-grid">
          {field('اختر من الموجودين', <select value="" onChange={e => pickTeacher(e.target.value)}><option value="">...</option>{db.teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>, 'tt')}
          {field('المادة (اختياري)', <input value={f.title || ''} onChange={set('title')} placeholder="مثال: رياضيات" />, 'ti')}
          {field('المصدر', <select value={f.source || 'admin'} onChange={set('source')}><option value="admin">من الأدمن</option><option value="student">حجز طالب</option><option value="contract">عقد دوري</option></select>, 'src')}
        </div>
        {conflictAnalysis && (
          <div style={{ background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <p style={{ margin: '0 0 8px', fontWeight: 900, fontSize: 14, color: '#9a3412' }}>تحليل التعارض</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>✓ {conflictAnalysis.free.length} أيام متاحة</span>
              <span style={{ background: '#fee2e2', color: '#991b1b', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>✗ {conflictAnalysis.conflicting.length} أيام متعارضة</span>
            </div>
            {conflictAnalysis.conflicting.map(c => (
              <div key={c.date} style={{ background: '#fff', border: '1px solid #fecdd3', borderRadius: 8, padding: 8, marginBottom: 6, fontSize: 12 }}>
                <div style={{ fontWeight: 800 }}>{arabicDate(c.date)}</div>
                <div className="muted">تعارض مع: {c.conflictWith.teacherName} ({c.conflictWith.hallName})</div>
                {c.conflictEndDate && <div style={{ color: '#b45309', fontWeight: 700, fontSize: 11 }}>التعاقد ينتهي: {arabicDate(c.conflictEndDate)}</div>}
                {conflictAnalysis.altHalls[c.date] && conflictAnalysis.altHalls[c.date].length > 0 && (
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, color: '#059669' }}>تحويل لـ:</span>
                    <select value={overflowPlan[c.date] || ''} onChange={e => setOverflowPlan({ ...overflowPlan, [c.date]: e.target.value })} style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1.5px solid #d1d5db' }}>
                      <option value="">...</option>
                      {conflictAnalysis.altHalls[c.date].map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select>
                  </div>
                )}
                {!conflictAnalysis.altHalls[c.date] && <div className="muted" style={{ color: '#dc2626', marginTop: 2 }}>لا توجد قاعة بديلة متاحة</div>}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-ok btn-sm" disabled={busy || !Object.values(overflowPlan).some(v => v)} onClick={saveWithOverflow}>حفظ مع تحويل</button>
              {conflictAnalysis.free.length > 0 && <button className="btn btn-ghost btn-sm" onClick={saveFreeOnly}>حفظ الأيام المتاحة فقط</button>}
              <button className="btn btn-danger btn-sm" onClick={() => setConflictAnalysis(null)}>إلغاء</button>
            </div>
          </div>
        )}
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn btn-primary" disabled={busy || !!conflictAnalysis} onClick={submit}>{busy ? '...' : 'حفظ'}</button>
        </div>
      </div>
    </div>
  )
}

function DetailModal({ booking: b, db, run, onClose, onEdit, onApprove, onDelete }) {
  const hall = db.halls.find(h => h.id === b.hallId)
  const isRec = b.type === 'recurring'
  const isMulti = b.type === 'multi'
  const daysTxt = isRec ? (b.dayTimes && Object.keys(b.dayTimes).length ? b.days.map(d => `${DAY_NAMES[d]} ${fmtTime(b.dayTimes[d].start)}-${fmtTime(b.dayTimes[d].end)}`).join('، ') : b.days.map(d => DAY_NAMES[d]).join('، ')) : isMulti ? `${b.slots?.length || 0} أيام` : DAY_NAMES[weekdayOf(b.date)]
  const dateTxt = isRec && !(b.dayTimes && Object.keys(b.dayTimes).length) ? `${b.startDate} حتى ${b.endDate} — ${fmtTime(b.start)}-${fmtTime(b.end)}` : isRec ? `${b.startDate} حتى ${b.endDate}` : isMulti ? (b.slots || []).map(s => `${arabicDate(s.date)} ${fmtTime(s.start)}-${fmtTime(s.end)}`).join('، ') : b.date
  const statusMap = { pending: ['بانتظار الاعتماد', '#d97706', '#fef3c7'], confirmed: ['مؤكد', '#059669', '#ecfdf5'], cancelled: ['ملغي', '#dc2626', '#fef2f2'], completed: ['منتهي', '#6366f1', '#eef2ff'] }
  const sourceMap = { admin: 'من الأدمن', student: 'حجز طالب', public: 'حجز عام', contract: 'عقد دوري' }
  const [label, bg] = statusMap[b.status] || ['غير معروف', '#6b7280', '#f3f4f6']
  const [overrideDate, setOverrideDate] = useState('')
  const [overrideHall, setOverrideHall] = useState('')
  const overrides = b.overrideHalls || {}
  const hasOverrides = Object.keys(overrides).length > 0
  const otherHalls = db.halls.filter(h => h.id !== b.hallId)

  async function setOverride() {
    if (!overrideDate) return alert('اختر التاريخ')
    if (!overrideHall) return alert('اختر القاعة البديلة')
    await run('setOverride', { bookingId: b.id, date: overrideDate, altHallId: overrideHall }, 'تم التحويل')
    onClose()
  }

  async function clearOverride(date) {
    await run('clearOverride', { bookingId: b.id, date }, 'تم الإرجاع')
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="dot" style={{ background: hall?.color }} />{b.teacherName}</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ background: bg, color: bg === '#fef3c7' ? '#92400e' : bg === '#ecfdf5' ? '#065f46' : bg === '#fef2f2' ? '#991b1b' : bg === '#eef2ff' ? '#3730a3' : '#fff', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800 }}>{label}</span>
          {b.source && <span style={{ background: '#f3f4f6', color: '#374151', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>{sourceMap[b.source] || b.source}</span>}
          <span style={{ background: '#f3f4f6', color: '#374151', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>{b.type === 'single' ? 'يوم واحد' : b.type === 'multi' ? 'مواعيد متعددة' : 'عقد دوري'}</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>{b.hallName} — {daysTxt} ({dateTxt}) — {isRec || isMulti ? '' : `${fmtTime(b.start)}-${fmtTime(b.end)}`}{isRec && <span className="small block">تكرار أسبوعي</span>}{isMulti && <span className="small block">مواعيد متعددة</span>}</p>
        {b.title && <p><b>المادة:</b> {b.title}</p>}
        {b.phone && <p dir="ltr" style={{ textAlign: 'right' }}><b>الهاتف:</b> {b.phone}</p>}
        {isRec && hasOverrides && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 13 }}>تحويلات مؤقتة</p>
            {Object.entries(overrides).map(([date, ov]) => (
              <div key={date} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 12 }}>
                <span className="dot" style={{ background: '#f97316' }} />
                <b>{arabicDate(date)}</b>
                <span className="muted">→</span>
                <span style={{ fontWeight: 700, color: '#ea580c' }}>{ov.hallName}</span>
                <button className="btn btn-danger btn-sm" style={{ marginRight: 'auto', padding: '2px 8px', fontSize: 11 }} onClick={() => { if (confirm('إرجاع للمكان الأصلي؟')) clearOverride(date) }}>إرجاع</button>
              </div>
            ))}
          </div>
        )}
        {isRec && otherHalls.length > 0 && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 13 }}>تحويل مؤقت لقاعه تانية</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <span className="label">التاريخ</span>
                <select value={overrideDate} onChange={e => setOverrideDate(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 8, border: '1.5px solid var(--line)' }}>
                  <option value="">اختر يوم</option>
                  {b.days.map(d => {
                    const dates = []
                    const d2 = new Date(b.startDate)
                    const end = new Date(b.endDate)
                    while (d2 <= end) {
                      if ((d2.getDay() + 1) % 7 === d) dates.push(dateStr(d2))
                      d2.setDate(d2.getDate() + 1)
                    }
                    return dates.slice(0, 8).map(date => (
                      <option key={date} value={date} disabled={!!overrides[date]}>{arabicDate(date)}</option>
                    ))
                  })}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <span className="label">القاعة البديلة</span>
                <select value={overrideHall} onChange={e => setOverrideHall(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 8, border: '1.5px solid var(--line)' }}>
                  <option value="">اختر قاعة</option>
                  {otherHalls.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <button className="btn btn-ok btn-sm" onClick={setOverride}>تحويل</button>
            </div>
          </div>
        )}
        <div className="modal-foot">
          {b.status === 'pending' && <button className="btn btn-ok" onClick={onApprove}>اعتماد</button>}
          {b.status === 'confirmed' && <button className="btn btn-ghost btn-sm" style={{ color: '#d97706' }} onClick={() => { if (confirm('إلغاء الحجز؟')) run('updateBooking', { id: b.id, status: 'cancelled' }, 'تم الإلغاء').then(() => setModal(null)) }}>إلغاء</button>}
          {b.status === 'cancelled' && <button className="btn btn-ghost btn-sm" style={{ color: '#059669' }} onClick={() => { if (confirm('إعادة تأكيد؟')) run('updateBooking', { id: b.id, status: 'confirmed' }, 'تم التأكيد').then(() => setModal(null)) }}>إعادة تأكيد</button>}
          {b.phone && b.status === 'confirmed' && <a className="btn btn-whatsapp" target="_blank" rel="noreferrer" href={waLink(b.phone, `تأكيد موعد ${b.hallName}: ${daysTxt}`)}>واتساب</a>}
          <button className="btn btn-ghost" onClick={onEdit}>تعديل</button>
          <button className="btn btn-danger" onClick={onDelete}>حذف</button>
          <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  )
}

function HallsTab({ db, run, onEdit }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [capacity, setCapacity] = useState('')
  const [hasScreen, setHasScreen] = useState(false)
  const [acCount, setAcCount] = useState('')
  const [boardsCount, setBoardsCount] = useState('')
  const [hasInteractiveScreen, setHasInteractiveScreen] = useState(false)
  async function add() {
    if (!name.trim()) return alert('اسم القاعة')
    if (!(Number(price) >= 0)) return alert('السعر')
    if (await run('addHall', { name, pricePerHour: Number(price), capacity: Number(capacity), hasScreen, acCount: Number(acCount), boardsCount: Number(boardsCount), hasInteractiveScreen }, 'تمت الإضافة')) {
      setName(''); setPrice(''); setCapacity(''); setHasScreen(false); setAcCount(''); setBoardsCount(''); setHasInteractiveScreen(false)
    }
  }
  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>إضافة قاعة</h3>
        <div className="form-grid">
          <div className="field"><span className="label">اسم القاعة</span><input value={name} onChange={e => setName(e.target.value)} placeholder="مثال: Hall 1" /></div>
          <div className="field"><span className="label">سعر الساعة (جنيه)</span><input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /></div>
        </div>
        <div className="form-grid">
          <div className="field"><span className="label">السعة (عدد الأفراد)</span><input type="number" min="0" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="مثال: 30" /></div>
          <div className="field"><span className="label">عدد التكييفات</span><input type="number" min="0" value={acCount} onChange={e => setAcCount(e.target.value)} placeholder="مثال: 2" /></div>
        </div>
        <div className="form-grid">
          <div className="field"><span className="label">عدد السبّورات</span><input type="number" min="0" value={boardsCount} onChange={e => setBoardsCount(e.target.value)} placeholder="مثال: 1" /></div>
          <div className="field checkbox-field">
            <label><input type="checkbox" checked={hasScreen} onChange={e => setHasScreen(e.target.checked)} /> مجهزة بشاشة عرض</label>
            <label><input type="checkbox" checked={hasInteractiveScreen} onChange={e => setHasInteractiveScreen(e.target.checked)} /> شاشة تفاعلية</label>
          </div>
        </div>
        <button className="btn btn-primary" onClick={add}>إضافة</button>
      </div>
      {db.halls.map(h => (
        <div className="card hall-card" key={h.id}>
          <span className="dot" style={{ background: h.color }} />
          <strong>{h.name}</strong>
          <span className="muted small">{h.pricePerHour} ج/ساعة</span>
          {h.capacity > 0 && <span className="muted small">{h.capacity} فرد</span>}
          {h.acCount > 0 && <span className="muted small">{h.acCount} تكييف</span>}
          {h.boardsCount > 0 && <span className="muted small">{h.boardsCount} سبّورة</span>}
          {h.hasScreen && <span className="muted small">شاشة</span>}
          {h.hasInteractiveScreen && <span className="muted small">شاشة تفاعلية</span>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(h)}>تعديل</button>
          <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`حذف "${h.name}"؟`)) run('deleteHall', { id: h.id }, 'تم الحذف') }}>حذف</button>
        </div>
      ))}
      {db.halls.length === 0 && <p className="muted">لا توجد قاعات</p>}
    </div>
  )
}

function HallModal({ hall, onClose, onSave }) {
  const [name, setName] = useState(hall.name)
  const [price, setPrice] = useState(hall.pricePerHour)
  const [color, setColor] = useState(hall.color)
  const [capacity, setCapacity] = useState(hall.capacity || '')
  const [hasScreen, setHasScreen] = useState(hall.hasScreen || false)
  const [acCount, setAcCount] = useState(hall.acCount || '')
  const [boardsCount, setBoardsCount] = useState(hall.boardsCount || '')
  const [hasInteractiveScreen, setHasInteractiveScreen] = useState(hall.hasInteractiveScreen || false)
  const palette = ['#e11d48', '#f43f5e', '#fb7185', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#8b5cf6', '#a855f7', '#ec4899', '#6366f1']
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>تعديل القاعة</h3>
        <div className="form-grid">
          <div className="field"><span className="label">الاسم</span><input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="field"><span className="label">السعر</span><input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /></div>
        </div>
        <div className="form-grid">
          <div className="field"><span className="label">السعة (عدد الأفراد)</span><input type="number" min="0" value={capacity} onChange={e => setCapacity(e.target.value)} /></div>
          <div className="field"><span className="label">عدد التكييفات</span><input type="number" min="0" value={acCount} onChange={e => setAcCount(e.target.value)} /></div>
        </div>
        <div className="form-grid">
          <div className="field"><span className="label">عدد السبّورات</span><input type="number" min="0" value={boardsCount} onChange={e => setBoardsCount(e.target.value)} /></div>
          <div className="field checkbox-field">
            <label><input type="checkbox" checked={hasScreen} onChange={e => setHasScreen(e.target.checked)} /> مجهزة بشاشة عرض</label>
            <label><input type="checkbox" checked={hasInteractiveScreen} onChange={e => setHasInteractiveScreen(e.target.checked)} /> شاشة تفاعلية</label>
          </div>
        </div>
        <div className="field"><span className="label">اللون</span><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{palette.map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 32, height: 32, borderRadius: 8, border: color === c ? '3px solid #111' : 'none', background: c }} />)}</div></div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn btn-primary" onClick={() => onSave({ name: name.trim(), pricePerHour: Number(price), color, capacity: Number(capacity), hasScreen, acCount: Number(acCount), boardsCount: Number(boardsCount), hasInteractiveScreen })}>حفظ</button>
        </div>
      </div>
    </div>
  )
}

function TeachersTab({ db, run, onEdit }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [photo, setPhoto] = useState('')
  const fileRef = useRef()
  async function handlePhoto(e) {
    const file = e.target.files[0]
    if (file) { const d = await resizeImage(file); setPhoto(d) }
  }
  async function add() {
    if (!name.trim()) return alert('اسم المدرس')
    if (await run('addTeacher', { name: name.trim(), phone: phone.trim(), photo }, 'تمت الإضافة')) { setName(''); setPhone(''); setPhoto(''); if (fileRef.current) fileRef.current.value = '' }
  }
  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>إضافة مدرس</h3>
        <div className="form-grid">
          <div className="field"><span className="label">الاسم</span><input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="field"><span className="label">الهاتف</span><input dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01x..." /></div>
        </div>
        <div className="form-grid">
          <div className="field"><span className="label">صورة المدرس</span><input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} /><input style={{ marginTop: 6 }} value={photo} onChange={e => setPhoto(e.target.value)} placeholder="أو الصق رابط الصورة" /></div>
          {photo && <div style={{ display: 'flex', alignItems: 'flex-end' }}><img src={photo} style={{ width: 70, height: 70, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--line)' }} /></div>}
        </div>
        <button className="btn btn-primary" onClick={add}>إضافة</button>
      </div>
      {db.teachers.map(t => (
        <div className="card hall-card" key={t.id}>
          {t.photo ? <img src={t.photo} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} /> : <span className="dot" style={{ background: '#94a3b8' }} />}
          <strong>{t.name}</strong>
          {t.phone && <span className="muted small" dir="ltr">{t.phone}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(t)}>تعديل</button>
          <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`حذف "${t.name}"؟`)) run('deleteTeacher', { id: t.id }, 'تم الحذف') }}>حذف</button>
        </div>
      ))}
      {db.teachers.length === 0 && <p className="muted">لا يوجد مدرسون</p>}
    </div>
  )
}

function TeacherModal({ teacher, onClose, onSave }) {
  const [name, setName] = useState(teacher.name)
  const [phone, setPhone] = useState(teacher.phone || '')
  const [photo, setPhoto] = useState(teacher.photo || '')
  const fileRef = useRef()
  async function handlePhoto(e) {
    const file = e.target.files[0]
    if (file) { const d = await resizeImage(file); setPhoto(d) }
  }
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>تعديل المدرس</h3>
        <div className="form-grid">
          <div className="field"><span className="label">الاسم</span><input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="field"><span className="label">الهاتف</span><input dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} /></div>
        </div>
        <div className="form-grid">
          <div className="field"><span className="label">الصورة</span><input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} /><input style={{ marginTop: 6 }} value={photo} onChange={e => setPhoto(e.target.value)} placeholder="رابط الصورة" /></div>
          {photo && <div style={{ display: 'flex', alignItems: 'flex-end' }}><img src={photo} style={{ width: 70, height: 70, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--line)' }} /></div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn btn-primary" onClick={() => onSave({ name: name.trim(), phone: phone.trim(), photo })}>حفظ</button>
        </div>
      </div>
    </div>
  )
}

function SettingsTab({ db, run, token }) {
  const s = db.settings
  const [placeName, setPlaceName] = useState(s.placeName)
  const [placeNameEn, setPlaceNameEn] = useState(s.placeNameEn || '')
  const [openT, setOpenT] = useState(s.openTime)
  const [closeT, setCloseT] = useState(s.closeTime)
  const [refresh, setRefresh] = useState(s.displayRefresh)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const hours = timeOptions(0, 24 * 60 - 30, 30)

  async function save() {
    if (Number(closeT) <= Number(openT)) return alert('ساعات العمل غير صحيحة')
    if (pw1 && pw1 !== pw2) return alert('كلمتا المرور غير متطابقتين')
    const p = { placeName, placeNameEn, openTime: Number(openT), closeTime: Number(closeT), displayRefresh: Number(refresh) }
    if (pw1) p.newPassword = pw1
    if (await run('updateSettings', p, 'تم الحفظ')) { setPw1(''); setPw2('') }
  }

  const adminUrl = `${origin}/manage/${token}`
  const bookingUrl = `${origin}/book`

  return (
    <div className="settings-grid">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>المعلومات</h3>
        <div className="field"><span className="label">اسم المكان (عربي)</span><input value={placeName} onChange={e => setPlaceName(e.target.value)} /></div>
        <div className="field"><span className="label">اسم المكان (إنجليزي)</span><input value={placeNameEn} onChange={e => setPlaceNameEn(e.target.value)} placeholder="EDUCON ACADEMY" /></div>
        <div className="form-grid">
          <div className="field"><span className="label">بداية العمل</span><select value={openT} onChange={e => setOpenT(e.target.value)}>{hours.filter(m => m < Number(closeT)).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select></div>
          <div className="field"><span className="label">نهاية العمل</span><select value={closeT} onChange={e => setCloseT(e.target.value)}>{hours.filter(m => m > Number(openT)).map(m => <option key={m} value={m}>{fmtTime(m)}</option>)}</select></div>
        </div>
        <div className="field"><span className="label">تحديث الشاشة (ثانية)</span><input type="number" min="10" value={refresh} onChange={e => setRefresh(e.target.value)} /></div>
        <div className="form-grid">
          <div className="field"><span className="label">كلمة مرور جديدة</span><input type="password" value={pw1} onChange={e => setPw1(e.target.value)} /></div>
          <div className="field"><span className="label">تأكيد</span><input type="password" value={pw2} onChange={e => setPw2(e.target.value)} /></div>
        </div>
        <button className="btn btn-primary" onClick={save}>حفظ</button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>روابط الوصول</h3>
        <div className="field">
          <span className="label">لوحة التحكم (سرية)</span>
          <div className="url-row"><input readOnly value={adminUrl} onFocus={e => e.target.select()} /><button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(adminUrl); alert('تم النسخ') }}>نسخ</button></div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, color: '#e11d48' }} onClick={() => { if (confirm('إعادة توليد الرابط؟')) run('updateSettings', { regenerateAdminToken: true }, 'تم التحديث — استخدم الرابط الجديد') }}>إعادة توليد الرابط</button>
        </div>
        <div className="field">
          <span className="label">رابط الحجز الخارجي (عام)</span>
          <div className="url-row"><input readOnly value={bookingUrl} onFocus={e => e.target.select()} /><button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(bookingUrl); alert('تم النسخ') }}>نسخ</button></div>
        </div>
        <p className="small muted">ضع رابط الحجز في المنشورات وأرسله للمدرسين، وافتح شاشة العرض على الشاشة الثابتة.</p>
      </div>
    </div>
  )
}
