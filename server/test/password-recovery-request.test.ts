import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as socketClient, type Socket } from 'socket.io-client';
import { digestToken } from '../src/security.js';
import { login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
const sockets: Socket[] = [];

beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await ctx.system.close();
});

async function submit(displayName = '成员甲'): Promise<Response> {
  return fetch(`${ctx.base}/api/password-recovery/request`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName }),
  });
}

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = socketClient(ctx.base, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
}

function nextEvent<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${name}`)), 4000);
    socket.once(name, (value) => { clearTimeout(timer); resolve(value); });
  });
}

function recoveryCookie(response: Response): { header: string; cookie: string; token: string } {
  const header = response.headers.get('set-cookie') ?? '';
  const cookie = header.split(';')[0]!;
  const token = cookie.slice('lab_password_recovery='.length);
  return { header, cookie, token };
}

describe('public password recovery request', () => {
  it('issues a seven-day 32-byte HttpOnly cookie and commits only a digest plus safe admin actions', async () => {
    const adminCookie = await login(ctx.base, 'admin');
    const adminSocket = await connect(adminCookie);
    const changedEvent = nextEvent<Record<string, unknown>>(adminSocket, 'password-reset-request:changed');
    const auditEvent = nextEvent<Record<string, unknown>>(adminSocket, 'audit:created');
    const notificationEvent = nextEvent<Record<string, unknown>>(adminSocket, 'notification:created');
    const before = Date.now();

    const response = await submit();
    expect(response.status).toBe(201);
    const responseBody = await response.clone().json();
    expect(responseBody).toEqual({ state: 'pending' });
    const { header, cookie, token } = recoveryCookie(response);
    expect(header).toMatch(/^lab_password_recovery=[A-Za-z0-9_-]{43};/);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//i);
    expect(header).not.toMatch(/; Secure/i);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const expiresText = /Expires=([^;]+)/i.exec(header)?.[1];
    expect(expiresText).toBeTruthy();
    const cookieLifetime = Date.parse(expiresText!) - before;
    expect(cookieLifetime).toBeGreaterThan(6.99 * 86_400_000);
    expect(cookieLifetime).toBeLessThan(7.01 * 86_400_000);

    const row = ctx.system.db.prepare('SELECT * FROM password_reset_requests').get() as Record<string, unknown>;
    expect(row.status).toBe('pending');
    expect(row.recovery_token_hash).toBe(digestToken(token));
    expect(row.recovery_token_hash).not.toBe(token);
    expect(String(row.recovery_token_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(await (await fetch(`${ctx.base}/api/password-recovery/lookup`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ displayName: '成员甲' }),
    })).json()).toEqual({ state: 'pending' });

    const recipients = (ctx.system.db.prepare(`SELECT u.username,n.* FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE n.category='password_reset' ORDER BY u.username`).all() as Array<Record<string, unknown>>);
    expect(recipients.map(({ username }) => username)).toEqual(['admin', 'teacher']);
    expect(recipients.every(({ title }) => title === '密码修改申请')).toBe(true);
    const audit = ctx.system.db.prepare(`SELECT * FROM audit_logs WHERE action='password_reset_requested'`).get() as Record<string, unknown>;
    expect(audit.object_type).toBe('password_reset_request');
    expect(audit.object_id).toBe(String(row.id));

    const changed = await changedEvent; const emittedAudit = await auditEvent; const notification = await notificationEvent;
    expect(changed).toEqual({ id: Number(row.id), status: 'pending', version: 1, updatedAt: String(row.updated_at) });
    expect(JSON.parse(String(audit.details_json))).toEqual({ subjectUserId: Number(row.user_id), status: 'pending', source: 'public_password_recovery', identityVerified: false });
    expect(emittedAudit).toMatchObject({ action: 'password_reset_requested', objectId: String(row.id) });
    expect(notification).toMatchObject({ category: 'password_reset', title: '密码修改申请' });
    const publicAndPersistent = JSON.stringify({ responseBody, row: { ...row, recovery_token_hash: '[expected digest field]' }, recipients, audit, changed, emittedAudit, notification });
    expect(publicAndPersistent).not.toContain(token);
    expect(publicAndPersistent).not.toContain(digestToken(token));
  });

  it('adds Secure to both issue and clear cookies only when configured', async () => {
    await ctx.system.close();
    ctx = await startTestSystem({ cookieSecure: true });
    const response = await submit();
    expect(response.status).toBe(201);
    const issued = recoveryCookie(response);
    expect(issued.header).toMatch(/; Secure/i);
    ctx.system.db.prepare(`UPDATE password_reset_requests SET status='approved'`).run();
    const reset = await fetch(`${ctx.base}/api/password-recovery/reset-approved`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: issued.cookie },
      body: JSON.stringify({ newPassword: 'SecureRecovery123!', newPasswordConfirm: 'SecureRecovery123!' }),
    });
    expect(reset.status).toBe(200);
    expect(reset.headers.get('set-cookie')).toMatch(/^lab_password_recovery=;.*Max-Age=0; Secure$/i);
  });

  it('rejects ambiguous/missing names and suppresses duplicate and concurrent unresolved requests', async () => {
    expect((await submit('不存在')).status).toBe(404);
    ctx.system.db.prepare(`UPDATE users SET display_name='同名成员' WHERE username IN ('member-a','member-b')`).run();
    expect((await submit('同名成员')).status).toBe(409);
    ctx.system.db.prepare(`UPDATE users SET display_name=CASE username WHEN 'member-a' THEN '成员甲' ELSE '成员乙' END
      WHERE username IN ('member-a','member-b')`).run();

    const statuses = (await Promise.all([submit(), submit()])).map(({ status }) => status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM password_reset_requests WHERE status IN ('pending','approved','rejected','appealed')`).get() as { count: number }).count).toBe(1);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='password_reset_requested'`).get() as { count: number }).count).toBe(1);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications WHERE category='password_reset'`).get() as { count: number }).count).toBe(2);
    const duplicate = await submit();
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers.get('set-cookie')).toBeNull();
  });

  it('expires an old unresolved request before atomically creating its replacement', async () => {
    const user = ctx.system.db.prepare(`SELECT id FROM users WHERE username='member-a'`).get() as { id: number };
    ctx.system.db.prepare(`INSERT INTO password_reset_requests
      (user_id,recovery_token_hash,status,created_at,updated_at,expires_at)
      VALUES (?,?, 'rejected',?,?,?)`).run(user.id, digestToken('old-expired-token'), '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', '2000-01-02T00:00:00.000Z');
    const response = await submit();
    expect(response.status).toBe(201);
    expect(ctx.system.db.prepare(`SELECT status,version FROM password_reset_requests ORDER BY id`).all()).toEqual([
      { status: 'expired', version: 2 }, { status: 'pending', version: 1 },
    ]);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM password_reset_requests
      WHERE status IN ('pending','approved','rejected','appealed')`).get() as { count: number }).count).toBe(1);
  });

  it('rolls back request, audit, and notifications and emits no cookie when a notification insert fails', async () => {
    ctx.system.db.exec(`CREATE TRIGGER fail_password_reset_notification BEFORE INSERT ON notifications
      WHEN NEW.category='password_reset' BEGIN SELECT RAISE(ABORT,'forced password reset notification failure'); END;`);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await submit();
    consoleError.mockRestore();
    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM password_reset_requests').get() as { count: number }).count).toBe(0);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='password_reset_requested'`).get() as { count: number }).count).toBe(0);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications WHERE category='password_reset'`).get() as { count: number }).count).toBe(0);
  });
});
