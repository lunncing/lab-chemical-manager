import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as socketClient, type Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createSystem } from '../src/system.js';
import { verifyPassword } from '../src/security.js';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
const sockets: Socket[] = [];
const directories: string[] = [];

beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await ctx.system.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = socketClient(ctx.base, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function socketEvent<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve) => socket.once(name, resolve));
}

async function register(input: Record<string, unknown>): Promise<{ response: Response; body: any; cookie: string }> {
  const response = await fetch(`${ctx.base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  const body = await response.clone().json();
  return { response, body, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}

describe('DELETE /api/users/:id', () => {
  it('allows only super admins and rejects self, missing, and already deleted targets', async () => {
    const teacherCookie = await login(ctx.base, 'teacher');
    const aliceCookie = await login(ctx.base, 'member-a');
    const teacher = ctx.system.db.prepare(`SELECT id FROM users WHERE username='teacher'`).get() as { id: number };
    const bob = ctx.system.db.prepare(`SELECT id FROM users WHERE username='member-b'`).get() as { id: number };

    expect((await api(ctx.base, aliceCookie, `/api/users/${bob.id}`, { method: 'DELETE' })).status).toBe(403);

    const self = await api(ctx.base, teacherCookie, `/api/users/${teacher.id}`, { method: 'DELETE' });
    expect(self.status).toBe(400);
    expect((await self.json()).error.message).toBe('不能删除当前账号');

    const missing = await api(ctx.base, teacherCookie, '/api/users/999999', { method: 'DELETE' });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.message).toBe('账号不存在');

    ctx.system.db.prepare('UPDATE users SET deleted_at=? WHERE id=?').run('2026-08-30T12:00:00.000Z', bob.id);
    const deleted = await api(ctx.base, teacherCookie, `/api/users/${bob.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(404);
    expect((await deleted.json()).error.message).toBe('账号不存在');
  });

  it('returns 409 when a stale authenticated actor leaves the target as the last active super admin', async () => {
    await ctx.system.close();
    const directory = mkdtempSync(join(tmpdir(), 'lab-last-super-'));
    directories.push(directory);
    const databasePath = join(directory, 'last-super.sqlite');
    const system = createSystem({ databasePath, seedDemo: true });
    await new Promise<void>((resolve) => system.httpServer.listen(0, '127.0.0.1', resolve));
    const address = system.httpServer.address() as AddressInfo;
    ctx = { system, base: `http://127.0.0.1:${address.port}` };
    ctx.system.db.exec('PRAGMA busy_timeout=5000');

    const teacherCookie = await login(ctx.base, 'teacher');
    const actor = ctx.system.db.prepare(`SELECT id FROM users WHERE username='teacher'`).get() as { id: number };
    const target = (await (await api(ctx.base, teacherCookie, '/api/users', {
      method: 'POST', body: JSON.stringify({ username: 'last-super-target', displayName: '最后超级管理员', role: 'super_admin', password: 'LastSuper123!' }),
    })).json()).user;

    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(workerData.databasePath);
      try {
        db.exec('BEGIN IMMEDIATE');
        db.prepare('UPDATE users SET active=0 WHERE id=?').run(workerData.actorId);
        parentPort.postMessage({ state: 'updated' });
        setTimeout(() => {
          try {
            db.exec('COMMIT');
            db.close();
            parentPort.postMessage({ state: 'committed' });
          } catch (error) {
            parentPort.postMessage({ state: 'error', message: String(error) });
          }
        }, 1000);
      } catch (error) {
        parentPort.postMessage({ state: 'error', message: String(error) });
      }
    `, { eval: true, workerData: { databasePath, actorId: actor.id } });
    const updated = new Promise<void>((resolve, reject) => worker.on('message', (message: { state: string; message?: string }) => {
      if (message.state === 'updated') resolve();
      if (message.state === 'error') reject(new Error(message.message));
    }));
    const exited = new Promise<void>((resolve, reject) => {
      worker.once('error', reject);
      worker.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)));
    });
    await updated;

    const response = await api(ctx.base, teacherCookie, `/api/users/${target.id}`, { method: 'DELETE' });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe('不能删除最后一个启用的超级管理员');
    await exited;
    expect(ctx.system.db.prepare('SELECT deleted_at FROM users WHERE id=?').get(target.id)).toEqual({ deleted_at: null });
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='account_deleted' AND object_id=?`).get(String(target.id)) as { count: number }).count).toBe(0);
  });

  it('irreversibly removes a demo login identity while retaining its display name and permits admin reuse', async () => {
    const teacherCookie = await login(ctx.base, 'teacher');
    const aliceCookie = await login(ctx.base, 'member-a');
    const original = ctx.system.db.prepare(`SELECT * FROM users WHERE username='member-a'`).get() as Record<string, unknown>;
    const id = Number(original.id);

    await api(ctx.base, aliceCookie, '/api/notifications/preferences', {
      method: 'PUT', body: JSON.stringify({ category: 'account', enabled: false }),
    });
    ctx.system.db.prepare(`INSERT INTO notifications (user_id,category,title,body,created_at) VALUES (?,'account','待清理','私有消息',?)`).run(id, '2026-08-30T12:00:00.000Z');
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM sessions WHERE user_id=?').get(id) as { count: number }).count).toBeGreaterThan(0);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM notifications WHERE user_id=?').get(id) as { count: number }).count).toBeGreaterThan(0);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM notification_preferences WHERE user_id=?').get(id) as { count: number }).count).toBe(1);

    const targetSocket = await connect(aliceCookie);
    const observerSocket = await connect(teacherCookie);
    const changed = socketEvent<{ id: number; mode: string }>(observerSocket, 'user:changed');
    const disconnected = socketEvent<string>(targetSocket, 'disconnect');

    const response = await api(ctx.base, teacherCookie, `/api/users/${id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    const body = await response.json();
    const emitted = await changed;
    expect(await disconnected).toBe('io server disconnect');

    const tombstone = ctx.system.db.prepare('SELECT * FROM users WHERE id=?').get(id) as Record<string, unknown>;
    expect(tombstone.username).toMatch(new RegExp(`^deleted-${id}-[A-Za-z0-9_-]+$`));
    expect(tombstone.username).not.toBe(original.username);
    expect(tombstone.display_name).toBe(original.display_name);
    expect(body).toEqual({ deleted: { id, mode: 'login_identity_removed_display_name_retained' } });
    expect(emitted).toEqual(body.deleted);
    expect(tombstone.role).toBe(original.role);
    expect(tombstone.password_hash).not.toBe(original.password_hash);
    expect(String(tombstone.password_hash)).toMatch(/^scrypt\$/);
    expect(verifyPassword('Demo1234!', String(tombstone.password_hash))).toBe(false);
    expect(tombstone).toMatchObject({ active: 0, demo: 0, version: Number(original.version) + 1 });
    expect(Number.isNaN(Date.parse(String(tombstone.deleted_at)))).toBe(false);
    expect(tombstone.updated_at).toBe(tombstone.deleted_at);

    for (const table of ['sessions', 'notifications', 'notification_preferences']) {
      expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`).get(id) as { count: number }).count).toBe(0);
    }
    expect(ctx.system.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const users = (await (await api(ctx.base, teacherCookie, '/api/users')).json()).users as Array<{ id: number }>;
    const members = (await (await api(ctx.base, teacherCookie, '/api/members')).json()).users as Array<{ id: number }>;
    expect(users.some((user) => user.id === id)).toBe(false);
    expect(members.some((user) => user.id === id)).toBe(false);
    expect((await api(ctx.base, aliceCookie, '/api/auth/me')).status).toBe(401);
    expect((await fetch(`${ctx.base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'member-a', password: 'Demo1234!' }),
    })).status).toBe(401);
    expect((await api(ctx.base, teacherCookie, `/api/users/${id}`, {
      method: 'PATCH', body: JSON.stringify({ displayName: '不能恢复', version: Number(original.version) + 1 }),
    })).status).toBe(404);
    expect((await api(ctx.base, teacherCookie, `/api/users/${id}`, { method: 'DELETE' })).status).toBe(404);

    const deletionAudit = ctx.system.db.prepare(`SELECT * FROM audit_logs WHERE action='account_deleted' AND object_id=?`).get(String(id)) as Record<string, unknown>;
    expect(deletionAudit).toBeDefined();
    expect(JSON.parse(String(deletionAudit.details_json))).toEqual({ mode: 'login_identity_removed_display_name_retained' });
    const deletionAuditText = JSON.stringify(deletionAudit);
    for (const secret of [String(original.username), String(original.display_name), String(original.password_hash), 'Demo1234!']) {
      expect(deletionAuditText).not.toContain(secret);
    }

    const replacement = await api(ctx.base, teacherCookie, '/api/users', {
      method: 'POST', body: JSON.stringify({ username: 'member-a', displayName: '新成员甲', role: 'member', password: 'Replacement123!' }),
    });
    expect(replacement.status).toBe(201);
    expect((await replacement.json()).user).toMatchObject({ username: 'member-a', displayName: '新成员甲' });
    expect((await fetch(`${ctx.base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'member-a', password: 'Replacement123!' }),
    })).status).toBe(200);
  });

  it('preserves the original display name across business history while registration reuses the removed username', async () => {
    const teacherCookie = await login(ctx.base, 'teacher');
    const adminCookie = await login(ctx.base, 'admin');
    const bobCookie = await login(ctx.base, 'member-b');
    const original = ctx.system.db.prepare(`SELECT * FROM users WHERE username='admin'`).get() as Record<string, unknown>;
    const id = Number(original.id);

    const chemical = (await (await api(ctx.base, adminCookie, '/api/chemicals', {
      method: 'POST', body: JSON.stringify({ name: '删除历史药品', specification: 'AR 1 瓶', inboundAt: '2026-08-30T12:00:00.000Z', cabinet: 'A', shelf: 3 }),
    })).json()).chemical;
    const moved = await api(ctx.base, adminCookie, `/api/chemicals/${chemical.id}/move`, {
      method: 'PATCH', body: JSON.stringify({ cabinet: 'A', shelf: 4, version: chemical.version }),
    });
    expect(moved.status).toBe(200);
    const purchase = (await (await api(ctx.base, adminCookie, '/api/purchases', {
      method: 'POST', body: JSON.stringify({ chemicalName: '删除历史采购', specification: '1 瓶', purpose: '保留历史', hazardous: false, requestType: 'normal' }),
    })).json()).purchase;
    const bob = ctx.system.db.prepare(`SELECT id FROM users WHERE username='member-b'`).get() as { id: number };
    const inbound = (await (await api(ctx.base, adminCookie, '/api/inbound-requests', {
      method: 'POST', body: JSON.stringify({ targetUserId: bob.id, name: '删除历史代入库', specification: '1 瓶', inboundAt: '2026-08-30T12:00:00.000Z', cabinet: 'B', shelf: 2 }),
    })).json()).request;
    const inboundToDeleted = (await (await api(ctx.base, bobCookie, '/api/inbound-requests', {
      method: 'POST', body: JSON.stringify({ targetUserId: id, name: '删除历史被代入库', specification: '1 瓶', inboundAt: '2026-08-30T12:00:00.000Z', cabinet: 'B', shelf: 3 }),
    })).json()).request;
    const invite = (await (await api(ctx.base, adminCookie, '/api/registration-invites', { method: 'POST' })).json()).invite;

    const before = {
      chemicals: (ctx.system.db.prepare('SELECT COUNT(*) count FROM chemicals').get() as { count: number }).count,
      movements: (ctx.system.db.prepare('SELECT COUNT(*) count FROM inventory_movements').get() as { count: number }).count,
      purchases: (ctx.system.db.prepare('SELECT COUNT(*) count FROM purchases').get() as { count: number }).count,
      inbound: (ctx.system.db.prepare('SELECT COUNT(*) count FROM inbound_requests').get() as { count: number }).count,
      invites: (ctx.system.db.prepare('SELECT COUNT(*) count FROM registration_invites').get() as { count: number }).count,
    };

    expect((await api(ctx.base, teacherCookie, `/api/users/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(ctx.system.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM chemicals').get() as { count: number }).count).toBe(before.chemicals);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM inventory_movements').get() as { count: number }).count).toBe(before.movements);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM purchases').get() as { count: number }).count).toBe(before.purchases);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM inbound_requests').get() as { count: number }).count).toBe(before.inbound);
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM registration_invites').get() as { count: number }).count).toBe(before.invites);

    const tombstone = ctx.system.db.prepare('SELECT username,display_name FROM users WHERE id=?').get(id) as { username: string; display_name: string };
    const expectedHistoricalActor = { id, username: tombstone.username, displayName: original.display_name };
    const chemicalDetail = await (await api(ctx.base, teacherCookie, `/api/chemicals/${chemical.id}`)).json();
    const chemicalView = chemicalDetail.chemical;
    const purchaseView = ((await (await api(ctx.base, teacherCookie, '/api/purchases')).json()).purchases as any[]).find((item) => item.id === purchase.id);
    const inboundView = ((await (await api(ctx.base, bobCookie, '/api/inbound-requests?scope=incoming')).json()).requests as any[]).find((item) => item.id === inbound.id);
    const outboundView = ((await (await api(ctx.base, bobCookie, '/api/inbound-requests?scope=mine')).json()).requests as any[]).find((item) => item.id === inboundToDeleted.id);
    expect.soft(tombstone.display_name).toBe(original.display_name);
    expect.soft(chemicalView.owner).toEqual(expectedHistoricalActor);
    expect.soft(chemicalView.inboundOperator).toEqual(expectedHistoricalActor);
    expect.soft(chemicalDetail.movements).toHaveLength(2);
    for (const movement of chemicalDetail.movements) {
      expect.soft(movement).toMatchObject({ operator_username: tombstone.username, operator_name: original.display_name });
    }
    expect.soft(purchaseView.applicant).toEqual(expectedHistoricalActor);
    expect.soft(inboundView.requester).toEqual(expectedHistoricalActor);
    expect.soft(outboundView.targetUser).toEqual(expectedHistoricalActor);

    const registration = await register({
      username: 'admin', displayName: '新注册管理员名', password: 'RegisteredAgain123!', passwordConfirm: 'RegisteredAgain123!', inviteCode: invite.code,
    });
    expect(registration.response.status).toBe(201);
    expect(registration.body.user.id).not.toBe(id);
    expect(registration.body.user).toMatchObject({ username: 'admin', role: 'member' });
    expect((await fetch(`${ctx.base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Demo1234!' }),
    })).status).toBe(401);

    const invites = (await (await api(ctx.base, teacherCookie, '/api/registration-invites')).json()).invites as any[];
    const inviteView = invites.find((item) => item.id === invite.id);
    expect.soft(inviteView.creator).toEqual(expectedHistoricalActor);
    expect(inviteView.usedBy).toMatchObject({ id: registration.body.user.id, username: 'admin' });
    const logs = (await (await api(ctx.base, teacherCookie, '/api/audit-logs')).json()).logs as any[];
    const historicalAudit = logs.find((log) => log.action === 'inventory_inbound' && log.objectId === String(chemical.id));
    expect.soft(historicalAudit.actor).toEqual(expectedHistoricalActor);
    expect(ctx.system.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('serializes concurrent deletion so a non-demo login identity is removed exactly once', async () => {
    const teacherCookie = await login(ctx.base, 'teacher');
    const created = (await (await api(ctx.base, teacherCookie, '/api/users', {
      method: 'POST', body: JSON.stringify({ username: 'delete-race', displayName: '并发删除', role: 'member', password: 'DeleteRace123!' }),
    })).json()).user;
    expect(created.demo).toBe(false);

    const responses = await Promise.all([
      api(ctx.base, teacherCookie, `/api/users/${created.id}`, { method: 'DELETE' }),
      api(ctx.base, teacherCookie, `/api/users/${created.id}`, { method: 'DELETE' }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 404]);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='account_deleted' AND object_id=?`).get(String(created.id)) as { count: number }).count).toBe(1);
    expect(ctx.system.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
