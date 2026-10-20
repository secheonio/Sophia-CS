import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)
const KEY_LENGTH = 64

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex || typeof password !== 'string' || password.length > 128) {
    return false
  }
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return crypto.timingSafeEqual(actual, expected)
}

// 존재하지 않는 계정도 같은 시간이 걸리도록 비교 대상으로 사용합니다.
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'))

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url')
}

const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

export function generateTemporaryPassword() {
  let password = ''
  for (let index = 0; index < 12; index += 1) {
    password += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)]
  }
  return password
}

export function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }
  return null
}

const WINDOW_MS = 10 * 60 * 1000
const LIMITS = { e: 5, i: 30 }

// 무차별 대입 방지: 이메일당 5회, IP당 30회 실패 시 10분간 차단합니다.
export function createLoginLimiter() {
  const failures = new Map()

  function prune(now) {
    if (failures.size < 2000) return
    for (const [key, entry] of failures) if (now - entry.first > WINDOW_MS) failures.delete(key)
  }

  return {
    blocked(keys) {
      const now = Date.now()
      return keys.some((key) => {
        const entry = failures.get(key)
        if (!entry) return false
        if (now - entry.first > WINDOW_MS) {
          failures.delete(key)
          return false
        }
        return entry.count >= LIMITS[key[0]]
      })
    },
    fail(keys) {
      const now = Date.now()
      prune(now)
      for (const key of keys) {
        const entry = failures.get(key)
        if (!entry || now - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: now })
        else entry.count += 1
      }
    },
    reset(keys) {
      for (const key of keys) failures.delete(key)
    },
  }
}
