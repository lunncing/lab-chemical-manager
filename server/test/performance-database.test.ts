import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';

const databases: DatabaseSync[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function pragmaNumber(db: DatabaseSync, pragma: string): number {
  const row = db.prepare(`PRAGMA ${pragma}`).get() as Record<string, number>;
  return Number(Object.values(row)[0]);
}

describe('low-spec SQLite configuration', () => {
  it('uses WAL/NORMAL/5s busy timeout for a legacy file DB without changing rows or breaking FKs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lab-performance-db-'));
    directories.push(directory);
    const path = join(directory, 'legacy.sqlite');
    let db = new DatabaseSync(path);
    databases.push(db);
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
        role TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        demo INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      );
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL,
        object_type TEXT NOT NULL, object_id TEXT NOT NULL, summary TEXT NOT NULL,
        details_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO users VALUES (41,'legacy','旧成员','member','keep-hash',1,0,7,
        '2026-08-01T00:00:00.000Z','2026-08-02T00:00:00.000Z',NULL);
      INSERT INTO audit_logs VALUES (71,41,'legacy_action','chemical','9','保留旧审计',
        '{"kept":true}','2026-08-03T00:00:00.000Z');
    `);
    const usersBefore = db.prepare('SELECT * FROM users').all();
    const auditsBefore = db.prepare('SELECT * FROM audit_logs').all();
    db.close();

    db = openDatabase(path, false);
    databases.push(db);

    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    expect(pragmaNumber(db, 'synchronous')).toBe(1);
    expect(pragmaNumber(db, 'busy_timeout')).toBe(5000);
    expect(pragmaNumber(db, 'foreign_keys')).toBe(1);
    expect(db.prepare('SELECT * FROM users').all()).toEqual(usersBefore);
    expect(db.prepare('SELECT * FROM audit_logs').all()).toEqual(auditsBefore);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_audit_logs_created'`).get()).toEqual({ name: 'idx_audit_logs_created' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps in-memory test databases compatible and foreign keys enabled', () => {
    const db = openDatabase(':memory:', false);
    databases.push(db);

    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('memory');
    expect(pragmaNumber(db, 'foreign_keys')).toBe(1);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_audit_logs_created'`).get()).toEqual({ name: 'idx_audit_logs_created' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
