import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

describe('inventory vertical slice', () => {
  it('supports C1 direct inbound, strict C queries, and bidirectional A/B to C moves', async () => {
    const alice = await login(ctx.base, 'member-a'); const bob = await login(ctx.base, 'member-b');
    const acidResponse = await api(ctx.base, alice, '/api/chemicals', { method: 'POST', body: JSON.stringify({
      name: '盐酸', specification: 'AR 500mL', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'C', shelf: 1,
    }) });
    expect(acidResponse.status).toBe(201);
    const acid = (await acidResponse.json()).chemical;
    expect(acid).toMatchObject({ cabinet: 'C', shelf: 1 });

    const invalidAcid = await api(ctx.base, alice, '/api/chemicals', { method: 'POST', body: JSON.stringify({
      name: '错误盐酸', specification: 'AR', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'C', shelf: 2,
    }) });
    expect(invalidAcid.status).toBe(400);
    expect((await invalidAcid.json()).error.message).toContain('C 柜仅允许第 1 层');

    expect((await api(ctx.base, alice, '/api/chemicals?cabinet=C')).status).toBe(200);
    expect((await api(ctx.base, alice, '/api/chemicals?cabinet=C&shelf=1')).status).toBe(200);
    const invalidQuery = await api(ctx.base, alice, '/api/chemicals?cabinet=C&shelf=2');
    expect(invalidQuery.status).toBe(400); expect((await invalidQuery.json()).error.message).toContain('C 柜仅允许第 1 层');
    expect((await api(ctx.base, alice, '/api/chemicals?cabinet=D')).status).toBe(400);
    expect((await api(ctx.base, alice, '/api/chemicals?cabinet=C&unexpected=1')).status).toBe(400);

    const toA = await api(ctx.base, bob, `/api/chemicals/${acid.id}/move`, { method: 'PATCH', body: JSON.stringify({ cabinet: 'A', shelf: 5, version: acid.version }) });
    expect(toA.status).toBe(200); const movedToA = (await toA.json()).chemical;
    const toC = await api(ctx.base, bob, `/api/chemicals/${acid.id}/move`, { method: 'PATCH', body: JSON.stringify({ cabinet: 'C', shelf: 1, version: movedToA.version }) });
    expect(toC.status).toBe(200); expect((await toC.json()).chemical).toMatchObject({ cabinet: 'C', shelf: 1, version: 3 });

    const logs = (await (await api(ctx.base, alice, '/api/audit-logs')).json()).logs as Array<{ summary: string }>;
    expect(logs.some(({ summary }) => summary.includes('C 柜 1 层'))).toBe(true);
    const messages = (await (await api(ctx.base, alice, '/api/notifications')).json()).notifications as Array<{ body: string }>;
    expect(messages.some(({ body }) => body.includes('C 柜 1 层'))).toBe(true);
  });

  it('persists inbound stock in its shelf with atomic audit and routed messages', async () => {
    const member = await login(ctx.base, 'member-a');
    const response = await api(ctx.base, member, '/api/chemicals', { method: 'POST', body: JSON.stringify({
      name: '无水乙醇', specification: 'AR 500mL', inboundAt: '2026-08-29T08:00:00.000Z', cabinet: 'A', shelf: 2,
    }) });
    expect(response.status).toBe(201);
    const chemical = (await response.json()).chemical;

    const shelf = await api(ctx.base, member, '/api/chemicals?cabinet=A&shelf=2');
    expect((await shelf.json()).chemicals).toEqual([expect.objectContaining({ id: chemical.id, name: '无水乙醇', owner: expect.objectContaining({ username: 'member-a' }) })]);
    const audit = await api(ctx.base, member, '/api/audit-logs');
    expect((await audit.json()).logs[0]).toEqual(expect.objectContaining({ action: 'inventory_inbound', objectId: String(chemical.id) }));
    const notifications = await api(ctx.base, member, '/api/notifications');
    expect((await notifications.json()).notifications[0].category).toBe('inventory_inbound');
  });

  it('locks direct inbound ownership to the authenticated user and rejects legacy owner overrides', async () => {
    const alice = await login(ctx.base, 'member-a');
    const bob = await login(ctx.base, 'member-b');
    const members = await api(ctx.base, alice, '/api/members');
    const bobId = (await members.json()).users.find((user: { username: string }) => user.username === 'member-b').id;

    const overridden = await api(ctx.base, alice, '/api/chemicals', { method: 'POST', body: JSON.stringify({
      name: '越权入库', specification: '1 瓶', ownerId: bobId, inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'A', shelf: 2,
    }) });
    expect(overridden.status).toBe(400);

    const direct = await api(ctx.base, alice, '/api/chemicals', { method: 'POST', body: JSON.stringify({
      name: '本人入库', specification: '1 瓶', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'A', shelf: 2,
    }) });
    expect(direct.status).toBe(201);
    expect((await direct.json()).chemical).toMatchObject({
      owner: { username: 'member-a' }, inboundOperator: { username: 'member-a' },
    });

    const bobShelf = await api(ctx.base, bob, '/api/chemicals?search=越权入库');
    expect((await bobShelf.json()).chemicals).toHaveLength(0);
  });

  it('moves another member’s chemical, discards without deleting, and rejects invalid shelf data', async () => {
    const alice = await login(ctx.base, 'member-a');
    const bob = await login(ctx.base, 'member-b');
    const createdResponse = await api(ctx.base, bob, '/api/chemicals', { method: 'POST', body: JSON.stringify({
      name: '丙酮', specification: 'AR 500mL', inboundAt: '2026-08-29T08:00:00.000Z', cabinet: 'A', shelf: 1,
    }) });
    const created = (await createdResponse.json()).chemical;
    const invalid = await api(ctx.base, alice, `/api/chemicals/${created.id}/move`, { method: 'PATCH', body: JSON.stringify({ cabinet: 'B', shelf: 6, version: created.version }) });
    expect(invalid.status).toBe(400);

    const movedResponse = await api(ctx.base, alice, `/api/chemicals/${created.id}/move`, { method: 'PATCH', body: JSON.stringify({ cabinet: 'B', shelf: 5, version: created.version }) });
    expect(movedResponse.status).toBe(200);
    const moved = (await movedResponse.json()).chemical;
    expect(moved).toMatchObject({ cabinet: 'B', shelf: 5, version: 2 });

    const stale = await api(ctx.base, bob, `/api/chemicals/${created.id}/discard`, { method: 'PATCH', body: JSON.stringify({ confirmed: true, version: created.version }) });
    expect(stale.status).toBe(409);
    const discardedResponse = await api(ctx.base, bob, `/api/chemicals/${created.id}/discard`, { method: 'PATCH', body: JSON.stringify({ confirmed: true, reason: '污染', version: moved.version }) });
    expect(discardedResponse.status).toBe(200);
    expect((await discardedResponse.json()).chemical.status).toBe('discarded');
    const active = await api(ctx.base, bob, '/api/chemicals?cabinet=B&shelf=5');
    expect((await active.json()).chemicals).toHaveLength(0);
    const history = await api(ctx.base, bob, `/api/chemicals/${created.id}`);
    expect((await history.json()).chemical.status).toBe('discarded');
  });
});
