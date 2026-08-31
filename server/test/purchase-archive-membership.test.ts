import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beijingWeekStart } from '../src/purchase-weeks.js';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

async function create(cookie: string, name: string, requestType: 'normal' | 'urgent' = 'normal', hazardous = false) {
  const response = await api(ctx.base, cookie, '/api/purchases', { method: 'POST', body: JSON.stringify({
    chemicalName: name, specification: '1瓶', purpose: '归档事务测试', hazardous, requestType,
  }) });
  expect(response.status).toBe(201);
  return (await response.json()).purchase;
}

async function decide(cookie: string, purchase: { id: number; version: number }, decision: 'approved' | 'deferred' | 'rejected', comment?: string) {
  return api(ctx.base, cookie, `/api/purchases/${purchase.id}/decision`, { method: 'POST', body: JSON.stringify({ decision, comment, version: purchase.version }) });
}

describe('approval-time weekly archive membership', () => {
  it('archives only approved normal nonhazardous requests using their successful decision time', async () => {
    const member = await login(ctx.base, 'member-a'); const admin = await login(ctx.base, 'admin'); const teacher = await login(ctx.base, 'teacher'); const hazard = await login(ctx.base, 'hazard');
    const normal = await create(member, '普通非危险品');
    const hazardous = await create(member, '普通危险品', 'normal', true);
    const urgent = await create(member, '加急非危险品', 'urgent');
    const deferred = await create(member, '推迟普通品');
    const rejected = await create(member, '驳回普通品');
    const withdrawn = await create(member, '撤销普通品');

    const approvedResponse = await decide(admin, normal, 'approved'); expect(approvedResponse.status).toBe(200);
    const approved = (await approvedResponse.json()).purchase;
    expect(ctx.system.db.prepare('SELECT purchase_id,week_start,added_at FROM purchase_weekly_entries').all()).toEqual([
      { purchase_id: normal.id, week_start: beijingWeekStart(approved.decidedAt), added_at: approved.decidedAt },
    ]);

    expect((await decide(hazard, hazardous, 'approved')).status).toBe(200);
    expect((await decide(teacher, urgent, 'approved')).status).toBe(200);
    expect((await decide(admin, deferred, 'deferred', '等待预算')).status).toBe(200);
    expect((await decide(admin, rejected, 'rejected', '不予采购')).status).toBe(200);
    expect((await api(ctx.base, member, `/api/purchases/${withdrawn.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: withdrawn.version }) })).status).toBe(200);
    expect(ctx.system.db.prepare('SELECT purchase_id FROM purchase_weekly_entries ORDER BY purchase_id').all()).toEqual([{ purchase_id: normal.id }]);
  });

  it('rolls back approval, audit, and notifications when archive insertion fails', async () => {
    const member = await login(ctx.base, 'member-a'); const admin = await login(ctx.base, 'admin');
    const purchase = await create(member, '原子失败样品');
    ctx.system.db.exec(`CREATE TRIGGER fail_weekly_archive BEFORE INSERT ON purchase_weekly_entries BEGIN SELECT RAISE(ABORT, 'archive failed'); END`);

    const response = await decide(admin, purchase, 'approved');
    expect(response.status).toBe(500);
    expect(ctx.system.db.prepare('SELECT status,version,decided_at FROM purchases WHERE id=?').get(purchase.id)).toEqual({ status: 'pending_normal', version: 1, decided_at: null });
    expect(ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='purchase_approved' AND object_id=?`).get(String(purchase.id))).toEqual({ count: 0 });
    expect(ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications WHERE object_type='purchase' AND object_id=? AND title IN ('采购申请通过','待采购任务')`).get(String(purchase.id))).toEqual({ count: 0 });
    expect(ctx.system.db.prepare('SELECT COUNT(*) count FROM purchase_weekly_entries WHERE purchase_id=?').get(purchase.id)).toEqual({ count: 0 });
  });
});
