import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

async function create(cookie: string, requestType: 'normal' | 'urgent' = 'normal', hazardous = false) {
  return api(ctx.base, cookie, '/api/purchases', { method: 'POST', body: JSON.stringify({
    chemicalName: hazardous ? '叠氮化钠' : '氯化钠', specification: 'AR 500g', purpose: '合成实验', hazardous, requestType,
  }) });
}

describe('purchase request state machine', () => {
  it('lets normal admins decide normal requests while enforcing comments and optimistic versions', async () => {
    const member = await login(ctx.base, 'member-a'); const admin = await login(ctx.base, 'admin');
    const createdResponse = await create(member); expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).purchase; expect(created.status).toBe('pending_normal');
    const noComment = await api(ctx.base, admin, `/api/purchases/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'deferred', version: created.version }) });
    expect(noComment.status).toBe(400);
    const deferredResponse = await api(ctx.base, admin, `/api/purchases/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'deferred', comment: '补充纯度', version: created.version }) });
    const deferred = (await deferredResponse.json()).purchase; expect(deferred).toMatchObject({ status: 'deferred', approvalComment: '补充纯度', version: 2 });
    const revisedResponse = await api(ctx.base, member, `/api/purchases/${created.id}`, { method: 'PATCH', body: JSON.stringify({ specification: 'GR 500g', version: deferred.version }) });
    const revised = (await revisedResponse.json()).purchase; expect(revised).toMatchObject({ status: 'pending_normal', approvalComment: null, version: 3 });
    const stale = await api(ctx.base, admin, `/api/purchases/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: deferred.version }) });
    expect(stale.status).toBe(409);
    const approved = await api(ctx.base, admin, `/api/purchases/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: revised.version }) });
    expect((await approved.json()).purchase.status).toBe('approved');
  });

  it('restricts urgent approval to super admins and owner-only editing/withdrawal', async () => {
    const alice = await login(ctx.base, 'member-a'); const bob = await login(ctx.base, 'member-b');
    const admin = await login(ctx.base, 'admin'); const teacher = await login(ctx.base, 'teacher');
    const created = (await (await create(alice, 'urgent')).json()).purchase;
    expect(created.status).toBe('pending_super');
    const forbiddenDecision = await api(ctx.base, admin, `/api/purchases/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: created.version }) });
    expect(forbiddenDecision.status).toBe(403);
    const forbiddenEdit = await api(ctx.base, bob, `/api/purchases/${created.id}`, { method: 'PATCH', body: JSON.stringify({ purpose: '越权修改', version: created.version }) });
    expect(forbiddenEdit.status).toBe(403);
    const rejectedNoComment = await api(ctx.base, teacher, `/api/purchases/${created.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'rejected', version: created.version }) });
    expect(rejectedNoComment.status).toBe(400);
    const withdrawn = await api(ctx.base, alice, `/api/purchases/${created.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: created.version }) });
    expect((await withdrawn.json()).purchase.status).toBe('withdrawn');
    const terminalEdit = await api(ctx.base, alice, `/api/purchases/${created.id}`, { method: 'PATCH', body: JSON.stringify({ purpose: '不能修改', version: 2 }) });
    expect(terminalEdit.status).toBe(409);
  });
});
