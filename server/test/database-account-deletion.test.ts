import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';

const directories: string[] = [];
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    try { db.close(); } catch { /* already closed */ }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'lab-account-deletion-'));
  directories.push(directory);
  return join(directory, 'v1.6.sqlite');
}

const legacyColumns = 'id,username,display_name,role,password_hash,active,demo,version,created_at,updated_at';

describe('V1.7 users.deleted_at migration', () => {
  it('adds one nullable column to a V1.6 users table without changing rows and is idempotent', () => {
    const path = tempPath();
    let db = new DatabaseSync(path);
    databases.push(db);
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('member','normal_admin','super_admin','hazardous_buyer')),
        password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO users (${legacyColumns}) VALUES
        (41,'legacy.user','旧版用户','member','legacy-hash',1,0,7,'2026-08-01T01:02:03.000Z','2026-08-02T04:05:06.000Z');
    `);
    const before = db.prepare(`SELECT ${legacyColumns} FROM users`).all();
    db.close();

    db = openDatabase(path, false);
    databases.push(db);
    expect(db.prepare(`SELECT ${legacyColumns} FROM users`).all()).toEqual(before);
    expect(db.prepare('SELECT deleted_at FROM users WHERE id=41').get()).toEqual({ deleted_at: null });
    expect((db.prepare(`PRAGMA table_info('users')`).all() as Array<{ name: string }>).filter(({ name }) => name === 'deleted_at')).toHaveLength(1);
    db.close();

    db = openDatabase(path, false);
    databases.push(db);
    expect(db.prepare(`SELECT ${legacyColumns} FROM users`).all()).toEqual(before);
    expect(db.prepare('SELECT deleted_at FROM users WHERE id=41').get()).toEqual({ deleted_at: null });
    expect((db.prepare(`PRAGMA table_info('users')`).all() as Array<{ name: string }>).filter(({ name }) => name === 'deleted_at')).toHaveLength(1);
  });

  it('includes deleted_at on a fresh database', () => {
    const db = openDatabase(':memory:', false);
    databases.push(db);
    const column = (db.prepare(`PRAGMA table_info('users')`).all() as Array<{ name: string; notnull: number; dflt_value: unknown }>).find(({ name }) => name === 'deleted_at');
    expect(column).toMatchObject({ name: 'deleted_at', notnull: 0, dflt_value: null });
  });
});
