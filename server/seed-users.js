import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, today } from './db.js'
import { hashPassword } from './security.js'
import { validateEmail } from './rules.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = openDatabase(path.join(root, 'data', 'app.db'))

const defaultPassword = 'sophia00'

const users = [
  { name: '박세천', email: 'secheonio@gmail.com', department: '교장', position: '교장' },
  { name: '남이숙', email: 'namisuk@school.local', department: '행정실', position: '행정실장' },
  { name: '양혜련', email: 'yanghyerin@school.local', department: '기초과정', position: '기관장' },
  { name: '이수영', email: 'leesuyeong@school.local', department: '전형위원회', position: '기관장' },
  { name: '유화정', email: 'yuhajeong@school.local', department: '본과정', position: '기관장' },
  { name: '강대형', email: 'kangdaeyoung@school.local', department: '생활교육부', position: '기관장' },
  { name: '임은혁', email: 'imeunchul@school.local', department: '교무부', position: '기관장' },
  { name: '최지은', email: 'chojieun@school.local', department: '교육과정연구부', position: '기관장' },
  { name: '문숙영', email: 'moonsookyoung@school.local', department: '심화과정', position: '기관장' },
  { name: '고석수', email: 'goseoksu@school.local', department: '생활관', position: '기관장' },
  { name: '박미숙', email: 'parkmisuk@school.local', department: '기초과정', position: '기안자' },
  { name: '강정진', email: 'kimjeongjin@school.local', department: '본과정', position: '기안자' },
  { name: '박영주', email: 'parkyoungju@school.local', department: '심화과정', position: '기안자' },
  { name: '박숙희', email: 'parksukhee@school.local', department: '생활교육부', position: '기안자' },
  { name: '박상희', email: 'parksanghee@school.local', department: '교무부', position: '기안자' },
  { name: '윤정근', email: 'yoonjeonggeun@school.local', department: '교육과정연구부', position: '기안자' },
  { name: '이남옥', email: 'leenamok@school.local', department: '델포이', position: '기안자' },
  { name: '박영주2', email: 'parkyoungju2@school.local', department: '생활관', position: '기안자' },
]

async function upsertUser(entry) {
  const email = validateEmail(entry.email)
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  const passwordValue = entry.position === '교장' ? 'gyver0979' : defaultPassword
  const passwordHash = await hashPassword(passwordValue)

  if (existing) {
    db.prepare(`
      UPDATE users
      SET name = ?, department = ?, position = ?, password_hash = ?, must_change_password = ?, active = 1
      WHERE id = ?
    `).run(entry.name, entry.department, entry.position, passwordHash, entry.position === '교장' ? 0 : 1, existing.id)
    return existing.id
  }

  const result = db.prepare(`
    INSERT INTO users (email, name, department, position, password_hash, must_change_password, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(email, entry.name, entry.department, entry.position, passwordHash, entry.position === '교장' ? 0 : 1, today())

  return Number(result.lastInsertRowid)
}

const run = async () => {
  for (const user of users) {
    await upsertUser(user)
  }

  const total = db.prepare('SELECT COUNT(*) AS total FROM users').get().total
  console.log(`기본 사용자 ${total}명이 준비되었습니다.`)
  console.log(`공통 초기 비밀번호: ${defaultPassword}`)
  console.log('교장 계정 비밀번호: gyver0979 (이름은 박세천)')
  console.log('처음 로그인 시 비밀번호를 반드시 변경해야 합니다.')
}

await run()
