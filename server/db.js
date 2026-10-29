import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ACCOUNTING_DEPARTMENT, COURSE_DEPARTMENTS, DEPARTMENT_DEPARTMENTS, DEPARTMENTS, INSTITUTION_DEPARTMENTS, PRINCIPAL_DEPARTMENT } from './rules.js'

function normalizeJsonList(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && String(item).trim() !== '')
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item) => item !== null && item !== undefined && String(item).trim() !== '')
      : []
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
}

export function syncUserDepartmentAssignments(db) {
  const userRows = db.prepare('SELECT id, department, position, departments, positions, active FROM users ORDER BY id').all()
  db.exec('DELETE FROM user_departments')
  const insert = db.prepare('INSERT OR REPLACE INTO user_departments (user_id, department, role, is_active) VALUES (?, ?, ?, ?)')
  for (const user of userRows) {
    const assignedDepartments = normalizeJsonList(user.departments)
    const assignedRoles = normalizeJsonList(user.positions)
    const selectedDepartments = assignedDepartments.length ? assignedDepartments : [user.department]
    const selectedRoles = assignedRoles.length ? assignedRoles : [user.position]
    selectedDepartments.forEach((department, index) => {
      if (!DEPARTMENTS.includes(String(department))) return
      const rawRole = String(selectedRoles[index] ?? selectedRoles[0] ?? user.position ?? '기안자')
      const normalizedRole = rawRole === '부장'
        ? (String(department) === '행정실' ? '행정실장' : '기관장')
        : ['기안자', '기관장', '행정실장', '교장'].includes(rawRole)
          ? rawRole
          : '기안자'
      insert.run(user.id, department, normalizedRole, user.active ? 1 : 0)
    })
  }
}

export function ensureApprovalRoutes(db) {
  const hasTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='approval_routes'").get()
  if (!hasTable) return

  const count = db.prepare('SELECT COUNT(*) AS count FROM approval_routes').get().count
  if (count > 0) return

  const insert = db.prepare('INSERT INTO approval_routes (department, seq, role, kind) VALUES (?, ?, ?, ?)')
  for (const department of DEPARTMENTS) {
    insert.run(department, 0, '기관장', '소속장 결재')
    insert.run(department, 1, '행정실장', '교장 결재 대기중')
    insert.run(department, 2, '교장', '교장 결재')
    insert.run(department, 3, '행정실장', '행정실장 지출처리')
  }
}

export function migrateLegacyRoleAssignments(db) {
  const userDepartmentsTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_departments'").get()
  if (!userDepartmentsTable) return

  const total = db.prepare('SELECT COUNT(*) AS count FROM user_departments').get().count
  if (total === 0) {
    syncUserDepartmentAssignments(db)
  }

  const duplicateHeads = db.prepare(`
    SELECT department, MIN(id) AS keep_id
    FROM user_departments
    WHERE role = '기관장' AND is_active = 1
    GROUP BY department
    HAVING COUNT(*) > 1
  `).all()
  for (const row of duplicateHeads) {
    const extras = db.prepare(
      'SELECT id FROM user_departments WHERE department = ? AND role = ? AND is_active = 1 AND id != ? ORDER BY id',
    ).all(row.department, '기관장', row.keep_id)
    for (const extra of extras) {
      db.prepare('UPDATE user_departments SET is_active = 0 WHERE id = ?').run(extra.id)
    }
  }
}

const schema = `
CREATE TABLE IF NOT EXISTS departments (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('과정', '부서', '기관'))
);

CREATE TABLE IF NOT EXISTS user_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('기안자', '기관장', '행정실장', '교장')),
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, department)
);

CREATE TABLE IF NOT EXISTS approval_routes (
  department TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('기안자', '기관장', '행정실장', '교장')),
  kind TEXT NOT NULL,
  PRIMARY KEY (department, seq)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '없음',
  departments TEXT NOT NULL DEFAULT '[]',
  positions TEXT NOT NULL DEFAULT '[]',
  phone TEXT,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

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
  payment_row_id INTEGER REFERENCES request_payment_rows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS budget_master (
  department TEXT PRIMARY KEY,
  rows_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department TEXT NOT NULL,
  gwan TEXT NOT NULL,
  hang TEXT NOT NULL,
  mok TEXT NOT NULL,
  semok TEXT NOT NULL,
  nae TEXT NOT NULL,
  total_amount INTEGER NOT NULL,
  remaining_amount INTEGER NOT NULL,
  execution_rate REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (department, gwan, hang, mok, semok, nae)
);
CREATE INDEX IF NOT EXISTS idx_budget_rows_department ON budget_rows(department);

CREATE TABLE IF NOT EXISTS request_budget_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  budget_row_id INTEGER NOT NULL REFERENCES budget_rows(id),
  requested_amount INTEGER NOT NULL,
  approved_amount INTEGER NOT NULL DEFAULT 0,
  allocated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (request_id, budget_row_id)
);
CREATE INDEX IF NOT EXISTS idx_request_budget_allocations ON request_budget_allocations(request_id, budget_row_id);

CREATE TABLE IF NOT EXISTS request_payment_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  date_text TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  payer TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  UNIQUE (request_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_request_payment_rows_request ON request_payment_rows(request_id, seq);
`

function pruneDuplicateActiveRoleRows(db) {
  const duplicateGroups = [
    { where: "position = '기관장' AND active = 1", partitionBy: 'department' },
    { where: "position = '행정실장' AND active = 1", partitionBy: null },
    { where: "position = '교장' AND active = 1", partitionBy: null },
  ]

  for (const group of duplicateGroups) {
    if (group.partitionBy) {
      db.exec(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (PARTITION BY ${group.partitionBy} ORDER BY id) AS rn
          FROM users
          WHERE ${group.where}
        )
        DELETE FROM users
        WHERE id IN (
          SELECT id FROM ranked WHERE rn > 1
        )
      `)
    } else {
      db.exec(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (ORDER BY id) AS rn
          FROM users
          WHERE ${group.where}
        )
        DELETE FROM users
        WHERE id IN (
          SELECT id FROM ranked WHERE rn > 1
        )
      `)
    }
  }
}

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(schema)
  pruneDuplicateActiveRoleRows(db)

  for (const department of DEPARTMENTS) {
    const kind = COURSE_DEPARTMENTS.includes(department)
      ? '과정'
      : DEPARTMENT_DEPARTMENTS.includes(department)
        ? '부서'
        : '기관'
    db.prepare('INSERT OR IGNORE INTO departments (name, kind) VALUES (?, ?)').run(department, kind)
  }

  ensureApprovalRoutes(db)

  const userDepartmentsTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_departments'").get()
  if (userDepartmentsTable) {
    db.exec(`
      DELETE FROM user_departments
      WHERE id NOT IN (
        SELECT MIN(id) FROM user_departments GROUP BY user_id, department
      )
    `)
    db.exec(`
      DELETE FROM user_departments
      WHERE role = '기관장' AND is_active = 1 AND id NOT IN (
        SELECT MIN(id) FROM user_departments WHERE role = '기관장' AND is_active = 1 GROUP BY department
      )
    `)

    migrateLegacyRoleAssignments(db)
  }

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_active_principal ON users(position) WHERE position = '교장' AND active = 1")
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_active_accountant ON users(position) WHERE position = '행정실장' AND active = 1")
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_active_head_per_department ON users(department) WHERE position = '기관장' AND active = 1")
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_active_department_head ON user_departments(department) WHERE role = '기관장' AND is_active = 1")

  const usersExists = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get()
  const legacyExists = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users_legacy'").get()
  if (!usersExists && legacyExists) {
    db.exec('ALTER TABLE users_legacy RENAME TO users')
  }

  const columns = db.prepare('PRAGMA table_info(users)').all()
  const names = new Set(columns.map((column) => column.name))
  if (!names.has('departments')) db.exec("ALTER TABLE users ADD COLUMN departments TEXT NOT NULL DEFAULT '[]'")
  if (!names.has('positions')) db.exec("ALTER TABLE users ADD COLUMN positions TEXT NOT NULL DEFAULT '[]'")
  if (!names.has('phone')) db.exec('ALTER TABLE users ADD COLUMN phone TEXT')

  const emailColumn = columns.find((column) => column.name === 'email')
  const needsNullableEmailMigration = emailColumn && emailColumn.notnull === 1 && !legacyExists
  if (needsNullableEmailMigration) {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('DROP INDEX IF EXISTS users_email_unique')
    db.exec('DROP INDEX IF EXISTS one_active_principal')
    db.exec('DROP INDEX IF EXISTS one_active_accountant')
    db.exec('DROP INDEX IF EXISTS one_active_head_per_department')
    db.exec('DROP TABLE IF EXISTS users_migration')
    db.exec('ALTER TABLE users RENAME TO users_legacy')
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        name TEXT NOT NULL,
        department TEXT NOT NULL,
        position TEXT NOT NULL DEFAULT '없음',
        departments TEXT NOT NULL DEFAULT '[]',
        positions TEXT NOT NULL DEFAULT '[]',
        phone TEXT,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
    `)
    db.exec(`
      INSERT INTO users (id, email, name, department, position, departments, positions, phone, password_hash, must_change_password, active, created_at)
      SELECT id,
             CASE WHEN TRIM(COALESCE(email, '')) = '' THEN NULL ELSE email END,
             name,
             department,
             position,
             COALESCE(departments, '[]'),
             COALESCE(positions, '[]'),
             phone,
             password_hash,
             must_change_password,
             active,
             created_at
      FROM users_legacy;
    `)
    db.exec('DROP TABLE users_legacy')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL')
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_active_principal ON users(position) WHERE position = '교장' AND active = 1")
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_active_accountant ON users(position) WHERE position = '행정실장' AND active = 1")
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_active_head_per_department ON users(department) WHERE position = '기관장' AND active = 1")
  }

  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='users_email_unique'").get()) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL')
  }

  const budgetTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='budget_master'").get()
  if (!budgetTable) {
    db.exec(`
      CREATE TABLE budget_master (
        department TEXT PRIMARY KEY,
        rows_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }

  const paymentRowsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='request_payment_rows'").get()
  if (!paymentRowsTable) {
    db.exec(`
      CREATE TABLE request_payment_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        date_text TEXT NOT NULL DEFAULT '',
        amount INTEGER NOT NULL DEFAULT 0,
        payer TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL DEFAULT '',
        UNIQUE (request_id, seq)
      );
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_request_payment_rows_request ON request_payment_rows(request_id, seq)')
  }
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
