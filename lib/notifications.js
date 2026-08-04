import { configureWebPush } from './vapid.js'

let push = null

function getPush() {
  if (!push) push = configureWebPush()
  return push
}

export async function sendPushNotification(subscription, title, body, url) {
  try {
    const webpush = getPush()
    const payload = JSON.stringify({ title, body, url })
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys
      },
      payload
    )
    return true
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      return 'expired'
    }
    console.error('Push notification error:', err.message)
    return false
  }
}

export async function notifySubscriptions(db, title, body, url, filter) {
  const subs = (db.pushSubscriptions || []).filter(filter)
  const results = []
  for (const sub of subs) {
    const result = await sendPushNotification(sub, title, body, url)
    results.push({ endpoint: sub.endpoint, result })
  }
  return results
}

export async function notifyAdmin(db, title, body, url) {
  return notifySubscriptions(db, title, body, url, s => s.role === 'admin')
}

export async function notifyTeacher(db, teacherName, title, body, url) {
  return notifySubscriptions(db, title, body, url, s => s.role === 'teacher' && s.teacherName === teacherName)
}

export function cleanupExpiredSubscriptions(db, results) {
  if (!db.pushSubscriptions) return
  const expiredEndpoints = new Set()
  for (const r of results) {
    if (r.result === 'expired') expiredEndpoints.add(r.endpoint)
  }
  if (expiredEndpoints.size > 0) {
    db.pushSubscriptions = db.pushSubscriptions.filter(s => !expiredEndpoints.has(s.endpoint))
  }
}
