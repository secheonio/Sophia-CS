// 운영 중에도 안전한 DB 백업. 사용법: node server/backup.js [백업폴더] [보관일수]
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.env.DATABASE_FILE ?? path.join(root, 'data', 'app.db')
const dir = path.resolve(process.argv[2] ?? path.join(root, 'backups'))
const keepDays = Number(process.argv[3] ?? 30)

if (!fs.existsSync(source)) {
  console.error(`데이터베이스 파일이 없습니다: ${source}`)
  process.exit(1)
}
fs.mkdirSync(dir, { recursive: true })

const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/[-: ]/g, '').slice(0, 12)
const target = path.join(dir, `app-${stamp}.db`)
if (fs.existsSync(target)) fs.rmSync(target)

// VACUUM INTO는 쓰기 중에도 일관된 스냅샷을 만든다.
const db = new DatabaseSync(source, { readOnly: true })
db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
db.close()

const check = new DatabaseSync(target, { readOnly: true })
const result = check.prepare('PRAGMA integrity_check').get()
check.close()
if (Object.values(result)[0] !== 'ok') {
  fs.rmSync(target)
  console.error('백업 파일 검사에 실패했습니다.')
  process.exit(1)
}

const limit = Date.now() - keepDays * 24 * 60 * 60 * 1000
for (const file of fs.readdirSync(dir)) {
  const full = path.join(dir, file)
  if (/^app-\d{12}\.db$/.test(file) && fs.statSync(full).mtimeMs < limit) fs.rmSync(full)
}
console.log(`백업 완료: ${target}`)
