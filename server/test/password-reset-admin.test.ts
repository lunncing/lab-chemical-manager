import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as socketClient, type Socket } from 'socket.io-client';
import { digestToken } from '../src/security.js';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
const sockets: Socket[] = [];

beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await ctx.system.close();
});

function insertRequest(username: string, token: string, status: 'pending' | 'approved' | 'rejected' | 'appealed' | 'consumed' | 'expired', options: { expiresAt?: string; appealReason?: string } = {}) {
  const user = ctx.system.db.prepare('SELECT id FROM users WHERE username=?').get(username) as { id: number };
  const now = '2026-08-30T00:00:00.000Z';
  const result = ctx.system.db.prepare(`INSERT INTO password_reset_requests
    (user_id,recovery_token_hash,status,appeal_reason,created_at,updated_at,expires_at,consumed_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    user.id, digestToken(token), status, options.appealReason ?? null, now, now, options.expiresAt ?? '2099-09-06T00:00:00.000Z', status === 'consumed' ? now : null,
  );
  return { id: Number(result.lastInsertRowid), token, userId: user.id, version: 1 };
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

async function decide(cookie: string, id: number, body: Record<string, unknown>): Promise<Response> {
  return api(ctx.base, cookie, `/api/password-reset-requests/${id}/decision`, { method: 'POST', body: JSON.stringify(body) });
}

describe('authenticated password reset request queue', () => {
  it('is limited to normal/super admins, independent of preferences, and returns only safe pending/appealed identity data', async () => {
    const pending = insertRequest('member-a', 'pending-admin-list-token', 'pending');
    const appealed = insertRequest('member-b', 'appealed-admin-list-token', 'appealed', { appealReason: '此前身份核验方式有误' });
    insertRequest('admin', 'approved-hidden-list-token', 'approved');
    insertRequest('teacher', 'rejected-hidden-list-token', 'rejected');
    const overdue = insertRequest('hazard', 'overdue-hidden-list-token', 'pending', { expiresAt: '2000-01-01T00:00:00.000Z' });
    const memberCookie = await login(ctx.base, 'member-a');
    const hazardCookie = await login(ctx.base, 'hazard');
    const adminCookie = await login(ctx.base, 'admin');
    const teacherCookie = await login(ctx.base, 'teacher');
    const adminId = (ctx.system.db.prepare(`SELECT id FROM users WHERE username='admin'`).get() as { id: number }).id;
    ctx.system.db.prepare(`INSERT INTO notification_preferences (user_id,category,enabled,updated_at) VALUES (?,'password_reset',0,?)`).run(adminId, '2026-08-30T00:00:00.000Z');

    expect((await fetch(`${ctx.base}/api/password-reset-requests`)).status).toBe(401);
    expect((await api(ctx.base, memberCookie, '/api/password-reset-requests')).status).toBe(403);
    expect((await api(ctx.base, hazardCookie, '/api/password-reset-requests')).status).toBe(403);
    const adminResponse = await api(ctx.base, adminCookie, '/api/password-reset-requests');
    const teacherResponse = await api(ctx.base, teacherCookie, '/api/password-reset-requests');
    expect(adminResponse.status).toBe(200); expect(teacherResponse.status).toBe(200);
    const body = await adminResponse.json();
    expect(body.requests.map(({ id }: { id: number }) => id)).toEqual([pending.id, appealed.id]);
    expect(body.requests[0]).toMatchObject({
      id: pending.id, status: 'pending', appealReason: null, version: 1,
      user: { id: pending.userId, username: 'member-a', displayName: '成员甲' },
    });
    expect(body.requests[1]).toMatchObject({ status: 'appealed', appealReason: '此前身份核验方式有误' });
    const serialized = JSON.stringify(body);
    for (const secret of [pending.token, appealed.token, digestToken(pending.token), digestToken(appealed.token), 'password_hash', 'recovery_token_hash']) expect(serialized).not.toContain(secret);
    expect(ctx.system.db.prepare('SELECT status,version FROM password_reset_requests WHERE id=?').get(overdue.id)).toEqual({ status: 'expired', version: 2 });
  });

  it('commits approvals/rejections with reviewer, audit, subject notification, realtime, and matching-cookie states', async () => {
    const approvable = insertRequest('member-a', 'approved-decision-token', 'pending');
    const rejectable = insertRequest('member-b', 'rejected-decision-token', 'appealed', { appealReason: '请求再次核验' });
    const adminCookie = await login(ctx.base, 'admin');
    const aliceCookie = await login(ctx.base, 'member-a');
    const adminSocket = await connect(adminCookie); const aliceSocket = await connect(aliceCookie);
    const changedEvent = nextEvent<Record<string, unknown>>(adminSocket, 'password-reset-request:changed');
    const auditEvent = nextEvent<Record<string, unknown>>(adminSocket, 'audit:created');
    const notificationEvent = nextEvent<Record<string, unknown>>(aliceSocket, 'notification:created');

    const approvedResponse = await decide(adminCookie, approvable.id, { decision: 'approved', comment: '已人工核验身份', version: 1 });
    expect(approvedResponse.status).toBe(200);
    const approved = (await approvedResponse.json()).request;
    expect(approved).toMatchObject({ id: approvable.id, status: 'approved', version: 2, reviewComment: '已人工核验身份', reviewer: { username: 'admin' } });
    expect(approved.reviewedAt).toBeTruthy();
    expect(await changedEvent).toMatchObject({ id: approvable.id, status: 'approved', version: 2 });
    expect(await auditEvent).toMatchObject({ action: 'password_reset_approved', objectId: String(approvable.id) });
    expect(await notificationEvent).toMatchObject({ category: 'password_reset', title: '密码修改申请已批准', userId: approvable.userId });

    const rejectedResponse = await decide(adminCookie, rejectable.id, { decision: 'rejected', comment: '身份资料不一致', version: 1 });
    expect(rejectedResponse.status).toBe(200);
    expect((await rejectedResponse.json()).request).toMatchObject({ id: rejectable.id, status: 'rejected', version: 2, reviewComment: '身份资料不一致', reviewer: { username: 'admin' } });
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action IN ('password_reset_approved','password_reset_rejected')`).get() as { count: number }).count).toBe(2);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications WHERE category='password_reset' AND user_id IN (?,?)`).get(approvable.userId, rejectable.userId) as { count: number }).count).toBe(2);

    const lookup = (displayName: string, token: string) => fetch(`${ctx.base}/api/password-recovery/lookup`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: `lab_password_recovery=${token}` }, body: JSON.stringify({ displayName }),
    });
    expect(await (await lookup('成员甲', approvable.token)).json()).toEqual({ state: 'approved' });
    expect(await (await lookup('成员乙', rejectable.token)).json()).toEqual({ state: 'rejected' });
    expect(JSON.stringify({ approved, rows: ctx.system.db.prepare(`SELECT summary,details_json FROM audit_logs WHERE object_type='password_reset_request'`).all() })).not.toContain(approvable.token);
  });

  it('requires a rejection explanation and allows exactly one version/state-protected concurrent decision', async () => {
    const request = insertRequest('member-a', 'concurrent-admin-decision-token', 'pending');
    const adminCookie = await login(ctx.base, 'admin'); const teacherCookie = await login(ctx.base, 'teacher');
    expect((await decide(adminCookie, request.id, { decision: 'rejected', comment: '   ', version: 1 })).status).toBe(400);
    const wrongVersion = await decide(adminCookie, request.id, { decision: 'approved', version: 99 });
    expect(wrongVersion.status).toBe(409);

    const results = await Promise.all([
      decide(adminCookie, request.id, { decision: 'approved', version: 1 }),
      decide(teacherCookie, request.id, { decision: 'rejected', comment: '并发拒绝', version: 1 }),
    ]);
    expect(results.map(({ status }) => status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE object_type='password_reset_request' AND object_id=?
      AND action IN ('password_reset_approved','password_reset_rejected')`).get(String(request.id)) as { count: number }).count).toBe(1);
    expect((ctx.system.db.prepare(`SELECT version FROM password_reset_requests WHERE id=?`).get(request.id) as { version: number }).version).toBe(2);
    const finalConflict = await decide(adminCookie, request.id, { decision: 'approved', version: 2 });
    expect(finalConflict.status).toBe(409);
    expect(await finalConflict.json()).toEqual(await wrongVersion.json());
  });

  it('expires an overdue request before rejecting the decision with a generic conflict', async () => {
    const request = insertRequest('member-a', 'expired-admin-decision-token', 'pending', { expiresAt: '2000-01-01T00:00:00.000Z' });
    const adminCookie = await login(ctx.base, 'admin');
    const response = await decide(adminCookie, request.id, { decision: 'approved', version: 1 });
    expect(response.status).toBe(409);
    expect(ctx.system.db.prepare('SELECT status,version FROM password_reset_requests WHERE id=?').get(request.id)).toEqual({ status: 'expired', version: 2 });
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE object_type='password_reset_request' AND object_id=?`).get(String(request.id)) as { count: number }).count).toBe(0);
  });

  it('rolls back the decision and audit when subject notification persistence fails', async () => {
    const request = insertRequest('member-a', 'rollback-admin-decision-token', 'pending');
    const adminCookie = await login(ctx.base, 'admin');
    ctx.system.db.exec(`CREATE TRIGGER fail_password_decision_notification BEFORE INSERT ON notifications
      WHEN NEW.category='password_reset' BEGIN SELECT RAISE(ABORT,'forced decision notification failure'); END;`);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await decide(adminCookie, request.id, { decision: 'approved', version: 1 });
    consoleError.mockRestore();
    expect(response.status).toBe(500);
    expect(ctx.system.db.prepare('SELECT status,version,reviewer_id FROM password_reset_requests WHERE id=?').get(request.id)).toEqual({ status: 'pending', version: 1, reviewer_id: null });
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE object_type='password_reset_request' AND object_id=?`).get(String(request.id)) as { count: number }).count).toBe(0);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications WHERE category='password_reset'`).get() as { count: number }).count).toBe(0);
  });
});
