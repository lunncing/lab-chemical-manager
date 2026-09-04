import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

async function inbound(cookie: string, name: string, specification: string, casNumber?: string) {
  const response = await api(ctx.base, cookie, '/api/chemicals', { method: 'POST', body: JSON.stringify({
    name, specification, ...(casNumber === undefined ? {} : { casNumber }),
    inboundAt: '2026-09-04T08:00:00.000Z', cabinet: 'A', shelf: 1,
  }) });
  expect(response.status).toBe(201);
  return (await response.json()).chemical;
}

async function search(cookie: string, term: string) {
  const response = await api(ctx.base, cookie, `/api/chemicals?search=${encodeURIComponent(term)}`);
  expect(response.status).toBe(200);
  return (await response.json()).chemicals as Array<{ id: number; name: string; casNumber: string | null }>;
}

describe('inventory CAS search', () => {
  it('adds CAS matching while retaining name and specification matching', async () => {
    const alice = await login(ctx.base, 'member-a');
    const ethanol = await inbound(alice, '无水乙醇', '色谱纯 4L', '64-17-5');
    await inbound(alice, '超纯水', 'LC-MS 1L', '7732-18-5');

    expect(await search(alice, '64-17-5')).toEqual([expect.objectContaining({ id: ethanol.id, casNumber: '64-17-5' })]);
    expect(await search(alice, '64-17')).toEqual([expect.objectContaining({ id: ethanol.id })]);
    expect(await search(alice, '无水乙醇')).toEqual([expect.objectContaining({ id: ethanol.id })]);
    expect(await search(alice, '色谱纯')).toEqual([expect.objectContaining({ id: ethanol.id })]);
  });

  it('keeps a null-CAS record searchable/viewable and makes a later CAS supplement searchable', async () => {
    const alice = await login(ctx.base, 'member-a');
    const legacy = await inbound(alice, '迁移旧样品', '历史规格');
    expect(legacy.casNumber).toBeNull();
    expect(await search(alice, '迁移旧样品')).toEqual([expect.objectContaining({ id: legacy.id, casNumber: null })]);

    const details = await api(ctx.base, alice, `/api/chemicals/${legacy.id}`);
    expect(details.status).toBe(200);
    expect((await details.json()).chemical).toMatchObject({ id: legacy.id, casNumber: null });

    const corrected = await api(ctx.base, alice, `/api/chemicals/${legacy.id}/details`, { method: 'PATCH', body: JSON.stringify({ casNumber: ' 67-64-1 ', version: legacy.version }) });
    expect(corrected.status).toBe(200);
    expect((await corrected.json()).chemical.casNumber).toBe('67-64-1');
    expect(await search(alice, '67-64-1')).toEqual([expect.objectContaining({ id: legacy.id, casNumber: '67-64-1' })]);
  });
});
