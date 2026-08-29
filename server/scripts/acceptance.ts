import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { createSystem } from '../src/system.js';

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
async function json(response: Response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.status === 204 ? undefined : response.json(); }
async function connect(cookie: string) {
  const socket = connectSocket(base, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true }); sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket;
}
function event(socket: Socket, name: string) { return new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`未收到 ${name}`)), 4000); socket.once(name, (data) => { clearTimeout(timer); resolve(data); }); }); }
async function createPurchase(cookie: string, name: string, requestType: 'normal' | 'urgent', hazardous = false) {
  return (await json(await request('/purchases', cookie, { method: 'POST', body: JSON.stringify({ chemicalName: name, specification: '1 瓶', purpose: '验收实验', requestType, hazardous }) }), 201)).purchase;
}
async function decide(cookie: string, purchase: any, decision: 'approved' | 'deferred' | 'rejected', comment?: string) {
  return (await json(await request(`/purchases/${purchase.id}/decision`, cookie, { method: 'POST', body: JSON.stringify({ decision, comment, version: purchase.version }) }))).purchase;
}

try {
  await json(await request('/health')); console.log('PASS health: empty in-memory SQLite database returns 200');
  const teacher = await login('teacher'); const admin = await login('admin'); const hazard = await login('hazard'); const alice = await login('member-a'); const bob = await login('member-b');
  assert.deepEqual([teacher.user.role, admin.user.role, hazard.user.role, alice.user.role], ['super_admin', 'normal_admin', 'hazardous_buyer', 'member']);
  assert.equal((await request('/users', alice.cookie)).status, 403); assert.equal((await request('/users', teacher.cookie)).status, 200);
  console.log('PASS roles: five demo logins and server-side 403/200 authorization');

  const aliceSocket = await connect(alice.cookie); const bobSocket = await connect(bob.cookie);
  const firstRealtime = event(aliceSocket, 'chemical:changed'); const secondRealtime = event(bobSocket, 'chemical:changed');
  const inbound = (await json(await request('/chemicals', bob.cookie, { method: 'POST', body: JSON.stringify({ name: '验收乙醇', specification: 'AR 500mL', inboundAt: new Date().toISOString(), cabinet: 'A', shelf: 1 }) }), 201)).chemical;
  assert.equal((await firstRealtime).id, inbound.id); assert.equal((await secondRealtime).id, inbound.id);
  assert.equal((await request(`/chemicals/${inbound.id}/move`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ cabinet: 'B', shelf: 9, version: inbound.version }) })).status, 400);
  const moved = (await json(await request(`/chemicals/${inbound.id}/move`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ cabinet: 'B', shelf: 4, version: inbound.version }) }))).chemical;
  const discarded = (await json(await request(`/chemicals/${inbound.id}/discard`, bob.cookie, { method: 'PATCH', body: JSON.stringify({ confirmed: true, reason: '验收废弃', version: moved.version }) }))).chemical;
  assert.equal(discarded.status, 'discarded'); assert.equal((await json(await request('/chemicals?cabinet=B&shelf=4', alice.cookie))).chemicals.length, 0);
  console.log('PASS inventory/realtime: inbound, cross-owner move, invalid shelf, discard, two Socket.IO clients');

  const normal = await createPurchase(alice.cookie, '普通试剂', 'normal'); const urgent = await createPurchase(alice.cookie, '加急试剂', 'urgent');
  const dangerous = await createPurchase(alice.cookie, '叠氮化钠', 'normal', true); const rejectable = await createPurchase(bob.cookie, '驳回试剂', 'normal');
  assert.equal((await request(`/purchases/${urgent.id}/decision`, admin.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: urgent.version }) })).status, 403);
  const approvedNormal = await decide(admin.cookie, normal, 'approved');
  let deferredUrgent = await decide(teacher.cookie, urgent, 'deferred', '等待预算');
  deferredUrgent = (await json(await request(`/purchases/${urgent.id}`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ purpose: '补充后的加急用途', version: deferredUrgent.version }) }))).purchase;
  assert.equal(deferredUrgent.status, 'pending_super'); assert.equal(deferredUrgent.approvalComment, null);
  const approvedUrgent = await decide(teacher.cookie, deferredUrgent, 'approved'); const approvedDangerous = await decide(admin.cookie, dangerous, 'approved');
  const rejected = await decide(admin.cookie, rejectable, 'rejected', '不符合采购要求');
  assert.equal(approvedNormal.status, 'approved'); assert.equal(approvedUrgent.status, 'approved'); assert.equal(approvedDangerous.status, 'approved'); assert.equal(rejected.status, 'rejected');
  const withdrawable = await createPurchase(bob.cookie, '撤销试剂', 'normal'); const withdrawn = (await json(await request(`/purchases/${withdrawable.id}/withdraw`, bob.cookie, { method: 'POST', body: JSON.stringify({ version: withdrawable.version }) }))).purchase; assert.equal(withdrawn.status, 'withdrawn');
  console.log('PASS purchase state machine: normal/urgent/hazardous, approve/defer/revise/reject/withdraw, forbidden urgent approval');

  const normalCatalog = (await json(await request('/purchases/catalog/normal', admin.cookie))).purchases;
  const urgentCatalog = (await json(await request('/purchases/catalog/urgent', admin.cookie))).purchases;
  const dangerousQueue = (await json(await request('/purchases/catalog/hazardous', hazard.cookie))).purchases;
  assert(normalCatalog.some((item: any) => item.id === normal.id)); assert(urgentCatalog.some((item: any) => item.id === urgent.id)); assert(dangerousQueue.some((item: any) => item.id === dangerous.id));
  console.log('PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue');

  const beforeMessages = (await json(await request('/notifications', alice.cookie))).notifications.length;
  await json(await request('/notifications/preferences', alice.cookie, { method: 'PUT', body: JSON.stringify({ category: 'inventory_inbound', enabled: false }) }));
  await json(await request('/chemicals', bob.cookie, { method: 'POST', body: JSON.stringify({ name: '偏好屏蔽验证', specification: '1 瓶', inboundAt: new Date().toISOString(), cabinet: 'A', shelf: 5 }) }), 201);
  const afterMessages = (await json(await request('/notifications', alice.cookie))).notifications;
  assert.equal(afterMessages.length, beforeMessages); assert((await json(await request('/chemicals?search=偏好屏蔽验证', alice.cookie))).chemicals.length === 1);
  const logs = (await json(await request('/audit-logs', alice.cookie))).logs; assert(logs.some((log: any) => log.summary.includes('偏好屏蔽验证'))); assert(logs.some((log: any) => log.action === 'purchase_rejected'));
  console.log('PASS preferences/audit: future category blocked while inventory and immutable public audit remain');
  console.log(`ACCEPTANCE OK (${logs.length} audit entries verified)`);
} finally {
  for (const socket of sockets) socket.close(); await system.close();
}
