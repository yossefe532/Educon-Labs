import crypto from 'crypto'

const SALT = 'teacher-halls::tb::2026'

export function hashPw(pw) {
  return crypto.createHash('sha256').update(String(pw) + SALT).digest('hex')
}

export function makeSessionToken(pw) {
  return hashPw(pw)
}

export function checkSession(token, pw) {
  return !!token && token === makeSessionToken(pw)
}
