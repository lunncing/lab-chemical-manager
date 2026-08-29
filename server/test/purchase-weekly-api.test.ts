import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentBeijingWeekStart, weekEnd } from '../src/purchase-weeks.js';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

function shiftWeek(weekStart: string, days: number): string {
  const date = new Date(`${weekStart}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}

function archive(values: { name: string; weekStart: string; status?: 'approved' | 'purchased'; requestType?: 'normal' | 'urgent'; hazardous?: boolean }): number {
  const decidedAt = `${values.weekStart}T08:00:00.000Z`;
  const result = ctx.system.db.prepare(`INSERT INTO purchases (chemical_name,specification,purpose,hazardous,request_type,applicant_id,status,created_at,updated_at,decided_at)
    VALUES (?, '1瓶', 'API 测试', ?, ?, 4, ?, ?, ?, ?)`).run(values.name, Number(values.hazardous ?? false), values.requestType ?? 'normal', values.status ?? 'approved', decidedAt, decidedAt, decidedAt);
  const id = Number(result.lastInsertRowid);
  ctx.system.db.prepare('INSERT INTO purchase_weekly_entries (purchase_id,week_start,added_at) VALUES (?,?,?)').run(id, values.weekStart, decidedAt);
  return id;
}

describe('weekly normal purchase catalog APIs', () => {
  it('always returns an empty current week and permits only normal/super admins', async () => {
    const member = await login(ctx.base, 'member-a'); const hazard = await login(ctx.base, 'hazard');
    const admin = await login(ctx.base, 'admin'); const teacher = await login(ctx.base, 'teacher');
    const current = currentBeijingWeekStart();
    for (const cookie of [member, hazard]) expect((await api(ctx.base, cookie, '/api/purchases/catalog/normal/weeks')).status).toBe(403);
    for (const cookie of [admin, teacher]) {
      const response = await api(ctx.base, cookie, '/api/purchases/catalog/normal/weeks'); expect(response.status).toBe(200);
      expect((await response.json()).weeks).toEqual([{ weekStart: current, weekEnd: weekEnd(current), count: 0, approvedCount: 0, purchasedCount: 0, isCurrent: true }]);
    }
  });

  it('returns descending archived weeks with approved and purchased statistics', async () => {
    const admin = await login(ctx.base, 'admin'); const current = currentBeijingWeekStart(); const previous = shiftWeek(current, -7);
    archive({ name: '本周待采购', weekStart: current });
    archive({ name: '本周已采购', weekStart: current, status: 'purchased' });
    archive({ name: '历史已采购', weekStart: previous, status: 'purchased' });
    archive({ name: '损坏的加急归档', weekStart: previous, requestType: 'urgent' });
    archive({ name: '损坏的危险归档', weekStart: previous, hazardous: true });

    const weeks = (await (await api(ctx.base, admin, '/api/purchases/catalog/normal/weeks')).json()).weeks;
    expect(weeks).toEqual([
      { weekStart: current, weekEnd: weekEnd(current), count: 2, approvedCount: 1, purchasedCount: 1, isCurrent: true },
      { weekStart: previous, weekEnd: weekEnd(previous), count: 1, approvedCount: 0, purchasedCount: 1, isCurrent: false },
    ]);
  });

  it('serves current or specified archived membership, retaining purchased and excluding urgent/hazardous rows', async () => {
    const admin = await login(ctx.base, 'admin'); const member = await login(ctx.base, 'member-a');
    const current = currentBeijingWeekStart(); const previous = shiftWeek(current, -7);
    const currentId = archive({ name: '本周普通', weekStart: current });
    const approvedId = archive({ name: '历史待采购', weekStart: previous });
    const purchasedId = archive({ name: '历史已采购', weekStart: previous, status: 'purchased' });
    archive({ name: '历史加急', weekStart: previous, requestType: 'urgent' });
    archive({ name: '历史危险', weekStart: previous, hazardous: true });

    expect((await api(ctx.base, member, '/api/purchases/catalog/normal')).status).toBe(403);
    const currentBody = await (await api(ctx.base, admin, '/api/purchases/catalog/normal')).json();
    expect(currentBody.week).toEqual({ weekStart: current, weekEnd: weekEnd(current), isCurrent: true });
    expect(currentBody.purchases.map((purchase: { id: number }) => purchase.id)).toEqual([currentId]);

    const historical = await (await api(ctx.base, admin, `/api/purchases/catalog/normal?week=${previous}`)).json();
    expect(historical.week).toEqual({ weekStart: previous, weekEnd: weekEnd(previous), isCurrent: false });
    expect(historical.purchases.map((purchase: { id: number; status: string }) => ({ id: purchase.id, status: purchase.status }))).toEqual([
      { id: purchasedId, status: 'purchased' }, { id: approvedId, status: 'approved' },
    ]);
  });

  it('rejects non-Mondays, impossible/loose dates, and repeated week queries with a Chinese 400', async () => {
    const admin = await login(ctx.base, 'admin');
    for (const query of ['2026-08-23', '2026-02-30', '2026-8-24', '2026-08-24T00%3A00%3A00Z', '2026-08-24&week=2026-08-31']) {
      const response = await api(ctx.base, admin, `/api/purchases/catalog/normal?week=${query}`);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual({ code: 'VALIDATION_ERROR', message: '采购周次必须是格式严格的真实周一日期' });
    }
  });
});
