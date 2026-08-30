import { afterEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext | undefined;

afterEach(async () => {
  if (ctx) await ctx.system.close();
  ctx = undefined;
});

describe('deleted user exclusions', () => {
  it('treats an active tombstone as unavailable to every auth, member, account, target, and recipient query', async () => {
    ctx = await startTestSystem();
    const teacherCookie = await login(ctx.base, 'teacher');
    const aliceCookie = await login(ctx.base, 'member-a');
    const bobCookie = await login(ctx.base, 'member-b');
    const alice = ctx.system.db.prepare(`SELECT id,version FROM users WHERE username='member-a'`).get() as { id: number; version: number };

    ctx.system.db.prepare('UPDATE users SET deleted_at=? WHERE id=?').run('2026-08-30T12:00:00.000Z', alice.id);

    expect((await api(ctx.base, aliceCookie, '/api/auth/me')).status).toBe(401);
    expect((await fetch(`${ctx.base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'member-a', password: 'Demo1234!' }),
    })).status).toBe(401);

    const users = (await (await api(ctx.base, teacherCookie, '/api/users')).json()).users as Array<{ id: number }>;
    const members = (await (await api(ctx.base, teacherCookie, '/api/members')).json()).users as Array<{ id: number }>;
    expect(users.some(({ id }) => id === alice.id)).toBe(false);
    expect(members.some(({ id }) => id === alice.id)).toBe(false);

    const patch = await api(ctx.base, teacherCookie, `/api/users/${alice.id}`, {
      method: 'PATCH', body: JSON.stringify({ displayName: '不应更新', version: alice.version }),
    });
    expect(patch.status).toBe(404);

    const proxy = await api(ctx.base, bobCookie, '/api/inbound-requests', {
      method: 'POST', body: JSON.stringify({
        targetUserId: alice.id, name: '不应投递', specification: '1 瓶',
        inboundAt: '2026-08-30T12:00:00.000Z', cabinet: 'A', shelf: 1,
      }),
    });
    expect(proxy.status).toBe(400);

    ctx.system.db.prepare('DELETE FROM notifications WHERE user_id=?').run(alice.id);
    const chemical = await api(ctx.base, bobCookie, '/api/chemicals', {
      method: 'POST', body: JSON.stringify({
        name: '墓碑通知排除', specification: '1 瓶', inboundAt: '2026-08-30T12:00:00.000Z', cabinet: 'A', shelf: 2,
      }),
    });
    expect(chemical.status).toBe(201);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM notifications WHERE user_id=?').get(alice.id) as { count: number }).count).toBe(0);
  });
});
