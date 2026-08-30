import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/security.js';
import { createRegistrationInvite } from '../src/registration-invites.js';
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

function inviteCode(options: { expiresAt?: string; revoked?: boolean } = {}): string {
  const creator = ctx.system.db.prepare(`SELECT id FROM users WHERE username='admin'`).get() as { id: number };
  const invite = createRegistrationInvite(ctx.system.db, creator.id);
  if (options.expiresAt) ctx.system.db.prepare('UPDATE registration_invites SET expires_at=? WHERE id=?').run(options.expiresAt, invite.id);
  if (options.revoked) ctx.system.db.prepare('UPDATE registration_invites SET revoked_by=?,revoked_at=? WHERE id=?').run(creator.id, new Date().toISOString(), invite.id);
  return invite.code;
}

describe('self-service member registration', () => {
  it('atomically creates a hashed member, session, public audit, notification, and compatible cookie', async () => {
    const code = inviteCode();
    const response = await register({ ...validRegistration, inviteCode: `  ${code}  ` });
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
    const consumed = ctx.system.db.prepare('SELECT i.*,u.username used_username FROM registration_invites i LEFT JOIN users u ON u.id=i.used_by').get() as Record<string, unknown>;
    expect(consumed.used_username).toBe('new.member'); expect(consumed.used_at).toEqual(expect.any(String)); expect(consumed.version).toBe(2);
    expect(JSON.stringify(consumed)).not.toContain(code);
  });

  it('honors super-admin account notification preferences', async () => {
    const teacher = await login(ctx.base, 'teacher');
    expect((await api(ctx.base, teacher, '/api/notifications/preferences', {
      method: 'PUT', body: JSON.stringify({ category: 'account', enabled: false }),
    })).status).toBe(200);

    const response = await register({ ...validRegistration, username: 'quiet.member', inviteCode: inviteCode() });
    expect(response.status).toBe(201);
    const user = (await response.json()).user;
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE u.username='teacher' AND n.object_type='user' AND n.object_id=?`).get(String(user.id)) as { count: number }).count).toBe(0);
  });

  it('rejects confirmation mismatch, role injection, short passwords, and invalid usernames without side effects', async () => {
    const cases = [
      { body: { ...validRegistration, username: 'mismatch', passwordConfirm: 'DifferentPassword!' } },
      { body: { ...validRegistration, username: 'role-inject', role: 'super_admin', inviteCode: inviteCode() } },
      { body: { ...validRegistration, username: 'active-inject', active: false, inviteCode: inviteCode() } },
      { body: { ...validRegistration, username: 'demo-inject', demo: true, inviteCode: inviteCode() } },
      { body: { ...validRegistration, username: 'short-pass', password: 'short', passwordConfirm: 'short' } },
      { body: { ...validRegistration, username: 'bad username' } },
    ];
    for (const { body } of cases) expect((await register(body)).status).toBe(400);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM users WHERE username IN ('mismatch','role-inject','active-inject','demo-inject','short-pass','bad username')`).get() as { count: number }).count).toBe(0);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='account_register'`).get() as { count: number }).count).toBe(0);
  });

  it('returns a Chinese 409 conflict for a duplicate username', async () => {
    expect((await register({ ...validRegistration, inviteCode: inviteCode() })).status).toBe(201);
    const reusableAfterConflict = inviteCode();
    const duplicate = await register({ ...validRegistration, inviteCode: reusableAfterConflict });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.message).toBe('用户名已存在');
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM users WHERE username='new.member'`).get() as { count: number }).count).toBe(1);
    expect((ctx.system.db.prepare(`SELECT used_by FROM registration_invites WHERE code_hash=(SELECT code_hash FROM registration_invites WHERE used_by IS NULL ORDER BY id DESC LIMIT 1)`).get() as { used_by: number | null }).used_by).toBeNull();
    expect((await register({ ...validRegistration, username: 'after.conflict', inviteCode: reusableAfterConflict })).status).toBe(201);
  });

  it('uses one generic Chinese error for nonexistent, malformed, expired, revoked, and used invitations, while missing/empty codes are 400', async () => {
    const expired = inviteCode({ expiresAt: '2000-01-01T00:00:00.000Z' });
    const revoked = inviteCode({ revoked: true });
    const used = inviteCode();
    expect((await register({ ...validRegistration, username: 'first.use', inviteCode: used })).status).toBe(201);
    const cases = [
      { username: 'missing.code' }, { username: 'empty.code', inviteCode: '   ' }, { username: 'not.found', inviteCode: `LSF-${'A'.repeat(32)}` },
      { username: 'malformed', inviteCode: 'obviously-not-an-invite' }, { username: 'expired.code', inviteCode: expired },
      { username: 'revoked.code', inviteCode: revoked }, { username: 'second.use', inviteCode: used },
    ];
    for (const item of cases) {
      const response = await register({ ...validRegistration, ...item });
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe('邀请码无效或已失效');
    }
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM users WHERE username IN ('missing.code','empty.code','not.found','malformed','expired.code','revoked.code','second.use')`).get() as { count: number }).count).toBe(0);
  });

  it('rolls back user, invite, session, audit, and notification when invite consumption fails after user insertion', async () => {
    const code = inviteCode();
    ctx.system.db.exec(`CREATE TRIGGER fail_invite_consumption BEFORE UPDATE OF used_by ON registration_invites BEGIN SELECT RAISE(FAIL, 'forced consumption failure'); END;`);
    const before = {
      sessions: (ctx.system.db.prepare('SELECT COUNT(*) count FROM sessions').get() as { count: number }).count,
      audits: (ctx.system.db.prepare('SELECT COUNT(*) count FROM audit_logs').get() as { count: number }).count,
      notifications: (ctx.system.db.prepare('SELECT COUNT(*) count FROM notifications').get() as { count: number }).count,
    };
    expect((await register({ ...validRegistration, username: 'rolled.back', inviteCode: code })).status).toBe(500);
    expect(ctx.system.db.prepare(`SELECT id FROM users WHERE username='rolled.back'`).get()).toBeUndefined();
    const invite = ctx.system.db.prepare('SELECT used_by,used_at,version FROM registration_invites').get();
    expect(invite).toEqual({ used_by: null, used_at: null, version: 1 });
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM sessions').get() as { count: number }).count).toBe(before.sessions);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM audit_logs').get() as { count: number }).count).toBe(before.audits);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM notifications').get() as { count: number }).count).toBe(before.notifications);
  });

  it('allows exactly one of two concurrent registrations to consume a single invitation', async () => {
    const code = inviteCode();
    const [first, second] = await Promise.all([
      register({ ...validRegistration, username: 'race.one', inviteCode: code }),
      register({ ...validRegistration, username: 'race.two', inviteCode: code }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 400]);
    const failed = first.status === 400 ? first : second;
    expect((await failed.json()).error.message).toBe('邀请码无效或已失效');
    const users = ctx.system.db.prepare(`SELECT id,username FROM users WHERE username IN ('race.one','race.two')`).all() as Array<{ id: number; username: string }>;
    expect(users).toHaveLength(1);
    expect((ctx.system.db.prepare('SELECT used_by FROM registration_invites').get() as { used_by: number }).used_by).toBe(users[0]!.id);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='account_register' AND actor_id=?`).get(users[0]!.id) as { count: number }).count).toBe(1);
  });
});
