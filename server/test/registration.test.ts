import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/security.js';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem({ cookieSecure: true }); });
afterEach(async () => { await ctx.system.close(); });

const validRegistration = {
  username: 'new.member', displayName: '新成员', password: 'LongPassword123!', passwordConfirm: 'LongPassword123!',
};

async function register(body: Record<string, unknown>) {
  return fetch(`${ctx.base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('self-service member registration', () => {
  it('atomically creates a hashed member, session, public audit, notification, and compatible cookie', async () => {
    const response = await register(validRegistration);
    expect(response.status).toBe(201);
    const cookieHeader = response.headers.get('set-cookie')!;
    expect(cookieHeader).toMatch(/^lab_session=.+; HttpOnly; SameSite=Lax; Path=\/; Expires=.+; Secure$/i);

    const body = await response.json();
    expect(body).toEqual({ user: expect.objectContaining({
      username: 'new.member', displayName: '新成员', role: 'member', active: true, demo: false, version: 1,
    }) });
    expect(body.user).not.toHaveProperty('password');
    expect(body.user).not.toHaveProperty('passwordHash');

    const stored = ctx.system.db.prepare('SELECT * FROM users WHERE username=?').get('new.member') as Record<string, unknown>;
    expect(stored.role).toBe('member'); expect(stored.active).toBe(1); expect(stored.demo).toBe(0);
    expect(stored.password_hash).not.toBe(validRegistration.password);
    expect(String(stored.password_hash)).toMatch(/^scrypt\$/);
    expect(verifyPassword(validRegistration.password, String(stored.password_hash))).toBe(true);

    const cookie = cookieHeader.split(';')[0]!;
    const me = await api(ctx.base, cookie, '/api/auth/me');
    expect(me.status).toBe(200);
    expect((await me.json()).user.id).toBe(body.user.id);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM sessions WHERE user_id=?').get(body.user.id) as { count: number }).count).toBe(1);

    const audits = await api(ctx.base, cookie, '/api/audit-logs');
    const audit = (await audits.json()).logs.find((item: any) => item.action === 'account_register' && item.objectId === String(body.user.id));
    expect(audit).toMatchObject({ actor: { id: body.user.id }, summary: '新成员注册：new.member', details: { username: 'new.member', role: 'member' } });
    expect(JSON.stringify(audit.details)).not.toContain(validRegistration.password);

    const notification = ctx.system.db.prepare(`SELECT n.* FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE u.username='teacher' AND n.category='account' AND n.object_type='user' AND n.object_id=?`).get(String(body.user.id)) as Record<string, unknown>;
    expect(notification.title).toBe('新成员注册');
    expect(notification.body).toContain('new.member');
  });

  it('honors super-admin account notification preferences', async () => {
    const teacher = await login(ctx.base, 'teacher');
    expect((await api(ctx.base, teacher, '/api/notifications/preferences', {
      method: 'PUT', body: JSON.stringify({ category: 'account', enabled: false }),
    })).status).toBe(200);

    const response = await register({ ...validRegistration, username: 'quiet.member' });
    expect(response.status).toBe(201);
    const user = (await response.json()).user;
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE u.username='teacher' AND n.object_type='user' AND n.object_id=?`).get(String(user.id)) as { count: number }).count).toBe(0);
  });

  it('rejects confirmation mismatch, role injection, short passwords, and invalid usernames without side effects', async () => {
    const cases = [
      { body: { ...validRegistration, username: 'mismatch', passwordConfirm: 'DifferentPassword!' } },
      { body: { ...validRegistration, username: 'role-inject', role: 'super_admin' } },
      { body: { ...validRegistration, username: 'short-pass', password: 'short', passwordConfirm: 'short' } },
      { body: { ...validRegistration, username: 'bad username' } },
    ];
    for (const { body } of cases) expect((await register(body)).status).toBe(400);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM users WHERE username IN ('mismatch','role-inject','short-pass','bad username')`).get() as { count: number }).count).toBe(0);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='account_register'`).get() as { count: number }).count).toBe(0);
  });

  it('returns a Chinese 409 conflict for a duplicate username', async () => {
    expect((await register(validRegistration)).status).toBe(201);
    const duplicate = await register(validRegistration);
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.message).toBe('用户名已存在');
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM users WHERE username='new.member'`).get() as { count: number }).count).toBe(1);
  });
});
