import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

describe('inventory vertical slice', () => {
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
