import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { await ctx.system.close(); });

type RequestType = 'normal' | 'urgent';
type PurchaseValue = { id: number; status: string; version: number; hazardous: boolean; requestType: RequestType };

async function create(cookie: string, label: string, requestType: RequestType, hazardous: boolean): Promise<PurchaseValue> {
  const response = await api(ctx.base, cookie, '/api/purchases', {
    method: 'POST',
    body: JSON.stringify({
      chemicalName: label,
      specification: 'AR 500g',
      purpose: 'V1.8 审批矩阵测试',
      requestType,
      hazardous,
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()).purchase;
}

async function decide(cookie: string, purchase: Pick<PurchaseValue, 'id' | 'version'>, decision: 'approved' | 'deferred' | 'rejected', comment?: string) {
  return api(ctx.base, cookie, `/api/purchases/${purchase.id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, ...(comment ? { comment } : {}), version: purchase.version }),
  });
}

async function edit(cookie: string, purchase: Pick<PurchaseValue, 'id' | 'version'>, purpose: string): Promise<PurchaseValue> {
  const response = await api(ctx.base, cookie, `/api/purchases/${purchase.id}`, {
    method: 'PATCH', body: JSON.stringify({ purpose, version: purchase.version }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).purchase;
}

async function queueIds(cookie: string): Promise<number[]> {
  const response = await api(ctx.base, cookie, '/api/purchases/tasks/approvals');
  expect(response.status).toBe(200);
  return ((await response.json()).purchases as Array<{ id: number }>).map(({ id }) => id).sort((a, b) => a - b);
}

function notificationRecipients(id: number, title?: string): string[] {
  const clauses = [`n.object_type='purchase'`, 'n.object_id=?'];
  const params: Array<string> = [String(id)];
  if (title) { clauses.push('n.title=?'); params.push(title); }
  return (ctx.system.db.prepare(`SELECT u.username FROM notifications n JOIN users u ON u.id=n.user_id
    WHERE ${clauses.join(' AND ')} ORDER BY u.username`).all(...params) as Array<{ username: string }>).map(({ username }) => username);
}

describe('V1.8 corrected purchase approval model', () => {
  it('assigns the four request classes to their exact initial stage and notification audience', async () => {
    const member = await login(ctx.base, 'member-a');
    const normalSafe = await create(member, '普通非危险', 'normal', false);
    const normalHazardous = await create(member, '普通危险', 'normal', true);
    const urgentSafe = await create(member, '加急非危险', 'urgent', false);
    const urgentHazardous = await create(member, '加急危险', 'urgent', true);

    expect([normalSafe.status, normalHazardous.status, urgentSafe.status, urgentHazardous.status]).toEqual([
      'pending_normal', 'pending_hazardous', 'pending_super', 'pending_super',
    ]);
    expect(notificationRecipients(normalSafe.id)).toEqual(['admin', 'teacher']);
    expect(notificationRecipients(normalHazardous.id)).toEqual(['hazard', 'teacher']);
    expect(notificationRecipients(urgentSafe.id)).toEqual(['teacher']);
    expect(notificationRecipients(urgentHazardous.id)).toEqual(['teacher']);

    const categories = ctx.system.db.prepare(`SELECT object_id,category FROM notifications
      WHERE object_type='purchase' ORDER BY CAST(object_id AS INTEGER),category`).all() as Array<{ object_id: string; category: string }>;
    const categoryFor = (id: number) => [...new Set(categories.filter(({ object_id }) => object_id === String(id)).map(({ category }) => category))];
    expect(categoryFor(normalSafe.id)).toEqual(['purchase_normal']);
    expect(categoryFor(normalHazardous.id)).toEqual(['hazardous']);
    expect(categoryFor(urgentSafe.id)).toEqual(['purchase_urgent']);
    expect(categoryFor(urgentHazardous.id)).toEqual(['purchase_urgent']);
  });

  it('routes every pending-stage modification to the same corrected approval audience', async () => {
    const applicant = await login(ctx.base, 'member-a');
    const normalSafe = await create(applicant, '修改通知普通非危险', 'normal', false);
    const normalHazardous = await create(applicant, '修改通知普通危险', 'normal', true);
    const urgentSafe = await create(applicant, '修改通知加急非危险', 'urgent', false);
    const urgentHazardous = await create(applicant, '修改通知加急危险', 'urgent', true);
    ctx.system.db.exec('DELETE FROM notifications');

    await edit(applicant, normalSafe, '修改后的普通非危险');
    await edit(applicant, normalHazardous, '修改后的普通危险');
    await edit(applicant, urgentSafe, '修改后的加急非危险');
    await edit(applicant, urgentHazardous, '修改后的加急危险');

    expect(notificationRecipients(normalSafe.id)).toEqual(['admin', 'teacher']);
    expect(notificationRecipients(normalHazardous.id)).toEqual(['hazard', 'teacher']);
    expect(notificationRecipients(urgentSafe.id)).toEqual(['teacher']);
    expect(notificationRecipients(urgentHazardous.id)).toEqual(['teacher']);
    expect((ctx.system.db.prepare(`SELECT DISTINCT category FROM notifications WHERE object_id=?`).get(String(normalHazardous.id)) as { category: string }).category).toBe('hazardous');
  });

  it('enforces the complete role-by-request-class first-decision matrix with server-side 403s', async () => {
    const sessions = {
      member: await login(ctx.base, 'member-b'),
      normal_admin: await login(ctx.base, 'admin'),
      hazardous_buyer: await login(ctx.base, 'hazard'),
      super_admin: await login(ctx.base, 'teacher'),
    };
    const applicant = await login(ctx.base, 'member-a');
    const classes = [
      { key: 'normal_safe', requestType: 'normal' as const, hazardous: false, allowed: ['normal_admin', 'super_admin'], result: 'approved' },
      { key: 'normal_hazardous', requestType: 'normal' as const, hazardous: true, allowed: ['hazardous_buyer', 'super_admin'], result: 'approved' },
      { key: 'urgent_safe', requestType: 'urgent' as const, hazardous: false, allowed: ['super_admin'], result: 'approved' },
      { key: 'urgent_hazardous', requestType: 'urgent' as const, hazardous: true, allowed: ['super_admin'], result: 'pending_hazardous' },
    ];

    for (const requestClass of classes) {
      for (const [role, cookie] of Object.entries(sessions)) {
        const purchase = await create(applicant, `${requestClass.key}-${role}`, requestClass.requestType, requestClass.hazardous);
        const response = await decide(cookie, purchase, 'approved');
        if (requestClass.allowed.includes(role)) {
          expect(response.status, `${requestClass.key}/${role}`).toBe(200);
          expect((await response.json()).purchase).toMatchObject({ status: requestClass.result, version: purchase.version + 1 });
        } else {
          expect(response.status, `${requestClass.key}/${role}`).toBe(403);
          expect(ctx.system.db.prepare('SELECT status,version FROM purchases WHERE id=?').get(purchase.id)).toEqual({
            status: purchase.status, version: purchase.version,
          });
        }
      }
    }
  });

  it('exposes only the correct stage in each role queue, including hazardous-buyer approval navigation data', async () => {
    const applicant = await login(ctx.base, 'member-a');
    const admin = await login(ctx.base, 'admin');
    const hazard = await login(ctx.base, 'hazard');
    const teacher = await login(ctx.base, 'teacher');
    const member = await login(ctx.base, 'member-b');
    const normalSafe = await create(applicant, '队列普通非危险', 'normal', false);
    const normalHazardous = await create(applicant, '队列普通危险', 'normal', true);
    const urgentSafe = await create(applicant, '队列加急非危险', 'urgent', false);
    const urgentHazardous = await create(applicant, '队列加急危险', 'urgent', true);

    expect(await queueIds(admin)).toEqual([normalSafe.id]);
    expect(await queueIds(hazard)).toEqual([normalHazardous.id]);
    expect(await queueIds(teacher)).toEqual([normalSafe.id, normalHazardous.id, urgentSafe.id, urgentHazardous.id].sort((a, b) => a - b));
    expect((await api(ctx.base, member, '/api/purchases/tasks/approvals')).status).toBe(403);

    expect(await (await api(ctx.base, admin, '/api/purchases/tasks/summary')).json()).toEqual({ approvalCount: 1, procurementCount: 0 });
    expect(await (await api(ctx.base, hazard, '/api/purchases/tasks/summary')).json()).toEqual({ approvalCount: 1, procurementCount: 0 });
    expect(await (await api(ctx.base, teacher, '/api/purchases/tasks/summary')).json()).toEqual({ approvalCount: 4, procurementCount: 0 });
  });

  it('keeps urgent hazardous approval two-stage and creates procurement work only after hazardous review', async () => {
    const applicant = await login(ctx.base, 'member-a');
    const admin = await login(ctx.base, 'admin');
    const hazard = await login(ctx.base, 'hazard');
    const teacher = await login(ctx.base, 'teacher');
    const purchase = await create(applicant, '两阶段加急危险品', 'urgent', true);

    expect((await decide(hazard, purchase, 'approved')).status).toBe(403);
    const firstResponse = await decide(teacher, purchase, 'approved', '老师确认确需加急');
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()).purchase as PurchaseValue;
    expect(first).toMatchObject({ status: 'pending_hazardous', version: purchase.version + 1 });
    expect(notificationRecipients(purchase.id, '危险品复核任务')).toEqual(['hazard', 'teacher']);
    expect(notificationRecipients(purchase.id, '待采购任务')).toEqual([]);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs
      WHERE object_type='purchase' AND object_id=? AND action='purchase_hazardous_review_requested'`).get(String(purchase.id)) as { count: number }).count).toBe(1);
    expect(await queueIds(hazard)).toContain(purchase.id);
    expect((await decide(admin, first, 'approved')).status).toBe(403);

    const finalResponse = await decide(hazard, first, 'approved', '危险品复核通过');
    expect(finalResponse.status).toBe(200);
    const final = (await finalResponse.json()).purchase as PurchaseValue;
    expect(final).toMatchObject({ status: 'approved', version: purchase.version + 2 });
    expect(notificationRecipients(purchase.id, '待采购任务')).toEqual(['hazard', 'teacher']);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM audit_logs
      WHERE object_type='purchase' AND object_id=? AND action='purchase_approved'`).get(String(purchase.id)) as { count: number }).count).toBe(1);
    expect((ctx.system.db.prepare(`SELECT COUNT(*) count FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE n.object_type='purchase' AND n.object_id=? AND n.title='采购申请通过' AND u.username='member-a'`).get(String(purchase.id)) as { count: number }).count).toBe(1);
  });

  it('maps defer/edit back to the same approval stage and supports legacy normal-hazardous deferred rows', async () => {
    const applicant = await login(ctx.base, 'member-a');
    const admin = await login(ctx.base, 'admin');
    const hazard = await login(ctx.base, 'hazard');
    const teacher = await login(ctx.base, 'teacher');

    const normalSafe = await create(applicant, '编辑普通非危险', 'normal', false);
    const normalSafeDeferred = (await (await decide(admin, normalSafe, 'deferred', '补充用途')).json()).purchase as PurchaseValue;
    expect(normalSafeDeferred.status).toBe('deferred');
    expect(await edit(applicant, normalSafeDeferred, '普通非危险已补充')).toMatchObject({ status: 'pending_normal', approvalComment: null });

    const urgentSafe = await create(applicant, '编辑加急非危险', 'urgent', false);
    const urgentSafeDeferred = (await (await decide(teacher, urgentSafe, 'deferred', '补充预算')).json()).purchase as PurchaseValue;
    expect(urgentSafeDeferred.status).toBe('deferred');
    expect(await edit(applicant, urgentSafeDeferred, '加急非危险已补充')).toMatchObject({ status: 'pending_super', approvalComment: null });

    const normalHazardous = await create(applicant, '编辑普通危险', 'normal', true);
    const normalHazardousDeferred = (await (await decide(hazard, normalHazardous, 'deferred', '补充危险品说明')).json()).purchase as PurchaseValue;
    expect(normalHazardousDeferred.status).toBe('deferred_hazardous');
    expect(await edit(applicant, normalHazardousDeferred, '普通危险已补充')).toMatchObject({ status: 'pending_hazardous', approvalComment: null });

    const urgentHazardous = await create(applicant, '编辑加急危险', 'urgent', true);
    const hazardousStage = (await (await decide(teacher, urgentHazardous, 'approved')).json()).purchase as PurchaseValue;
    const hazardousDeferred = (await (await decide(hazard, hazardousStage, 'deferred', '补充危险操作方案')).json()).purchase as PurchaseValue;
    expect(hazardousDeferred.status).toBe('deferred_hazardous');
    const revisedHazardous = await edit(applicant, hazardousDeferred, '加急危险已补充');
    expect(revisedHazardous).toMatchObject({ status: 'pending_hazardous', approvalComment: null });
    expect((await decide(hazard, revisedHazardous, 'approved')).status).toBe(200);

    const legacy = await create(applicant, '旧版普通危险推迟', 'normal', true);
    ctx.system.db.prepare(`UPDATE purchases SET status='deferred',approval_comment='旧版推迟' WHERE id=?`).run(legacy.id);
    expect(await queueIds(admin)).not.toContain(legacy.id);
    expect(await queueIds(hazard)).toContain(legacy.id);
    expect((await decide(admin, legacy, 'approved')).status).toBe(403);
    expect((await decide(hazard, legacy, 'approved')).status).toBe(200);
  });

  it('cannot gain urgent hazardous-review authority by editing a normal hazardous request', async () => {
    const applicant = await login(ctx.base, 'member-a');
    const hazard = await login(ctx.base, 'hazard');
    const teacher = await login(ctx.base, 'teacher');
    const normalHazardous = await create(applicant, '改成加急不得绕过老师', 'normal', true);

    const editedResponse = await api(ctx.base, applicant, `/api/purchases/${normalHazardous.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ requestType: 'urgent', version: normalHazardous.version }),
    });
    expect(editedResponse.status).toBe(200);
    const edited = (await editedResponse.json()).purchase as PurchaseValue;
    expect(edited).toMatchObject({ requestType: 'urgent', hazardous: true, status: 'pending_super' });
    expect((await decide(hazard, edited, 'approved')).status).toBe(403);
    const teacherStage = await decide(teacher, edited, 'approved');
    expect(teacherStage.status).toBe(200);
    expect((await teacherStage.json()).purchase.status).toBe('pending_hazardous');
  });
});
