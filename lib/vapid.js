import webpush from 'web-push'
import crypto from 'crypto'

let cachedKeys = null

export function getVapidKeys() {
  if (cachedKeys) return cachedKeys
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@educon-academy.com'
  const existingPublic = process.env.VAPID_PUBLIC_KEY
  const existingPrivate = process.env.VAPID_PRIVATE_KEY
  if (existingPublic && existingPrivate) {
    cachedKeys = { publicKey: existingPublic, privateKey: existingPrivate }
    return cachedKeys
  }
  const keys = webpush.generateVAPIDKeys()
  cachedKeys = keys
  return keys
}

export function configureWebPush() {
  const keys = getVapidKeys()
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@educon-academy.com',
    keys.publicKey,
    keys.privateKey
  )
  return webpush
}

export function arrayBufferToBase64(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

export function base64ToBuffer(base64) {
  return Buffer.from(base64, 'base64url')
}
