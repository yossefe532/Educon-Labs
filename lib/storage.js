import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const REDIS_KEY = 'teacher_halls_state_v1'
const LOCK_KEY = 'teacher_halls_lock_v1'

let redis = null
try {
  if (process.env.VERCEL_KV_REST_API_URL) {
    const { Redis } = await import('@upstash/redis')
    redis = Redis.fromEnv()
  }
} catch {
  redis = null
}

export function isCloud() {
  return !!redis
}

function genToken() {
  return crypto.randomBytes(16).toString('hex')
}

export function defaultDB() {
  return {
    halls: [],
    teachers: [],
    bookings: [],
    settings: {
      placeName: 'اكاديمية ايديكون للتدريب',
      placeNameEn: 'EDUCON ACADEMY',
      adminPassword: 'admin123',
      adminToken: genToken(),
      bookingToken: genToken(),
      openTime: 480,
      closeTime: 1380,
      displayRefresh: 60
    }
  }
}

function localPath() {
  return path.join(process.cwd(), 'data', 'db.json')
}

async function readLocal() {
  try {
    return JSON.parse(await fs.promises.readFile(localPath(), 'utf8'))
  } catch {
    const d = defaultDB()
    await saveLocal(d)
    return d
  }
}

async function saveLocal(db) {
  await fs.promises.mkdir(path.dirname(localPath()), { recursive: true })
  await fs.promises.writeFile(localPath(), JSON.stringify(db, null, 2), 'utf8')
}

export async function loadDB() {
  if (redis) {
    const raw = await redis.get(REDIS_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      if (d && d.settings) return d
      return Object.assign(defaultDB(), d)
    }
    const d = defaultDB()
    await redis.set(REDIS_KEY, JSON.stringify(d))
    return d
  }
  return readLocal()
}

export async function saveDB(db) {
  if (redis) {
    await redis.set(REDIS_KEY, JSON.stringify(db))
  } else {
    await saveLocal(db)
  }
}

export async function withLock(fn) {
  if (!redis) return fn()
  for (let i = 0; i < 5; i++) {
    const ok = await redis.set(LOCK_KEY, '1', { nx: true, ex: 10 })
    if (ok) {
      try {
        return await fn()
      } finally {
        await redis.del(LOCK_KEY)
      }
    }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error('النظام مشغول حاليًا، حاول مرة أخرى')
}

export function sanitizeState(db, authed) {
  const { adminPassword, adminToken, bookingToken, ...rest } = db.settings
  const settings = {
    ...rest,
    defaultPassword: db.settings.adminPassword === 'admin123',
    ...(authed ? { adminToken, bookingToken } : {})
  }
  const bookings = db.bookings.map(b => {
    if (authed) return b
    const { phone, teacherName, hallName, title, source, createdAt, ...sched } = b
    return sched
  })
  const teachers = db.teachers.map(t => (authed ? t : { id: t.id, name: t.name }))
  return { halls: db.halls, teachers, bookings, settings }
}
