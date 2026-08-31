import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

describe('catalog and notification routing', () => {
  it('routes approved normal, urgent, and hazardous requests to the correct catalogs', async () => {
    const member = await login(ctx.base, 'member-a'); const admin = await login(ctx.base, 'admin');
    const teacher = await login(ctx.base, 'teacher'); const hazard = await login(ctx.base, 'hazard');
    async function submit(requestType: 'normal' | 'urgent', hazardous: boolean) {
      const response = await api(ctx.base, member, '/api/purchases', { method: 'POST', body: JSON.stringify({ chemicalName: `${requestType}-${hazardous}`, specification: '1瓶', purpose: '测试', requestType, hazardous }) });
      return (await response.json()).purchase;
    }
    async function approve(purchase: any, cookie: string) {
      const response = await api(ctx.base, cookie, `/api/purchases/${purchase.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: purchase.version }) });
      expect(response.status).toBe(200);
      return (await response.json()).purchase;
    }
    const normal = await submit('normal', false); const urgent = await submit('urgent', false);
    const dangerous = await submit('normal', true); const dangerousUrgent = await submit('urgent', true);
    await approve(normal, admin); await approve(urgent, teacher); await approve(dangerous, hazard);
    await approve(await approve(dangerousUrgent, teacher), hazard);
    const normalIds = (await (await api(ctx.base, admin, '/api/purchases/catalog/normal')).json()).purchases.map((p: any) => p.id);
    const urgentIds = (await (await api(ctx.base, admin, '/api/purchases/catalog/urgent')).json()).purchases.map((p: any) => p.id);
    const hazardousIds = (await (await api(ctx.base, hazard, '/api/purchases/catalog/hazardous')).json()).purchases.map((p: any) => p.id);
    expect(normalIds).toContain(normal.id); expect(normalIds).not.toContain(dangerous.id);
    expect(urgentIds).toContain(urgent.id); expect(urgentIds).not.toContain(dangerousUrgent.id);
    expect(hazardousIds).toEqual([dangerousUrgent.id, dangerous.id]);
    expect((await api(ctx.base, member, '/api/purchases/catalog/hazardous')).status).toBe(403);
  });

  it('notification category switches block only future messages, not audit or business data', async () => {
    const member = await login(ctx.base, 'member-a');
    const before = await api(ctx.base, member, '/api/notifications/preferences', { method: 'PUT', body: JSON.stringify({ category: 'inventory_inbound', enabled: false }) });
    expect(before.status).toBe(200);
    await api(ctx.base, member, '/api/chemicals', { method: 'POST', body: JSON.stringify({ name: '屏蔽测试', specification: '1瓶', inboundAt: '2026-08-29T08:00:00.000Z', cabinet: 'A', shelf: 3 }) });
    const messages = await api(ctx.base, member, '/api/notifications');
    expect((await messages.json()).notifications.filter((n: any) => n.category === 'inventory_inbound')).toHaveLength(0);
    const chemicals = await api(ctx.base, member, '/api/chemicals?search=屏蔽测试');
    expect((await chemicals.json()).chemicals).toHaveLength(1);
    const logs = await api(ctx.base, member, '/api/audit-logs');
    const audit = (await logs.json()).logs.find((log: any) => log.summary.includes('屏蔽测试'));
    expect(audit).toBeDefined();
    expect(audit.details).toMatchObject({ cabinet: 'A', shelf: 3, ownerId: 4 });
  });
});
