import crypto from 'crypto'

const REDIS_KEY = 'teacher_halls_state_v1'
const LOCK_KEY = 'teacher_halls_lock_v1'

let redis = null
let storageMode = 'memory'
let dbVersion = 0
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.VERCEL_KV_REST_API_URL
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.VERCEL_KV_REST_API_TOKEN
if (redisUrl && redisToken) {
  try {
    const { Redis } = await import('@upstash/redis')
    redis = new Redis({ url: redisUrl, token: redisToken })
    storageMode = 'redis'
  } catch {
    redis = null
  }
}

function genToken(suffix) {
  const secret = process.env.APP_SECRET || 'educon-academy-2026'
  return crypto.createHash('sha256').update(secret + '::' + (suffix || '')).digest('hex').slice(0, 32)
}

export function defaultDB() {
  return {
    halls: [],
    teachers: [],
    bookings: [],
    pushSubscriptions: [],
    settings: {
      placeName: 'اكاديمية ايديكون للتدريب',
      placeNameEn: 'EDUCON ACADEMY',
      adminPassword: 'admin123',
      adminToken: process.env.ADMIN_TOKEN || genToken('admin'),
      bookingToken: process.env.BOOKING_TOKEN || genToken('booking'),
      openTime: 480,
      closeTime: 1380,
      displayRefresh: 60
    }
  }
}

export async function loadDB() {
  if (redis) {
    try {
      const raw = await redis.get(REDIS_KEY)
      if (raw) {
        const d = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (d && d.settings) { dbVersion = d._version || 0; return d }
        return Object.assign(defaultDB(), d)
      }
      const d = defaultDB()
      d._version = 1
      dbVersion = 1
      await redis.set(REDIS_KEY, JSON.stringify(d))
      return d
    } catch {
      return defaultDB()
    }
  }
  try {
    const fs = await import('fs')
    const path = await import('path')
    const p = path.default.join(process.cwd(), 'data', 'db.json')
    const data = await fs.default.promises.readFile(p, 'utf8')
    const d = JSON.parse(data)
    if (d && d.settings) { dbVersion = d._version || 0; return d }
    return Object.assign(defaultDB(), d)
  } catch {
    return defaultDB()
  }
}

export async function saveDB(db) {
  const newVersion = (db._version || 0) + 1
  if (redis) {
    try {
      const raw = await redis.get(REDIS_KEY)
      const remote = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
      const remoteVer = remote?._version || 0
      if (remoteVer > (db._version || 0)) {
        throw new Error('تم تعديل البيانات من طلب آخر')
      }
      db._version = newVersion
      await redis.set(REDIS_KEY, JSON.stringify(db))
      dbVersion = newVersion
    } catch (e) {
      if (e.message === 'تم تعديل البيانات من طلب آخر') throw e
    }
    return
  }
  try {
    const fs = await import('fs')
    const path = await import('path')
    const p = path.default.join(process.cwd(), 'data', 'db.json')
    await fs.default.promises.mkdir(path.default.dirname(p), { recursive: true })
    db._version = newVersion
    await fs.default.promises.writeFile(p, JSON.stringify(db, null, 2), 'utf8')
    dbVersion = newVersion
  } catch {}
}

export async function withLock(fn) {
  if (!redis) return fn()
  for (let i = 0; i < 10; i++) {
    try {
      const ok = await redis.set(LOCK_KEY, '1', { nx: true, ex: 30 })
      if (ok) {
        try { return await fn() } finally { await redis.del(LOCK_KEY) }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200 + i * 100))
  }
  throw new Error('ال系统 مشغول حاول مرة تانية')
}

export function sanitizeState(db, authed) {
  const { adminPassword, adminToken, bookingToken, _adminTokenVersion, _bookingTokenVersion, ...rest } = db.settings
  const settings = {
    ...rest,
    defaultPassword: db.settings.adminPassword === 'admin123',
    storageMode,
    ...(authed ? { adminToken, bookingToken } : {})
  }
  const bookings = db.bookings.map(b => {
    if (authed) return b
    const { phone, teacherName, hallName, title, source, createdAt, ...sched } = b
    return sched
  })
  const teachers = db.teachers.map(t => (authed ? t : { id: t.id, name: t.name }))
  const pushSubscriptions = authed ? (db.pushSubscriptions || []) : []
  return { halls: db.halls, teachers, bookings, settings, pushSubscriptions }
}
