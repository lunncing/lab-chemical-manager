import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/database.js';

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : '';
assert(sourcePath && existsSync(sourcePath), 'usage: verify-acid-cabinet-upgrade <v1.4-database-path>');
const directory = mkdtempSync(join(process.cwd(), '.acid-cabinet-upgrade-'));
const copyPath = join(directory, basename(sourcePath));

function snapshot(db: DatabaseSync) {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => {
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
    return [table, { rowCount: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
  }));
}

function targetSchema(db: DatabaseSync) {
  return db.prepare(`SELECT type,name,sql FROM sqlite_master WHERE (type='table' AND name IN ('chemicals','inbound_requests')) OR (type='index' AND tbl_name IN ('chemicals','inbound_requests')) ORDER BY type,name`).all();
}

let db: DatabaseSync | undefined;
try {
  copyFileSync(sourcePath, copyPath);
  db = new DatabaseSync(copyPath);
  const legacyChemicals = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='chemicals'`).get() as { sql: string }).sql;
  const legacyInbound = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='inbound_requests'`).get() as { sql: string }).sql;
  assert(legacyChemicals.includes("cabinet IN ('A','B')") && legacyInbound.includes("cabinet IN ('A','B')"), 'source is not a V1.4 cabinet schema');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'source database has foreign key violations');
  const before = snapshot(db); db.close(); db = undefined;

  db = openDatabase(copyPath, false);
  assert.deepEqual(snapshot(db), before, 'a legacy business row changed during acid cabinet upgrade');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'upgraded database has foreign key violations');
  const indexNames = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('chemicals','inbound_requests') ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  assert(indexNames.includes('idx_chemicals_location'));
  assert(indexNames.includes('idx_inbound_requests_target_status'));
  assert(indexNames.includes('idx_inbound_requests_requester_status'));

  const users = db.prepare('SELECT id FROM users ORDER BY id LIMIT 2').all() as Array<{ id: number }>;
  assert(users.length >= 2, 'upgrade verification needs two existing users');
  const chemicalId = Number((db.prepare('SELECT COALESCE(MAX(id),0)+1 id FROM chemicals').get() as { id: number }).id);
  const requestId = Number((db.prepare('SELECT COALESCE(MAX(id),0)+1 id FROM inbound_requests').get() as { id: number }).id);
  const at = '2026-08-30T12:00:00.000Z';
  const insertChemical = db.prepare(`INSERT INTO chemicals (id,name,specification,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'active',?,?)`);
  insertChemical.run(chemicalId, 'V1.5 酸柜验证', 'AR 1瓶', users[0]!.id, users[0]!.id, at, 'C', 1, at, at);
  assert.throws(() => insertChemical.run(chemicalId + 1, 'V1.5 错误层', 'AR 1瓶', users[0]!.id, users[0]!.id, at, 'C', 2, at, at));
  const insertRequest = db.prepare(`INSERT INTO inbound_requests (id,requester_id,target_user_id,name,specification,inbound_at,cabinet,shelf,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'pending',?,?)`);
  insertRequest.run(requestId, users[0]!.id, users[1]!.id, 'V1.5 酸柜代入库验证', 'AR 1瓶', at, 'C', 1, at, at);
  assert.throws(() => insertRequest.run(requestId + 1, users[0]!.id, users[1]!.id, 'V1.5 错误代入库层', 'AR 1瓶', at, 'C', 2, at, at));
  const afterFirstOpen = snapshot(db); const schemaAfterFirstOpen = targetSchema(db);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close(); db = undefined;

  db = openDatabase(copyPath, false);
  assert.deepEqual(snapshot(db), afterFirstOpen, 'second open changed row content');
  assert.deepEqual(targetSchema(db), schemaAfterFirstOpen, 'second open rebuilt the acid cabinet schema');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log(`PASS V1.4 production database copy: ${Object.keys(before).length} legacy tables unchanged; FK/index checks passed; C1 chemical/request writes passed; C2 constraints passed; second open idempotent`);
} finally {
  try { db?.close(); } catch { /* already closed */ }
  rmSync(directory, { recursive: true, force: true });
}
