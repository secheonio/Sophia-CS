// 첫 관리자(교장) 계정을 만듭니다. 사용법: npm run create-admin -- "이름" 이메일
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { openDatabase, today } from './db.js'
import { generateTemporaryPassword, hashPassword } from './security.js'
import { cleanText, validateEmail, validatePassword } from './rules.js'

const [nameArg, emailArg] = process.argv.slice(2)
if ((!nameArg || !emailArg) && !process.env.DEFAULT_ADMIN_NAME && !process.env.DEFAULT_ADMIN_EMAIL) {
  console.error('사용법: npm run create-admin -- "이름" 이메일')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = openDatabase(process.env.DATABASE_FILE ?? path.join(root, 'data', 'app.db'))
const defaultAdminName = process.env.DEFAULT_ADMIN_NAME ?? '박세천'
const defaultAdminEmail = process.env.DEFAULT_ADMIN_EMAIL ?? 'secheonio@gmail.com'

if (db.prepare("SELECT 1 FROM users WHERE position = '교장' AND active = 1").get()) {
  console.error('이미 교장(관리자) 계정이 있습니다.')
  process.exit(1)
}

const name = cleanText(nameArg ?? defaultAdminName, '이름', { min: 1, max: 30 })
const email = validateEmail(emailArg ?? defaultAdminEmail)

// 환경 변수 INITIAL_ADMIN_PASSWORD 또는 터미널 입력으로 비밀번호를 직접 정할 수 있다. 입력하지 않으면 임시 비밀번호를 발급한다.
async function askPassword() {
  if (process.env.INITIAL_ADMIN_PASSWORD) return process.env.INITIAL_ADMIN_PASSWORD
  if (!process.stdin.isTTY) return ''
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  rl._writeToOutput = () => {}
  const ask = (text) => new Promise((resolve) => {
    process.stdout.write(text)
    rl.question('', (answer) => { process.stdout.write('\n'); resolve(answer) })
  })
  const first = await ask('교장 비밀번호 (8자 이상, 비워 두면 임시 비밀번호 발급): ')
  if (first === '') { rl.close(); return '' }
  const second = await ask('비밀번호 확인: ')
  rl.close()
  if (first !== second) {
    console.error('비밀번호가 일치하지 않습니다.')
    process.exit(1)
  }
  return first
}

const chosen = await askPassword()
const password = chosen === '' ? 'gyver0979' : validatePassword(chosen)
const mustChange = chosen === ''
db.prepare(
  `INSERT INTO users (email, name, department, position, password_hash, must_change_password, active, created_at)
   VALUES (?, ?, '교장', '교장', ?, ?, 1, ?)`,
).run(email, name, await hashPassword(password), mustChange ? 1 : 0, today())

console.log(`교장 계정을 만들었습니다: ${email}`)
if (mustChange) {
  console.log(`임시 비밀번호: ${password}`)
  console.log('처음 로그인하면 비밀번호를 바꿔야 합니다. 이 비밀번호는 다시 표시되지 않습니다.')
} else {
  console.log('입력한 비밀번호로 바로 로그인할 수 있습니다.')
}
