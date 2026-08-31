import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';

const databases: DatabaseSync[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    try { db.close(); } catch { /* already closed */ }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function addUser(db: DatabaseSync, id = 1): void {
  db.prepare(`INSERT INTO users (id,username,display_name,role,password_hash,active,demo,version,created_at,updated_at)
    VALUES (?,?,?,'member','test-hash',1,0,1,?,?)`).run(id, `member-${id}`, `成员${id}`, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z');
}

describe('password_reset_requests additive schema', () => {
  it('creates the constrained table, FKs, required indexes, and one-unresolved-per-user invariant', () => {
    const db = openDatabase(':memory:', false);
    databases.push(db);
    const columns = db.prepare(`PRAGMA table_info('password_reset_requests')`).all() as Array<{ name: string; notnull: number; dflt_value: unknown; pk: number }>;
    expect(columns.map(({ name }) => name)).toEqual([
      'id', 'user_id', 'recovery_token_hash', 'status', 'appeal_reason', 'reviewer_id', 'review_comment',
      'version', 'created_at', 'updated_at', 'expires_at', 'reviewed_at', 'consumed_at',
    ]);
    expect(columns.find(({ name }) => name === 'version')).toMatchObject({ notnull: 1, dflt_value: '1' });
    expect(columns.find(({ name }) => name === 'id')).toMatchObject({ pk: 1 });

    const foreignKeys = db.prepare(`PRAGMA foreign_key_list('password_reset_requests')`).all() as Array<{ from: string; table: string; to: string }>;
    expect(foreignKeys.map(({ from, table, to }) => ({ from, table, to }))).toEqual(expect.arrayContaining([
      { from: 'user_id', table: 'users', to: 'id' },
      { from: 'reviewer_id', table: 'users', to: 'id' },
    ]));
    const indexes = db.prepare(`PRAGMA index_list('password_reset_requests')`).all() as Array<{ name: string; unique: number; partial: number }>;
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'idx_password_reset_requests_user_status', unique: 0 }),
      expect.objectContaining({ name: 'idx_password_reset_requests_status_created', unique: 0 }),
      expect.objectContaining({ name: 'idx_password_reset_requests_expires', unique: 0 }),
      expect.objectContaining({ name: 'idx_password_reset_requests_unresolved_user', unique: 1, partial: 1 }),
    ]));

    addUser(db);
    const insert = db.prepare(`INSERT INTO password_reset_requests
      (user_id,recovery_token_hash,status,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?)`);
    insert.run(1, 'a'.repeat(64), 'pending', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', '2026-09-06T00:00:00.000Z');
    expect(() => insert.run(1, 'b'.repeat(64), 'approved', '2026-08-30T00:00:01.000Z', '2026-08-30T00:00:01.000Z', '2026-09-06T00:00:01.000Z')).toThrow(/UNIQUE constraint failed/);
    db.prepare(`UPDATE password_reset_requests SET status='consumed' WHERE user_id=1`).run();
    insert.run(1, 'b'.repeat(64), 'rejected', '2026-08-30T00:00:02.000Z', '2026-08-30T00:00:02.000Z', '2026-09-06T00:00:02.000Z');
    expect(() => insert.run(1, 'b'.repeat(64), 'expired', '2026-08-30T00:00:03.000Z', '2026-08-30T00:00:03.000Z', '2026-09-06T00:00:03.000Z')).toThrow(/UNIQUE constraint failed/);
    expect(() => insert.run(1, 'c'.repeat(64), 'invalid', '2026-08-30T00:00:04.000Z', '2026-08-30T00:00:04.000Z', '2026-09-06T00:00:04.000Z')).toThrow(/CHECK constraint failed/);
  });

  it('preserves existing V1.7 tables and rows and is identical on a second open', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lab-password-recovery-schema-'));
    directories.push(directory);
    const path = join(directory, 'v1.7.sqlite');
    let db = new DatabaseSync(path);
    databases.push(db);
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('member','normal_admin','super_admin','hazardous_buyer')),
        password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      );
      CREATE TABLE v17_marker (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO users VALUES (71,'legacy-v17','旧版成员','member','unchanged-hash',1,0,4,
        '2026-08-01T00:00:00.000Z','2026-08-02T00:00:00.000Z',NULL);
      INSERT INTO v17_marker VALUES (9,'keep exactly');
    `);
    const originalUsersSql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get() as { sql: string }).sql;
    const originalUsers = db.prepare('SELECT * FROM users').all();
    const originalMarkerSql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='v17_marker'`).get() as { sql: string }).sql;
    const originalMarker = db.prepare('SELECT * FROM v17_marker').all();
    db.close();

    db = openDatabase(path, false);
    databases.push(db);
    expect((db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get() as { sql: string }).sql).toBe(originalUsersSql);
    expect(db.prepare('SELECT * FROM users').all()).toEqual(originalUsers);
    expect((db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='v17_marker'`).get() as { sql: string }).sql).toBe(originalMarkerSql);
    expect(db.prepare('SELECT * FROM v17_marker').all()).toEqual(originalMarker);
    const firstRecoverySchema = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
      WHERE tbl_name='password_reset_requests' OR name LIKE 'idx_password_reset_requests_%' ORDER BY type,name`).all();
    expect(firstRecoverySchema).toHaveLength(6);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();

    db = openDatabase(path, false);
    databases.push(db);
    expect(db.prepare('SELECT * FROM users').all()).toEqual(originalUsers);
    expect(db.prepare('SELECT * FROM v17_marker').all()).toEqual(originalMarker);
    expect(db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
      WHERE tbl_name='password_reset_requests' OR name LIKE 'idx_password_reset_requests_%' ORDER BY type,name`).all()).toEqual(firstRecoverySchema);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
