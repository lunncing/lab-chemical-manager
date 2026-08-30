import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateAcidCabinetTables } from '../src/cabinet-migration.js';
import { openDatabase } from '../src/database.js';

const directories: string[] = [];
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const v14Schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('member','normal_admin','super_admin','hazardous_buyer')), password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
CREATE TABLE chemicals (id INTEGER PRIMARY KEY, name TEXT NOT NULL, specification TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id), inbound_operator_id INTEGER NOT NULL REFERENCES users(id), inbound_at TEXT NOT NULL, cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B')), shelf INTEGER NOT NULL CHECK(shelf BETWEEN 1 AND 5), status TEXT NOT NULL CHECK(status IN ('active','discarded')), discard_reason TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, chemical_id INTEGER NOT NULL REFERENCES chemicals(id), operator_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, from_cabinet TEXT, from_shelf INTEGER, to_cabinet TEXT, to_shelf INTEGER, reason TEXT, created_at TEXT NOT NULL);
CREATE TABLE purchases (id INTEGER PRIMARY KEY, chemical_name TEXT NOT NULL, specification TEXT NOT NULL, purpose TEXT NOT NULL, hazardous INTEGER NOT NULL DEFAULT 0, request_type TEXT NOT NULL CHECK(request_type IN ('normal','urgent')), applicant_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL, approval_comment TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT, withdrawn_at TEXT);
CREATE TABLE purchase_weekly_entries (id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL UNIQUE REFERENCES purchases(id), week_start TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL, summary TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE notification_preferences (user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, category));
CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, object_type TEXT, object_id TEXT, read_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE inbound_requests (id INTEGER PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id), target_user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, specification TEXT NOT NULL, inbound_at TEXT NOT NULL, cabinet TEXT NOT NULL CHECK(cabinet IN ('A','B')), shelf INTEGER NOT NULL CHECK(shelf BETWEEN 1 AND 5), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','withdrawn')) DEFAULT 'pending', decision_comment TEXT, chemical_id INTEGER REFERENCES chemicals(id), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT, withdrawn_at TEXT);
CREATE INDEX idx_chemicals_location ON chemicals(status, cabinet, shelf);
CREATE INDEX idx_chemicals_owner_custom ON chemicals(owner_id, status);
CREATE INDEX idx_purchases_status ON purchases(status, request_type, hazardous);
CREATE INDEX idx_purchase_weekly_entries_week_start ON purchase_weekly_entries(week_start);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at);
CREATE INDEX idx_inbound_requests_target_status ON inbound_requests(target_user_id, status, created_at);
CREATE INDEX idx_inbound_requests_requester_status ON inbound_requests(requester_id, status, created_at);
`;

function createV14(path: string, brokenForeignKey = false): DatabaseSync {
  const db = new DatabaseSync(path); db.exec(v14Schema);
  const at = '2026-08-20T01:02:03.456Z';
  db.exec(`
    INSERT INTO users (id,username,display_name,role,password_hash,active,demo,version,created_at,updated_at) VALUES
      (11,'legacy-a','旧成员甲','member','hash-a',1,0,7,'${at}','${at}'),
      (12,'legacy-b','旧成员乙','member','hash-b',1,0,4,'${at}','${at}');
    INSERT INTO sessions VALUES ('legacy-token',11,'2027-08-20T01:02:03.456Z');
    INSERT INTO chemicals (id,name,specification,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,discard_reason,version,created_at,updated_at)
      VALUES (41,'旧盐','AR 1瓶',12,11,'${at}','B',5,'active',NULL,9,'${at}','${at}');
    INSERT INTO inventory_movements (id,chemical_id,operator_id,action,to_cabinet,to_shelf,created_at) VALUES (51,41,11,'inbound','B',5,'${at}');
    INSERT INTO purchases (id,chemical_name,specification,purpose,hazardous,request_type,applicant_id,status,approval_comment,version,created_at,updated_at,decided_at,withdrawn_at)
      VALUES (61,'旧采购','1瓶','旧用途',0,'normal',11,'approved','同意',6,'${at}','${at}','${at}',NULL);
    INSERT INTO purchase_weekly_entries (id,purchase_id,week_start,added_at) VALUES (62,61,'2026-08-17','${at}');
    INSERT INTO audit_logs VALUES (81,11,'legacy_action','chemical','41','旧审计','{"kept":true}','${at}');
    INSERT INTO notification_preferences VALUES (11,'inventory_inbound',1,'${at}');
    INSERT INTO notifications VALUES (91,12,'inventory_inbound','旧通知','旧正文','chemical','41',NULL,'${at}');
    INSERT INTO inbound_requests (id,requester_id,target_user_id,name,specification,inbound_at,cabinet,shelf,status,decision_comment,chemical_id,version,created_at,updated_at,decided_at,withdrawn_at)
      VALUES (71,11,12,'旧代入库','AR 1瓶','${at}','B',5,'approved','已同意',41,8,'${at}','${at}','${at}',NULL);
  `);
  if (brokenForeignKey) {
    db.exec('PRAGMA foreign_keys=OFF; UPDATE inventory_movements SET chemical_id=999 WHERE id=51; PRAGMA foreign_keys=ON;');
  }
  return db;
}

function snapshot(db: DatabaseSync) {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'registration_invites' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => {
    const columns = table === 'users' ? 'id,username,display_name,role,password_hash,active,demo,version,created_at,updated_at' : '*';
    const rows = db.prepare(`SELECT ${columns} FROM "${table}" ORDER BY rowid`).all();
    return [table, { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
  }));
}

function tempPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'lab-acid-cabinet-')); directories.push(directory); return join(directory, 'v1.4.sqlite');
}

describe('V1.4 acid cabinet table rebuild migration', () => {
  it('preserves every legacy business row/FK/index and is idempotent while enabling C1 only', () => {
    const path = tempPath(); let db = createV14(path); const before = snapshot(db); db.close();

    db = openDatabase(path, false); databases.push(db);
    expect(snapshot(db)).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect((db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('chemicals','inbound_requests') ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'idx_chemicals_location', 'idx_chemicals_owner_custom', 'idx_inbound_requests_requester_status', 'idx_inbound_requests_target_status',
    ]);
    expect(db.prepare('SELECT id,version,created_at,updated_at FROM chemicals WHERE id=41').get()).toEqual({ id: 41, version: 9, created_at: '2026-08-20T01:02:03.456Z', updated_at: '2026-08-20T01:02:03.456Z' });
    expect(db.prepare('SELECT id,chemical_id,version,decided_at FROM inbound_requests WHERE id=71').get()).toEqual({ id: 71, chemical_id: 41, version: 8, decided_at: '2026-08-20T01:02:03.456Z' });

    db.prepare(`INSERT INTO chemicals (id,name,specification,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,created_at,updated_at) VALUES (42,'盐酸','AR',11,11,'2026-08-30T00:00:00.000Z','C',1,'active','2026-08-30T00:00:00.000Z','2026-08-30T00:00:00.000Z')`).run();
    expect(() => db.prepare(`INSERT INTO chemicals (id,name,specification,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,created_at,updated_at) VALUES (43,'错误酸柜','AR',11,11,'2026-08-30T00:00:00.000Z','C',2,'active','2026-08-30T00:00:00.000Z','2026-08-30T00:00:00.000Z')`).run()).toThrow();
    expect(() => db.prepare(`INSERT INTO inbound_requests (id,requester_id,target_user_id,name,specification,inbound_at,cabinet,shelf,status,created_at,updated_at) VALUES (72,11,12,'错误申请','AR','2026-08-30T00:00:00.000Z','C',2,'pending','2026-08-30T00:00:00.000Z','2026-08-30T00:00:00.000Z')`).run()).toThrow();
    const firstSchema = db.prepare(`SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type,name`).all();
    const afterFirstOpen = snapshot(db); db.close();

    db = openDatabase(path, false); databases.push(db);
    expect(db.prepare(`SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type,name`).all()).toEqual(firstSchema);
    expect(snapshot(db)).toEqual(afterFirstOpen);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rolls back fully, restores foreign keys, and leaves no temporary tables on a failed check', () => {
    const path = tempPath(); const db = createV14(path, true); databases.push(db); const before = snapshot(db);
    expect(() => migrateAcidCabinetTables(db)).toThrow(/foreign key/i);
    expect(snapshot(db)).toEqual(before);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE '%v15%'`).all()).toEqual([]);
    expect((db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='chemicals'`).get() as { sql: string }).sql).toContain("cabinet IN ('A','B')");
  });
});
