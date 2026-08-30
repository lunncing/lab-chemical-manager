import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashPassword } from './security.js';
import { beijingWeekStart } from './purchase-weeks.js';
import { migrateAcidCabinetTables } from './cabinet-migration.js';
import type { Role, UserView } from '../../shared/types.js';

export type Db = DatabaseSync;

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('member','normal_admin','super_admin','hazardous_buyer')),
  password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chemicals (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, specification TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id), inbound_operator_id INTEGER NOT NULL REFERENCES users(id),
  inbound_at TEXT NOT NULL, cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B','C')),
  shelf INTEGER NOT NULL CHECK((cabinet IN ('A','B') AND shelf BETWEEN 1 AND 5) OR (cabinet='C' AND shelf=1)), status TEXT NOT NULL CHECK(status IN ('active','discarded')),
  discard_reason TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY, chemical_id INTEGER NOT NULL REFERENCES chemicals(id), operator_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL, from_cabinet TEXT, from_shelf INTEGER, to_cabinet TEXT, to_shelf INTEGER,
  reason TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY, chemical_name TEXT NOT NULL, specification TEXT NOT NULL, purpose TEXT NOT NULL,
  hazardous INTEGER NOT NULL DEFAULT 0, request_type TEXT NOT NULL CHECK(request_type IN ('normal','urgent')),
  applicant_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL,
  approval_comment TEXT, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT, withdrawn_at TEXT
);
CREATE TABLE IF NOT EXISTS purchase_weekly_entries (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL UNIQUE REFERENCES purchases(id),
  week_start TEXT NOT NULL,
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL,
  object_type TEXT NOT NULL, object_id TEXT NOT NULL, summary TEXT NOT NULL, details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY(user_id, category)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, object_type TEXT, object_id TEXT,
  read_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inbound_requests (
  id INTEGER PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id), target_user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, specification TEXT NOT NULL, inbound_at TEXT NOT NULL,
  cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B','C')),
  shelf INTEGER NOT NULL CHECK((cabinet IN ('A','B') AND shelf BETWEEN 1 AND 5) OR (cabinet='C' AND shelf=1)),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','withdrawn')) DEFAULT 'pending',
  decision_comment TEXT, chemical_id INTEGER REFERENCES chemicals(id), version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT, withdrawn_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chemicals_location ON chemicals(status, cabinet, shelf);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status, request_type, hazardous);
CREATE INDEX IF NOT EXISTS idx_purchase_weekly_entries_week_start ON purchase_weekly_entries(week_start);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS idx_inbound_requests_target_status ON inbound_requests(target_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_inbound_requests_requester_status ON inbound_requests(requester_id, status, created_at);
PRAGMA optimize;
`;

export function openDatabase(path: string, seedDemo = true): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(schema);
    migrateAcidCabinetTables(db);
    backfillWeeklyPurchaseEntries(db);
    if (seedDemo) seedDemoUsers(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function backfillWeeklyPurchaseEntries(db: Db): void {
  const rows = db.prepare(`SELECT p.id,p.decided_at FROM purchases p
    LEFT JOIN purchase_weekly_entries e ON e.purchase_id=p.id
    WHERE p.request_type='normal' AND p.hazardous=0 AND p.status IN ('approved','purchased')
      AND p.decided_at IS NOT NULL AND e.purchase_id IS NULL`).all() as Array<{ id: number; decided_at: string }>;
  if (!rows.length) return;
  const insert = db.prepare('INSERT OR IGNORE INTO purchase_weekly_entries (purchase_id,week_start,added_at) VALUES (?,?,?)');
  const addedAt = new Date().toISOString();
  transaction(db, () => {
    for (const row of rows) insert.run(row.id, beijingWeekStart(row.decided_at), addedAt);
  });
}

function seedDemoUsers(db: Db): void {
  const count = db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number };
  if (count.count > 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO users (username, display_name, role, password_hash, active, demo, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)');
  const users: Array<[string, string, Role]> = [
    ['teacher', '李老师', 'super_admin'], ['admin', '普通管理员', 'normal_admin'],
    ['hazard', '危险品采购人', 'hazardous_buyer'], ['member-a', '成员甲', 'member'], ['member-b', '成员乙', 'member'],
  ];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [username, name, role] of users) insert.run(username, name, role, hashPassword('Demo1234!'), now, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function transaction<T>(db: Db, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = operation();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function userView(row: Record<string, unknown>): UserView {
  return {
    id: Number(row.id), username: String(row.username), displayName: String(row.display_name),
    role: row.role as Role, active: Boolean(row.active), demo: Boolean(row.demo), version: Number(row.version),
  };
}
