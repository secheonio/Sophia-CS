import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { transaction, today } from './db.js'
import {
  CATEGORIES, DEPARTMENTS, HttpError, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, POSITIONS,
  buildSteps, cleanText, decodeImage, departmentsByPosition, deriveStatus,
  validateEmail, validatePassword, validateRequestFields, validateRole,
} from './rules.js'
import {
  DUMMY_HASH, createLoginLimiter, generateTemporaryPassword, hashPassword,
  newSessionToken, readCookie, sha256, verifyPassword,
} from './security.js'

const SESSION_MS = 12 * 60 * 60 * 1000
const COOKIE_NAME = 'sid'
const BIG_JSON_LIMIT = '40mb'

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    department: user.department,
    position: user.position,
    mustChangePassword: Boolean(user.must_change_password),
    active: Boolean(user.active),
  }
}

function toId(value) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, '찾을 수 없습니다.')
  return id
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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.get('origin')
      if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
        return next(new HttpError(403, '허용되지 않은 요청 출처입니다.'))
      }
      if (!req.is('application/json')) return next(new HttpError(415, 'JSON 형식의 요청만 받을 수 있습니다.'))
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
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const emailKey = `e:${email}`
    const keys = [emailKey, `i:${req.ip}`]
    if (limiter.blocked(keys)) throw new HttpError(429, '로그인 시도가 너무 많습니다. 10분 후 다시 시도해 주세요.')

    const user = q('SELECT * FROM users WHERE email = ?').get(email)
    const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH)
    if (!user || !user.active || !valid) {
      limiter.fail(keys)
      throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.')
    }
    limiter.reset([emailKey])
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
    if (!(await verifyPassword(body.currentPassword, req.user.password_hash))) {
      throw new HttpError(400, '현재 비밀번호가 올바르지 않습니다.')
    }
    const next = validatePassword(body.newPassword)
    if (next === body.currentPassword) throw new HttpError(400, '새 비밀번호는 현재 비밀번호와 달라야 합니다.')
    const hash = await hashPassword(next)
    q('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.user.id)
    q('DELETE FROM sessions WHERE user_id = ?').run(req.user.id)
    startSession(res, req.user.id)
    res.json({ user: publicUser({ ...req.user, must_change_password: 0 }) })
  })

  app.get('/api/meta', ...ready, (_req, res) => {
    res.json({
      departments: DEPARTMENTS,
      categories: CATEGORIES,
      positions: POSITIONS,
      departmentsByPosition: departmentsByPosition(),
      maxAttachments: MAX_ATTACHMENTS,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
    })
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
    const email = validateEmail(body.email)
    validateRole(body.department, body.position)
    const temporaryPassword = generateTemporaryPassword()
    const hash = await hashPassword(temporaryPassword)
    try {
      const result = q(
        `INSERT INTO users (email, name, department, position, password_hash, must_change_password, active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
      ).run(email, name, body.department, body.position, hash, today())
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
    const next = {
      name: body.name === undefined ? target.name : cleanText(body.name, '이름', { min: 1, max: 30 }),
      department: body.department ?? target.department,
      position: body.position ?? target.position,
      active: body.active === undefined ? Boolean(target.active) : body.active === true,
    }
    if (body.active !== undefined && typeof body.active !== 'boolean') throw new HttpError(400, '상태 값이 올바르지 않습니다.')
    validateRole(next.department, next.position)

    const roleChanged =
      next.department !== target.department || next.position !== target.position || next.active !== Boolean(target.active)
    if (roleChanged && target.id === req.user.id) {
      throw new HttpError(400, '본인의 소속·직책·사용 상태는 변경할 수 없습니다.')
    }
    if (roleChanged && hasPendingSteps(target.id)) {
      throw new HttpError(409, '결재 중인 품의가 있어 소속·직책·사용 상태를 변경할 수 없습니다. 결재가 끝난 뒤 변경해 주세요.')
    }
    try {
      q('UPDATE users SET name = ?, department = ?, position = ?, active = ? WHERE id = ?')
        .run(next.name, next.department, next.position, next.active ? 1 : 0, target.id)
    } catch (error) {
      throw translateConflict(error)
    }
    if (!next.active) q('DELETE FROM sessions WHERE user_id = ?').run(target.id)
    res.json({ user: publicUser(q('SELECT * FROM users WHERE id = ?').get(target.id)) })
  })

  app.post('/api/users/:id/reset-password', ...ready, requireAdmin, smallJson, async (req, res) => {
    const target = q('SELECT * FROM users WHERE id = ?').get(toId(req.params.id))
    if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.')
    const temporaryPassword = generateTemporaryPassword()
    q('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(await hashPassword(temporaryPassword), target.id)
    q('DELETE FROM sessions WHERE user_id = ?').run(target.id)
    res.json({ temporaryPassword })
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
      rejection: row.rejection_reason
        ? { by: row.rejection_by, reason: row.rejection_reason, date: row.rejection_on }
        : null,
    }
  }

  // 본인이 기안했거나 결재선에 포함된 품의만 조회할 수 있습니다.
  function visibleRequest(id, user) {
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

  function insertImages(requestId, images) {
    const insert = q('INSERT INTO attachments (request_id, name, mime, data) VALUES (?, ?, ?, ?)')
    for (const image of images) insert.run(requestId, image.name, image.mime, image.data)
  }

  function readNewImages(body, keepCount) {
    const list = body.newAttachments ?? []
    if (!Array.isArray(list)) throw new HttpError(400, '첨부 이미지 형식이 올바르지 않습니다.')
    if (keepCount + list.length > MAX_ATTACHMENTS) {
      throw new HttpError(400, `이미지는 최대 ${MAX_ATTACHMENTS}장까지 첨부할 수 있습니다.`)
    }
    return list.map(decodeImage)
  }

  app.get('/api/requests', ...ready, (req, res) => {
    const rows = q(
      `SELECT r.* FROM requests r WHERE r.requester_id = ?
         OR EXISTS (SELECT 1 FROM request_steps s WHERE s.request_id = r.id AND s.user_id = ?)
       ORDER BY r.id DESC`,
    ).all(req.user.id, req.user.id)
    res.json({ requests: rows.map(serialize) })
  })

  app.get('/api/approval-preview', ...ready, (req, res) => {
    const steps = buildSteps(db, req.user)
    res.json({ steps: steps.map(({ userId: _userId, status: _status, ...rest }) => rest) })
  })

  app.post('/api/requests', ...ready, bigJson, (req, res) => {
    const body = req.body ?? {}
    const fields = validateRequestFields(body)
    const images = readNewImages(body, 0)
    const created = transaction(db, () => {
      const steps = buildSteps(db, req.user)
      const year = today().slice(0, 4)
      const count = q('SELECT COUNT(*) AS n FROM requests WHERE code LIKE ?').get(`EXP-${year}-%`).n
      const code = `EXP-${year}-${String(count + 1).padStart(3, '0')}`
      const result = q(
        `INSERT INTO requests (code, title, category, amount, memo, requester_id, department, requested_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(code, fields.title, fields.category, fields.amount, fields.memo, req.user.id, req.user.department, today())
      const id = Number(result.lastInsertRowid)
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
    const keepIds = Array.isArray(body.keepAttachmentIds) ? body.keepAttachmentIds : []
    const existing = new Set(current.attachments.map((item) => item.id))
    if (!keepIds.every((id) => existing.has(id))) throw new HttpError(400, '유지할 첨부 이미지가 올바르지 않습니다.')
    const keep = new Set(keepIds)
    const images = readNewImages(body, keep.size)

    transaction(db, () => {
      const steps = buildSteps(db, req.user)
      q(
        `UPDATE requests SET title = ?, category = ?, amount = ?, memo = ?, department = ?, requested_on = ?,
           rejection_by = NULL, rejection_reason = NULL, rejection_on = NULL WHERE id = ?`,
      ).run(fields.title, fields.category, fields.amount, fields.memo, req.user.department, today(), row.id)
      q('DELETE FROM request_steps WHERE request_id = ?').run(row.id)
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
        q("UPDATE request_steps SET status = '결재 중' WHERE request_id = ? AND seq = ?").run(row.id, step.seq + 1)
      } else {
        q('UPDATE requests SET rejection_by = ?, rejection_reason = ?, rejection_on = ? WHERE id = ?')
          .run(req.user.name, reason, today(), row.id)
      }
      const action = decided === '반려' ? '반려' : step.kind === '지출 처리' ? '지출 완료' : '승인'
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
    const csp = "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
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
