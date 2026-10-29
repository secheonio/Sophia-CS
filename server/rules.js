export const COURSE_DEPARTMENTS = ['기초과정', '본과정', '심화과정']
export const DEPARTMENT_DEPARTMENTS = ['교무부', '생활교육부', '교육과정연구부']
export const INSTITUTION_DEPARTMENTS = ['행정실', '델포이', '생활관', '도서관', '전형위원회', '기타']
export const DEPARTMENTS = [...COURSE_DEPARTMENTS, ...DEPARTMENT_DEPARTMENTS, ...INSTITUTION_DEPARTMENTS]
export const CATEGORIES = ['교육활동비', '여비교통비', '비품·소모품', '시설·수선비', '복리후생비', '기타']
export const POSITIONS = ['없음', '기안자', '기관장', '교장', '행정실장']

export const PRINCIPAL_DEPARTMENT = '교장'
export const ACCOUNTING_DEPARTMENT = '행정실'
export const MAX_ATTACHMENTS = 5
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_AMOUNT = 1_000_000_000

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function departmentGroup(department) {
  if (COURSE_DEPARTMENTS.includes(department)) return '과정'
  if (DEPARTMENT_DEPARTMENTS.includes(department)) return '부서'
  if (INSTITUTION_DEPARTMENTS.includes(department)) return '기관'
  return null
}

export function departmentsByPosition() {
  const openDepartments = DEPARTMENTS.filter((department) => department !== PRINCIPAL_DEPARTMENT && department !== ACCOUNTING_DEPARTMENT)
  return {
    없음: DEPARTMENTS,
    교장: [PRINCIPAL_DEPARTMENT],
    행정실장: [ACCOUNTING_DEPARTMENT],
    기관장: openDepartments,
    기안자: openDepartments,
  }
}

export function normalizeRoleList(value, fallback = []) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? JSON.parse(value || '[]') : fallback
  if (!Array.isArray(list)) return fallback
  return [...new Set(list.filter((item) => DEPARTMENTS.includes(item) || item === '교장' || item === '행정실'))]
}

export function parseMultiValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [trimmed]
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
    }
  }
  return []
}

export function validateRole(department, position) {
  const allowed = departmentsByPosition()[position]
  if (!allowed) throw new HttpError(400, '올바르지 않은 직책입니다.')
  if (!allowed.includes(department)) {
    if (position === '행정실장' && department === '행정실') return
    if (position === '기관장' && department !== '교장' && department !== '행정실') return
    throw new HttpError(400, `${position}의 소속으로 선택할 수 없는 부서입니다.`)
  }
}

export function validateTargetDepartment(department) {
  if (!DEPARTMENTS.includes(department)) {
    throw new HttpError(400, '기안 대상 소속이 올바르지 않습니다.')
  }
}

export function cleanText(value, label, { min = 0, max }) {
  if (typeof value !== 'string') {
    if (min === 0 && value === undefined) return ''
    throw new HttpError(400, `${label}을(를) 입력해 주세요.`)
  }
  // 제어 문자는 제거하고 줄바꿈만 남깁니다.
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  if (text.length < min) throw new HttpError(400, `${label}을(를) 입력해 주세요.`)
  if (text.length > max) throw new HttpError(400, `${label}은(는) ${max}자 이하로 입력해 주세요.`)
  return text
}

export function validateEmail(value) {
  const email = cleanText(value, '이메일', { min: 1, max: 120 }).toLowerCase()
  if (!email.includes('@')) {
    throw new HttpError(400, '이메일은 @를 포함해야 합니다.')
  }
  return email
}

export function validatePhone(value) {
  const phone = cleanText(value, '전화번호', { min: 10, max: 11 })
  if (!/^\d{10,11}$/.test(phone)) {
    throw new HttpError(400, '전화번호 형식이 올바르지 않습니다. (예: 01012345678)')
  }
  return phone
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpError(400, '비밀번호는 8자 이상 128자 이하로 입력해 주세요.')
  }
  return value
}

const DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/

function matchesSignature(mime, bytes) {
  const startsWith = (...sig) => sig.every((byte, index) => bytes[index] === byte)
  if (mime === 'image/png') return startsWith(0x89, 0x50, 0x4e, 0x47)
  if (mime === 'image/jpeg') return startsWith(0xff, 0xd8, 0xff)
  if (mime === 'image/gif') return startsWith(0x47, 0x49, 0x46, 0x38)
  if (mime === 'image/webp') {
    return startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  }
  return false
}

export function decodeImage(item) {
  const name = cleanText(item?.name, '파일 이름', { min: 1, max: 100 })
  const dataUrl = item?.dataUrl
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 64) {
    throw new HttpError(400, `${name}: 5MB 이하의 이미지만 첨부할 수 있습니다.`)
  }
  const match = DATA_URL.exec(dataUrl)
  if (!match) throw new HttpError(400, `${name}: PNG, JPEG, GIF, WebP 이미지만 첨부할 수 있습니다.`)
  const data = Buffer.from(match[2], 'base64')
  if (data.length === 0 || data.length > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(400, `${name}: 5MB 이하의 이미지만 첨부할 수 있습니다.`)
  }
  if (!matchesSignature(match[1], data)) {
    throw new HttpError(400, `${name}: 이미지 파일 형식이 올바르지 않습니다.`)
  }
  return { name, mime: match[1], data }
}

export function validateRequestFields(body) {
  const amount = body.amount
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
    throw new HttpError(400, `금액은 1원 이상 ${MAX_AMOUNT.toLocaleString('ko-KR')}원 이하의 정수로 입력해 주세요.`)
  }
  if (!CATEGORIES.includes(body.category)) throw new HttpError(400, '비용 항목이 올바르지 않습니다.')
  return {
    title: cleanText(body.title, '품의 제목', { min: 1, max: 80 }),
    category: body.category,
    amount,
    memo: cleanText(body.memo ?? '', '사용 목적', { max: 500 }),
  }
}

export function deriveStatus(steps) {
  if (steps.some((step) => step.status === '반려')) return '반려'
  if (steps.every((step) => step.status === '승인')) return '지출 완료'
  const current = steps.find((step) => step.status === '결재 중')
  if (!current) return '결재 중'
  const paymentKinds = new Set([
    '행정실장 지출처리',
    '행정실장(지출처리)',
    '지출 처리',
    '교장 결재, 지출처리 요청',
  ])
  return paymentKinds.has(current.kind) ? '지출 대기' : '결재 중'
}

// 기안자 → 선택한 소속의 장 결재 → 행정실장(교장 결재 대기중) → 교장 결재 → 행정실장 지출처리
// 행정실장은 경유 단계에서 결재선을 잠시 보관하고, 교장 결재 후 최종 지출 처리 담당으로 이어진다.
export function buildSteps(db, requester) {
  const targetDepartment = requester.department
  const route = resolveApprovalUsers(db, targetDepartment)
  const active = route.filter((step) => step.user)
  if (targetDepartment !== '교장' && targetDepartment !== '행정실' && !active.some((step) => step.role === '기관장')) {
    throw new HttpError(409, `${targetDepartment}에 소속장이 지정되지 않아 결재선을 만들 수 없습니다. 관리자에게 문의해 주세요.`)
  }

  if (active.length === 0) {
    throw new HttpError(409, '결재선을 만들 수 없습니다. 관리자에게 문의해 주세요.')
  }

  return active.map((step, index) => ({
    userId: step.user.id,
    name: step.user.name,
    position: step.user.position,
    kind: step.kind,
    status: index === 0 ? '결재 중' : '대기',
  }))
}

export function getApprovalRouteTemplate(db, department) {
  const rows = db.prepare(
    'SELECT seq, role, kind FROM approval_routes WHERE department = ? ORDER BY seq ASC',
  ).all(department)
  if (!rows.length) {
    return [
      { seq: 0, role: '기관장', kind: '소속장 결재' },
      { seq: 1, role: '행정실장', kind: '교장 결재 대기중' },
      { seq: 2, role: '교장', kind: '교장 결재' },
      { seq: 3, role: '행정실장', kind: '행정실장 지출처리' },
    ]
  }
  return rows
}

export function resolveApprovalUsers(db, department) {
  const route = getApprovalRouteTemplate(db, department)
  return route.map((step) => {
    const role = step.role
    if (role === '교장') {
      const user = db.prepare("SELECT * FROM users WHERE position = '교장' AND active = 1 ORDER BY id LIMIT 1").get()
      return { ...step, user }
    }
    if (role === '행정실장') {
      const user = db.prepare("SELECT * FROM users WHERE position = '행정실장' AND active = 1 ORDER BY id LIMIT 1").get()
      return { ...step, user }
    }
    const user = db.prepare(
      `SELECT u.*
       FROM user_departments ud
       JOIN users u ON u.id = ud.user_id
       WHERE ud.department = ? AND ud.role = '기관장' AND ud.is_active = 1 AND u.active = 1
       ORDER BY u.id
       LIMIT 1`,
    ).get(department) ?? db.prepare("SELECT * FROM users WHERE department = ? AND position = '기관장' AND active = 1 ORDER BY id LIMIT 1").get(department)
    return { ...step, user }
  })
}
