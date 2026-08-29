import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

async function userId(cookie: string, username: string) {
  const response = await api(ctx.base, cookie, '/api/members');
  return (await response.json()).users.find((user: { username: string }) => user.username === username).id as number;
}

async function createRequest(cookie: string, targetUserId: number, name = '代入库乙腈') {
  return api(ctx.base, cookie, '/api/inbound-requests', { method: 'POST', body: JSON.stringify({
    targetUserId, name, specification: 'HPLC 4L', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'B', shelf: 2,
  }) });
}

describe('proxy inbound create and approval', () => {
  it('creates only a pending request scoped to requester/target, then atomically approves it into stock', async () => {
    const alice = await login(ctx.base, 'member-a'); const bob = await login(ctx.base, 'member-b'); const teacher = await login(ctx.base, 'teacher');
    const aliceId = await userId(alice, 'member-a'); const bobId = await userId(alice, 'member-b');

    const createdResponse = await createRequest(alice, bobId);
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).request;
    expect(created).toMatchObject({ status: 'pending', version: 1, requester: { id: aliceId }, targetUser: { id: bobId }, chemicalId: null });
    expect(ctx.system.db.prepare('SELECT COUNT(*) count FROM chemicals WHERE name=?').get('代入库乙腈')).toEqual({ count: 0 });

    expect((await (await api(ctx.base, alice, '/api/inbound-requests?scope=mine')).json()).requests.map((item: { id: number }) => item.id)).toEqual([created.id]);
    expect((await (await api(ctx.base, bob, '/api/inbound-requests?scope=incoming')).json()).requests.map((item: { id: number }) => item.id)).toEqual([created.id]);
    expect((await (await api(ctx.base, teacher, '/api/inbound-requests?scope=incoming')).json()).requests).toEqual([]);

    const bobMessages = (await (await api(ctx.base, bob, '/api/notifications')).json()).notifications;
    expect(bobMessages[0]).toMatchObject({ category: 'proxy_inbound', title: '代入库申请', objectType: 'inbound_request', objectId: String(created.id) });
    expect(bobMessages[0].body).toContain('成员甲 为您提交了 代入库乙腈 的代入库申请，是否同意？');

    const forbidden = await api(ctx.base, teacher, `/api/inbound-requests/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: created.version }) });
    expect(forbidden.status).toBe(403);
    const stale = await api(ctx.base, bob, `/api/inbound-requests/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: 99 }) });
    expect(stale.status).toBe(409);

    const approvedResponse = await api(ctx.base, bob, `/api/inbound-requests/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', comment: '同意入库', version: created.version }) });
    expect(approvedResponse.status).toBe(200);
    const approved = await approvedResponse.json();
    expect(approved.request).toMatchObject({ status: 'approved', version: 2, decisionComment: '同意入库', chemicalId: approved.chemical.id });
    expect(approved.chemical).toMatchObject({ name: '代入库乙腈', owner: { username: 'member-b' }, inboundOperator: { username: 'member-a' }, cabinet: 'B', shelf: 2 });

    const movement = ctx.system.db.prepare(`SELECT m.action,u.username operator FROM inventory_movements m JOIN users u ON u.id=m.operator_id WHERE m.chemical_id=?`).get(approved.chemical.id);
    expect(movement).toEqual({ action: 'inbound', operator: 'member-a' });
    const actions = (ctx.system.db.prepare('SELECT action FROM audit_logs WHERE object_id IN (?,?) ORDER BY id').all(String(created.id), String(approved.chemical.id)) as Array<{ action: string }>).map(({ action }) => action);
    expect(actions).toEqual(expect.arrayContaining(['proxy_inbound_requested', 'proxy_inbound_approved', 'inventory_inbound']));

    const duplicate = await api(ctx.base, bob, `/api/inbound-requests/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: approved.request.version }) });
    expect(duplicate.status).toBe(409);
    expect(ctx.system.db.prepare('SELECT COUNT(*) count FROM chemicals WHERE name=?').get('代入库乙腈')).toEqual({ count: 1 });
  });

  it('rejects self-targeting and disabled targets', async () => {
    const alice = await login(ctx.base, 'member-a'); const teacher = await login(ctx.base, 'teacher');
    const aliceId = await userId(alice, 'member-a'); const bobId = await userId(alice, 'member-b');
    expect((await createRequest(alice, aliceId, '自己')).status).toBe(400);
    ctx.system.db.prepare('UPDATE users SET active=0 WHERE id=?').run(bobId);
    expect((await createRequest(alice, bobId, '停用目标')).status).toBe(400);
    expect((await createRequest(alice, await userId(teacher, 'teacher'), '有效目标')).status).toBe(201);
  });

  it('keeps the incoming queue visible when proxy inbound messages are disabled', async () => {
    const alice = await login(ctx.base, 'member-a'); const bob = await login(ctx.base, 'member-b'); const bobId = await userId(alice, 'member-b');
    const preference = await api(ctx.base, bob, '/api/notifications/preferences', { method: 'PUT', body: JSON.stringify({ category: 'proxy_inbound', enabled: false }) });
    expect(preference.status).toBe(200);
    const created = (await (await createRequest(alice, bobId, '屏蔽消息样品')).json()).request;
    const messages = (await (await api(ctx.base, bob, '/api/notifications')).json()).notifications;
    expect(messages.some((item: { objectId: string | null }) => item.objectId === String(created.id))).toBe(false);
    const incoming = (await (await api(ctx.base, bob, '/api/inbound-requests?scope=incoming')).json()).requests;
    expect(incoming).toEqual([expect.objectContaining({ id: created.id, status: 'pending' })]);
  });
});

describe('proxy inbound rejection and withdrawal', () => {
  it('lets only the target reject a pending request without creating stock, then notifies and audits', async () => {
    const alice = await login(ctx.base, 'member-a'); const bob = await login(ctx.base, 'member-b');
    const bobId = await userId(alice, 'member-b');
    const created = (await (await createRequest(alice, bobId, '拒绝样品')).json()).request;

    const forbidden = await api(ctx.base, alice, `/api/inbound-requests/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '不能接收', version: created.version }) });
    expect(forbidden.status).toBe(403);
    const stale = await api(ctx.base, bob, `/api/inbound-requests/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '不能接收', version: 99 }) });
    expect(stale.status).toBe(409);

    const rejectedResponse = await api(ctx.base, bob, `/api/inbound-requests/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '不能接收', version: created.version }) });
    expect(rejectedResponse.status).toBe(200);
    const rejected = (await rejectedResponse.json()).request;
    expect(rejected).toMatchObject({ status: 'rejected', version: 2, decisionComment: '不能接收', chemicalId: null });
    expect(ctx.system.db.prepare('SELECT COUNT(*) count FROM chemicals WHERE name=?').get('拒绝样品')).toEqual({ count: 0 });

    const messages = (await (await api(ctx.base, alice, '/api/notifications')).json()).notifications;
    expect(messages[0]).toMatchObject({ category: 'proxy_inbound', title: '代入库申请已拒绝', objectType: 'inbound_request', objectId: String(created.id) });
    expect(ctx.system.db.prepare('SELECT action FROM audit_logs WHERE object_type=? AND object_id=? ORDER BY id DESC LIMIT 1').get('inbound_request', String(created.id))).toEqual({ action: 'proxy_inbound_rejected' });

    const duplicate = await api(ctx.base, bob, `/api/inbound-requests/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '再次拒绝', version: rejected.version }) });
    expect(duplicate.status).toBe(409);
  });

  it('lets only the requester withdraw a pending request without creating stock, then notifies and audits', async () => {
    const alice = await login(ctx.base, 'member-a'); const bob = await login(ctx.base, 'member-b');
    const bobId = await userId(alice, 'member-b');
    const created = (await (await createRequest(alice, bobId, '撤销样品')).json()).request;

    const forbidden = await api(ctx.base, bob, `/api/inbound-requests/${created.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: created.version }) });
    expect(forbidden.status).toBe(403);
    const stale = await api(ctx.base, alice, `/api/inbound-requests/${created.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: 99 }) });
    expect(stale.status).toBe(409);

    const withdrawnResponse = await api(ctx.base, alice, `/api/inbound-requests/${created.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: created.version }) });
    expect(withdrawnResponse.status).toBe(200);
    const withdrawn = (await withdrawnResponse.json()).request;
    expect(withdrawn).toMatchObject({ status: 'withdrawn', version: 2, chemicalId: null });
    expect(ctx.system.db.prepare('SELECT COUNT(*) count FROM chemicals WHERE name=?').get('撤销样品')).toEqual({ count: 0 });

    const messages = (await (await api(ctx.base, bob, '/api/notifications')).json()).notifications;
    expect(messages[0]).toMatchObject({ category: 'proxy_inbound', title: '代入库申请已撤销', objectType: 'inbound_request', objectId: String(created.id) });
    expect(ctx.system.db.prepare('SELECT action FROM audit_logs WHERE object_type=? AND object_id=? ORDER BY id DESC LIMIT 1').get('inbound_request', String(created.id))).toEqual({ action: 'proxy_inbound_withdrawn' });

    const duplicate = await api(ctx.base, alice, `/api/inbound-requests/${created.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: withdrawn.version }) });
    expect(duplicate.status).toBe(409);
  });
});
