import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestToken, verifyPassword } from '../src/security.js';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

async function recovery(path: string, body: Record<string, unknown>, cookie?: string): Promise<Response> {
  return fetch(`${ctx.base}/api/password-recovery${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function userId(username = 'member-a'): number {
  return Number((ctx.system.db.prepare('SELECT id FROM users WHERE username=?').get(username) as { id: number }).id);
}

function insertRecovery(token: string, status: 'pending' | 'approved' | 'rejected' | 'appealed' | 'consumed' | 'expired', username = 'member-a'): number {
  const now = '2026-08-30T00:00:00.000Z';
  const expires = '2099-09-06T00:00:00.000Z';
  const result = ctx.system.db.prepare(`INSERT INTO password_reset_requests
    (user_id,recovery_token_hash,status,created_at,updated_at,expires_at,consumed_at)
    VALUES (?,?,?,?,?,?,?)`).run(userId(username), digestToken(token), status, now, now, expires, status === 'consumed' ? now : null);
  return Number(result.lastInsertRowid);
}

describe('public password recovery lookup', () => {
  it('returns only the matching browser state and never reveals another browser request', async () => {
    const token = 'same-browser-secret';
    const id = insertRecovery(token, 'pending');
    const displayName = '成员甲';

    expect(await (await recovery('/lookup', { displayName })).json()).toEqual({ state: 'verify_current' });
    expect(await (await recovery('/lookup', { displayName }, 'lab_password_recovery=wrong-browser')).json()).toEqual({ state: 'verify_current' });
    expect(await (await recovery('/lookup', { displayName }, `lab_password_recovery=${token}`)).json()).toEqual({ state: 'pending' });

    for (const state of ['approved', 'rejected', 'appealed'] as const) {
      ctx.system.db.prepare('UPDATE password_reset_requests SET status=? WHERE id=?').run(state, id);
      expect(await (await recovery('/lookup', { displayName }, `lab_password_recovery=${token}`)).json()).toEqual({ state });
    }
    for (const state of ['consumed', 'expired'] as const) {
      ctx.system.db.prepare('UPDATE password_reset_requests SET status=? WHERE id=?').run(state, id);
      expect(await (await recovery('/lookup', { displayName }, `lab_password_recovery=${token}`)).json()).toEqual({ state: 'verify_current' });
    }
  });

  it('uses only one active non-deleted name match and handles expiry without exposing details', async () => {
    expect((await recovery('/lookup', { displayName: '不存在' })).status).toBe(404);
    ctx.system.db.prepare(`UPDATE users SET display_name='同名成员' WHERE username IN ('member-a','member-b')`).run();
    const duplicate = await recovery('/lookup', { displayName: '同名成员' });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.message).toBe('存在同名账号，请联系管理员');

    ctx.system.db.prepare(`UPDATE users SET display_name='停用成员',active=0 WHERE username='member-a'`).run();
    expect((await recovery('/lookup', { displayName: '停用成员' })).status).toBe(404);
    ctx.system.db.prepare(`UPDATE users SET display_name='删除成员',active=1,deleted_at=? WHERE username='member-a'`).run('2026-08-30T01:00:00.000Z');
    expect((await recovery('/lookup', { displayName: '删除成员' })).status).toBe(404);

    ctx.system.db.prepare(`UPDATE users SET display_name='成员甲',deleted_at=NULL WHERE username='member-a'`).run();
    const token = 'expired-browser-secret';
    const id = insertRecovery(token, 'approved');
    ctx.system.db.prepare(`UPDATE password_reset_requests SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?`).run(id);
    expect(await (await recovery('/lookup', { displayName: '成员甲' }, `lab_password_recovery=${token}`)).json()).toEqual({ state: 'verify_current' });
    expect(ctx.system.db.prepare('SELECT status,version FROM password_reset_requests WHERE id=?').get(id)).toEqual({ status: 'expired', version: 2 });
  });
});

describe('public password change with current password', () => {
  const valid = {
    displayName: '成员甲', currentPassword: 'Demo1234!',
    newPassword: 'ChangedPassword123!', newPasswordConfirm: 'ChangedPassword123!',
  };

  it('atomically changes the password, revokes sessions and recovery authority, and writes a secret-free audit', async () => {
    const firstSession = await login(ctx.base, 'member-a');
    const secondSession = await login(ctx.base, 'member-a');
    const token = 'request-invalidated-by-password-change';
    const requestId = insertRecovery(token, 'approved');
    const before = ctx.system.db.prepare(`SELECT version FROM users WHERE username='member-a'`).get() as { version: number };

    const response = await recovery('/change-with-current', valid);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: true });
    const user = ctx.system.db.prepare(`SELECT id,password_hash,version FROM users WHERE username='member-a'`).get() as { id: number; password_hash: string; version: number };
    expect(verifyPassword(valid.newPassword, user.password_hash)).toBe(true);
    expect(verifyPassword(valid.currentPassword, user.password_hash)).toBe(false);
    expect(user.version).toBe(before.version + 1);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM sessions WHERE user_id=?').get(user.id) as { count: number }).count).toBe(0);
    expect((await api(ctx.base, firstSession, '/api/auth/me')).status).toBe(401);
    expect((await api(ctx.base, secondSession, '/api/auth/me')).status).toBe(401);
    expect(ctx.system.db.prepare('SELECT status,version FROM password_reset_requests WHERE id=?').get(requestId)).toEqual({ status: 'expired', version: 2 });

    const audit = ctx.system.db.prepare(`SELECT * FROM audit_logs WHERE action='password_changed' AND object_id=?`).get(String(user.id)) as Record<string, unknown>;
    expect(JSON.parse(String(audit.details_json))).toEqual({ method: 'current_password' });
    const persisted = JSON.stringify({ audit, notifications: ctx.system.db.prepare(`SELECT * FROM notifications WHERE object_type='password_reset_request'`).all() });
    for (const secret of [valid.currentPassword, valid.newPassword, token, digestToken(token)]) expect(persisted).not.toContain(secret);
    expect((await recovery('/lookup', { displayName: '成员甲' }, `lab_password_recovery=${token}`)).status).toBe(200);
    expect((await (await recovery('/lookup', { displayName: '成员甲' }, `lab_password_recovery=${token}`)).json()).state).toBe('verify_current');
  });

  it('validates the new password and gives the same generic error for a missing name or wrong current password', async () => {
    const short = await recovery('/change-with-current', { ...valid, newPassword: 'short', newPasswordConfirm: 'short' });
    expect(short.status).toBe(400);
    const mismatch = await recovery('/change-with-current', { ...valid, newPasswordConfirm: 'DifferentPassword123!' });
    expect(mismatch.status).toBe(400);

    const wrongPassword = await recovery('/change-with-current', { ...valid, currentPassword: 'WrongPassword!' });
    const missingName = await recovery('/change-with-current', { ...valid, displayName: '不存在' });
    expect(wrongPassword.status).toBe(401);
    expect(missingName.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await missingName.json());
    expect(JSON.stringify(await (await recovery('/change-with-current', { ...valid, currentPassword: 'WrongAgain!' })).json())).not.toContain('WrongAgain!');
  });

  it('rolls back password and session changes when the audit insert fails', async () => {
    const session = await login(ctx.base, 'member-a');
    ctx.system.db.exec(`CREATE TRIGGER fail_password_change_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action='password_changed' BEGIN SELECT RAISE(ABORT,'forced password audit failure'); END;`);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await recovery('/change-with-current', valid);
    consoleError.mockRestore();
    expect(response.status).toBe(500);
    const user = ctx.system.db.prepare(`SELECT password_hash FROM users WHERE username='member-a'`).get() as { password_hash: string };
    expect(verifyPassword('Demo1234!', user.password_hash)).toBe(true);
    expect(verifyPassword(valid.newPassword, user.password_hash)).toBe(false);
    expect((await api(ctx.base, session, '/api/auth/me')).status).toBe(200);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='password_changed'`).get() as { count: number }).count).toBe(0);
  });
});
