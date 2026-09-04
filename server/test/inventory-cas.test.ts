import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

async function memberId(cookie: string, username: string): Promise<number> {
  const response = await api(ctx.base, cookie, '/api/members');
  return (await response.json()).users.find((user: { username: string }) => user.username === username).id;
}

function directBody(name: string, casNumber?: unknown) {
  return {
    name, specification: 'AR 500mL', inboundAt: '2026-09-04T08:00:00.000Z', cabinet: 'A', shelf: 1,
    ...(casNumber !== undefined ? { casNumber } : {}),
  };
}

describe('CAS in direct and proxy inbound', () => {
  it('normalizes optional direct-inbound CAS to string/null and does not make it unique', async () => {
    const alice = await login(ctx.base, 'member-a');
    const omitted = await api(ctx.base, alice, '/api/chemicals', { method: 'POST', body: JSON.stringify(directBody('未填 CAS')) });
    expect(omitted.status).toBe(201);
    expect((await omitted.json()).chemical.casNumber).toBeNull();

    const blank = await api(ctx.base, alice, '/api/chemicals', { method: 'POST', body: JSON.stringify(directBody('空白 CAS', '   ')) });
    expect(blank.status).toBe(201);
    expect((await blank.json()).chemical.casNumber).toBeNull();

    for (const name of ['乙醇甲瓶', '乙醇乙瓶']) {
      const response = await api(ctx.base, alice, '/api/chemicals', { method: 'POST', body: JSON.stringify(directBody(name, ' 64-17-5 ')) });
      expect(response.status).toBe(201);
      expect((await response.json()).chemical.casNumber).toBe('64-17-5');
    }
    expect(ctx.system.db.prepare(`SELECT name,cas_number FROM chemicals WHERE cas_number='64-17-5' ORDER BY id`).all()).toEqual([
      { name: '乙醇甲瓶', cas_number: '64-17-5' }, { name: '乙醇乙瓶', cas_number: '64-17-5' },
    ]);
  });

  it('rejects malformed and wrong-check-digit CAS at both inbound boundaries with Chinese errors', async () => {
    const alice = await login(ctx.base, 'member-a'); const bobId = await memberId(alice, 'member-b');
    const malformed = await api(ctx.base, alice, '/api/chemicals', { method: 'POST', body: JSON.stringify(directBody('格式错误', '64/17/5')) });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.message).toContain('CAS号格式应为 2–7 位数字-2 位数字-1 位校验码');

    const wrongCheck = await api(ctx.base, alice, '/api/inbound-requests', { method: 'POST', body: JSON.stringify({
      targetUserId: bobId, ...directBody('校验位错误', '64-17-6'),
    }) });
    expect(wrongCheck.status).toBe(400);
    expect((await wrongCheck.json()).error.message).toContain('CAS号校验位不正确');
    expect(ctx.system.db.prepare('SELECT COUNT(*) count FROM chemicals').get()).toEqual({ count: 0 });
    expect(ctx.system.db.prepare('SELECT COUNT(*) count FROM inbound_requests').get()).toEqual({ count: 0 });
  });

  it('stores normalized CAS on a pending request and transfers it unchanged on approval', async () => {
    const alice = await login(ctx.base, 'member-a'); const bob = await login(ctx.base, 'member-b'); const bobId = await memberId(alice, 'member-b');
    const createdResponse = await api(ctx.base, alice, '/api/inbound-requests', { method: 'POST', body: JSON.stringify({
      targetUserId: bobId, ...directBody('代入库丙酮', ' 67-64-1 '), cabinet: 'G1', shelf: 1,
    }) });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).request;
    expect(created).toMatchObject({ casNumber: '67-64-1', cabinet: 'G1', shelf: 1, status: 'pending' });
    expect(ctx.system.db.prepare('SELECT cas_number FROM inbound_requests WHERE id=?').get(created.id)).toEqual({ cas_number: '67-64-1' });

    const approvedResponse = await api(ctx.base, bob, `/api/inbound-requests/${created.id}/decision`, {
      method: 'POST', body: JSON.stringify({ decision: 'approved', version: created.version }),
    });
    expect(approvedResponse.status).toBe(200);
    const approved = await approvedResponse.json();
    expect(approved.request).toMatchObject({ casNumber: '67-64-1', status: 'approved', chemicalId: approved.chemical.id });
    expect(approved.chemical).toMatchObject({ casNumber: '67-64-1', owner: { username: 'member-b' }, inboundOperator: { username: 'member-a' } });
    expect(ctx.system.db.prepare('SELECT cas_number FROM chemicals WHERE id=?').get(approved.chemical.id)).toEqual({ cas_number: '67-64-1' });
  });
});
