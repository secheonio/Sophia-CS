import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { openDatabase } from './db.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = openDatabase(process.env.DATABASE_FILE ?? path.join(root, 'data', 'app.db'))
const production = process.env.NODE_ENV === 'production'

const app = createApp(db, {
  secureCookie: production,
  trustProxy: process.env.TRUST_PROXY === '1',
  staticDir: path.join(root, 'dist'),
})

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '127.0.0.1'
app.listen(port, host, () => {
  console.log(`지출품의 서버: http://${host}:${port}${production ? ' (운영 모드: HTTPS 필수)' : ''}`)
})
