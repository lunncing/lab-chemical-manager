import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { vi.restoreAllMocks(); await ctx.system.close(); });

async function createChemical(cookie: string, overrides: Record<string, unknown> = {}) {
  const response = await api(ctx.base, cookie, '/api/chemicals', { method: 'POST', body: JSON.stringify({
    name: '乙腈', specification: 'HPLC 4L', casNumber: '75-05-8', inboundAt: '2026-09-01T08:00:00.000Z', cabinet: 'B', shelf: 2, ...overrides,
  }) });
  expect(response.status).toBe(201);
  return (await response.json()).chemical as { id: number; version: number; [key: string]: unknown };
}

async function correct(cookie: string, id: number, body: Record<string, unknown>) {
  return api(ctx.base, cookie, `/api/chemicals/${id}/details`, { method: 'PATCH', body: JSON.stringify(body) });
}

describe('stored chemical detail correction', () => {
  it('lets the owner change only detail fields and keeps structured before/after server-side behind a public summary', async () => {
    const alice = await login(ctx.base, 'member-a');
    const chemical = await createChemical(alice);
    const before = ctx.system.db.prepare('SELECT * FROM chemicals WHERE id=?').get(chemical.id) as Record<string, unknown>;

    const response = await correct(alice, chemical.id, {
      name: '  乙腈（已更正）  ', specification: 'HPLC 4L', casNumber: '  75-05-8 ',
      inboundAt: '2026-09-02T09:30:00.000Z', version: chemical.version,
    });
    expect(response.status).toBe(200);
    const updated = (await response.json()).chemical;
    expect(updated).toMatchObject({
      id: chemical.id, name: '乙腈（已更正）', specification: 'HPLC 4L', casNumber: '75-05-8',
      inboundAt: '2026-09-02T09:30:00.000Z', cabinet: 'B', shelf: 2, status: 'active', version: chemical.version + 1,
      owner: { username: 'member-a' }, inboundOperator: { username: 'member-a' },
    });
    const after = ctx.system.db.prepare('SELECT * FROM chemicals WHERE id=?').get(chemical.id) as Record<string, unknown>;
    for (const immutable of ['owner_id', 'inbound_operator_id', 'cabinet', 'shelf', 'status', 'created_at']) expect(after[immutable]).toBe(before[immutable]);

    const storedAudit = ctx.system.db.prepare(`SELECT summary,details_json FROM audit_logs WHERE action='inventory_details_corrected' AND object_id=?`).get(String(chemical.id)) as { summary: string; details_json: string };
    expect(storedAudit.summary).toBe('更正药品信息：乙腈（已更正）（名称、入库时间）');
    expect(JSON.parse(storedAudit.details_json)).toEqual({
      before: { name: '乙腈', inboundAt: '2026-09-01T08:00:00.000Z' },
      after: { name: '乙腈（已更正）', inboundAt: '2026-09-02T09:30:00.000Z' },
    });
    const publicLogs = (await (await api(ctx.base, alice, '/api/audit-logs')).json()).logs as Array<Record<string, unknown>>;
    const publicAudit = publicLogs.find((log) => log.action === 'inventory_details_corrected')!;
    expect(publicAudit.summary).toBe(storedAudit.summary);
    expect(publicAudit).not.toHaveProperty('details');
    expect(publicAudit).not.toHaveProperty('detailsJson');
  });

  it('enforces owner/super authorization, rejects unknown or required-field clears, and permits explicit CAS clearing', async () => {
    const alice = await login(ctx.base, 'member-a'); const bob = await login(ctx.base, 'member-b');
    const normalAdmin = await login(ctx.base, 'admin'); const hazardousBuyer = await login(ctx.base, 'hazard'); const teacher = await login(ctx.base, 'teacher');
    const chemical = await createChemical(alice);

    for (const cookie of [bob, normalAdmin, hazardousBuyer]) {
      const forbidden = await correct(cookie, chemical.id, { name: '越权更正', version: chemical.version });
      expect(forbidden.status).toBe(403);
    }
    for (const invalidBody of [
      { ownerId: 5, version: chemical.version },
      { cabinet: 'A', version: chemical.version },
      { name: '   ', version: chemical.version },
      { name: null, version: chemical.version },
      { specification: '', version: chemical.version },
      { inboundAt: null, version: chemical.version },
    ]) {
      const invalid = await correct(alice, chemical.id, invalidBody);
      expect(invalid.status).toBe(400);
    }
    expect((ctx.system.db.prepare('SELECT version FROM chemicals WHERE id=?').get(chemical.id) as { version: number }).version).toBe(chemical.version);

    const clearedResponse = await correct(teacher, chemical.id, { casNumber: '   ', version: chemical.version });
    expect(clearedResponse.status).toBe(200);
    const cleared = (await clearedResponse.json()).chemical;
    expect(cleared).toMatchObject({ casNumber: null, version: chemical.version + 1 });
    expect(ctx.system.db.prepare('SELECT cas_number FROM chemicals WHERE id=?').get(chemical.id)).toEqual({ cas_number: null });

    const discarded = await api(ctx.base, alice, `/api/chemicals/${chemical.id}/discard`, { method: 'PATCH', body: JSON.stringify({ confirmed: true, version: cleared.version }) });
    expect(discarded.status).toBe(200);
    const denied = await correct(teacher, chemical.id, { name: '不能更正', version: cleared.version + 1 });
    expect(denied.status).toBe(409);
    expect((await denied.json()).error.message).toContain('已废弃药品不能更正');
  });

  it('returns 400 for a normalized no-op and 409 for stale or concurrent versions without extra audits', async () => {
    const alice = await login(ctx.base, 'member-a'); const chemical = await createChemical(alice);
    const initialAuditCount = (ctx.system.db.prepare('SELECT COUNT(*) count FROM audit_logs').get() as { count: number }).count;

    const noOp = await correct(alice, chemical.id, { name: ' 乙腈 ', casNumber: '75-05-8', version: chemical.version });
    expect(noOp.status).toBe(400);
    expect((await noOp.json()).error.message).toContain('没有需要更正的药品信息');
    expect(ctx.system.db.prepare('SELECT version FROM chemicals WHERE id=?').get(chemical.id)).toEqual({ version: chemical.version });
    expect((ctx.system.db.prepare('SELECT COUNT(*) count FROM audit_logs').get() as { count: number }).count).toBe(initialAuditCount);

    const stale = await correct(alice, chemical.id, { name: '过期版本', version: chemical.version + 1 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.message).toContain('药品已被其他人修改');

    const [first, second] = await Promise.all([
      correct(alice, chemical.id, { name: '并发更正甲', version: chemical.version }),
      correct(alice, chemical.id, { name: '并发更正乙', version: chemical.version }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(ctx.system.db.prepare('SELECT version FROM chemicals WHERE id=?').get(chemical.id)).toEqual({ version: chemical.version + 1 });
    expect(ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='inventory_details_corrected' AND object_id=?`).get(String(chemical.id))).toEqual({ count: 1 });
  });

  it('commits before broadcasting the existing inventory revision event and exposes no structured audit in realtime', async () => {
    const alice = await login(ctx.base, 'member-a'); const chemical = await createChemical(alice);
    const emitted: Array<{ event: string; payload: Record<string, unknown>; storedName: string | undefined }> = [];
    vi.spyOn(ctx.system.io, 'emit').mockImplementation(((event: string, payload: Record<string, unknown>) => {
      const row = ctx.system.db.prepare('SELECT name FROM chemicals WHERE id=?').get(chemical.id) as { name: string } | undefined;
      emitted.push({ event, payload, storedName: row?.name });
      return true;
    }) as typeof ctx.system.io.emit);

    const response = await correct(alice, chemical.id, { name: '提交后广播', version: chemical.version });
    expect(response.status).toBe(200);
    expect(emitted.find(({ event }) => event === 'chemical:changed')).toMatchObject({ storedName: '提交后广播', payload: { name: '提交后广播' } });
    const auditEvent = emitted.find(({ event }) => event === 'audit:created')!;
    expect(auditEvent.storedName).toBe('提交后广播');
    expect(auditEvent.payload).not.toHaveProperty('details');
  });

  it('rolls back the chemical and emits nothing when structured audit persistence fails', async () => {
    const alice = await login(ctx.base, 'member-a'); const chemical = await createChemical(alice);
    const before = ctx.system.db.prepare('SELECT * FROM chemicals WHERE id=?').get(chemical.id);
    ctx.system.db.exec(`CREATE TRIGGER fail_correction_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action='inventory_details_corrected' BEGIN SELECT RAISE(FAIL,'forced correction audit failure'); END`);
    const emitSpy = vi.spyOn(ctx.system.io, 'emit');

    const response = await correct(alice, chemical.id, { name: '不得保留', version: chemical.version });
    expect(response.status).toBe(500);
    expect(ctx.system.db.prepare('SELECT * FROM chemicals WHERE id=?').get(chemical.id)).toEqual(before);
    expect(ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='inventory_details_corrected'`).get()).toEqual({ count: 0 });
    expect(emitSpy.mock.calls.some(([event]) => event === 'chemical:changed' || event === 'audit:created')).toBe(false);
  });
});
