import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as socketClient, type Socket } from 'socket.io-client';
import { digestToken, verifyPassword } from '../src/security.js';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
const sockets: Socket[] = [];

beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await ctx.system.close();
});

function insertRequest(username: string, token: string, status: 'pending' | 'approved' | 'rejected' | 'appealed', expiresAt = '2099-09-06T00:00:00.000Z') {
  const user = ctx.system.db.prepare('SELECT id FROM users WHERE username=?').get(username) as { id: number };
  const now = '2026-08-30T00:00:00.000Z';
  const reviewer = ctx.system.db.prepare(`SELECT id FROM users WHERE username='admin'`).get() as { id: number };
  const result = ctx.system.db.prepare(`INSERT INTO password_reset_requests
    (user_id,recovery_token_hash,status,reviewer_id,review_comment,created_at,updated_at,expires_at,reviewed_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    user.id, digestToken(token), status, status === 'rejected' ? reviewer.id : null, status === 'rejected' ? '首次核验未通过' : null,
    now, now, expiresAt, status === 'rejected' ? now : null,
  );
  return { id: Number(result.lastInsertRowid), token, userId: user.id };
}

async function recovery(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  return fetch(`${ctx.base}/api/password-recovery${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { cookie: `lab_password_recovery=${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = socketClient(ctx.base, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true });
    sockets.push(socket); socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
}

function nextEvent<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${name}`)), 4000);
    socket.once(name, (value) => { clearTimeout(timer); resolve(value); });
  });
}

describe('public password recovery appeal', () => {
  it('reopens the matching rejected request with safe audit, admin notification, realtime, and no purchase task', async () => {
    const request = insertRequest('member-a', 'appeal-success-browser-token', 'rejected');
    const adminCookie = await login(ctx.base, 'admin');
    const adminSocket = await connect(adminCookie);
    const changedEvent = nextEvent<Record<string, unknown>>(adminSocket, 'password-reset-request:changed');
    const auditEvent = nextEvent<Record<string, unknown>>(adminSocket, 'audit:created');
    const notificationEvent = nextEvent<Record<string, unknown>>(adminSocket, 'notification:created');
    const tasksBefore = await (await api(ctx.base, adminCookie, '/api/purchases/tasks/summary')).json();

    const response = await recovery('/appeal', { reason: '可以通过课题组登记电话再次核验' }, request.token);
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toEqual({ state: 'appealed' });
    expect(ctx.system.db.prepare(`SELECT status,appeal_reason,version,review_comment FROM password_reset_requests WHERE id=?`).get(request.id)).toEqual({
      status: 'appealed', appeal_reason: '可以通过课题组登记电话再次核验', version: 2, review_comment: '首次核验未通过',
    });
    const changed = await changedEvent; const audit = await auditEvent; const notification = await notificationEvent;
    const updatedAt = (ctx.system.db.prepare(`SELECT updated_at FROM password_reset_requests WHERE id=?`).get(request.id) as { updated_at: string }).updated_at;
    expect(changed).toEqual({ id: request.id, status: 'appealed', version: 2, updatedAt });
    expect(audit).toMatchObject({ action: 'password_reset_appealed', objectId: String(request.id) });
    expect(audit.details).toEqual({ subjectUserId: request.userId, status: 'appealed', source: 'public_password_recovery', identityVerified: false });
    expect(notification).toMatchObject({ category: 'password_reset', title: '密码修改申诉' });
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE n.category='password_reset' AND n.title='密码修改申诉' AND u.role IN ('normal_admin','super_admin')`).get() as { count: number }).count).toBe(2);
    expect(await (await api(ctx.base, adminCookie, '/api/purchases/tasks/summary')).json()).toEqual(tasksBefore);
    expect((await (await api(ctx.base, adminCookie, '/api/password-reset-requests')).json()).requests.map(({ id }: { id: number }) => id)).toContain(request.id);
    const stored = JSON.stringify({ response: await response.json(), changed, audit, notification, rows: ctx.system.db.prepare(`SELECT summary,details_json FROM audit_logs WHERE action='password_reset_appealed'`).all() });
    expect(stored).not.toContain(request.token); expect(stored).not.toContain(digestToken(request.token));
  });

  it('validates reason, denies missing/wrong cookies generically, and permits only one appeal transition', async () => {
    const request = insertRequest('member-a', 'appeal-security-browser-token', 'rejected');
    expect((await recovery('/appeal', { reason: '' }, request.token)).status).toBe(400);
    expect((await recovery('/appeal', { reason: 'x'.repeat(1001) }, request.token)).status).toBe(400);
    const missing = await recovery('/appeal', { reason: '请求复核' });
    const wrong = await recovery('/appeal', { reason: '请求复核' }, 'wrong-appeal-cookie');
    expect(missing.status).toBe(401); expect(wrong.status).toBe(401);
    expect(await missing.json()).toEqual(await wrong.json());

    const results = await Promise.all([
      recovery('/appeal', { reason: '第一次并发申诉' }, request.token),
      recovery('/appeal', { reason: '第二次并发申诉' }, request.token),
    ]);
    expect(results.map(({ status }) => status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='password_reset_appealed' AND object_id=?`).get(String(request.id)) as { count: number }).count).toBe(1);
    expect((ctx.system.db.prepare(`SELECT version FROM password_reset_requests WHERE id=?`).get(request.id) as { version: number }).version).toBe(2);
  });

  it('expires rejected authority and rolls back a failed notification transaction', async () => {
    const expired = insertRequest('member-a', 'expired-appeal-browser-token', 'rejected', '2000-01-01T00:00:00.000Z');
    const expiredResponse = await recovery('/appeal', { reason: '过期后申诉' }, expired.token);
    expect(expiredResponse.status).toBe(409);
    expect(ctx.system.db.prepare('SELECT status,version FROM password_reset_requests WHERE id=?').get(expired.id)).toEqual({ status: 'expired', version: 2 });

    const rollback = insertRequest('member-b', 'rollback-appeal-browser-token', 'rejected');
    ctx.system.db.exec(`CREATE TRIGGER fail_password_appeal_notification BEFORE INSERT ON notifications
      WHEN NEW.title='密码修改申诉' BEGIN SELECT RAISE(ABORT,'forced appeal notification failure'); END;`);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await recovery('/appeal', { reason: '本次应整体回滚' }, rollback.token);
    consoleError.mockRestore();
    expect(failed.status).toBe(500);
    expect(ctx.system.db.prepare('SELECT status,appeal_reason,version FROM password_reset_requests WHERE id=?').get(rollback.id)).toEqual({ status: 'rejected', appeal_reason: null, version: 1 });
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='password_reset_appealed' AND object_id=?`).get(String(rollback.id)) as { count: number }).count).toBe(0);
  });
});

describe('public approved password reset', () => {
  const passwords = { newPassword: 'RecoveredPassword123!', newPasswordConfirm: 'RecoveredPassword123!' };

  it('atomically consumes matching approved authority, changes password, revokes sessions, clears cookie, audits, and emits safely', async () => {
    const request = insertRequest('member-a', 'approved-reset-browser-token', 'approved');
    const firstSession = await login(ctx.base, 'member-a'); const secondSession = await login(ctx.base, 'member-a');
    const socket = await connect(firstSession);
    const changedEvent = nextEvent<Record<string, unknown>>(socket, 'password-reset-request:changed');
    const auditEvent = nextEvent<Record<string, unknown>>(socket, 'audit:created');
    const disconnectEvent = nextEvent<string>(socket, 'disconnect');

    const response = await recovery('/reset-approved', passwords, request.token);
    expect(response.status).toBe(200);
    const responseBody = await response.clone().json();
    expect(responseBody).toEqual({ changed: true });
    const clearCookie = response.headers.get('set-cookie') ?? '';
    expect(clearCookie).toMatch(/^lab_password_recovery=;/);
    expect(clearCookie).toMatch(/HttpOnly.*SameSite=Lax.*Path=\/.*Max-Age=0/i);
    expect(clearCookie).not.toMatch(/; Secure/i);
    expect(await changedEvent).toMatchObject({ id: request.id, status: 'consumed', version: 2 });
    expect(await auditEvent).toMatchObject({ action: 'password_reset_consumed', objectId: String(request.id) });
    expect(await disconnectEvent).toBe('io server disconnect');

    const user = ctx.system.db.prepare(`SELECT password_hash FROM users WHERE username='member-a'`).get() as { password_hash: string };
    expect(verifyPassword(passwords.newPassword, user.password_hash)).toBe(true);
    expect(verifyPassword('Demo1234!', user.password_hash)).toBe(false);
    expect(ctx.system.db.prepare('SELECT status,version,consumed_at FROM password_reset_requests WHERE id=?').get(request.id)).toMatchObject({ status: 'consumed', version: 2 });
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM sessions WHERE user_id=?').get(request.userId) as { count: number }).count).toBe(0);
    expect((await api(ctx.base, firstSession, '/api/auth/me')).status).toBe(401);
    expect((await api(ctx.base, secondSession, '/api/auth/me')).status).toBe(401);
    const newLogin = await fetch(`${ctx.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'member-a', password: passwords.newPassword }) });
    expect(newLogin.status).toBe(200);

    const exposed = JSON.stringify({ responseBody, request: ctx.system.db.prepare(`SELECT status,version,consumed_at FROM password_reset_requests WHERE id=?`).get(request.id), audits: ctx.system.db.prepare(`SELECT summary,details_json FROM audit_logs WHERE action='password_reset_consumed'`).all() });
    for (const secret of [request.token, digestToken(request.token), passwords.newPassword]) expect(exposed).not.toContain(secret);
  });

  it('validates passwords, denies missing/wrong cookies generically, and rejects wrong state or expiry without changing password', async () => {
    const request = insertRequest('member-a', 'reset-security-browser-token', 'approved');
    expect((await recovery('/reset-approved', { ...passwords, newPassword: 'short', newPasswordConfirm: 'short' }, request.token)).status).toBe(400);
    expect((await recovery('/reset-approved', { ...passwords, newPasswordConfirm: 'DifferentPassword123!' }, request.token)).status).toBe(400);
    const missing = await recovery('/reset-approved', passwords);
    const wrong = await recovery('/reset-approved', passwords, 'wrong-reset-cookie');
    expect(missing.status).toBe(401); expect(wrong.status).toBe(401);
    expect(await missing.json()).toEqual(await wrong.json());

    ctx.system.db.prepare(`UPDATE password_reset_requests SET status='rejected' WHERE id=?`).run(request.id);
    expect((await recovery('/reset-approved', passwords, request.token)).status).toBe(409);
    ctx.system.db.prepare(`UPDATE password_reset_requests SET status='approved',expires_at='2000-01-01T00:00:00.000Z' WHERE id=?`).run(request.id);
    expect((await recovery('/reset-approved', passwords, request.token)).status).toBe(409);
    expect(ctx.system.db.prepare('SELECT status FROM password_reset_requests WHERE id=?').get(request.id)).toEqual({ status: 'expired' });
    const user = ctx.system.db.prepare(`SELECT password_hash FROM users WHERE username='member-a'`).get() as { password_hash: string };
    expect(verifyPassword('Demo1234!', user.password_hash)).toBe(true);
  });

  it('allows one concurrent consumption and rejects token reuse', async () => {
    const request = insertRequest('member-a', 'concurrent-approved-reset-token', 'approved');
    const results = await Promise.all([
      recovery('/reset-approved', passwords, request.token),
      recovery('/reset-approved', passwords, request.token),
    ]);
    expect(results.map(({ status }) => status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='password_reset_consumed' AND object_id=?`).get(String(request.id)) as { count: number }).count).toBe(1);
    expect(ctx.system.db.prepare('SELECT status,version FROM password_reset_requests WHERE id=?').get(request.id)).toEqual({ status: 'consumed', version: 2 });
    expect((await recovery('/reset-approved', passwords, request.token)).status).toBe(409);
  });

  it('rolls back password, sessions, request consumption, and audit together', async () => {
    const request = insertRequest('member-a', 'rollback-approved-reset-token', 'approved');
    const session = await login(ctx.base, 'member-a');
    ctx.system.db.exec(`CREATE TRIGGER fail_password_reset_consumed_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action='password_reset_consumed' BEGIN SELECT RAISE(ABORT,'forced reset audit failure'); END;`);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await recovery('/reset-approved', passwords, request.token);
    consoleError.mockRestore();
    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(ctx.system.db.prepare('SELECT status,version,consumed_at FROM password_reset_requests WHERE id=?').get(request.id)).toEqual({ status: 'approved', version: 1, consumed_at: null });
    const user = ctx.system.db.prepare(`SELECT password_hash FROM users WHERE username='member-a'`).get() as { password_hash: string };
    expect(verifyPassword('Demo1234!', user.password_hash)).toBe(true);
    expect(verifyPassword(passwords.newPassword, user.password_hash)).toBe(false);
    expect((await api(ctx.base, session, '/api/auth/me')).status).toBe(200);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='password_reset_consumed'`).get() as { count: number }).count).toBe(0);
  });
});
