// 첫 관리자(교장) 계정을 만듭니다. 사용법: npm run create-admin -- "이름" 이메일
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, today } from './db.js'
import { generateTemporaryPassword, hashPassword } from './security.js'
import { cleanText, validateEmail } from './rules.js'

const [nameArg, emailArg] = process.argv.slice(2)
if (!nameArg || !emailArg) {
  console.error('사용법: npm run create-admin -- "이름" 이메일')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = openDatabase(process.env.DATABASE_FILE ?? path.join(root, 'data', 'app.db'))

if (db.prepare("SELECT 1 FROM users WHERE position = '교장' AND active = 1").get()) {
  console.error('이미 교장(관리자) 계정이 있습니다.')
  process.exit(1)
}

const name = cleanText(nameArg, '이름', { min: 1, max: 30 })
const email = validateEmail(emailArg)
const temporaryPassword = generateTemporaryPassword()
db.prepare(
  `INSERT INTO users (email, name, department, position, password_hash, must_change_password, active, created_at)
   VALUES (?, ?, '교장', '교장', ?, 1, 1, ?)`,
).run(email, name, await hashPassword(temporaryPassword), today())

console.log(`교장 계정을 만들었습니다: ${email}`)
console.log(`임시 비밀번호: ${temporaryPassword}`)
console.log('처음 로그인하면 비밀번호를 바꿔야 합니다. 이 비밀번호는 다시 표시되지 않습니다.')
