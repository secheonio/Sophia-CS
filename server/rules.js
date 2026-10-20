export const DEPARTMENTS = [
  '기초과정', '본과정', '심화과정', '생활교육부', '교무부',
  '교육과정부', '델포이', '생활관', '행정실',
]
export const CATEGORIES = ['교육활동비', '여비교통비', '비품·소모품', '시설·수선비', '복리후생비', '기타']
export const POSITIONS = ['교장', '행정실장', '기관장', '기안자']

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

export function departmentsByPosition() {
  const regular = DEPARTMENTS.filter((department) => department !== ACCOUNTING_DEPARTMENT)
  return {
    교장: [PRINCIPAL_DEPARTMENT],
    행정실장: [ACCOUNTING_DEPARTMENT],
    기관장: regular,
    기안자: regular,
  }
}

export function validateRole(department, position) {
  const allowed = departmentsByPosition()[position]
  if (!allowed) throw new HttpError(400, '올바르지 않은 직책입니다.')
  if (!allowed.includes(department)) {
    throw new HttpError(400, `${position}의 소속으로 선택할 수 없는 부서입니다.`)
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
  const email = cleanText(value, '이메일', { min: 3, max: 120 }).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, '이메일 형식이 올바르지 않습니다.')
  }
  return email
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
  return current?.kind === '지출 처리' ? '지출 대기' : '결재 중'
}

// 기안자 → 담당 기관장 확인 → 교장 최종 결재 → 행정실장 지출 처리
// 기관장·행정실장이 기안하면 기관장 확인을 건너뛰고, 교장이 기안하면 지출 처리만 남습니다.
export function buildSteps(db, requester) {
  const find = (sql, ...params) => db.prepare(sql).get(...params)
  const principal = find("SELECT * FROM users WHERE position = '교장' AND active = 1")
  const accountant = find("SELECT * FROM users WHERE position = '행정실장' AND active = 1")
  if (!principal || !accountant) {
    throw new HttpError(409, '교장 또는 행정실장이 지정되지 않아 결재선을 만들 수 없습니다. 관리자에게 문의해 주세요.')
  }

  const steps = []
  if (requester.position === '기안자') {
    const head = find(
      "SELECT * FROM users WHERE position = '기관장' AND department = ? AND active = 1",
      requester.department,
    )
    if (!head) {
      throw new HttpError(409, `${requester.department}에 기관장이 지정되지 않아 결재선을 만들 수 없습니다. 관리자에게 문의해 주세요.`)
    }
    steps.push({ user: head, kind: '확인 결재' })
  }
  if (requester.position !== '교장') steps.push({ user: principal, kind: '최종 결재' })
  steps.push({ user: accountant, kind: '지출 처리' })

  return steps.map((step, index) => ({
    userId: step.user.id,
    name: step.user.name,
    position: step.user.position,
    kind: step.kind,
    status: index === 0 ? '결재 중' : '대기',
  }))
}
