import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as socketClient, type Socket } from 'socket.io-client';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext; const sockets: Socket[] = [];
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { for (const socket of sockets) socket.close(); await ctx.system.close(); });

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = socketClient(ctx.base, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true }); sockets.push(socket);
    socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
}

function nextEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 4000);
    socket.once(event, (value) => { clearTimeout(timer); resolve(value); });
  });
}

describe('authenticated Socket.IO realtime', () => {
  it('delivers one committed change to two authenticated clients without refresh', async () => {
    const aliceCookie = await login(ctx.base, 'member-a'); const bobCookie = await login(ctx.base, 'member-b');
    const alice = await connect(aliceCookie); const bob = await connect(bobCookie);
    const aliceChange = nextEvent<any>(alice, 'chemical:changed'); const bobChange = nextEvent<any>(bob, 'chemical:changed');
    const aliceAudit = nextEvent<any>(alice, 'audit:created'); const bobNotification = nextEvent<any>(bob, 'notification:created');
    const response = await api(ctx.base, aliceCookie, '/api/chemicals', { method: 'POST', body: JSON.stringify({
      name: '实时乙腈', specification: 'HPLC 4L', inboundAt: '2026-08-29T08:00:00.000Z', cabinet: 'B', shelf: 2,
    }) });
    expect(response.status).toBe(201);
    expect((await aliceChange).name).toBe('实时乙腈'); expect((await bobChange).name).toBe('实时乙腈');
    expect((await aliceAudit).action).toBe('inventory_inbound'); expect((await bobNotification).category).toBe('inventory_inbound');
  });

  it('rejects a Socket.IO connection without an authenticated cookie', async () => {
    const error = await new Promise<Error>((resolve) => {
      const socket = socketClient(ctx.base, { transports: ['websocket'], forceNew: true }); sockets.push(socket); socket.once('connect_error', resolve);
    });
    expect(error.message).toContain('UNAUTHENTICATED');
  });

  it('broadcasts inbound request creation and atomic approval changes', async () => {
    const aliceCookie = await login(ctx.base, 'member-a'); const bobCookie = await login(ctx.base, 'member-b');
    const members = await api(ctx.base, aliceCookie, '/api/members');
    const bobId = (await members.json()).users.find((user: { username: string }) => user.username === 'member-b').id;
    const alice = await connect(aliceCookie); const bob = await connect(bobCookie);
    const aliceCreated = nextEvent<any>(alice, 'inbound-request:changed'); const bobCreated = nextEvent<any>(bob, 'inbound-request:changed');
    const response = await api(ctx.base, aliceCookie, '/api/inbound-requests', { method: 'POST', body: JSON.stringify({
      targetUserId: bobId, name: '实时代入库', specification: '1 瓶', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'A', shelf: 3,
    }) });
    expect(response.status).toBe(201); const created = (await response.json()).request;
    expect((await aliceCreated).id).toBe(created.id); expect((await bobCreated).status).toBe('pending');

    const approvedEvent = nextEvent<any>(alice, 'inbound-request:changed'); const chemicalEvent = nextEvent<any>(bob, 'chemical:changed');
    const approved = await api(ctx.base, bobCookie, `/api/inbound-requests/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: created.version }) });
    expect(approved.status).toBe(200); expect((await approvedEvent).status).toBe('approved'); expect((await chemicalEvent).name).toBe('实时代入库');
  });

  it('broadcasts safe invite creation and revocation changes without plaintext', async () => {
    const adminCookie = await login(ctx.base, 'admin'); const teacherCookie = await login(ctx.base, 'teacher');
    const admin = await connect(adminCookie); const teacher = await connect(teacherCookie);
    const adminCreated = nextEvent<any>(admin, 'registration-invite:changed'); const teacherCreated = nextEvent<any>(teacher, 'registration-invite:changed');
    const response = await api(ctx.base, adminCookie, '/api/registration-invites', { method: 'POST' });
    expect(response.status).toBe(201); const created = (await response.json()).invite;
    const adminEvent = await adminCreated; const teacherEvent = await teacherCreated;
    expect(adminEvent).toMatchObject({ id: created.id, codeHint: created.codeHint, status: 'active', version: 1 });
    expect(teacherEvent.id).toBe(created.id);
    expect(JSON.stringify([adminEvent, teacherEvent])).not.toContain(created.code);
    expect(adminEvent).not.toHaveProperty('code'); expect(adminEvent).not.toHaveProperty('codeHash');

    const revokedEvent = nextEvent<any>(teacher, 'registration-invite:changed');
    const revoked = await api(ctx.base, teacherCookie, `/api/registration-invites/${created.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: 1 }) });
    expect(revoked.status).toBe(200); expect(await revokedEvent).toMatchObject({ id: created.id, status: 'revoked', version: 2 });
  });

  it('broadcasts safe invite consumption after registration commits', async () => {
    const adminCookie = await login(ctx.base, 'admin'); const teacherCookie = await login(ctx.base, 'teacher');
    const teacher = await connect(teacherCookie);
    const created = (await (await api(ctx.base, adminCookie, '/api/registration-invites', { method: 'POST' })).json()).invite;
    const consumedEvent = nextEvent<any>(teacher, 'registration-invite:changed');
    const registered = await fetch(`${ctx.base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      username: 'realtime.registered', displayName: '实时注册成员', password: 'LongPassword123!', passwordConfirm: 'LongPassword123!', inviteCode: created.code,
    }) });
    expect(registered.status).toBe(201);
    const consumed = await consumedEvent;
    expect(consumed).toMatchObject({ id: created.id, codeHint: created.codeHint, status: 'used', usedBy: { username: 'realtime.registered' }, version: 2 });
    expect(JSON.stringify(consumed)).not.toContain(created.code); expect(consumed).not.toHaveProperty('code'); expect(consumed).not.toHaveProperty('codeHash');
  });
});
