import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

function expectDescending(ids: number[]): void {
  expect(ids).toEqual([...ids].sort((left, right) => right - left));
}

describe('bounded high-volume list queries', () => {
  it('returns at most the newest 500 audit rows ordered by id descending', async () => {
    const insert = ctx.system.db.prepare(`INSERT INTO audit_logs
      (actor_id,action,object_type,object_id,summary,details_json,created_at) VALUES (4,'perf_audit','chemical',?,?,?,?)`);
    ctx.system.db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 510; index += 1) insert.run(String(index), `审计 ${index}`, '{}', `2026-08-30T00:00:${String(index % 60).padStart(2, '0')}.000Z`);
      ctx.system.db.exec('COMMIT');
    } catch (error) { ctx.system.db.exec('ROLLBACK'); throw error; }

    const member = await login(ctx.base, 'member-a');
    const response = await api(ctx.base, member, '/api/audit-logs');
    const logs = (await response.json()).logs as Array<{ id: number }>;

    expect(logs).toHaveLength(500);
    expectDescending(logs.map(({ id }) => id));
    expect(logs[0]!.id).toBe(510);
    expect(logs.at(-1)!.id).toBe(11);
  });

  it('caps purchases all/mine at 500 while leaving complete task and catalog semantics visible', async () => {
    const insert = ctx.system.db.prepare(`INSERT INTO purchases
      (chemical_name,specification,purpose,hazardous,request_type,applicant_id,status,created_at,updated_at)
      VALUES (?,'1瓶','性能边界',0,'normal',?,'pending_normal',?,?)`);
    const catalogInsert = ctx.system.db.prepare(`INSERT INTO purchases
      (chemical_name,specification,purpose,hazardous,request_type,applicant_id,status,created_at,updated_at,decided_at)
      VALUES (?,'1瓶','目录语义',0,'urgent',4,'approved',?,?,?)`);
    ctx.system.db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 510; index += 1) {
        const at = `2026-08-30T01:${String(index % 60).padStart(2, '0')}:00.000Z`;
        insert.run(`成员甲-${index}`, 4, at, at);
      }
      for (let index = 0; index < 10; index += 1) {
        const at = `2026-08-30T02:${String(index).padStart(2, '0')}:00.000Z`;
        insert.run(`成员乙-${index}`, 5, at, at);
      }
      for (let index = 0; index < 505; index += 1) {
        const at = `2026-08-30T03:${String(index % 60).padStart(2, '0')}:00.000Z`;
        catalogInsert.run(`加急目录-${index}`, at, at, at);
      }
      ctx.system.db.exec('COMMIT');
    } catch (error) { ctx.system.db.exec('ROLLBACK'); throw error; }

    const member = await login(ctx.base, 'member-a'); const admin = await login(ctx.base, 'admin');
    const all = (await (await api(ctx.base, member, '/api/purchases')).json()).purchases as Array<{ id: number }>;
    const mine = (await (await api(ctx.base, member, '/api/purchases?scope=mine')).json()).purchases as Array<{ id: number }>;
    const tasks = (await (await api(ctx.base, admin, '/api/purchases/tasks/approvals')).json()).purchases as Array<{ id: number }>;
    const catalog = (await (await api(ctx.base, admin, '/api/purchases/catalog/urgent')).json()).purchases as Array<{ id: number }>;

    expect(all).toHaveLength(500); expectDescending(all.map(({ id }) => id));
    expect(mine).toHaveLength(500); expectDescending(mine.map(({ id }) => id));
    expect(tasks).toHaveLength(520); expectDescending(tasks.map(({ id }) => id));
    expect(catalog).toHaveLength(505); expectDescending(catalog.map(({ id }) => id));
  });

  it('keeps 500 notification rows but obtains unreadCount from an independent COUNT', async () => {
    const insert = ctx.system.db.prepare(`INSERT INTO notifications
      (user_id,category,title,body,object_type,object_id,created_at)
      VALUES (4,'account',?,'性能边界','user',?,?)`);
    ctx.system.db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 510; index += 1) insert.run(`通知 ${index}`, String(index), `2026-08-30T03:00:${String(index % 60).padStart(2, '0')}.000Z`);
      ctx.system.db.exec('COMMIT');
    } catch (error) { ctx.system.db.exec('ROLLBACK'); throw error; }

    const member = await login(ctx.base, 'member-a');
    const listBody = await (await api(ctx.base, member, '/api/notifications')).json();
    const countBody = await (await api(ctx.base, member, '/api/notifications/unread-count')).json();

    expect(listBody.notifications).toHaveLength(500);
    expect(listBody.unreadCount).toBe(510);
    expect(countBody.unreadCount).toBe(510);
  });
});
