import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/database.js';

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : '';
assert(sourcePath && existsSync(sourcePath), 'usage: verify-password-recovery-upgrade <v1.7-database-path>');
const directory = mkdtempSync(join(tmpdir(), 'lab-v1.8-password-recovery-upgrade-'));
const copyPath = join(directory, basename(sourcePath));

interface SchemaObject { type: string; name: string; tbl_name: string; sql: string | null; }

function schemaObjects(db: DatabaseSync): SchemaObject[] {
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all() as unknown as SchemaObject[];
}

function tableSnapshots(db: DatabaseSync) {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => {
    const rows = db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).all();
    return [table, { rowCount: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
  }));
}

let db: DatabaseSync | undefined;
try {
  copyFileSync(sourcePath, copyPath);
  db = new DatabaseSync(copyPath);
  const userColumns = db.prepare(`PRAGMA table_info('users')`).all() as Array<{ name: string }>;
  assert(userColumns.some(({ name }) => name === 'deleted_at'), 'source is not a V1.7 users schema');
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='password_reset_requests'`).get() as { count: number }).count, 0, 'source already has password_reset_requests');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'source copy has foreign key violations');
  const beforeRows = tableSnapshots(db);
  const beforeSchema = schemaObjects(db);
  const beforeRowCount = Object.values(beforeRows).reduce((sum, item) => sum + item.rowCount, 0);
  db.close(); db = undefined;

  db = openDatabase(copyPath, false);
  assert.deepEqual(tableSnapshots(db), { ...beforeRows, password_reset_requests: { rowCount: 0, sha256: createHash('sha256').update('[]').digest('hex') } }, 'a V1.7 business row changed');
  const upgradedSchema = schemaObjects(db);
  for (const legacyObject of beforeSchema) {
    assert.deepEqual(upgradedSchema.find(({ type, name }) => type === legacyObject.type && name === legacyObject.name), legacyObject, `legacy schema object changed: ${legacyObject.type} ${legacyObject.name}`);
  }
  const recoveryObjects = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE tbl_name='password_reset_requests' ORDER BY type,name`).all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
  assert.deepEqual(recoveryObjects.map(({ name }) => name), [
    'idx_password_reset_requests_expires',
    'idx_password_reset_requests_status_created',
    'idx_password_reset_requests_unresolved_user',
    'idx_password_reset_requests_user_status',
    'sqlite_autoindex_password_reset_requests_1',
    'password_reset_requests',
  ]);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'upgraded copy has foreign key violations');
  const firstRows = tableSnapshots(db);
  const firstSchema = schemaObjects(db);
  db.close(); db = undefined;

  db = openDatabase(copyPath, false);
  assert.deepEqual(tableSnapshots(db), firstRows, 'second open changed a row');
  assert.deepEqual(schemaObjects(db), firstSchema, 'second open changed schema');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'second-open copy has foreign key violations');
  console.log(`PASS V1.7 database copy: ${Object.keys(beforeRows).length} legacy tables / ${beforeRowCount} rows unchanged; password_reset_requests added empty with 5 indexes; FK clean; second open idempotent`);
} finally {
  try { db?.close(); } catch { /* already closed */ }
  rmSync(directory, { recursive: true, force: true });
}
