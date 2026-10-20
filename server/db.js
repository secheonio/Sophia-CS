import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('교장', '행정실장', '기관장', '기안자')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_principal ON users(position) WHERE position = '교장' AND active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_accountant ON users(position) WHERE position = '행정실장' AND active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_head_per_department ON users(department) WHERE position = '기관장' AND active = 1;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT NOT NULL,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  department TEXT NOT NULL,
  requested_on TEXT NOT NULL,
  rejection_by TEXT,
  rejection_reason TEXT,
  rejection_on TEXT
);

CREATE TABLE IF NOT EXISTS request_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  user_name TEXT NOT NULL,
  user_position TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  decided_on TEXT,
  UNIQUE (request_id, seq)
);
CREATE INDEX IF NOT EXISTS steps_by_user ON request_steps(user_id);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(schema)
  return db
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}
