import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRegistrationInvite, digestInviteCode } from '../src/registration-invites.js';
import { openDatabase } from '../src/database.js';

const databases: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) { try { db.close(); } catch { /* already closed */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function trackedDatabase(path = ':memory:') {
  const db = openDatabase(path, true); databases.push(db); return db;
}

function legacySnapshot(db: ReturnType<typeof openDatabase>) {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'registration_invites' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name);
  return Object.fromEntries(tables.map((table) => {
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
    return [table, { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
  }));
}

describe('registration invite cryptography and hash-only persistence', () => {
  it('generates unique LSF codes with exactly 192 random bits and stores only SHA-256 plus a non-reconstructable hint', () => {
    const db = trackedDatabase();
    const creator = db.prepare(`SELECT id FROM users WHERE username='admin'`).get() as { id: number };
    const now = new Date('2026-08-30T08:00:00.000Z');
    const invites = Array.from({ length: 32 }, () => createRegistrationInvite(db, creator.id, now));

    expect(new Set(invites.map(({ code }) => code)).size).toBe(invites.length);
    for (const invite of invites) {
      expect(invite.code).toMatch(/^LSF-[A-Za-z0-9_-]{32}$/);
      expect(Buffer.from(invite.code.slice(4), 'base64url')).toHaveLength(24);
      expect(invite.codeHint).toMatch(/^LSF-[A-Za-z0-9_-]{4}…[A-Za-z0-9_-]{4}$/);
      expect(invite.expiresAt).toBe('2026-09-06T08:00:00.000Z');
      const stored = db.prepare('SELECT * FROM registration_invites WHERE id=?').get(invite.id) as Record<string, unknown>;
      expect(stored.code_hash).toBe(digestInviteCode(invite.code));
      expect(stored.code_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.code_hint).toBe(invite.codeHint);
      expect(JSON.stringify(stored)).not.toContain(invite.code);
    }
  });
});

describe('V1.5 additive registration invite upgrade', () => {
  it('preserves every old table row byte-for-byte, creates the empty indexed table, passes FK check, and is idempotent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lab-invite-upgrade-')); directories.push(directory);
    const path = join(directory, 'v1.5.sqlite');
    let db = trackedDatabase(path);
    db.exec('DROP TABLE IF EXISTS registration_invites');
    const before = legacySnapshot(db); db.close(); databases.pop();

    db = trackedDatabase(path);
    expect(legacySnapshot(db)).toEqual(before);
    expect(db.prepare('SELECT * FROM registration_invites').all()).toEqual([]);
    expect((db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='registration_invites' ORDER BY name`).all() as Array<{ name: string }>).map(({ name }) => name)).toEqual([
      'idx_registration_invites_created_by', 'idx_registration_invites_expires_at', 'idx_registration_invites_used_by', 'sqlite_autoindex_registration_invites_1',
    ]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const schema = db.prepare(`SELECT type,name,sql FROM sqlite_master WHERE tbl_name='registration_invites' ORDER BY type,name`).all();
    db.close(); databases.pop();

    db = trackedDatabase(path);
    expect(db.prepare(`SELECT type,name,sql FROM sqlite_master WHERE tbl_name='registration_invites' ORDER BY type,name`).all()).toEqual(schema);
    expect(legacySnapshot(db)).toEqual(before);
    expect(db.prepare('SELECT * FROM registration_invites').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
