import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

async function create(cookie: string, chemicalName: string, requestType: 'normal' | 'urgent' = 'normal', hazardous = false) {
  const response = await api(ctx.base, cookie, '/api/purchases', { method: 'POST', body: JSON.stringify({
    chemicalName, specification: 'AR 500g', purpose: '任务队列测试', hazardous, requestType,
  }) });
  return (await response.json()).purchase;
}

async function decide(cookie: string, purchase: { id: number; version: number }, decision: 'approved' | 'deferred') {
  const response = await api(ctx.base, cookie, `/api/purchases/${purchase.id}/decision`, { method: 'POST', body: JSON.stringify({
    decision, comment: decision === 'deferred' ? '稍后处理' : undefined, version: purchase.version,
  }) });
  return (await response.json()).purchase;
}

async function taskIds(cookie: string, queue: 'approvals' | 'procurement') {
  const response = await api(ctx.base, cookie, `/api/purchases/tasks/${queue}`);
  expect(response.status).toBe(200);
  return ((await response.json()).purchases as Array<{ id: number }>).map(({ id }) => id).sort((a, b) => a - b);
}

describe('role-specific purchase task queues', () => {
  it('derives approval and procurement summaries from server-side role queries', async () => {
    const alice = await login(ctx.base, 'member-a'); const bob = await login(ctx.base, 'member-b');
    const admin = await login(ctx.base, 'admin'); const teacher = await login(ctx.base, 'teacher'); const hazard = await login(ctx.base, 'hazard');

    const normalPending = await create(alice, '普通待审批');
    const urgentPending = await create(alice, '加急待审批', 'urgent');
    const normalDeferred = await decide(admin, await create(bob, '普通已推迟'), 'deferred');
    const urgentDeferred = await decide(teacher, await create(bob, '加急已推迟', 'urgent'), 'deferred');
    const normalApproved = await decide(admin, await create(alice, '普通待采购'), 'approved');
    const urgentApproved = await decide(teacher, await create(alice, '加急待采购', 'urgent'), 'approved');
    const hazardousApproved = await decide(hazard, await create(alice, '危险品待采购', 'normal', true), 'approved');

    expect(await taskIds(admin, 'approvals')).toEqual([normalPending.id, normalDeferred.id].sort((a, b) => a - b));
    expect(await taskIds(teacher, 'approvals')).toEqual([normalPending.id, urgentPending.id, normalDeferred.id, urgentDeferred.id].sort((a, b) => a - b));
    expect(await taskIds(admin, 'procurement')).toEqual([normalApproved.id, urgentApproved.id].sort((a, b) => a - b));
    expect(await taskIds(hazard, 'procurement')).toEqual([hazardousApproved.id]);
    expect(await taskIds(teacher, 'procurement')).toEqual([normalApproved.id, urgentApproved.id, hazardousApproved.id].sort((a, b) => a - b));

    const expected = new Map([
      [admin, { approvalCount: 2, procurementCount: 2 }],
      [teacher, { approvalCount: 4, procurementCount: 3 }],
      [hazard, { approvalCount: 0, procurementCount: 1 }],
      [alice, { approvalCount: 0, procurementCount: 0 }],
    ]);
    for (const [cookie, summary] of expected) {
      const response = await api(ctx.base, cookie, '/api/purchases/tasks/summary');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(summary);
    }

    expect(await taskIds(hazard, 'approvals')).toEqual([]);
    expect((await api(ctx.base, alice, '/api/purchases/tasks/approvals')).status).toBe(403);
    expect((await api(ctx.base, alice, '/api/purchases/tasks/procurement')).status).toBe(403);
  });

  it('filters procurement tasks by a strictly validated bound request type', async () => {
    const alice = await login(ctx.base, 'member-a'); const admin = await login(ctx.base, 'admin');
    const teacher = await login(ctx.base, 'teacher'); const hazard = await login(ctx.base, 'hazard');
    const normal = await decide(admin, await create(alice, '筛选普通'), 'approved');
    const urgent = await decide(teacher, await create(alice, '筛选加急', 'urgent'), 'approved');
    const hazardousNormal = await decide(hazard, await create(alice, '筛选危险普通', 'normal', true), 'approved');
    const hazardousUrgentFirstStage = await decide(teacher, await create(alice, '筛选危险加急', 'urgent', true), 'approved');
    const hazardousUrgent = await decide(hazard, hazardousUrgentFirstStage, 'approved');

    async function filtered(cookie: string, requestType: 'normal' | 'urgent') {
      const response = await api(ctx.base, cookie, `/api/purchases/tasks/procurement?requestType=${requestType}`);
      expect(response.status).toBe(200);
      return ((await response.json()).purchases as Array<{ id: number }>).map(({ id }) => id).sort((a, b) => a - b);
    }

    expect(await filtered(admin, 'normal')).toEqual([normal.id]);
    expect(await filtered(admin, 'urgent')).toEqual([urgent.id]);
    expect(await filtered(hazard, 'normal')).toEqual([hazardousNormal.id]);
    expect(await filtered(hazard, 'urgent')).toEqual([hazardousUrgent.id]);
    expect(await filtered(teacher, 'normal')).toEqual([normal.id, hazardousNormal.id].sort((a, b) => a - b));
    expect(await filtered(teacher, 'urgent')).toEqual([urgent.id, hazardousUrgent.id].sort((a, b) => a - b));

    expect((await api(ctx.base, admin, '/api/purchases/tasks/procurement?requestType=other')).status).toBe(400);
    expect((await api(ctx.base, admin, '/api/purchases/tasks/procurement?requestType=normal&requestType=urgent')).status).toBe(400);
  });
});
