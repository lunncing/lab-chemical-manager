import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateStorageLocationsAndCas } from '../src/cabinet-migration.js';
import { openDatabase } from '../src/database.js';

const directories: string[] = [];
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const v18Schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('member','normal_admin','super_admin','hazardous_buyer')), password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE registration_invites (id INTEGER PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, code_hint TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_by INTEGER REFERENCES users(id), used_at TEXT, revoked_by INTEGER REFERENCES users(id), revoked_at TEXT, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
CREATE TABLE password_reset_requests (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), recovery_token_hash TEXT NOT NULL UNIQUE CHECK(length(recovery_token_hash)=64), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','appealed','consumed','expired')), appeal_reason TEXT, reviewer_id INTEGER REFERENCES users(id), review_comment TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL, reviewed_at TEXT, consumed_at TEXT);
CREATE TABLE chemicals (id INTEGER PRIMARY KEY, name TEXT NOT NULL, specification TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id), inbound_operator_id INTEGER NOT NULL REFERENCES users(id), inbound_at TEXT NOT NULL, cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B','C')), shelf INTEGER NOT NULL CHECK((cabinet IN ('A','B') AND shelf BETWEEN 1 AND 5) OR (cabinet='C' AND shelf=1)), status TEXT NOT NULL CHECK(status IN ('active','discarded')), discard_reason TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, chemical_id INTEGER NOT NULL REFERENCES chemicals(id), operator_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, from_cabinet TEXT, from_shelf INTEGER, to_cabinet TEXT, to_shelf INTEGER, reason TEXT, created_at TEXT NOT NULL);
CREATE TABLE purchases (id INTEGER PRIMARY KEY, chemical_name TEXT NOT NULL, specification TEXT NOT NULL, purpose TEXT NOT NULL, hazardous INTEGER NOT NULL DEFAULT 0, request_type TEXT NOT NULL CHECK(request_type IN ('normal','urgent')), applicant_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL, approval_comment TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT, withdrawn_at TEXT);
CREATE TABLE purchase_weekly_entries (id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL UNIQUE REFERENCES purchases(id), week_start TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL, summary TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE notification_preferences (user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, category));
CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, object_type TEXT, object_id TEXT, read_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE inbound_requests (id INTEGER PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id), target_user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, specification TEXT NOT NULL, inbound_at TEXT NOT NULL, cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B','C')), shelf INTEGER NOT NULL CHECK((cabinet IN ('A','B') AND shelf BETWEEN 1 AND 5) OR (cabinet='C' AND shelf=1)), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','withdrawn')) DEFAULT 'pending', decision_comment TEXT, chemical_id INTEGER REFERENCES chemicals(id), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT, withdrawn_at TEXT);
CREATE INDEX idx_chemicals_location ON chemicals(status,cabinet,shelf);
CREATE INDEX idx_chemicals_owner_custom ON chemicals(owner_id,status);
CREATE INDEX idx_purchases_status ON purchases(status,request_type,hazardous);
CREATE INDEX idx_purchase_weekly_entries_week_start ON purchase_weekly_entries(week_start);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_notifications_user ON notifications(user_id,read_at,created_at);
CREATE INDEX idx_inbound_requests_target_status ON inbound_requests(target_user_id,status,created_at);
CREATE INDEX idx_inbound_requests_requester_status ON inbound_requests(requester_id,status,created_at);
CREATE INDEX idx_registration_invites_created_by ON registration_invites(created_by);
CREATE INDEX idx_registration_invites_expires_at ON registration_invites(expires_at);
CREATE INDEX idx_registration_invites_used_by ON registration_invites(used_by);
CREATE INDEX idx_password_reset_requests_user_status ON password_reset_requests(user_id,status);
CREATE INDEX idx_password_reset_requests_status_created ON password_reset_requests(status,created_at);
CREATE INDEX idx_password_reset_requests_expires ON password_reset_requests(expires_at);
CREATE UNIQUE INDEX idx_password_reset_requests_unresolved_user ON password_reset_requests(user_id) WHERE status IN ('pending','approved','rejected','appealed');
`;

function tempPath(name = 'v1.8.sqlite'): string {
  const directory = mkdtempSync(join(tmpdir(), 'lab-v19-upgrade-'));
  directories.push(directory);
  return join(directory, name);
}

function createV18(path: string, brokenForeignKey = false): DatabaseSync {
  const db = new DatabaseSync(path); db.exec(v18Schema);
  const at = '2026-08-30T01:02:03.456Z';
  db.exec(`
    INSERT INTO users VALUES
      (11,'legacy-owner','旧归属人','member','hash-owner',1,0,7,'${at}','${at}',NULL),
      (12,'legacy-operator','旧操作人','normal_admin','hash-operator',1,0,4,'${at}','${at}',NULL),
      (13,'legacy-reviewer','旧审核人','super_admin','hash-reviewer',1,0,3,'${at}','${at}',NULL);
    INSERT INTO registration_invites VALUES (21,'${'a'.repeat(64)}','LSF-…abcd',12,'${at}','2027-08-30T01:02:03.456Z',11,'${at}',NULL,NULL,2);
    INSERT INTO sessions VALUES ('legacy-token',11,'2027-08-30T01:02:03.456Z');
    INSERT INTO password_reset_requests VALUES (31,11,'${'b'.repeat(64)}','consumed',NULL,13,'已完成',5,'${at}','${at}','2027-08-30T01:02:03.456Z','${at}','${at}');
    INSERT INTO chemicals VALUES
      (41,'旧乙醇','AR 500mL',11,11,'${at}','A',3,'active',NULL,9,'${at}','${at}'),
      (42,'旧冷藏品','1瓶',12,11,'${at}','B',5,'discarded','已使用',6,'${at}','${at}'),
      (43,'旧盐酸','AR 1L',12,11,'${at}','C',1,'active',NULL,8,'${at}','${at}');
    INSERT INTO inventory_movements VALUES
      (51,43,11,'inbound',NULL,NULL,'C',1,NULL,'${at}'),
      (52,41,11,'move','C',1,'A',3,NULL,'${at}'),
      (53,43,12,'move','B',2,'C',1,NULL,'${at}'),
      (54,42,12,'discard','C',1,NULL,NULL,'已使用','${at}');
    INSERT INTO purchases VALUES (61,'旧采购','1瓶','旧用途',0,'normal',11,'approved','同意',6,'${at}','${at}','${at}',NULL);
    INSERT INTO purchase_weekly_entries VALUES (62,61,'2026-08-24','${at}');
    INSERT INTO audit_logs VALUES (71,11,'legacy_action','chemical','43','旧审计','{"kept":true}','${at}');
    INSERT INTO notification_preferences VALUES (11,'inventory_inbound',1,'${at}');
    INSERT INTO notifications VALUES (81,12,'inventory_inbound','旧通知','旧正文','chemical','43',NULL,'${at}');
    INSERT INTO inbound_requests VALUES
      (91,11,12,'待确认旧酸','AR','${at}','C',1,'pending',NULL,NULL,4,'${at}','${at}',NULL,NULL),
      (92,11,12,'已批准旧酸','AR','${at}','C',1,'approved','同意',43,5,'${at}','${at}','${at}',NULL);
  `);
  if (brokenForeignKey) db.exec('PRAGMA foreign_keys=OFF; UPDATE inventory_movements SET chemical_id=999 WHERE id=54; PRAGMA foreign_keys=ON;');
  return db;
}

function businessSnapshot(db: DatabaseSync) {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]));
}

function expectedV19Snapshot(before: ReturnType<typeof businessSnapshot>) {
  return {
    ...before,
    chemicals: (before.chemicals as Array<Record<string, unknown>>).map((row) => ({ ...row, cas_number: null, cabinet: row.cabinet === 'C' ? 'C1' : row.cabinet })),
    inbound_requests: (before.inbound_requests as Array<Record<string, unknown>>).map((row) => ({ ...row, cas_number: null, cabinet: row.cabinet === 'C' ? 'C1' : row.cabinet })),
    inventory_movements: (before.inventory_movements as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      from_cabinet: row.from_cabinet === 'C' ? 'C1' : row.from_cabinet,
      to_cabinet: row.to_cabinet === 'C' ? 'C1' : row.to_cabinet,
    })),
  };
}

function expectHealthy(db: DatabaseSync) {
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
}

describe('V1.9 storage/CAS schema and populated V1.8 upgrade', () => {
  it('creates a fresh six-location schema with nullable, non-unique indexed CAS columns', () => {
    const db = openDatabase(':memory:', false); databases.push(db);
    expect((db.prepare(`PRAGMA table_info('chemicals')`).all() as Array<{ name: string; notnull: number }>).find(({ name }) => name === 'cas_number')).toMatchObject({ name: 'cas_number', notnull: 0 });
    expect((db.prepare(`PRAGMA table_info('inbound_requests')`).all() as Array<{ name: string; notnull: number }>).find(({ name }) => name === 'cas_number')).toMatchObject({ name: 'cas_number', notnull: 0 });
    const index = (db.prepare(`PRAGMA index_list('chemicals')`).all() as Array<{ name: string; unique: number }>).find(({ name }) => name === 'idx_chemicals_cas_number');
    expect(index).toMatchObject({ name: 'idx_chemicals_cas_number', unique: 0 });

    const at = '2026-09-04T08:00:00.000Z';
    db.exec(`INSERT INTO users (id,username,display_name,role,password_hash,created_at,updated_at) VALUES (1,'owner','归属人','member','hash','${at}','${at}')`);
    const insert = db.prepare(`INSERT INTO chemicals (name,specification,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?)`);
    for (const cabinet of ['A', 'B', 'C1', 'C2', 'G1', 'G2']) insert.run(`药品-${cabinet}`, 'AR', 1, 1, at, cabinet, cabinet === 'A' ? 5 : 1, at, at);
    expect(() => insert.run('非法碱柜层', 'AR', 1, 1, at, 'C2', 2, at, at)).toThrow();
    expect(() => insert.run('旧柜号', 'AR', 1, 1, at, 'C', 1, at, at)).toThrow();
    expectHealthy(db);
  });

  it('preserves every populated V1.8 business row except C→C1 and new null CAS, including history and custom indexes', () => {
    const path = tempPath(); let db = createV18(path); const before = businessSnapshot(db); db.close();

    db = openDatabase(path, false); databases.push(db);
    expect(businessSnapshot(db)).toEqual(expectedV19Snapshot(before));
    expectHealthy(db);
    expect((db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='chemicals' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'idx_chemicals_cas_number', 'idx_chemicals_location', 'idx_chemicals_owner_custom',
    ]);
    expect(db.prepare(`SELECT id,cabinet,cas_number,status,version,created_at,updated_at FROM chemicals ORDER BY id`).all()).toEqual([
      { id: 41, cabinet: 'A', cas_number: null, status: 'active', version: 9, created_at: '2026-08-30T01:02:03.456Z', updated_at: '2026-08-30T01:02:03.456Z' },
      { id: 42, cabinet: 'B', cas_number: null, status: 'discarded', version: 6, created_at: '2026-08-30T01:02:03.456Z', updated_at: '2026-08-30T01:02:03.456Z' },
      { id: 43, cabinet: 'C1', cas_number: null, status: 'active', version: 8, created_at: '2026-08-30T01:02:03.456Z', updated_at: '2026-08-30T01:02:03.456Z' },
    ]);
    const firstSchema = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type,name`).all();
    const afterFirstOpen = businessSnapshot(db); db.close();

    db = openDatabase(path, false);
    expect(businessSnapshot(db)).toEqual(afterFirstOpen);
    expect(db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type,name`).all()).toEqual(firstSchema);
    expectHealthy(db); db.close();
    db = openDatabase(path, false); databases.push(db);
    expect(businessSnapshot(db)).toEqual(afterFirstOpen);
    expectHealthy(db);
  });

  it('rolls back C/CAS table work and movement rewrites while restoring foreign keys on failure', () => {
    const db = createV18(tempPath('broken-v1.8.sqlite'), true); databases.push(db); const before = businessSnapshot(db);
    expect(() => migrateStorageLocationsAndCas(db)).toThrow(/foreign key/i);
    expect(businessSnapshot(db)).toEqual(before);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE '%v19%'`).all()).toEqual([]);
    expect((db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='chemicals'`).get() as { sql: string }).sql).toContain("cabinet IN ('A','B','C')");
  });
});
