import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
let cookies: Record<string, string>;
beforeEach(async () => {
  ctx = await startTestSystem();
  cookies = Object.fromEntries(await Promise.all(['teacher', 'admin', 'hazard', 'member-a'].map(async (name) => [name, await login(ctx.base, name)])));
});
afterEach(async () => { await ctx.system.close(); });

async function create(cookie: string, body?: unknown) {
  return api(ctx.base, cookie, '/api/registration-invites', {
    method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('registration invite generation and scoped listing', () => {
  it('enforces the complete role matrix and a strict empty creation body', async () => {
    expect((await create(cookies['member-a']!)).status).toBe(403);
    expect((await create(cookies.hazard!)).status).toBe(403);
    expect((await api(ctx.base, cookies['member-a']!, '/api/registration-invites')).status).toBe(403);
    expect((await api(ctx.base, cookies.hazard!, '/api/registration-invites')).status).toBe(403);
    expect((await create(cookies.admin!, { expiresInDays: 30 })).status).toBe(400);
    expect((await create(cookies.teacher!, { role: 'super_admin' })).status).toBe(400);
    expect((await create(cookies.admin!, {})).status).toBe(201);
    expect((await create(cookies.teacher!)).status).toBe(201);
  });

  it('returns plaintext once, writes only safe audit data, scopes normal admins to their own rows, and lets super admins list all', async () => {
    const adminResponse = await create(cookies.admin!); expect(adminResponse.status).toBe(201);
    const adminInvite = (await adminResponse.json()).invite;
    const teacherInvite = (await (await create(cookies.teacher!)).json()).invite;
    expect(adminInvite).toEqual({
      id: expect.any(Number), code: expect.stringMatching(/^LSF-[A-Za-z0-9_-]{32}$/), codeHint: expect.any(String),
      createdAt: expect.any(String), expiresAt: expect.any(String), version: 1,
    });

    const storedJson = JSON.stringify(ctx.system.db.prepare('SELECT * FROM registration_invites ORDER BY id').all());
    expect(storedJson).not.toContain(adminInvite.code); expect(storedJson).not.toContain(teacherInvite.code);
    const audit = ctx.system.db.prepare(`SELECT summary,details_json FROM audit_logs WHERE action='registration_invite_created' AND object_id=?`).get(String(adminInvite.id)) as { summary: string; details_json: string };
    expect(JSON.parse(audit.details_json)).toEqual({ inviteId: adminInvite.id, hint: adminInvite.codeHint, expiresAt: adminInvite.expiresAt });
    expect(JSON.stringify(audit)).not.toContain(adminInvite.code);

    const adminList = (await (await api(ctx.base, cookies.admin!, '/api/registration-invites')).json()).invites;
    expect(adminList).toHaveLength(1); expect(adminList[0]).toMatchObject({ id: adminInvite.id, codeHint: adminInvite.codeHint, creator: { username: 'admin' }, status: 'active', usedBy: null, usedAt: null, version: 1 });
    expect(JSON.stringify(adminList)).not.toContain(adminInvite.code); expect(adminList[0]).not.toHaveProperty('code'); expect(adminList[0]).not.toHaveProperty('codeHash');
    const teacherList = (await (await api(ctx.base, cookies.teacher!, '/api/registration-invites')).json()).invites;
    expect(teacherList.map((item: { id: number }) => item.id)).toEqual([teacherInvite.id, adminInvite.id]);
  });
});

describe('registration invite revocation', () => {
  it('enforces ownership, super-admin override, active status, and optimistic versions without leaking plaintext', async () => {
    const own = (await (await create(cookies.admin!)).json()).invite;
    const foreign = (await (await create(cookies.teacher!)).json()).invite;
    expect((await api(ctx.base, cookies.admin!, `/api/registration-invites/${foreign.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: foreign.version }) })).status).toBe(403);
    expect((await api(ctx.base, cookies['member-a']!, `/api/registration-invites/${own.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: own.version }) })).status).toBe(403);
    expect((await api(ctx.base, cookies.admin!, `/api/registration-invites/${own.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: 99 }) })).status).toBe(409);

    const revoked = await api(ctx.base, cookies.admin!, `/api/registration-invites/${own.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: own.version }) });
    expect(revoked.status).toBe(200); const revokedInvite = (await revoked.json()).invite;
    expect(revokedInvite).toMatchObject({ id: own.id, status: 'revoked', version: 2 });
    expect(revokedInvite).not.toHaveProperty('code'); expect(revokedInvite).not.toHaveProperty('codeHash');
    expect((await api(ctx.base, cookies.admin!, `/api/registration-invites/${own.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: 2 }) })).status).toBe(409);

    const superRevoked = await api(ctx.base, cookies.teacher!, `/api/registration-invites/${foreign.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: foreign.version }) });
    expect(superRevoked.status).toBe(200);
    const audits = ctx.system.db.prepare(`SELECT summary,details_json FROM audit_logs WHERE action='registration_invite_revoked' ORDER BY id`).all();
    expect(audits).toHaveLength(2); expect(JSON.stringify(audits)).not.toContain(own.code); expect(JSON.stringify(audits)).not.toContain(foreign.code);
  });

  it('returns 409 for expired and used invites', async () => {
    const expired = (await (await create(cookies.admin!)).json()).invite;
    const used = (await (await create(cookies.admin!)).json()).invite;
    const member = ctx.system.db.prepare(`SELECT id FROM users WHERE username='member-a'`).get() as { id: number };
    ctx.system.db.prepare('UPDATE registration_invites SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expired.id);
    ctx.system.db.prepare('UPDATE registration_invites SET used_by=?,used_at=? WHERE id=?').run(member.id, new Date().toISOString(), used.id);
    expect((await api(ctx.base, cookies.admin!, `/api/registration-invites/${expired.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: expired.version }) })).status).toBe(409);
    expect((await api(ctx.base, cookies.admin!, `/api/registration-invites/${used.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: used.version }) })).status).toBe(409);
  });
});
