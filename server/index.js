import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { openDatabase, today } from './db.js'
import { hashPassword } from './security.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = openDatabase(process.env.DATABASE_FILE ?? path.join(root, 'data', 'app.db'))

async function purgeCorruptedUsers() {
  const invalidIds = db.prepare(`
    SELECT id FROM users
    WHERE instr(COALESCE(name, ''), '?') > 0
       OR instr(COALESCE(department, ''), '?') > 0
       OR instr(COALESCE(position, ''), '?') > 0
       OR instr(COALESCE(email, ''), '?') > 0
       OR name IS NULL
       OR TRIM(COALESCE(name, '')) = ''
       OR TRIM(COALESCE(department, '')) = ''
       OR TRIM(COALESCE(position, '')) = ''
  `).all().map((row) => row.id)

  if (invalidIds.length === 0) {
    return
  }

  const placeholders = invalidIds.map(() => '?').join(', ')

  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.prepare(`DELETE FROM request_steps WHERE user_id IN (${placeholders})`).run(...invalidIds)
    db.prepare(`DELETE FROM request_events WHERE actor_id IN (${placeholders})`).run(...invalidIds)

    const requestIds = db.prepare(`SELECT id FROM requests WHERE requester_id IN (${placeholders})`).all(...invalidIds).map((row) => row.id)
    if (requestIds.length > 0) {
      const requestPlaceholders = requestIds.map(() => '?').join(', ')
      db.prepare(`DELETE FROM request_steps WHERE request_id IN (${requestPlaceholders})`).run(...requestIds)
      db.prepare(`DELETE FROM request_events WHERE request_id IN (${requestPlaceholders})`).run(...requestIds)
      db.prepare(`DELETE FROM attachments WHERE request_id IN (${requestPlaceholders})`).run(...requestIds)
      db.prepare(`DELETE FROM requests WHERE requester_id IN (${placeholders})`).run(...invalidIds)
    }

    db.prepare(`DELETE FROM sessions WHERE user_id IN (${placeholders})`).run(...invalidIds)
    db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...invalidIds)
    console.log(`오염된 사용자 데이터 ${invalidIds.length}건을 정리했습니다.`)
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

async function ensureStablePrincipal() {
  const defaultPassword = 'gyver0979'
  const passwordHash = await hashPassword(defaultPassword)
  const principalRows = db.prepare(
    `SELECT * FROM users WHERE (email = ? OR name = ? OR position = '교장' OR department = '교장') ORDER BY id`,
  ).all('secheonio@gmail.com', '박세천')

  const principal = principalRows.find((row) => row.email === 'secheonio@gmail.com' || row.name === '박세천') ?? principalRows[0] ?? null

  if (!principal) {
    db.prepare(
      `INSERT INTO users (email, name, department, position, password_hash, must_change_password, active, created_at)
       VALUES (?, ?, '교장', '교장', ?, 0, 1, ?)`
    ).run('secheonio@gmail.com', '박세천', passwordHash, today())
    console.log(`기본 교장 계정 생성: 박세천 / ${defaultPassword}`)
    return
  }

  const needsUpdate = principal.name !== '박세천'
    || principal.email !== 'secheonio@gmail.com'
    || principal.department !== '교장'
    || principal.position !== '교장'
    || principal.must_change_password !== 0
    || principal.password_hash === null

  if (needsUpdate) {
    db.prepare(
      `UPDATE users
       SET name = ?, email = ?, department = ?, position = ?, password_hash = ?, must_change_password = 0, active = 1
       WHERE id = ?`
    ).run('박세천', 'secheonio@gmail.com', '교장', '교장', passwordHash, principal.id)
    console.log('기존 교장 계정을 박세천 기준으로 정렬했습니다.')
  }

  for (const row of principalRows) {
    if (row.id !== principal.id) {
      db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(row.id)
    }
  }
}

async function ensureSeedUsers() {
  const defaultPassword = 'sophia00'
  const seedUsers = [
    { name: '남이숙', email: 'namisuk@school.local', department: '행정실', position: '행정실장' },
    { name: '양혜련', email: 'yanghyerin@school.local', department: '기초과정', position: '기관장' },
    { name: '이수영', email: 'leesuyeong@school.local', department: '전형위원회', position: '기관장' },
    { name: '유하정', email: 'yuhajeong@school.local', department: '본과정', position: '기관장' },
    { name: '강대형', email: 'kangdaeyoung@school.local', department: '생활교육부', position: '기관장' },
    { name: '임은혁', email: 'imeunchul@school.local', department: '교무부', position: '기관장' },
    { name: '최지은', email: 'chojieun@school.local', department: '교육과정연구부', position: '기관장' },
    { name: '문숙영', email: 'moonsookyoung@school.local', department: '심화과정', position: '기관장' },
    { name: '고석수', email: 'goseoksu@school.local', department: '생활관', position: '기관장' },
    { name: '박미숙', email: 'parkmisuk@school.local', department: '기초과정', position: '기안자' },
    { name: '김정진', email: 'kimjeongjin@school.local', department: '본과정', position: '기안자' },
    { name: '박영주', email: 'parkyoungju@school.local', department: '심화과정', position: '기안자' },
    { name: '박숙희', email: 'parksukhee@school.local', department: '생활교육부', position: '기안자' },
    { name: '박상희', email: 'parksanghee@school.local', department: '교무부', position: '기안자' },
    { name: '윤정근', email: 'yoonjeonggeun@school.local', department: '교육과정연구부', position: '기안자' },
    { name: '이남옥', email: 'leenamok@school.local', department: '델포이', position: '기안자' },
    { name: '박영주2', email: 'parkyoungju2@school.local', department: '생활관', position: '기안자' },
  ]

  for (const entry of seedUsers) {
    const existing = db.prepare('SELECT * FROM users WHERE email = ? OR name = ? ORDER BY id LIMIT 1').get(entry.email, entry.name)
    const passwordHash = await hashPassword(entry.position === '교장' ? 'gyver0979' : defaultPassword)
    const departmentValue = JSON.stringify([entry.department])
    const positionValue = JSON.stringify([entry.position])
    const shouldSetPassword = entry.position === '교장' ? 0 : 1

    if (existing) {
      db.prepare(`
        UPDATE users
        SET email = ?, name = ?, department = ?, position = ?, departments = ?, positions = ?, password_hash = ?, must_change_password = ?, active = 1
        WHERE id = ?
      `).run(entry.email, entry.name, entry.department, entry.position, departmentValue, positionValue, passwordHash, shouldSetPassword, existing.id)
    } else {
      db.prepare(`
        INSERT INTO users (email, name, department, position, departments, positions, password_hash, must_change_password, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(entry.email, entry.name, entry.department, entry.position, departmentValue, positionValue, passwordHash, shouldSetPassword, today())
    }
  }
}

const DEFAULT_BUDGET_CATALOG = {
  기초과정: [
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '교구비', 내역: '기초과정 실습 교구', 예산총액: 5000000, 예산잔액: 5000000, 집행률: 0 },
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '미술재료비', 내역: '기초과정 미술활동 재료', 예산총액: 5000000, 예산잔액: 5000000, 집행률: 0 },
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '생태수업비', 내역: '기초과정 생태교육 운영', 예산총액: 5000000, 예산잔액: 5000000, 집행률: 0 },
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '체육교구비', 내역: '기초과정 체육활동 교구', 예산총액: 5000000, 예산잔액: 5000000, 집행률: 0 },
  ],
  본과정: [
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '교과교재비', 내역: '본과정 교과자료 제작', 예산총액: 6000000, 예산잔액: 6000000, 집행률: 0 },
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '실습재료비', 내역: '본과정 실습재료 구매', 예산총액: 6000000, 예산잔액: 6000000, 집행률: 0 },
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '학습보조재료', 내역: '본과정 학습보조 자료', 예산총액: 6000000, 예산잔액: 6000000, 집행률: 0 },
  ],
  심화과정: [
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '심화프로그램비', 내역: '심화과정 프로그램 운영', 예산총액: 7000000, 예산잔액: 7000000, 집행률: 0 },
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '전시기획비', 내역: '심화과정 전시/발표 준비', 예산총액: 7000000, 예산잔액: 7000000, 집행률: 0 },
    { 관: '교육활동비', 항: '교과 및 재량비', 목: '교재 및 교구비', 세목: '실험재료비', 내역: '심화과정 실험재료 구매', 예산총액: 7000000, 예산잔액: 7000000, 집행률: 0 },
  ],
  교무부: [
    { 관: '교육행정비', 항: '업무운영비', 목: '교육행정', 세목: '회의비', 내역: '교무부 회의 운영비', 예산총액: 4500000, 예산잔액: 4500000, 집행률: 0 },
    { 관: '교육행정비', 항: '업무운영비', 목: '교육행정', 세목: '문서관리비', 내역: '교무부 문서 및 자료 제작', 예산총액: 4500000, 예산잔액: 4500000, 집행률: 0 },
    { 관: '교육행정비', 항: '업무운영비', 목: '교육행정', 세목: '교직원교육비', 내역: '교무부 연수 및 교육비', 예산총액: 4500000, 예산잔액: 4500000, 집행률: 0 },
  ],
  교육과정연구부: [
    { 관: '교육활동비', 항: '연구개발비', 목: '교육과정개발', 세목: '연구수당', 내역: '교육과정연구부 연구 운영', 예산총액: 5000000, 예산잔액: 5000000, 집행률: 0 },
    { 관: '교육활동비', 항: '연구개발비', 목: '교육과정개발', 세목: '프로그램개발비', 내역: '교육과정 개선 프로그램 개발', 예산총액: 5000000, 예산잔액: 5000000, 집행률: 0 },
    { 관: '교육활동비', 항: '연구개발비', 목: '교육과정개발', 세목: '평가운영비', 내역: '교육과정 평가 및 분석', 예산총액: 5000000, 예산잔액: 5000000, 집행률: 0 },
  ],
  생활교육부: [
    { 관: '교육활동비', 항: '학생활동비', 목: '생활교육', 세목: '학생활동지원비', 내역: '생활교육부 학생활동 지원', 예산총액: 4200000, 예산잔액: 4200000, 집행률: 0 },
    { 관: '교육활동비', 항: '학생활동비', 목: '생활교육', 세목: '봉사활동비', 내역: '생활교육부 봉사활동 운영', 예산총액: 4200000, 예산잔액: 4200000, 집행률: 0 },
    { 관: '교육활동비', 항: '학생활동비', 목: '생활교육', 세목: '문화프로그램비', 내역: '생활교육부 문화프로그램 운영', 예산총액: 4200000, 예산잔액: 4200000, 집행률: 0 },
  ],
  생활관: [
    { 관: '학생복지비', 항: '생활관리비', 목: '생활관운영', 세목: '식비', 내역: '생활관 식재료 구매', 예산총액: 9000000, 예산잔액: 9000000, 집행률: 0 },
    { 관: '학생복지비', 항: '생활관리비', 목: '생활관운영', 세목: '청소용품비', 내역: '생활관 청소 및 관리', 예산총액: 9000000, 예산잔액: 9000000, 집행률: 0 },
    { 관: '학생복지비', 항: '생활관리비', 목: '생활관운영', 세목: '안전관리비', 내역: '생활관 안전관리 소모품', 예산총액: 9000000, 예산잔액: 9000000, 집행률: 0 },
  ],
  전형위원회: [
    { 관: '교육행정비', 항: '전형운영비', 목: '전형운영', 세목: '전형자료비', 내역: '전형위원회 전형 자료 제작', 예산총액: 3000000, 예산잔액: 3000000, 집행률: 0 },
    { 관: '교육행정비', 항: '전형운영비', 목: '전형운영', 세목: '심사비', 내역: '전형위원회 심사운영비', 예산총액: 3000000, 예산잔액: 3000000, 집행률: 0 },
    { 관: '교육행정비', 항: '전형운영비', 목: '전형운영', 세목: '보안관리비', 내역: '전형위원회 보안 및 관리비', 예산총액: 3000000, 예산잔액: 3000000, 집행률: 0 },
  ],
  델포이: [
    { 관: '교육활동비', 항: '프로그램운영비', 목: '델포이운영', 세목: '프로그램비', 내역: '델포이 프로그램 운영비', 예산총액: 5200000, 예산잔액: 5200000, 집행률: 0 },
    { 관: '교육활동비', 항: '프로그램운영비', 목: '델포이운영', 세목: '운영재료비', 내역: '델포이 프로그램 재료비', 예산총액: 5200000, 예산잔액: 5200000, 집행률: 0 },
    { 관: '교육활동비', 항: '프로그램운영비', 목: '델포이운영', 세목: '시설관리비', 내역: '델포이 시설 유지보수', 예산총액: 5200000, 예산잔액: 5200000, 집행률: 0 },
  ],
  행정실: [
    { 관: '관리운영비', 항: '행정업무비', 목: '행정실운영', 세목: '소모품비', 내역: '행정실 소모품 및 사무용품', 예산총액: 8000000, 예산잔액: 8000000, 집행률: 0 },
    { 관: '관리운영비', 항: '행정업무비', 목: '행정실운영', 세목: '사무용기기비', 내역: '행정실 장비 및 소모품 구매', 예산총액: 8000000, 예산잔액: 8000000, 집행률: 0 },
    { 관: '관리운영비', 항: '행정업무비', 목: '행정실운영', 세목: '업무지원비', 내역: '행정실 업무지원 및 협조비', 예산총액: 8000000, 예산잔액: 8000000, 집행률: 0 },
  ],
}

async function ensureBudgetCatalog() {
  const budgetDepartments = Object.keys(DEFAULT_BUDGET_CATALOG)
  for (const department of budgetDepartments) {
    const existing = db.prepare('SELECT rows_json FROM budget_master WHERE department = ?').get(department)
    if (!existing) {
      db.prepare('INSERT INTO budget_master (department, rows_json, updated_at) VALUES (?, ?, ?)')
        .run(department, JSON.stringify(DEFAULT_BUDGET_CATALOG[department]), today())
    }
  }
}

async function bootstrapDatabase() {
  await purgeCorruptedUsers()
  await ensureStablePrincipal()
  await ensureSeedUsers()
  await ensureBudgetCatalog()
}

await bootstrapDatabase()

const production = process.env.NODE_ENV === 'production'

const app = createApp(db, {
  secureCookie: production,
  trustProxy: process.env.TRUST_PROXY === '1',
  staticDir: path.join(root, 'dist'),
})

const port = Number(process.env.PORT ?? 3002)
const host = process.env.HOST ?? '127.0.0.1'
app.listen(port, host, () => {
  console.log(`지출품의 서버: http://${host}:${port}${production ? ' (운영 모드: HTTPS 필수)' : ''}`)
})
