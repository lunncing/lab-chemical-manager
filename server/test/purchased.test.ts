import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as socketClient, type Socket } from 'socket.io-client';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext; const sockets: Socket[] = [];
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { for (const socket of sockets.splice(0)) socket.close(); await ctx.system.close(); });

async function create(cookie: string, chemicalName: string, hazardous = false) {
  const response = await api(ctx.base, cookie, '/api/purchases', { method: 'POST', body: JSON.stringify({
    chemicalName, specification: 'AR 500g', purpose: '采购完成测试', hazardous, requestType: 'normal',
  }) });
  return (await response.json()).purchase;
}

async function approve(cookie: string, purchase: { id: number; version: number }) {
  const response = await api(ctx.base, cookie, `/api/purchases/${purchase.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: purchase.version }) });
  expect(response.status).toBe(200);
  return (await response.json()).purchase;
}

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = socketClient(ctx.base, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true }); sockets.push(socket);
    socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
}

function nextPurchaseChange(socket: Socket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for purchase:changed')), 4000);
    socket.once('purchase:changed', (value) => { clearTimeout(timer); resolve(value); });
  });
}

describe('approved to purchased transition', () => {
  it('enforces hazardous/nonhazardous roles, approved state, and optimistic versions', async () => {
    const member = await login(ctx.base, 'member-a'); const admin = await login(ctx.base, 'admin');
    const teacher = await login(ctx.base, 'teacher'); const hazard = await login(ctx.base, 'hazard');
    const pending = await create(member, '尚未审批');
    expect((await api(ctx.base, admin, `/api/purchases/${pending.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: pending.version }) })).status).toBe(409);

    const normal = await approve(admin, await create(member, '非危险采购'));
    const dangerous = await approve(admin, await create(member, '危险采购', true));
    expect((await api(ctx.base, member, `/api/purchases/${normal.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: normal.version }) })).status).toBe(403);
    expect((await api(ctx.base, hazard, `/api/purchases/${normal.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: normal.version }) })).status).toBe(403);
    expect((await api(ctx.base, admin, `/api/purchases/${dangerous.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: dangerous.version }) })).status).toBe(403);
    expect((await api(ctx.base, admin, `/api/purchases/${normal.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: normal.version - 1 }) })).status).toBe(409);

    const dangerousDone = await api(ctx.base, hazard, `/api/purchases/${dangerous.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: dangerous.version }) });
    expect(dangerousDone.status).toBe(200);
    expect((await dangerousDone.json()).purchase).toMatchObject({ status: 'purchased', version: dangerous.version + 1 });
    const normalDone = await api(ctx.base, teacher, `/api/purchases/${normal.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: normal.version }) });
    expect(normalDone.status).toBe(200);
    const purchasedNormal = (await normalDone.json()).purchase;
    expect((await api(ctx.base, teacher, `/api/purchases/${normal.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: purchasedNormal.version }) })).status).toBe(409);

    const superNormal = await approve(admin, await create(member, '超级管理员非危险采购'));
    const superDangerous = await approve(admin, await create(member, '超级管理员危险采购', true));
    expect((await api(ctx.base, teacher, `/api/purchases/${superNormal.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: superNormal.version }) })).status).toBe(200);
    expect((await api(ctx.base, teacher, `/api/purchases/${superDangerous.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: superDangerous.version }) })).status).toBe(200);
  });

  it('routes approval tasks, broadcasts completion, notifies the applicant, audits it, and removes it only from active queues', async () => {
    const member = await login(ctx.base, 'member-a'); const admin = await login(ctx.base, 'admin');
    const teacher = await login(ctx.base, 'teacher');
    const normal = await approve(admin, await create(member, '路由非危险品'));
    const dangerous = await approve(admin, await create(member, '路由危险品', true));

    const taskRecipients = (purchaseId: number) => (ctx.system.db.prepare(`SELECT u.username FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE n.object_type='purchase' AND n.object_id=? AND n.title='待采购任务' ORDER BY u.username`).all(String(purchaseId)) as Array<{ username: string }>).map(({ username }) => username);
    expect(taskRecipients(normal.id)).toEqual(['admin', 'teacher']);
    expect(taskRecipients(dangerous.id)).toEqual(['hazard', 'teacher']);
    const applicantOutcomes = ctx.system.db.prepare(`SELECT object_id FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE u.username='member-a' AND n.object_type='purchase' AND n.title='采购申请通过' ORDER BY object_id`).all() as Array<{ object_id: string }>;
    expect(applicantOutcomes.map(({ object_id }) => Number(object_id))).toEqual(expect.arrayContaining([normal.id, dangerous.id]));

    const memberSocket = await connect(member); const changed = nextPurchaseChange(memberSocket);
    const response = await api(ctx.base, teacher, `/api/purchases/${normal.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: normal.version }) });
    expect(response.status).toBe(200); const purchased = (await response.json()).purchase;
    expect((await changed).status).toBe('purchased');
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='purchase_purchased' AND object_id=?`).get(String(normal.id)) as { count: number }).count).toBe(1);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE u.username='member-a' AND n.object_id=? AND n.title='采购已完成'`).get(String(normal.id)) as { count: number }).count).toBe(1);

    const procurement = await api(ctx.base, teacher, '/api/purchases/tasks/procurement');
    expect(((await procurement.json()).purchases as Array<{ id: number }>).map(({ id }) => id)).not.toContain(normal.id);
    const catalog = await api(ctx.base, admin, '/api/purchases/catalog/normal');
    expect(((await catalog.json()).purchases as Array<{ id: number }>).map(({ id }) => id)).not.toContain(normal.id);
    const all = await api(ctx.base, member, '/api/purchases'); const mine = await api(ctx.base, member, '/api/purchases?scope=mine');
    expect(((await all.json()).purchases as Array<{ id: number; status: string }>).find(({ id }) => id === normal.id)?.status).toBe('purchased');
    expect(((await mine.json()).purchases as Array<{ id: number; status: string }>).find(({ id }) => id === normal.id)?.status).toBe('purchased');
    expect(purchased.status).toBe('purchased');
  });
});
