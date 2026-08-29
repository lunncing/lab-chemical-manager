import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { createSystem } from '../src/system.js';
import { verifyPassword } from '../src/security.js';
import { currentBeijingWeekStart, weekEnd } from '../src/purchase-weeks.js';

const system = createSystem({ databasePath: ':memory:', seedDemo: true });
const sockets: Socket[] = [];

await new Promise<void>((resolve) => system.httpServer.listen(0, '127.0.0.1', resolve));
const address = system.httpServer.address() as AddressInfo;
const base = `http://127.0.0.1:${address.port}`;

async function request(path: string, cookie?: string, init: RequestInit = {}) {
  return fetch(`${base}/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...init.headers } });
}
async function login(username: string) {
  const response = await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username, password: 'Demo1234!' }) });
  assert.equal(response.status, 200, `${username} login`); const body = await response.json();
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, user: body.user };
}
async function register(input: Record<string, unknown>) {
  const response = await request('/auth/register', undefined, { method: 'POST', body: JSON.stringify(input) });
  const body = await response.clone().json() as { user?: any };
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '', user: body.user };
}
async function json(response: Response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.status === 204 ? undefined : response.json(); }
async function connect(cookie: string) {
  const socket = connectSocket(base, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true }); sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket;
}
function event(socket: Socket, name: string) { return new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`未收到 ${name}`)), 4000); socket.once(name, (data) => { clearTimeout(timer); resolve(data); }); }); }
function shiftWeek(weekStart: string, days: number) { const value = new Date(`${weekStart}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
async function createPurchase(cookie: string, name: string, requestType: 'normal' | 'urgent', hazardous = false) {
  return (await json(await request('/purchases', cookie, { method: 'POST', body: JSON.stringify({ chemicalName: name, specification: '1 瓶', purpose: '验收实验', requestType, hazardous }) }), 201)).purchase;
}
async function decide(cookie: string, purchase: any, decision: 'approved' | 'deferred' | 'rejected', comment?: string) {
  return (await json(await request(`/purchases/${purchase.id}/decision`, cookie, { method: 'POST', body: JSON.stringify({ decision, comment, version: purchase.version }) }))).purchase;
}
async function markPurchased(cookie: string, purchase: any) {
  return (await json(await request(`/purchases/${purchase.id}/purchased`, cookie, { method: 'POST', body: JSON.stringify({ version: purchase.version }) }))).purchase;
}
async function createInboundRequest(cookie: string, targetUserId: number, name: string) {
  return (await json(await request('/inbound-requests', cookie, { method: 'POST', body: JSON.stringify({ targetUserId, name, specification: 'HPLC 4L', inboundAt: new Date().toISOString(), cabinet: 'B', shelf: 2 }) }), 201)).request;
}

try {
  await json(await request('/health')); console.log('PASS health: empty in-memory SQLite database returns 200');
  const teacher = await login('teacher'); const admin = await login('admin'); const hazard = await login('hazard'); const alice = await login('member-a'); const bob = await login('member-b');
  assert.deepEqual([teacher.user.role, admin.user.role, hazard.user.role, alice.user.role], ['super_admin', 'normal_admin', 'hazardous_buyer', 'member']);
  assert.equal((await request('/users', alice.cookie)).status, 403); assert.equal((await request('/users', teacher.cookie)).status, 200);
  console.log('PASS roles: five demo logins and server-side 403/200 authorization');

  const registered = await register({ username: 'acceptance-member', displayName: '验收注册成员', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!' });
  assert.equal(registered.response.status, 201); assert.equal(registered.user.role, 'member'); assert.equal(registered.user.active, true); assert.equal(registered.user.demo, false);
  assert.equal((await json(await request('/auth/me', registered.cookie))).user.id, registered.user.id);
  const registeredRow = system.db.prepare('SELECT * FROM users WHERE id=?').get(registered.user.id) as Record<string, unknown>;
  assert(verifyPassword('Acceptance123!', String(registeredRow.password_hash)));
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='account_register' AND object_id=?`).get(String(registered.user.id)) as { count: number }).count, 1);
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.username='teacher' AND n.category='account' AND n.object_id=?`).get(String(registered.user.id)) as { count: number }).count, 1);
  assert.equal((await register({ username: 'role-injection', displayName: '越权注册', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!', role: 'super_admin' })).response.status, 400);
  assert.equal((await register({ username: 'acceptance-member', displayName: '重复注册', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!' })).response.status, 409);
  console.log('PASS registration: strict member-only hashed account, transactional session/audit/notification, cookie auto-login');

  const aliceSocket = await connect(alice.cookie); const bobSocket = await connect(bob.cookie);
  const firstRealtime = event(aliceSocket, 'chemical:changed'); const secondRealtime = event(bobSocket, 'chemical:changed');
  const inbound = (await json(await request('/chemicals', bob.cookie, { method: 'POST', body: JSON.stringify({ name: '验收乙醇', specification: 'AR 500mL', inboundAt: new Date().toISOString(), cabinet: 'A', shelf: 1 }) }), 201)).chemical;
  assert.equal((await firstRealtime).id, inbound.id); assert.equal((await secondRealtime).id, inbound.id);
  assert.equal((await request(`/chemicals/${inbound.id}/move`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ cabinet: 'B', shelf: 9, version: inbound.version }) })).status, 400);
  const moved = (await json(await request(`/chemicals/${inbound.id}/move`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ cabinet: 'B', shelf: 4, version: inbound.version }) }))).chemical;
  const discarded = (await json(await request(`/chemicals/${inbound.id}/discard`, bob.cookie, { method: 'PATCH', body: JSON.stringify({ confirmed: true, reason: '验收废弃', version: moved.version }) }))).chemical;
  assert.equal(discarded.status, 'discarded'); assert.equal((await json(await request('/chemicals?cabinet=B&shelf=4', alice.cookie))).chemicals.length, 0);
  assert.equal((await request('/chemicals', alice.cookie, { method: 'POST', body: JSON.stringify({ name: '越权归属', specification: '1 瓶', ownerId: bob.user.id, inboundAt: new Date().toISOString(), cabinet: 'A', shelf: 2 }) })).status, 400);
  console.log('PASS inventory/realtime: inbound, cross-owner move, invalid shelf, discard, two Socket.IO clients');

  const pendingEvent = event(aliceSocket, 'inbound-request:changed'); const proxy = await createInboundRequest(alice.cookie, bob.user.id, '验收代入库乙腈');
  assert.equal((await pendingEvent).status, 'pending'); assert.equal((await json(await request('/chemicals?search=验收代入库乙腈', alice.cookie))).chemicals.length, 0);
  assert((await json(await request('/inbound-requests?scope=mine', alice.cookie))).requests.some((item: any) => item.id === proxy.id));
  assert((await json(await request('/inbound-requests?scope=incoming', bob.cookie))).requests.some((item: any) => item.id === proxy.id));
  assert.equal((await request(`/inbound-requests/${proxy.id}/decision`, teacher.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: proxy.version }) })).status, 403);
  assert.equal((await request(`/inbound-requests/${proxy.id}/decision`, bob.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: 99 }) })).status, 409);
  const approvedEvent = event(aliceSocket, 'inbound-request:changed'); const proxyChemicalEvent = event(bobSocket, 'chemical:changed');
  const approvedProxy = await json(await request(`/inbound-requests/${proxy.id}/decision`, bob.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', comment: '验收同意', version: proxy.version }) }));
  assert.equal((await approvedEvent).status, 'approved'); assert.equal((await proxyChemicalEvent).id, approvedProxy.chemical.id);
  assert.equal(approvedProxy.chemical.owner.id, bob.user.id); assert.equal(approvedProxy.chemical.inboundOperator.id, alice.user.id);
  assert.equal((await request(`/inbound-requests/${proxy.id}/decision`, bob.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: approvedProxy.request.version }) })).status, 409);
  const rejectableProxy = await createInboundRequest(alice.cookie, bob.user.id, '验收拒绝代入库');
  const rejectedProxy = (await json(await request(`/inbound-requests/${rejectableProxy.id}/decision`, bob.cookie, { method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '验收拒绝', version: rejectableProxy.version }) }))).request;
  const withdrawableProxy = await createInboundRequest(alice.cookie, bob.user.id, '验收撤销代入库');
  const withdrawnProxy = (await json(await request(`/inbound-requests/${withdrawableProxy.id}/withdraw`, alice.cookie, { method: 'POST', body: JSON.stringify({ version: withdrawableProxy.version }) }))).request;
  assert.equal(rejectedProxy.status, 'rejected'); assert.equal(withdrawnProxy.status, 'withdrawn');
  assert.equal((await json(await request('/chemicals?search=验收拒绝代入库', alice.cookie))).chemicals.length, 0); assert.equal((await json(await request('/chemicals?search=验收撤销代入库', alice.cookie))).chemicals.length, 0);
  console.log('PASS proxy inbound: pending scopes, authorization/version conflicts, atomic approval, reject/withdraw, realtime');

  const normal = await createPurchase(alice.cookie, '普通试剂', 'normal'); const urgent = await createPurchase(alice.cookie, '加急试剂', 'urgent');
  const dangerous = await createPurchase(alice.cookie, '叠氮化钠', 'normal', true); const dangerousUrgent = await createPurchase(alice.cookie, '加急危险试剂', 'urgent', true); const rejectable = await createPurchase(bob.cookie, '驳回试剂', 'normal');
  assert.deepEqual(await json(await request('/purchases/tasks/summary', admin.cookie)), { approvalCount: 3, procurementCount: 0 });
  assert.deepEqual(await json(await request('/purchases/tasks/summary', teacher.cookie)), { approvalCount: 5, procurementCount: 0 });
  const adminApprovals = (await json(await request('/purchases/tasks/approvals', admin.cookie))).purchases.map((item: any) => item.id);
  const teacherApprovals = (await json(await request('/purchases/tasks/approvals', teacher.cookie))).purchases.map((item: any) => item.id);
  assert(adminApprovals.includes(normal.id) && adminApprovals.includes(dangerous.id) && adminApprovals.includes(rejectable.id) && !adminApprovals.includes(urgent.id));
  assert(teacherApprovals.includes(normal.id) && teacherApprovals.includes(urgent.id) && teacherApprovals.includes(dangerous.id) && teacherApprovals.includes(dangerousUrgent.id) && teacherApprovals.includes(rejectable.id));
  assert.equal((await request(`/purchases/${urgent.id}/decision`, admin.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: urgent.version }) })).status, 403);
  const approvedNormal = await decide(admin.cookie, normal, 'approved');
  const currentWeek = currentBeijingWeekStart(); const previousWeek = shiftWeek(currentWeek, -7);
  const archiveEntry = system.db.prepare('SELECT week_start,added_at FROM purchase_weekly_entries WHERE purchase_id=?').get(normal.id) as { week_start: string; added_at: string };
  assert.equal(archiveEntry.week_start, currentWeek); assert.equal(archiveEntry.added_at, approvedNormal.decidedAt);
  let deferredUrgent = await decide(teacher.cookie, urgent, 'deferred', '等待预算');
  deferredUrgent = (await json(await request(`/purchases/${urgent.id}`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ purpose: '补充后的加急用途', version: deferredUrgent.version }) }))).purchase;
  assert.equal(deferredUrgent.status, 'pending_super'); assert.equal(deferredUrgent.approvalComment, null);
  const approvedUrgent = await decide(teacher.cookie, deferredUrgent, 'approved'); const approvedDangerous = await decide(admin.cookie, dangerous, 'approved'); const approvedDangerousUrgent = await decide(teacher.cookie, dangerousUrgent, 'approved');
  const rejected = await decide(admin.cookie, rejectable, 'rejected', '不符合采购要求');
  assert.equal(approvedNormal.status, 'approved'); assert.equal(approvedUrgent.status, 'approved'); assert.equal(approvedDangerous.status, 'approved'); assert.equal(approvedDangerousUrgent.status, 'approved'); assert.equal(rejected.status, 'rejected');
  const withdrawable = await createPurchase(bob.cookie, '撤销试剂', 'normal'); const withdrawn = (await json(await request(`/purchases/${withdrawable.id}/withdraw`, bob.cookie, { method: 'POST', body: JSON.stringify({ version: withdrawable.version }) }))).purchase; assert.equal(withdrawn.status, 'withdrawn');
  console.log('PASS purchase state machine: normal/urgent/hazardous, approve/defer/revise/reject/withdraw, forbidden urgent approval');

  assert.deepEqual(await json(await request('/purchases/tasks/summary', admin.cookie)), { approvalCount: 0, procurementCount: 2 });
  assert.deepEqual(await json(await request('/purchases/tasks/summary', hazard.cookie)), { approvalCount: 0, procurementCount: 2 });
  assert.deepEqual(await json(await request('/purchases/tasks/summary', teacher.cookie)), { approvalCount: 0, procurementCount: 4 });
  assert.deepEqual(await json(await request('/purchases/tasks/summary', alice.cookie)), { approvalCount: 0, procurementCount: 0 });
  assert.equal((await request('/purchases/tasks/approvals', hazard.cookie)).status, 403); assert.equal((await request('/purchases/tasks/procurement', alice.cookie)).status, 403);
  const adminProcurement = (await json(await request('/purchases/tasks/procurement', admin.cookie))).purchases.map((item: any) => item.id);
  const hazardProcurement = (await json(await request('/purchases/tasks/procurement', hazard.cookie))).purchases.map((item: any) => item.id);
  const teacherProcurement = (await json(await request('/purchases/tasks/procurement', teacher.cookie))).purchases.map((item: any) => item.id);
  assert(adminProcurement.includes(normal.id) && adminProcurement.includes(urgent.id) && !adminProcurement.includes(dangerous.id));
  assert.deepEqual(hazardProcurement, [dangerousUrgent.id, dangerous.id]); assert(teacherProcurement.includes(normal.id) && teacherProcurement.includes(urgent.id) && teacherProcurement.includes(dangerous.id) && teacherProcurement.includes(dangerousUrgent.id));
  assert.deepEqual((await json(await request('/purchases/tasks/procurement?requestType=normal', hazard.cookie))).purchases.map((item: any) => item.id), [dangerous.id]);
  assert.deepEqual((await json(await request('/purchases/tasks/procurement?requestType=urgent', hazard.cookie))).purchases.map((item: any) => item.id), [dangerousUrgent.id]);
  assert.equal((await request('/purchases/tasks/procurement?requestType=invalid', admin.cookie)).status, 400);
  assert.equal((await request('/purchases/tasks/procurement?requestType=normal&requestType=urgent', admin.cookie)).status, 400);
  const procurementTaskRecipients = (purchaseId: number) => (system.db.prepare(`SELECT u.username FROM notifications n JOIN users u ON u.id=n.user_id
    WHERE n.object_type='purchase' AND n.object_id=? AND n.title='待采购任务' ORDER BY u.username`).all(String(purchaseId)) as Array<{ username: string }>).map(({ username }) => username);
  assert.deepEqual(procurementTaskRecipients(normal.id), ['admin', 'teacher']); assert.deepEqual(procurementTaskRecipients(dangerous.id), ['hazard', 'teacher']);
  console.log('PASS purchase tasks: server summaries, role-specific approval/procurement queues, hazardous/nonhazardous routing');

  const normalCatalogBody = await json(await request('/purchases/catalog/normal', admin.cookie)); const normalCatalog = normalCatalogBody.purchases;
  const urgentCatalog = (await json(await request('/purchases/catalog/urgent', admin.cookie))).purchases;
  const dangerousQueue = (await json(await request('/purchases/catalog/hazardous', hazard.cookie))).purchases;
  assert(normalCatalog.some((item: any) => item.id === normal.id)); assert(!normalCatalog.some((item: any) => item.id === dangerous.id));
  assert(urgentCatalog.some((item: any) => item.id === urgent.id)); assert(!urgentCatalog.some((item: any) => item.id === dangerousUrgent.id));
  assert(dangerousQueue.some((item: any) => item.id === dangerous.id)); assert(dangerousQueue.some((item: any) => item.id === dangerousUrgent.id));
  console.log('PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue');

  assert.deepEqual(normalCatalogBody.week, { weekStart: currentWeek, weekEnd: weekEnd(currentWeek), isCurrent: true });
  const initialWeeks = (await json(await request('/purchases/catalog/normal/weeks', admin.cookie))).weeks;
  assert.deepEqual(initialWeeks, [{ weekStart: currentWeek, weekEnd: weekEnd(currentWeek), count: 1, approvedCount: 1, purchasedCount: 0, isCurrent: true }]);
  system.db.prepare('UPDATE purchase_weekly_entries SET week_start=? WHERE purchase_id=?').run(previousWeek, normal.id);
  const rolledWeeks = (await json(await request('/purchases/catalog/normal/weeks', admin.cookie))).weeks;
  assert.deepEqual(rolledWeeks, [
    { weekStart: currentWeek, weekEnd: weekEnd(currentWeek), count: 0, approvedCount: 0, purchasedCount: 0, isCurrent: true },
    { weekStart: previousWeek, weekEnd: weekEnd(previousWeek), count: 1, approvedCount: 1, purchasedCount: 0, isCurrent: false },
  ]);
  console.log('PASS weekly archive rollover: approval membership, current empty week, descending historical statistics');

  assert.equal((await request(`/purchases/${normal.id}/purchased`, alice.cookie, { method: 'POST', body: JSON.stringify({ version: approvedNormal.version }) })).status, 403);
  assert.equal((await request(`/purchases/${dangerous.id}/purchased`, admin.cookie, { method: 'POST', body: JSON.stringify({ version: approvedDangerous.version }) })).status, 403);
  assert.equal((await request(`/purchases/${normal.id}/purchased`, admin.cookie, { method: 'POST', body: JSON.stringify({ version: 1 }) })).status, 409);
  const purchasedEvent = event(aliceSocket, 'purchase:changed'); const purchasedNormal = await markPurchased(admin.cookie, approvedNormal); assert.equal((await purchasedEvent).status, 'purchased');
  const purchasedDangerous = await markPurchased(hazard.cookie, approvedDangerous); const purchasedUrgent = await markPurchased(teacher.cookie, approvedUrgent); const purchasedDangerousUrgent = await markPurchased(hazard.cookie, approvedDangerousUrgent);
  assert.equal(purchasedNormal.status, 'purchased'); assert.equal(purchasedDangerous.status, 'purchased'); assert.equal(purchasedUrgent.status, 'purchased'); assert.equal(purchasedDangerousUrgent.status, 'purchased');
  assert.equal((await request(`/purchases/${normal.id}/purchased`, admin.cookie, { method: 'POST', body: JSON.stringify({ version: purchasedNormal.version }) })).status, 409);
  assert.equal((await json(await request('/purchases/tasks/procurement', teacher.cookie))).purchases.length, 0);
  const historicalCatalog = await json(await request(`/purchases/catalog/normal?week=${previousWeek}`, admin.cookie));
  assert.deepEqual(historicalCatalog.week, { weekStart: previousWeek, weekEnd: weekEnd(previousWeek), isCurrent: false });
  assert.equal(historicalCatalog.purchases.find((item: any) => item.id === normal.id)?.status, 'purchased');
  assert.equal((await json(await request('/purchases/catalog/normal', admin.cookie))).purchases.some((item: any) => item.id === normal.id), false);
  assert.equal((await json(await request('/purchases/catalog/urgent', admin.cookie))).purchases.some((item: any) => item.id === urgent.id), false);
  assert.equal((await json(await request('/purchases/catalog/hazardous', hazard.cookie))).purchases.some((item: any) => item.id === dangerous.id), false);
  const purchaseHistory = (await json(await request('/purchases?scope=mine', alice.cookie))).purchases;
  assert.deepEqual(purchaseHistory.filter((item: any) => [normal.id, urgent.id, dangerous.id, dangerousUrgent.id].includes(item.id)).map((item: any) => item.status), ['purchased', 'purchased', 'purchased', 'purchased']);
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='purchase_purchased'`).get() as { count: number }).count, 4);
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.username='member-a' AND n.title='采购已完成'`).get() as { count: number }).count, 4);
  const finalWeeks = (await json(await request('/purchases/catalog/normal/weeks', admin.cookie))).weeks;
  assert.equal(finalWeeks.find((week: any) => week.weekStart === previousWeek)?.purchasedCount, 1);
  console.log('PASS purchased lifecycle: active-queue removal plus cross-week archive and purchased retention');

  const beforeMessages = (await json(await request('/notifications', alice.cookie))).notifications.length;
  await json(await request('/notifications/preferences', alice.cookie, { method: 'PUT', body: JSON.stringify({ category: 'inventory_inbound', enabled: false }) }));
  await json(await request('/chemicals', bob.cookie, { method: 'POST', body: JSON.stringify({ name: '偏好屏蔽验证', specification: '1 瓶', inboundAt: new Date().toISOString(), cabinet: 'A', shelf: 5 }) }), 201);
  const afterMessages = (await json(await request('/notifications', alice.cookie))).notifications;
  assert.equal(afterMessages.length, beforeMessages); assert((await json(await request('/chemicals?search=偏好屏蔽验证', alice.cookie))).chemicals.length === 1);
  const logs = (await json(await request('/audit-logs', alice.cookie))).logs; assert(logs.some((log: any) => log.summary.includes('偏好屏蔽验证'))); assert(logs.some((log: any) => log.action === 'purchase_rejected')); assert.equal(logs.filter((log: any) => log.action === 'purchase_purchased').length, 4);
  console.log('PASS preferences/audit: future category blocked while inventory and immutable public audit remain');
  console.log(`ACCEPTANCE OK (${logs.length} audit entries verified)`);
} finally {
  for (const socket of sockets) socket.close(); await system.close();
}
