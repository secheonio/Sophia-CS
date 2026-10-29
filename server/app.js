import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { transaction, today } from './db.js'
import {
  CATEGORIES, DEPARTMENTS, HttpError, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, POSITIONS,
  buildSteps, cleanText, decodeImage, departmentsByPosition, deriveStatus,
  validateEmail, validatePassword, validatePhone, validateRequestFields, validateRole, validateTargetDepartment,
} from './rules.js'
import {
  DUMMY_HASH, createLoginLimiter, generateTemporaryPassword, hashPassword,
  newSessionToken, readCookie, sha256, verifyPassword,
} from './security.js'

const SESSION_MS = 12 * 60 * 60 * 1000
const COOKIE_NAME = 'sid'
const BIG_JSON_LIMIT = '40mb'
const ADMIN_RESET_PASSWORD = 'sophia00'

function parseList(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean)
    }
  }
  return []
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? '',
    phone: user.phone ?? '',
    department: user.department,
    position: user.position,
    departments: parseList(user.departments),
    positions: parseList(user.positions),
    mustChangePassword: Boolean(user.must_change_password),
    active: Boolean(user.active),
  }
}

function toId(value) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, '찾을 수 없습니다.')
  return id
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? parsed : fallback
}

function calculateExecutionRate(total, remaining) {
  const totalAmount = Math.max(0, asNumber(total, 0))
  const remainingAmount = Math.max(0, asNumber(remaining, 0))
  if (totalAmount === 0) return 0
  return Number((((totalAmount - remainingAmount) / totalAmount) * 100).toFixed(2))
}

function normalizeBudgetRow(row) {
  const total = Math.max(0, asNumber(row?.예산총액, 0))
  const remaining = Math.min(Math.max(0, asNumber(row?.예산잔액, 0)), total)
  return {
    관: String(row?.관 ?? '').trim(),
    항: String(row?.항 ?? '').trim(),
    목: String(row?.목 ?? '').trim(),
    세목: String(row?.세목 ?? '').trim(),
    내역: String(row?.내역 ?? '').trim(),
    예산총액: total,
    예산잔액: remaining,
    집행률: calculateExecutionRate(total, remaining),
  }
}

function parseBudgetRows(value) {
  if (!value) return []
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(normalizeBudgetRow) : []
  } catch {
    return []
  }
}

function readDepartmentBudgetRows(dbRef, department) {
  const row = dbRef.prepare('SELECT rows_json FROM budget_master WHERE department = ?').get(department)
  const parsed = parseBudgetRows(row?.rows_json)
  if (parsed.length > 0) return parsed
  const persisted = dbRef.prepare(
    'SELECT gwan, hang, mok, semok, nae, total_amount, remaining_amount, execution_rate FROM budget_rows WHERE department = ? ORDER BY id',
  ).all(department)
  return persisted.map((item) => ({
    관: item.gwan,
    항: item.hang,
    목: item.mok,
    세목: item.semok,
    내역: item.nae,
    예산총액: asNumber(item.total_amount, 0),
    예산잔액: asNumber(item.remaining_amount, 0),
    집행률: asNumber(item.execution_rate, 0),
  }))
}

function saveDepartmentBudgetRows(dbRef, department, rows) {
  const normalized = (Array.isArray(rows) ? rows : []).map(normalizeBudgetRow)
  dbRef.prepare('INSERT INTO budget_master (department, rows_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(department) DO UPDATE SET rows_json = excluded.rows_json, updated_at = excluded.updated_at')
    .run(department, JSON.stringify(normalized), today())

  dbRef.prepare('DELETE FROM budget_rows WHERE department = ?').run(department)
  const insert = dbRef.prepare(
    `INSERT INTO budget_rows (department, gwan, hang, mok, semok, nae, total_amount, remaining_amount, execution_rate, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const row of normalized) {
    insert.run(
      department,
      row.관,
      row.항,
      row.목,
      row.세목,
      row.내역,
      row.예산총액,
      row.예산잔액,
      row.집행률,
      today(),
    )
  }
  return normalized
}

function getDepartmentBudgetAllocation(dbRef, requestId) {
  const allocation = dbRef.prepare('SELECT * FROM request_budget_allocations WHERE request_id = ?').get(requestId)
  if (!allocation) return null
  const budgetRow = dbRef.prepare('SELECT * FROM budget_rows WHERE id = ?').get(allocation.budget_row_id)
  if (!budgetRow) return null
  return {
    allocation,
    budgetRow,
    department: budgetRow.department,
    fields: {
      관: budgetRow.gwan,
      항: budgetRow.hang,
      목: budgetRow.mok,
      세목: budgetRow.semok,
      내역: budgetRow.nae,
    },
  }
}

function updateBudgetAllocationStatus(dbRef, requestId, status, approvedAmount = 0) {
  dbRef.prepare(
    'UPDATE request_budget_allocations SET approved_amount = ?, status = ?, allocated_at = ? WHERE request_id = ?',
  ).run(approvedAmount, status, new Date().toISOString(), requestId)
}

function matchBudgetRow(a, b) {
  if (!a || !b) return false
  return ['관', '항', '목', '세목', '내역'].every((field) => String(a[field] ?? '').trim() === String(b[field] ?? '').trim())
}

function normalizePaymentRowAttachments(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: Number(item.id) || undefined,
      name: String(item.name ?? '').trim() || '영수증',
      size: Number(item.size) || 0,
      mime: String(item.mime ?? 'image/png'),
      dataUrl: typeof item.dataUrl === 'string' ? item.dataUrl : undefined,
    }))
}

function normalizePaymentRows(rows) {
  if (!Array.isArray(rows)) return []
  const cleaned = []
  rows.forEach((row, index) => {
    const summary = String(row?.summary ?? '').trim()
    const date = String(row?.date ?? '').trim()
    const payer = String(row?.payer ?? '').trim()
    const method = String(row?.method ?? '').trim()
    const rawAmount = String(row?.amount ?? '').trim()
    const attachments = normalizePaymentRowAttachments(row?.attachments)
    const hasAnyContent = summary || date || rawAmount || payer || method || attachments.length > 0
    if (!hasAnyContent) return
    const numericAmount = Number(rawAmount.replace(/[^0-9-]/g, ''))
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      throw new HttpError(400, `${index + 1}번째 지급 내역의 금액을 확인해 주세요.`)
    }
    if (!summary) throw new HttpError(400, `${index + 1}번째 지급 내역의 적요를 입력해 주세요.`)
    if (!payer) throw new HttpError(400, `${index + 1}번째 지급 내역의 성명(상호)를 입력해 주세요.`)
    if (!method) throw new HttpError(400, `${index + 1}번째 지급 내역의 지급방법을 입력해 주세요.`)
    cleaned.push({
      seq: cleaned.length + 1,
      summary,
      date: date || today(),
      amount: Math.round(numericAmount),
      payer,
      method,
      attachments,
    })
  })
  return cleaned
}

function readPaymentRows(dbRef, requestId) {
  const rows = dbRef.prepare(
    `SELECT pr.id AS row_id, pr.seq, pr.summary, pr.date_text, pr.amount, pr.payer, pr.method,
            a.id AS attachment_id, a.name AS attachment_name, a.size_bytes, a.mime
     FROM request_payment_rows pr
     LEFT JOIN attachments a ON a.payment_row_id = pr.id
     WHERE pr.request_id = ?
     ORDER BY pr.seq, a.id`,
  ).all(requestId)

  const map = new Map()
  for (const row of rows) {
    let entry = map.get(row.row_id)
    if (!entry) {
      entry = {
        id: row.row_id,
        seq: row.seq,
        summary: row.summary,
        date: row.date_text,
        amount: Number(row.amount || 0),
        payer: row.payer,
        method: row.method,
        attachments: [],
      }
      map.set(row.row_id, entry)
    }
    if (row.attachment_id) {
      entry.attachments.push({
        id: row.attachment_id,
        name: row.attachment_name,
        size: Number(row.size_bytes || 0),
        mime: row.mime || 'image/png',
      })
    }
  }
  return [...map.values()]
}

function savePaymentRows(dbRef, requestId, rows) {
  const preserved = new Map()
  dbRef.prepare('SELECT id, name, mime, size_bytes, data FROM attachments WHERE request_id = ? AND payment_row_id IS NOT NULL ORDER BY id')
    .all(requestId)
    .forEach((item) => {
      preserved.set(Number(item.id), {
        name: item.name,
        mime: item.mime,
        size: Number(item.size_bytes || 0),
        data: Buffer.from(item.data),
      })
    })

  dbRef.prepare('DELETE FROM request_payment_rows WHERE request_id = ?').run(requestId)
  if (!Array.isArray(rows) || rows.length === 0) return
  const insert = dbRef.prepare(
    'INSERT INTO request_payment_rows (request_id, seq, summary, date_text, amount, payer, method) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insertAttachment = dbRef.prepare(
    'INSERT INTO attachments (request_id, payment_row_id, name, mime, size_bytes, data) VALUES (?, ?, ?, ?, ?, ?)',
  )
  rows.forEach((row) => {
    const saved = insert.run(requestId, row.seq, row.summary, row.date, row.amount, row.payer, row.method)
    const paymentRowId = Number(saved.lastInsertRowid)
    const attachments = Array.isArray(row.attachments) ? row.attachments : []
    for (const attachment of attachments) {
      const attachmentId = attachment && attachment.id !== undefined ? Number(attachment.id) : null
      const preservedAttachment = attachmentId !== null ? preserved.get(attachmentId) : undefined
      const decoded = typeof attachment?.dataUrl === 'string'
        ? decodeImage({ name: attachment.name || '영수증', dataUrl: attachment.dataUrl })
        : preservedAttachment
          ? {
              name: String(attachment?.name || preservedAttachment.name || '영수증').trim() || '영수증',
              mime: preservedAttachment.mime || 'image/png',
              data: Buffer.from(preservedAttachment.data),
            }
          : null
      if (!decoded) continue
      insertAttachment.run(
        requestId,
        paymentRowId,
        String(attachment?.name || decoded.name || '영수증').trim() || '영수증',
        decoded.mime || attachment?.mime || 'image/png',
        Number(attachment?.size || decoded.data.length || 0),
        decoded.data,
      )
    }
  })
}

function getBudgetSelectionForDepartment(dbRef, department, budgetFields) {
  const rows = readDepartmentBudgetRows(dbRef, department)
  if (!budgetFields || typeof budgetFields !== 'object') return null
  const target = {
    관: String(budgetFields.관 ?? '').trim(),
    항: String(budgetFields.항 ?? '').trim(),
    목: String(budgetFields.목 ?? '').trim(),
    세목: String(budgetFields.세목 ?? '').trim(),
    내역: String(budgetFields.내역 ?? '').trim(),
  }
  if (!target.관 && !target.항 && !target.목 && !target.세목 && !target.내역) return null
  return rows.find((row) => matchBudgetRow(row, target)) ?? null
}

function reserveBudgetForRequest(dbRef, requestId, department, budgetFields, amount) {
  if (!budgetFields || typeof budgetFields !== 'object' || Object.values(budgetFields).every((value) => String(value ?? '').trim() === '')) {
    return null
  }
  const match = getBudgetSelectionForDepartment(dbRef, department, budgetFields)
  if (!match) {
    throw new HttpError(400, '예산 항목을 선택해 주세요.')
  }
  const remaining = Math.max(0, asNumber(match.예산잔액, 0))
  if (amount > remaining) {
    throw new HttpError(400, `선택한 예산 항목의 잔액이 부족합니다. 남은 예산 ${remaining.toLocaleString('ko-KR')}원 이하로 입력해 주세요.`)
  }

  const rows = readDepartmentBudgetRows(dbRef, department).map((row) => {
    if (!matchBudgetRow(row, budgetFields)) return row
    const nextRemaining = Math.max(0, asNumber(row.예산잔액, 0) - amount)
    return { ...row, 예산잔액: nextRemaining, 집행률: calculateExecutionRate(row.예산총액, nextRemaining) }
  })
  saveDepartmentBudgetRows(dbRef, department, rows)

  const budgetRow = dbRef.prepare(
    'SELECT id FROM budget_rows WHERE department = ? AND gwan = ? AND hang = ? AND mok = ? AND semok = ? AND nae = ?',
  ).get(department, match.관, match.항, match.목, match.세목, match.내역)
  const existing = dbRef.prepare('SELECT * FROM request_budget_allocations WHERE request_id = ?').get(requestId)
  if (existing) {
    dbRef.prepare(
      `UPDATE request_budget_allocations SET budget_row_id = ?, requested_amount = ?, approved_amount = ?, status = 'pending', allocated_at = ?
       WHERE request_id = ?`,
    ).run(budgetRow?.id ?? 0, amount, 0, new Date().toISOString(), requestId)
  } else if (budgetRow) {
    dbRef.prepare(
      `INSERT INTO request_budget_allocations (request_id, budget_row_id, requested_amount, approved_amount, allocated_at, status)
       VALUES (?, ?, ?, 0, ?, 'pending')`,
    ).run(requestId, budgetRow.id, amount, new Date().toISOString())
  }
  return match
}

function restoreBudgetForRequest(dbRef, requestId, department, budgetFields, amount) {
  const allocation = getDepartmentBudgetAllocation(dbRef, requestId)
  const resolvedFields = budgetFields || allocation?.fields || null
  const resolvedDepartment = department || allocation?.department || null
  if (!resolvedDepartment || !resolvedFields) return null

  const match = getBudgetSelectionForDepartment(dbRef, resolvedDepartment, resolvedFields)
  if (!match) return null

  const rows = readDepartmentBudgetRows(dbRef, resolvedDepartment).map((row) => {
    if (!matchBudgetRow(row, resolvedFields)) return row
    const nextRemaining = Math.max(0, asNumber(row.예산잔액, 0) + amount)
    const safeTotal = asNumber(row.예산총액, 0)
    return { ...row, 예산잔액: Math.min(nextRemaining, safeTotal), 집행률: calculateExecutionRate(safeTotal, Math.min(nextRemaining, safeTotal)) }
  })
  saveDepartmentBudgetRows(dbRef, resolvedDepartment, rows)
  updateBudgetAllocationStatus(dbRef, requestId, 'restored', 0)
  return match
}

export function createApp(db, { secureCookie = false, trustProxy = false, staticDir } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy ? 1 : false)
  const limiter = createLoginLimiter()
  const smallJson = express.json({ limit: '32kb' })
  const bigJson = express.json({ limit: BIG_JSON_LIMIT })
  const q = (sql) => db.prepare(sql)

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    })
    next()
  })

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (req.method === 'GET' || req.method === 'HEAD') return next()

    const origin = req.get('origin')
    const host = req.get('host')
    const sameOrigin = !!host && origin === `${req.protocol}://${host}`
    const loopbackOrigin = !!origin && /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?$/.test(origin)

    if (origin && !sameOrigin && !loopbackOrigin) {
      return next(new HttpError(403, '허용되지 않은 요청 출처입니다.'))
    }

    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.toLowerCase().includes('application/json')) {
      return next(new HttpError(415, 'JSON 형식의 요청만 받을 수 있습니다.'))
    }

    next()
  })

  app.use('/api', (req, _res, next) => {
    req.user = null
    const token = readCookie(req, COOKIE_NAME)
    if (token) {
      const row = q(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      ).get(sha256(token), Date.now())
      if (row) {
        req.user = row
        req.sessionHash = sha256(token)
      }
    }
    next()
  })

  const requireAuth = (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, '로그인이 필요합니다.'))
    next()
  }
  const requireReady = (req, _res, next) => {
    if (req.user.must_change_password) {
      return next(new HttpError(403, '먼저 비밀번호를 변경해 주세요.', 'PASSWORD_CHANGE_REQUIRED'))
    }
    next()
  }
  const requireAdmin = (req, _res, next) => {
    if (req.user.position !== '교장') return next(new HttpError(403, '관리자(교장)만 사용할 수 있습니다.'))
    next()
  }
  const ready = [requireAuth, requireReady]

  function startSession(res, userId) {
    const token = newSessionToken()
    q('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
    q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, Date.now() + SESSION_MS)
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: SESSION_MS, path: '/',
    })
  }

  // ---- 인증 ----
  app.post('/api/auth/login', smallJson, async (req, res) => {
    const body = req.body ?? {}
    const submittedName = typeof body.name === 'string' ? body.name.trim() : ''
    const submittedEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const loginValue = submittedName || submittedEmail
    const key = submittedName ? `n:${submittedName}` : `e:${submittedEmail}`
    const keys = [key, `i:${req.ip}`]
    if (limiter.blocked(keys)) throw new HttpError(429, '로그인 시도가 너무 많습니다. 10분 후 다시 시도해 주세요.')

    const user = q('SELECT * FROM users WHERE name = ? OR email = ?').get(loginValue, loginValue)
    const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH)
    if (!user || !user.active || !valid) {
      limiter.fail(keys)
      throw new HttpError(401, '이름 또는 비밀번호가 올바르지 않습니다.')
    }
    limiter.reset([key])
    startSession(res, user.id)
    res.json({ user: publicUser(user) })
  })

  app.post('/api/auth/logout', smallJson, (req, res) => {
    if (req.sessionHash) q('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash)
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/' })
    res.json({ ok: true })
  })

  app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }))

  app.post('/api/auth/change-password', requireAuth, smallJson, async (req, res) => {
    const body = req.body ?? {}
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    if (!currentPassword) throw new HttpError(400, '현재 비밀번호를 입력해 주세요.')
    if (!(await verifyPassword(currentPassword, req.user.password_hash))) {
      throw new HttpError(400, '현재 비밀번호가 올바르지 않습니다.')
    }

    const rawNewPassword = typeof body.newPassword === 'string' ? body.newPassword.trim() : ''
    const wantsPasswordChange = rawNewPassword.length > 0
    let nextPassword = ''
    if (wantsPasswordChange) {
      nextPassword = validatePassword(rawNewPassword)
      if (nextPassword === currentPassword) throw new HttpError(400, '새 비밀번호는 현재 비밀번호와 달라야 합니다.')
    }

    const hasEmailInput = Object.prototype.hasOwnProperty.call(body, 'email')
    const hasPhoneInput = Object.prototype.hasOwnProperty.call(body, 'phone')
    const emailValue = typeof body.email === 'string' ? body.email.trim() : (hasEmailInput ? '' : (req.user.email ?? ''))
    const phoneValue = typeof body.phone === 'string' ? body.phone.trim() : (hasPhoneInput ? '' : (req.user.phone ?? ''))
    const shouldUpdateEmail = hasEmailInput && emailValue !== ''
    const shouldUpdatePhone = hasPhoneInput && phoneValue !== ''
    if (hasEmailInput || hasPhoneInput) {
      if (shouldUpdateEmail && !emailValue.includes('@')) {
        throw new HttpError(400, '이메일은 @를 포함해야 합니다.')
      }
      if (shouldUpdatePhone && !/^\d{10,11}$/.test(phoneValue)) {
        throw new HttpError(400, '전화번호 형식이 올바르지 않습니다. (예: 01012345678)')
      }
      if (shouldUpdateEmail) {
        const normalizedEmail = validateEmail(emailValue)
        const existing = q('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, req.user.id)
        if (existing) throw new HttpError(409, '이미 등록된 이메일입니다.')
        q('UPDATE users SET email = ? WHERE id = ?').run(normalizedEmail, req.user.id)
      }
      if (shouldUpdatePhone) {
        const normalizedPhone = validatePhone(phoneValue)
        q('UPDATE users SET phone = ? WHERE id = ?').run(normalizedPhone, req.user.id)
      }
    }

    if (wantsPasswordChange) {
      const hash = await hashPassword(nextPassword)
      q('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.user.id)
    } else if (req.user.must_change_password) {
      throw new HttpError(400, '새 비밀번호를 입력해 주세요.')
    }

    q('DELETE FROM sessions WHERE user_id = ?').run(req.user.id)
    const refreshed = q('SELECT * FROM users WHERE id = ?').get(req.user.id)
    startSession(res, req.user.id)
    res.json({ user: publicUser(refreshed) })
  })

  app.get('/api/meta', ...ready, (_req, res) => {
    const budgetDepartments = ['기초과정', '본과정', '심화과정', '교무부', '교육과정연구부', '생활교육부', '전형위원회', '델포이', '생활관', '도서관', '행정실']
    const budgetCatalog = {}
    for (const department of budgetDepartments) {
      const row = q('SELECT rows_json FROM budget_master WHERE department = ?').get(department)
      budgetCatalog[department] = row ? JSON.parse(row.rows_json) : []
    }
    res.json({
      departments: DEPARTMENTS,
      categories: CATEGORIES,
      positions: POSITIONS,
      departmentsByPosition: departmentsByPosition(),
      maxAttachments: MAX_ATTACHMENTS,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      budgetDepartments,
      budgetCatalog,
    })
  })

  app.post('/api/budget-master/:department', ...ready, requireAdmin, smallJson, (req, res) => {
    const department = String(req.params.department ?? '').trim()
    if (!department) throw new HttpError(400, '상신 단위를 선택해 주세요.')
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
    const normalized = rows.map((row) => ({
      관: String(row?.관 ?? '').trim(),
      항: String(row?.항 ?? '').trim(),
      목: String(row?.목 ?? '').trim(),
      세목: String(row?.세목 ?? '').trim(),
      내역: String(row?.내역 ?? '').trim(),
      예산총액: Number(row?.예산총액 ?? 0),
      예산잔액: Number(row?.예산잔액 ?? 0),
      집행률: Number(row?.집행률 ?? 0),
    }))
    q('INSERT INTO budget_master (department, rows_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(department) DO UPDATE SET rows_json = excluded.rows_json, updated_at = excluded.updated_at')
      .run(department, JSON.stringify(normalized), today())
    res.json({ ok: true, department, rows: normalized })
  })

  // ---- 사용자 관리 (교장) ----
  function hasPendingSteps(userId) {
    return Boolean(q("SELECT 1 FROM request_steps WHERE user_id = ? AND status = '결재 중'").get(userId))
  }

  function translateConflict(error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      if (error.message.includes('users.email')) return new HttpError(409, '이미 등록된 이메일입니다.')
      return new HttpError(409, '이미 같은 직책이 지정되어 있습니다. (교장·행정실장은 1명, 기관장은 부서당 1명)')
    }
    return error
  }

  app.get('/api/users', ...ready, requireAdmin, (_req, res) => {
    const users = q('SELECT * FROM users ORDER BY active DESC, id').all()
    res.json({ users: users.map(publicUser) })
  })

  app.post('/api/users', ...ready, requireAdmin, smallJson, async (req, res) => {
    const body = req.body ?? {}
    const name = cleanText(body.name, '이름', { min: 1, max: 30 })
    const emailValue = typeof body.email === 'string' ? body.email.trim() : ''
    const email = emailValue ? validateEmail(emailValue) : null
    const phoneValue = typeof body.phone === 'string' ? body.phone.trim() : ''
    const phone = phoneValue ? validatePhone(phoneValue) : ''
    const departments = Array.isArray(body.departments) ? body.departments : [body.department ?? '기타']
    const positions = Array.isArray(body.positions) ? body.positions : [body.position ?? '기안자']
    if (!departments.length) throw new HttpError(400, '소속을 1개 이상 선택해 주세요.')
    if (!positions.length) throw new HttpError(400, '직책을 1개 이상 선택해 주세요.')
    const primaryDepartment = departments[0] ?? '기타'
    const primaryPosition = positions[0] ?? '기안자'
    validateRole(primaryDepartment, primaryPosition)
    const temporaryPassword = generateTemporaryPassword()
    const hash = await hashPassword(temporaryPassword)
    try {
      const result = q(
        `INSERT INTO users (email, name, department, position, departments, positions, phone, password_hash, must_change_password, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      ).run(email, name, primaryDepartment, primaryPosition, JSON.stringify(departments), JSON.stringify(positions), phone || null, hash, today())
      const user = q('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid))
      res.status(201).json({ user: publicUser(user), temporaryPassword })
    } catch (error) {
      throw translateConflict(error)
    }
  })

  app.patch('/api/users/:id', ...ready, requireAdmin, smallJson, (req, res) => {
    const target = q('SELECT * FROM users WHERE id = ?').get(toId(req.params.id))
    if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.')
    const body = req.body ?? {}
    const explicitDepartments = Object.prototype.hasOwnProperty.call(body, 'departments')
    const explicitPositions = Object.prototype.hasOwnProperty.call(body, 'positions')
    const parsedDepartments = Array.isArray(body.departments)
      ? body.departments.filter(Boolean)
      : (body.department ? [body.department] : parseList(target.departments))
    const parsedPositions = Array.isArray(body.positions)
      ? body.positions.filter(Boolean)
      : (body.position ? [body.position] : parseList(target.positions))
    const nextEmailValue = body.email === undefined ? (target.email ?? '') : String(body.email ?? '').trim()
    const nextEmail = nextEmailValue ? validateEmail(nextEmailValue) : null
    const nextPhoneValue = body.phone === undefined ? (target.phone ?? '') : String(body.phone ?? '').trim()
    const nextPhone = nextPhoneValue ? validatePhone(nextPhoneValue) : null

    const fallbackDepartment = target.department || '기타'
    const fallbackPosition = target.position === '기관장' || target.position === '행정실장' ? '기안자' : (target.position || '기안자')
    const nextDepartment = parsedDepartments.length ? parsedDepartments[0] : fallbackDepartment
    const nextPosition = parsedPositions.length ? parsedPositions[0] : fallbackPosition
    const next = {
      name: body.name === undefined ? target.name : cleanText(body.name, '이름', { min: 1, max: 30 }),
      email: nextEmail,
      phone: nextPhone ?? '',
      department: nextDepartment,
      position: nextPosition,
      departments: parsedDepartments.length ? parsedDepartments : [],
      positions: parsedPositions.length ? parsedPositions : [],
      active: body.active === undefined ? Boolean(target.active) : body.active === true,
    }
    if (body.active !== undefined && typeof body.active !== 'boolean') throw new HttpError(400, '상태 값이 올바르지 않습니다.')
    validateRole(next.department, next.position)

    const roleChanged =
      next.department !== target.department || next.position !== target.position ||
      JSON.stringify(next.departments) !== JSON.stringify(parseList(target.departments)) ||
      JSON.stringify(next.positions) !== JSON.stringify(parseList(target.positions))
    const statusChanged = next.active !== Boolean(target.active)
    if ((roleChanged || statusChanged) && target.id === req.user.id) {
      throw new HttpError(400, '본인의 소속·직책·사용 상태는 변경할 수 없습니다.')
    }
    if (statusChanged && !next.active && hasPendingSteps(target.id)) {
      throw new HttpError(409, '결재 중인 품의가 있어 사용자를 비활성화할 수 없습니다. 결재가 끝난 뒤 다시 시도해 주세요.')
    }
    if (roleChanged && hasPendingSteps(target.id)) {
      const pendingIsSameRole = target.department === next.department && target.position === next.position
      if (!pendingIsSameRole) {
        // 결재 중인 품의의 결재선은 이미 확정된 사용자 기준으로 구성되어 있으므로,
        // 해당 사용자의 직책 변경은 변경 전 상태를 유지해도 결재 흐름에 영향을 주지 않는다.
      }
    }
    try {
      q('UPDATE users SET name = ?, email = ?, phone = ?, department = ?, position = ?, departments = ?, positions = ?, active = ? WHERE id = ?')
        .run(next.name, next.email, next.phone || null, next.department, next.position, JSON.stringify(next.departments), JSON.stringify(next.positions), next.active ? 1 : 0, target.id)
    } catch (error) {
      throw translateConflict(error)
    }
    if (!next.active) q('DELETE FROM sessions WHERE user_id = ?').run(target.id)
    res.json({ user: publicUser(q('SELECT * FROM users WHERE id = ?').get(target.id)) })
  })

  app.delete('/api/users/:id', ...ready, requireAdmin, (req, res) => {
    const target = q('SELECT * FROM users WHERE id = ?').get(toId(req.params.id))
    if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.')
    if (target.id === req.user.id) throw new HttpError(400, '본인은 삭제할 수 없습니다.')
    if (hasPendingSteps(target.id)) {
      throw new HttpError(409, '결재 중인 품의가 있어 사용자를 삭제할 수 없습니다. 결재가 끝난 뒤 다시 시도해 주세요.')
    }
    q('UPDATE users SET active = 0 WHERE id = ?').run(target.id)
    q('DELETE FROM sessions WHERE user_id = ?').run(target.id)
    res.json({ ok: true })
  })

  app.post('/api/users/:id/reset-password', ...ready, requireAdmin, smallJson, async (req, res) => {
    const target = q('SELECT * FROM users WHERE id = ?').get(toId(req.params.id))
    if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.')
    const temporaryPassword = ADMIN_RESET_PASSWORD
    q('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(await hashPassword(temporaryPassword), target.id)
    q('DELETE FROM sessions WHERE user_id = ?').run(target.id)
    res.json({ temporaryPassword })
  })

  // 교장 교체: 직책 이전과 진행 중인 결재 이관을 한 트랜잭션으로 처리한다.
  app.post('/api/principal/transfer', ...ready, requireAdmin, smallJson, async (req, res) => {
    const body = req.body ?? {}
    let newUser = null
    let temporaryPassword = null
    let hash = null
    if (body.userId !== undefined) {
      newUser = q('SELECT * FROM users WHERE id = ?').get(toId(body.userId))
      if (!newUser || !newUser.active) throw new HttpError(404, '사용 중인 사용자를 찾을 수 없습니다.')
      if (newUser.id === req.user.id) throw new HttpError(400, '현재 교장에게는 교체할 수 없습니다.')
      if (newUser.position === '행정실장') throw new HttpError(400, '행정실장은 교장이 될 수 없습니다.')
    } else {
      cleanText(body.name, '이름', { min: 1, max: 30 })
      validateEmail(body.email)
      temporaryPassword = generateTemporaryPassword()
      hash = await hashPassword(temporaryPassword)
    }
    if (body.confirm !== true) throw new HttpError(400, '교체 확인이 필요합니다.')

    try {
      const moved = transaction(db, () => {
        const old = q('SELECT * FROM users WHERE id = ?').get(req.user.id)
        if (old.position !== '교장' || !old.active) throw new HttpError(409, '이미 교체되었습니다.')
        if (newUser) {
          const fresh = q('SELECT * FROM users WHERE id = ?').get(newUser.id)
          if (!fresh.active) throw new HttpError(409, '사용 중지된 사용자입니다.')
          if (hasPendingSteps(fresh.id)) {
            throw new HttpError(409, '결재 중인 품의가 있는 사용자는 교장으로 지정할 수 없습니다. 결재가 끝난 뒤 지정해 주세요.')
          }
        }
        q("UPDATE users SET active = 0 WHERE id = ?").run(old.id)
        let target = newUser
        if (target) {
          q("UPDATE users SET department = '교장', position = '교장', departments = '[]', positions = '[]' WHERE id = ?").run(target.id)
        } else {
          const result = q(
            `INSERT INTO users (email, name, department, position, departments, positions, password_hash, must_change_password, active, created_at)
             VALUES (?, ?, '교장', '교장', '[]', '[]', ?, 1, 1, ?)`,
          ).run(validateEmail(body.email), cleanText(body.name, '이름', { min: 1, max: 30 }), hash, today())
          target = { id: Number(result.lastInsertRowid) }
        }
        target = q('SELECT * FROM users WHERE id = ?').get(target.id)
        // 아직 처리되지 않은 교장 결재는 새 교장에게 넘기고, 완료된 결재는 기존 이름으로 남긴다.
        const pending = q(
          `SELECT DISTINCT request_id FROM request_steps WHERE user_id = ? AND status IN ('결재 중', '대기')`,
        ).all(old.id)
        const result = q(
          `UPDATE request_steps SET user_id = ?, user_name = ?, user_position = '교장'
           WHERE user_id = ? AND status IN ('결재 중', '대기')`,
        ).run(target.id, target.name, old.id)
        q('DELETE FROM sessions WHERE user_id = ?').run(old.id)
        for (const item of pending) logEvent(item.request_id, old.id, '교장 교체', `${old.name} → ${target.name}`)
        return { target, count: Number(result.changes) }
      })
      res.json({ user: publicUser(moved.target), temporaryPassword, transferredSteps: moved.count })
    } catch (error) {
      throw translateConflict(error)
    }
  })

  // ---- 지출품의 ----
  function serialize(row) {
    const steps = q('SELECT * FROM request_steps WHERE request_id = ? ORDER BY seq').all(row.id).map((step) => ({
      userId: step.user_id,
      name: step.user_name,
      position: step.user_position,
      kind: step.kind,
      status: step.status,
      date: step.decided_on,
    }))
    const attachments = q('SELECT id, name FROM attachments WHERE request_id = ? ORDER BY id').all(row.id)
      .map((item) => ({ id: item.id, name: item.name }))
    const requester = q('SELECT name FROM users WHERE id = ?').get(row.requester_id)
    const paymentRows = readPaymentRows(db, row.id)
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      category: row.category,
      amount: row.amount,
      memo: row.memo,
      requesterId: row.requester_id,
      requester: requester?.name ?? '',
      department: row.department,
      date: row.requested_on,
      status: deriveStatus(steps),
      steps,
      attachments,
      paymentRows,
      rejection: row.rejection_reason
        ? { by: row.rejection_by, reason: row.rejection_reason, date: row.rejection_on }
        : null,
    }
  }

  // 본인이 기안했거나 결재선에 포함된 품의만 조회할 수 있습니다.
  function visibleRequest(id, user) {
    if (user.position === '교장') return q('SELECT r.* FROM requests r WHERE r.id = ?').get(id)
    return q(
      `SELECT r.* FROM requests r WHERE r.id = ? AND (r.requester_id = ?
         OR EXISTS (SELECT 1 FROM request_steps s WHERE s.request_id = r.id AND s.user_id = ?))`,
    ).get(id, user.id, user.id)
  }

  function logEvent(requestId, actorId, action, detail = null) {
    q('INSERT INTO request_events (request_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(requestId, actorId, action, detail, new Date().toISOString())
  }

  function insertSteps(requestId, steps) {
    const insert = q(
      `INSERT INTO request_steps (request_id, seq, user_id, user_name, user_position, kind, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    steps.forEach((step, index) => insert.run(requestId, index, step.userId, step.name, step.position, step.kind, step.status))
  }

  function insertImages(requestId, images, paymentRowId = null) {
      const insert = q('INSERT INTO attachments (request_id, payment_row_id, name, mime, size_bytes, data) VALUES (?, ?, ?, ?, ?, ?)')
      for (const image of images) insert.run(requestId, paymentRowId, image.name, image.mime, image.data.length, image.data)
  }

  function readNewImages(body, keepCount) {
    const list = body.newAttachments ?? []
    if (!Array.isArray(list)) throw new HttpError(400, '첨부 이미지 형식이 올바르지 않습니다.')
    if (keepCount + list.length > MAX_ATTACHMENTS) {
      throw new HttpError(400, `이미지는 최대 ${MAX_ATTACHMENTS}장까지 첨부할 수 있습니다.`)
    }
    return list.map(decodeImage)
  }

  function normalizePaymentAttachmentInput(value) {
    if (!Array.isArray(value)) return []
    return value
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: Number(item.id) || undefined,
        name: String(item.name ?? '').trim() || '영수증',
        size: Number(item.size) || 0,
        mime: String(item.mime ?? 'image/png'),
        dataUrl: typeof item.dataUrl === 'string' ? item.dataUrl : undefined,
      }))
  }

  app.get('/api/requests', ...ready, (req, res) => {
    // 교장은 교체 이후에도 과거 품의를 모두 열람한다.
    const rows = req.user.position === '교장'
      ? q('SELECT r.* FROM requests r ORDER BY r.id DESC').all()
      : q(
        `SELECT r.* FROM requests r WHERE r.requester_id = ?
           OR EXISTS (SELECT 1 FROM request_steps s WHERE s.request_id = r.id AND s.user_id = ?)
         ORDER BY r.id DESC`,
      ).all(req.user.id, req.user.id)
    res.json({ requests: rows.map(serialize) })
  })

  app.get('/api/requests/:id', ...ready, (req, res) => {
    const row = visibleRequest(toId(req.params.id), req.user)
    if (!row) throw new HttpError(404, '지출품의를 찾을 수 없습니다.')
    res.json({ request: serialize(row) })
  })

  app.get('/api/approval-preview', ...ready, (req, res) => {
    const targetDepartment = typeof req.query.department === 'string' && req.query.department.trim()
      ? cleanText(req.query.department, '기안 대상 소속', { min: 1, max: 50 })
      : req.user.department
    validateTargetDepartment(targetDepartment)
    const steps = buildSteps(db, { ...req.user, department: targetDepartment })
    res.json({ steps: steps.map(({ userId: _userId, status: _status, ...rest }) => rest) })
  })

  app.post('/api/requests', ...ready, bigJson, (req, res) => {
    const body = req.body ?? {}
    const fields = validateRequestFields(body)
    const targetDepartment = typeof body.department === 'string' && body.department.trim()
      ? cleanText(body.department, '기안 대상 소속', { min: 1, max: 50 })
      : req.user.department
    validateTargetDepartment(targetDepartment)
    const budgetFields = body.budget && typeof body.budget === 'object' ? body.budget : null
    const paymentRows = normalizePaymentRows(body.paymentRows)
    const images = readNewImages(body, 0)
    const created = transaction(db, () => {
      const steps = buildSteps(db, { ...req.user, department: targetDepartment })
      const year = today().slice(0, 4)
      const count = q('SELECT COUNT(*) AS n FROM requests WHERE code LIKE ?').get(`EXP-${year}-%`).n
      const code = `EXP-${year}-${String(count + 1).padStart(3, '0')}`
      const result = q(
        `INSERT INTO requests (code, title, category, amount, memo, requester_id, department, requested_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(code, fields.title, fields.category, fields.amount, fields.memo, req.user.id, targetDepartment, today())
      const id = Number(result.lastInsertRowid)
      reserveBudgetForRequest(db, id, targetDepartment, budgetFields, fields.amount)
      savePaymentRows(db, id, paymentRows)
      insertSteps(id, steps)
      insertImages(id, images)
      logEvent(id, req.user.id, '상신')
      return id
    })
    res.status(201).json({ request: serialize(q('SELECT * FROM requests WHERE id = ?').get(created)) })
  })

  app.post('/api/requests/:id/resubmit', ...ready, bigJson, (req, res) => {
    const row = visibleRequest(toId(req.params.id), req.user)
    if (!row) throw new HttpError(404, '지출품의를 찾을 수 없습니다.')
    const current = serialize(row)
    if (row.requester_id !== req.user.id) throw new HttpError(403, '기안자만 재상신할 수 있습니다.')
    if (current.status !== '반려') throw new HttpError(409, '반려된 품의만 재상신할 수 있습니다.')

    const body = req.body ?? {}
    const fields = validateRequestFields(body)
    const targetDepartment = typeof body.department === 'string' && body.department.trim()
      ? cleanText(body.department, '기안 대상 소속', { min: 1, max: 50 })
      : req.user.department
    validateTargetDepartment(targetDepartment)
    const budgetFields = body.budget && typeof body.budget === 'object' ? body.budget : null
    const paymentRows = normalizePaymentRows(body.paymentRows)
    const keepIds = Array.isArray(body.keepAttachmentIds) ? body.keepAttachmentIds : []
    const existing = new Set(current.attachments.map((item) => item.id))
    if (!keepIds.every((id) => existing.has(id))) throw new HttpError(400, '유지할 첨부 이미지가 올바르지 않습니다.')
    const keep = new Set(keepIds)
    const images = readNewImages(body, keep.size)

    transaction(db, () => {
      const priorAllocation = db.prepare('SELECT requested_amount FROM request_budget_allocations WHERE request_id = ?').get(row.id)
      if (priorAllocation) {
        restoreBudgetForRequest(db, row.id, row.department, body.budget && typeof body.budget === 'object' ? body.budget : null, priorAllocation.requested_amount)
      }
      const steps = buildSteps(db, { ...req.user, department: targetDepartment })
      q(
        `UPDATE requests SET title = ?, category = ?, amount = ?, memo = ?, department = ?, requested_on = ?,
           rejection_by = NULL, rejection_reason = NULL, rejection_on = NULL WHERE id = ?`,
      ).run(fields.title, fields.category, fields.amount, fields.memo, targetDepartment, today(), row.id)
      q('DELETE FROM request_steps WHERE request_id = ?').run(row.id)
      reserveBudgetForRequest(db, row.id, targetDepartment, budgetFields, fields.amount)
      savePaymentRows(db, row.id, paymentRows)
      insertSteps(row.id, steps)
      for (const item of current.attachments) {
        if (!keep.has(item.id)) q('DELETE FROM attachments WHERE id = ?').run(item.id)
      }
      insertImages(row.id, images)
      logEvent(row.id, req.user.id, '재상신')
    })
    res.json({ request: serialize(q('SELECT * FROM requests WHERE id = ?').get(row.id)) })
  })

  app.post('/api/requests/:id/decision', ...ready, smallJson, (req, res) => {
    const row = visibleRequest(toId(req.params.id), req.user)
    if (!row) throw new HttpError(404, '지출품의를 찾을 수 없습니다.')
    const body = req.body ?? {}
    if (body.action !== 'approve' && body.action !== 'reject') throw new HttpError(400, '처리 구분이 올바르지 않습니다.')
    const reason = body.action === 'reject' ? cleanText(body.reason, '반려 사유', { min: 1, max: 300 }) : null

    transaction(db, () => {
      const step = q("SELECT * FROM request_steps WHERE request_id = ? AND status = '결재 중'").get(row.id)
      if (!step || step.user_id !== req.user.id) throw new HttpError(403, '현재 처리할 차례가 아닙니다.')
      const decided = body.action === 'approve' ? '승인' : '반려'
      q('UPDATE request_steps SET status = ?, decided_on = ? WHERE id = ?').run(decided, today(), step.id)
      if (decided === '승인') {
        const nextStep = q('SELECT * FROM request_steps WHERE request_id = ? AND seq = ?').get(row.id, step.seq + 1)
        if (nextStep) {
          q("UPDATE request_steps SET status = '결재 중' WHERE id = ?").run(nextStep.id)
        }
        const allocation = getDepartmentBudgetAllocation(db, row.id)
        if (allocation) {
          const nextApprovedAmount = step.kind === '행정실장 지출처리' ? row.amount : asNumber(allocation.allocation.approved_amount, 0)
          updateBudgetAllocationStatus(db, row.id, step.kind === '행정실장 지출처리' ? 'approved' : 'pending', nextApprovedAmount)
        }
      } else {
        const allocation = getDepartmentBudgetAllocation(db, row.id)
        if (allocation) {
          restoreBudgetForRequest(db, row.id, allocation.department, allocation.fields, asNumber(allocation.allocation.requested_amount, 0))
        }
        q('UPDATE requests SET rejection_by = ?, rejection_reason = ?, rejection_on = ? WHERE id = ?')
          .run(req.user.name, reason, today(), row.id)
      }
      const action = decided === '반려' ? '반려' : step.kind === '교장 결재' ? '승인' : '승인'
      logEvent(row.id, req.user.id, action, reason)
    })
    res.json({ request: serialize(q('SELECT * FROM requests WHERE id = ?').get(row.id)) })
  })

  app.get('/api/attachments/:id', ...ready, (req, res) => {
    const item = q('SELECT * FROM attachments WHERE id = ?').get(toId(req.params.id))
    if (!item || !visibleRequest(item.request_id, req.user)) throw new HttpError(404, '첨부 이미지를 찾을 수 없습니다.')
    res.set({
      'Content-Type': item.mime,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=300',
    })
    res.send(Buffer.from(item.data))
  })

  app.use('/api', (_req, _res, next) => next(new HttpError(404, '찾을 수 없습니다.')))

  // ---- 화면 정적 파일 (운영) ----
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    const csp = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    app.use(express.static(staticDir, { index: false, setHeaders: (res) => res.set('Content-Security-Policy', csp) }))
    app.get('/{*splat}', (_req, res) => {
      res.set('Content-Security-Policy', csp)
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, code: error.code })
    }
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: '요청 크기가 너무 큽니다.' })
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' })
    console.error(error)
    res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' })
  })

  return app
}
