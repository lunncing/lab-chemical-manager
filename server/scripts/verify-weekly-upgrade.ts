import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/database.js';
import { beijingWeekStart } from '../src/purchase-weeks.js';

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : '';
assert(sourcePath && existsSync(sourcePath), 'usage: verify-weekly-upgrade <v1.3-database-path>');
const directory = mkdtempSync(join(tmpdir(), 'lab-v1.4-upgrade-'));
const copyPath = join(directory, basename(sourcePath));

function legacySnapshot(db: DatabaseSync) {
  const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'purchase_weekly_entries' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  return Object.fromEntries(names.map((name) => {
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    return [name, { rowCount: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
  }));
}

let db: DatabaseSync | undefined;
try {
  copyFileSync(sourcePath, copyPath);
  db = new DatabaseSync(copyPath);
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='purchase_weekly_entries'`).get() as { count: number }).count, 0, 'source is not a V1.3 database');
  const before = legacySnapshot(db);
  const eligible = db.prepare(`SELECT id,decided_at FROM purchases WHERE request_type='normal' AND hazardous=0 AND status IN ('approved','purchased') AND decided_at IS NOT NULL ORDER BY id`).all() as Array<{ id: number; decided_at: string }>;
  db.close(); db = undefined;

  db = openDatabase(copyPath, false);
  assert.deepEqual(legacySnapshot(db), before, 'a legacy table changed during upgrade');
  const entries = (db.prepare('SELECT id,purchase_id,week_start,added_at FROM purchase_weekly_entries ORDER BY purchase_id').all() as Array<Record<string, unknown>>).map((row) => ({ id: Number(row.id), purchaseId: Number(row.purchase_id), weekStart: String(row.week_start), addedAt: String(row.added_at) }));
  assert.equal(entries.length, eligible.length, 'backfill row count mismatch');
  assert.equal(new Set(entries.map(({ purchaseId }) => purchaseId)).size, entries.length, 'purchase_id is not unique');
  assert.deepEqual(entries.map(({ purchaseId, weekStart }) => ({ purchaseId, weekStart })), eligible.map(({ id, decided_at }) => ({ purchaseId: id, weekStart: beijingWeekStart(decided_at) })));
  const firstEntries = JSON.stringify(entries);
  db.close(); db = undefined;

  db = openDatabase(copyPath, false);
  const secondEntries = (db.prepare('SELECT id,purchase_id,week_start,added_at FROM purchase_weekly_entries ORDER BY purchase_id').all() as Array<Record<string, unknown>>).map((row) => ({ id: Number(row.id), purchaseId: Number(row.purchase_id), weekStart: String(row.week_start), addedAt: String(row.added_at) }));
  assert.equal(JSON.stringify(secondEntries), firstEntries, 'second open changed or duplicated archive entries');
  assert.deepEqual(legacySnapshot(db), before, 'a legacy table changed on second open');
  console.log(`PASS V1.3 production database copy: ${Object.keys(before).length} legacy tables unchanged; ${entries.length} eligible rows backfilled; second open idempotent`);
} finally {
  try { db?.close(); } catch { /* already closed */ }
  rmSync(directory, { recursive: true, force: true });
}
