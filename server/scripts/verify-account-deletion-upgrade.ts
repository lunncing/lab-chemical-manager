import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/database.js';

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : '';
assert(sourcePath && existsSync(sourcePath), 'usage: verify-account-deletion-upgrade <v1.6-database-path>');
const directory = mkdtempSync(join(tmpdir(), 'lab-v1.7-account-upgrade-'));
const copyPath = join(directory, basename(sourcePath));

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

function quotedColumns(columns: ColumnInfo[]): string {
  return columns.map(({ name }) => `"${name.replaceAll('"', '""')}"`).join(',');
}

function legacySnapshot(db: DatabaseSync, userColumns: ColumnInfo[]) {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => {
    const selection = table === 'users' ? quotedColumns(userColumns) : '*';
    const rows = db.prepare(`SELECT ${selection} FROM "${table}" ORDER BY rowid`).all();
    return [table, { rowCount: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
  }));
}

function unaffectedSchema(db: DatabaseSync) {
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND NOT (type='table' AND name='users')
    ORDER BY type,name`).all();
}

let db: DatabaseSync | undefined;
try {
  copyFileSync(sourcePath, copyPath);
  db = new DatabaseSync(copyPath);
  const legacyColumns = db.prepare(`PRAGMA table_info('users')`).all() as unknown as ColumnInfo[];
  assert(!legacyColumns.some(({ name }) => name === 'deleted_at'), 'source is not a V1.6 users schema');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'source copy has foreign key violations');
  const beforeRows = legacySnapshot(db, legacyColumns);
  const beforeSchema = unaffectedSchema(db);
  const legacyUserCount = (db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number }).count;
  db.close(); db = undefined;

  db = openDatabase(copyPath, false);
  assert.deepEqual(legacySnapshot(db, legacyColumns), beforeRows, 'a V1.6 business row changed during users.deleted_at upgrade');
  assert.deepEqual(unaffectedSchema(db), beforeSchema, 'a non-users schema object changed during users.deleted_at upgrade');
  const upgradedColumns = db.prepare(`PRAGMA table_info('users')`).all() as unknown as ColumnInfo[];
  assert.deepEqual(upgradedColumns.slice(0, legacyColumns.length), legacyColumns, 'an existing users column changed');
  const addedColumns = upgradedColumns.slice(legacyColumns.length);
  assert.equal(addedColumns.length, 1, 'users.deleted_at was not added exactly once');
  assert.deepEqual({ ...addedColumns[0]! }, {
    cid: legacyColumns.length, name: 'deleted_at', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0,
  });
  assert.equal((db.prepare('SELECT COUNT(*) count FROM users WHERE deleted_at IS NOT NULL').get() as { count: number }).count, 0, 'a legacy user was marked deleted');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'upgraded copy has foreign key violations');
  const firstRows = legacySnapshot(db, legacyColumns);
  const firstUsers = db.prepare('SELECT * FROM users ORDER BY rowid').all();
  const firstSchema = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all();
  db.close(); db = undefined;

  db = openDatabase(copyPath, false);
  assert.deepEqual(legacySnapshot(db, legacyColumns), firstRows, 'second open changed a V1.6 business row');
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY rowid').all(), firstUsers, 'second open changed users or deleted_at');
  assert.deepEqual(db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all(), firstSchema, 'second open changed schema');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'second-open copy has foreign key violations');
  console.log(`PASS V1.6 production database copy: ${Object.keys(beforeRows).length} tables and ${legacyUserCount} users unchanged; nullable deleted_at added once; FK clean; second open idempotent`);
} finally {
  try { db?.close(); } catch { /* already closed */ }
  rmSync(directory, { recursive: true, force: true });
}
