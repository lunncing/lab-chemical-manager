import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/database.js';

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : '';
assert(sourcePath && existsSync(sourcePath), 'usage: verify-acid-cabinet-upgrade <v1.4-or-v1.8-database-path>');
const directory = mkdtempSync(join(process.cwd(), '.storage-cas-upgrade-'));
const copyPath = join(directory, basename(sourcePath));

type SnapshotShape = Record<string, string[]>;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function snapshotShape(db: DatabaseSync): SnapshotShape {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => [
    table,
    (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>).map(({ name }) => name),
  ]));
}

function snapshot(db: DatabaseSync, shape = snapshotShape(db)): Record<string, Array<Record<string, unknown>>> {
  return Object.fromEntries(Object.entries(shape).map(([table, columns]) => {
    const projection = columns.map(quoteIdentifier).join(',');
    const rows = db.prepare(`SELECT ${projection} FROM ${quoteIdentifier(table)} ORDER BY rowid`).all() as Array<Record<string, unknown>>;
    return [table, rows.map((row) => ({ ...row }))];
  }));
}

function expectedV19(before: ReturnType<typeof snapshot>): ReturnType<typeof snapshot> {
  return {
    ...before,
    chemicals: before.chemicals!.map((row) => ({
      ...row,
      cabinet: row.cabinet === 'C' ? 'C1' : row.cabinet,
    })),
    inbound_requests: before.inbound_requests!.map((row) => ({
      ...row,
      cabinet: row.cabinet === 'C' ? 'C1' : row.cabinet,
    })),
    inventory_movements: before.inventory_movements!.map((row) => ({
      ...row,
      from_cabinet: row.from_cabinet === 'C' ? 'C1' : row.from_cabinet,
      to_cabinet: row.to_cabinet === 'C' ? 'C1' : row.to_cabinet,
    })),
  };
}

function targetSchema(db: DatabaseSync) {
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE (type='table' AND name IN ('chemicals','inbound_requests')) OR (type='index' AND tbl_name IN ('chemicals','inbound_requests')) ORDER BY type,name`).all();
}

function assertHealthy(db: DatabaseSync): void {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'database has foreign key violations');
  assert.equal(String((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check), 'ok', 'database integrity check failed');
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1, 'foreign keys are not enabled');
}

function hasCabinetConstraint(sql: string, cabinets: string): boolean {
  return sql.replace(/\s+/g, '').toUpperCase().includes(`CHECK(CABINETIN(${cabinets}))`);
}

let db: DatabaseSync | undefined;
try {
  const sourceHash = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
  copyFileSync(sourcePath, copyPath);
  db = new DatabaseSync(copyPath);
  const legacyChemicals = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='chemicals'`).get() as { sql: string }).sql;
  const legacyInbound = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='inbound_requests'`).get() as { sql: string }).sql;
  const v18Cabinets = "'A','B','C'";
  const v14Cabinets = "'A','B'";
  const sourceVersion = hasCabinetConstraint(legacyChemicals, v18Cabinets) && hasCabinetConstraint(legacyInbound, v18Cabinets) ? 'V1.8'
    : hasCabinetConstraint(legacyChemicals, v14Cabinets) && hasCabinetConstraint(legacyInbound, v14Cabinets) ? 'V1.4' : undefined;
  assert(sourceVersion, 'source is not a V1.4 or V1.8 storage schema');
  assertHealthy(db);
  const sourceShape = snapshotShape(db);
  const before = snapshot(db, sourceShape);
  const explicitIndexesBefore = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('chemicals','inbound_requests') AND sql IS NOT NULL ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  db.close(); db = undefined;

  db = openDatabase(copyPath, false);
  assert.deepEqual(snapshot(db, sourceShape), expectedV19(before), 'a legacy business row changed outside C→C1/new-null-CAS migration');
  assertHealthy(db);
  const indexesAfter = db.prepare(`SELECT name,"unique" FROM pragma_index_list('chemicals') UNION ALL SELECT name,"unique" FROM pragma_index_list('inbound_requests')`).all() as Array<{ name: string; unique: number }>;
  const indexNames = indexesAfter.map(({ name }) => name);
  for (const name of explicitIndexesBefore) assert(indexNames.includes(name), `missing preserved index ${name}`);
  assert(indexNames.includes('idx_chemicals_cas_number'), 'missing CAS lookup index');
  assert.equal(indexesAfter.find(({ name }) => name === 'idx_chemicals_cas_number')?.unique, 0, 'CAS index must be non-unique');
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM chemicals WHERE cas_number IS NOT NULL`).get() as { count: number }).count, 0, 'legacy chemicals did not receive null CAS');
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM inbound_requests WHERE cas_number IS NOT NULL`).get() as { count: number }).count, 0, 'legacy requests did not receive null CAS');

  const users = db.prepare('SELECT id FROM users ORDER BY id LIMIT 2').all() as Array<{ id: number }>;
  assert(users.length >= 2, 'upgrade verification needs two existing users');
  let chemicalId = Number((db.prepare('SELECT COALESCE(MAX(id),0)+1 id FROM chemicals').get() as { id: number }).id);
  const at = '2026-09-04T12:00:00.000Z';
  const insertChemical = db.prepare(`INSERT INTO chemicals (id,name,specification,cas_number,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`);
  for (const [cabinet, shelf] of [['A', 5], ['B', 5], ['C1', 1], ['C2', 1], ['G1', 1], ['G2', 1]] as const) {
    insertChemical.run(chemicalId++, `V1.9 ${cabinet} 验证`, 'AR 1瓶', '64-17-5', users[0]!.id, users[0]!.id, at, cabinet, shelf, at, at);
  }
  assert.throws(() => insertChemical.run(chemicalId++, 'V1.9 旧柜号', 'AR 1瓶', null, users[0]!.id, users[0]!.id, at, 'C', 1, at, at));
  assert.throws(() => insertChemical.run(chemicalId++, 'V1.9 错误层', 'AR 1瓶', null, users[0]!.id, users[0]!.id, at, 'C2', 2, at, at));
  const requestId = Number((db.prepare('SELECT COALESCE(MAX(id),0)+1 id FROM inbound_requests').get() as { id: number }).id);
  const insertRequest = db.prepare(`INSERT INTO inbound_requests (id,requester_id,target_user_id,name,specification,inbound_at,cabinet,shelf,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'pending',?,?)`);
  insertRequest.run(requestId, users[0]!.id, users[1]!.id, 'V1.9 手套箱代入库验证', 'AR 1瓶', at, 'G2', 1, at, at);
  assert.throws(() => insertRequest.run(requestId + 1, users[0]!.id, users[1]!.id, 'V1.9 错误代入库层', 'AR 1瓶', at, 'G2', 2, at, at));
  const upgradedShape = snapshotShape(db);
  const afterFirstOpen = snapshot(db, upgradedShape);
  const schemaAfterFirstOpen = targetSchema(db);
  assertHealthy(db);
  db.close(); db = undefined;

  for (let reopen = 1; reopen <= 2; reopen += 1) {
    db = openDatabase(copyPath, false);
    assert.deepEqual(snapshot(db, upgradedShape), afterFirstOpen, `reopen ${reopen} changed row content`);
    assert.deepEqual(targetSchema(db), schemaAfterFirstOpen, `reopen ${reopen} rebuilt the V1.9 schema`);
    assertHealthy(db);
    db.close(); db = undefined;
  }
  assert.equal(createHash('sha256').update(readFileSync(sourcePath)).digest('hex'), sourceHash, 'source database was modified');
  console.log(`PASS ${sourceVersion} production database copy: ${Object.keys(before).length} business tables preserved; C→C1/null-CAS/FK/integrity/index/six-location checks passed; two reopens idempotent; source unchanged`);
} finally {
  try { db?.close(); } catch { /* already closed */ }
  rmSync(directory, { recursive: true, force: true });
}
