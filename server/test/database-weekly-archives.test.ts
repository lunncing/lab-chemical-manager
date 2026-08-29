import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';

const tempDirectories: string[] = [];
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const path of tempDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function openTracked(path: string, seedDemo: boolean): DatabaseSync {
  const db = openDatabase(path, seedDemo); databases.push(db); return db;
}

function legacySnapshot(db: DatabaseSync) {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'purchase_weekly_entries' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => {
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
    return [table, { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
  }));
}

function insertPurchase(db: DatabaseSync, values: { name: string; status: string; requestType?: 'normal' | 'urgent'; hazardous?: boolean; decidedAt?: string | null }) {
  const createdAt = '2026-08-01T00:00:00.000Z';
  return Number(db.prepare(`INSERT INTO purchases (chemical_name,specification,purpose,hazardous,request_type,applicant_id,status,created_at,updated_at,decided_at)
    VALUES (?, '1瓶', '迁移测试', ?, ?, 4, ?, ?, ?, ?)`).run(values.name, Number(values.hazardous ?? false), values.requestType ?? 'normal', values.status, createdAt, createdAt, values.decidedAt ?? null).lastInsertRowid);
}

describe('weekly purchase archive migration', () => {
  it('adds only the archive table and idempotently backfills eligible V1.3 rows without changing legacy data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lab-weekly-archive-')); tempDirectories.push(directory);
    const path = join(directory, 'v1.3.sqlite');
    let db = openTracked(path, true);
    db.exec('DROP TABLE IF EXISTS purchase_weekly_entries');
    const sunday = insertPurchase(db, { name: '周日批准', status: 'approved', decidedAt: '2026-08-30T15:59:59Z' });
    const monday = insertPurchase(db, { name: '周一已采购', status: 'purchased', decidedAt: '2026-08-30T16:00:00Z' });
    insertPurchase(db, { name: '危险品', status: 'approved', hazardous: true, decidedAt: '2026-08-30T15:00:00Z' });
    insertPurchase(db, { name: '加急', status: 'approved', requestType: 'urgent', decidedAt: '2026-08-30T15:00:00Z' });
    insertPurchase(db, { name: '被驳回', status: 'rejected', decidedAt: '2026-08-30T15:00:00Z' });
    insertPurchase(db, { name: '无决定时间', status: 'approved', decidedAt: null });
    const before = legacySnapshot(db); db.close();

    db = openTracked(path, false);
    expect((db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='purchase_weekly_entries'`).get() as { sql: string }).sql).toContain('purchase_id INTEGER NOT NULL UNIQUE REFERENCES purchases(id)');
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_purchase_weekly_entries_week_start'`).get()).toBeDefined();
    const firstEntries = db.prepare('SELECT id,purchase_id,week_start,added_at FROM purchase_weekly_entries ORDER BY purchase_id').all() as Array<Record<string, unknown>>;
    expect(firstEntries).toHaveLength(2);
    expect(firstEntries.map(({ purchase_id, week_start }) => ({ purchaseId: purchase_id, weekStart: week_start }))).toEqual([
      { purchaseId: sunday, weekStart: '2026-08-24' },
      { purchaseId: monday, weekStart: '2026-08-31' },
    ]);
    expect(firstEntries.every(({ added_at }) => typeof added_at === 'string' && added_at !== '')).toBe(true);
    expect(legacySnapshot(db)).toEqual(before);
    db.close();

    db = openTracked(path, false);
    expect(db.prepare('SELECT id,purchase_id,week_start,added_at FROM purchase_weekly_entries ORDER BY purchase_id').all()).toEqual(firstEntries);
    expect(legacySnapshot(db)).toEqual(before);
    db.close();
  });
});
