import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { createSystem } from '../src/system.js';
import { digestToken, verifyPassword } from '../src/security.js';
import { currentBeijingWeekStart, weekEnd } from '../src/purchase-weeks.js';
import { deleteAccount } from '../src/account-deletion.js';
import type { Cabinet } from '../../shared/types.js';

const system = createSystem({ databasePath: ':memory:', seedDemo: true });
const sockets: Socket[] = [];

await new Promise<void>((resolve) => system.httpServer.listen(0, '127.0.0.1', resolve));
const address = system.httpServer.address() as AddressInfo;
const base = `http://127.0.0.1:${address.port}`;

async function request(path: string, cookie?: string, init: RequestInit = {}) {
  return fetch(`${base}/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...init.headers } });
}
async function login(username: string, password = 'Demo1234!') {
  const response = await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200, `${username} login`); const body = await response.json();
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, user: body.user };
}
async function register(input: Record<string, unknown>) {
  const response = await request('/auth/register', undefined, { method: 'POST', body: JSON.stringify(input) });
  const body = await response.clone().json() as { user?: any };
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '', user: body.user };
}
async function createInvite(cookie: string) {
  return (await json(await request('/registration-invites', cookie, { method: 'POST' }), 201)).invite;
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
async function createInboundRequest(cookie: string, targetUserId: number, name: string, cabinet: Cabinet = 'B', shelf = 2, casNumber?: string) {
  return (await json(await request('/inbound-requests', cookie, { method: 'POST', body: JSON.stringify({ targetUserId, name, specification: 'HPLC 4L', ...(casNumber ? { casNumber } : {}), inboundAt: new Date().toISOString(), cabinet, shelf }) }), 201)).request;
}

try {
  await json(await request('/health')); console.log('PASS health: empty in-memory SQLite database returns 200');
  const teacher = await login('teacher'); const admin = await login('admin'); const hazard = await login('hazard'); const alice = await login('member-a'); const bob = await login('member-b');
  assert.deepEqual([teacher.user.role, admin.user.role, hazard.user.role, alice.user.role], ['super_admin', 'normal_admin', 'hazardous_buyer', 'member']);
  assert.equal((await request('/users', alice.cookie)).status, 403); assert.equal((await request('/users', teacher.cookie)).status, 200);
  console.log('PASS roles: five demo logins and server-side 403/200 authorization');

  const currentPasswordUser = (await json(await request('/users', teacher.cookie, { method: 'POST', body: JSON.stringify({
    username: 'acceptance-password-current', displayName: '验收原密码成员', role: 'member', password: 'CurrentPassword123!',
  }) }), 201)).user;
  const currentPasswordSession = await login('acceptance-password-current', 'CurrentPassword123!');
  assert.deepEqual(await json(await request('/password-recovery/lookup', undefined, { method: 'POST', body: JSON.stringify({ displayName: '验收原密码成员' }) })), { state: 'verify_current' });
  assert.deepEqual(await json(await request('/password-recovery/change-with-current', undefined, { method: 'POST', body: JSON.stringify({
    displayName: '验收原密码成员', currentPassword: 'CurrentPassword123!', newPassword: 'CurrentPasswordChanged123!', newPasswordConfirm: 'CurrentPasswordChanged123!',
  }) })), { changed: true });
  assert.equal((await request('/auth/me', currentPasswordSession.cookie)).status, 401);
  assert.equal((await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username: 'acceptance-password-current', password: 'CurrentPassword123!' }) })).status, 401);
  assert.equal((await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username: 'acceptance-password-current', password: 'CurrentPasswordChanged123!' }) })).status, 200);
  const currentPasswordRow = system.db.prepare('SELECT password_hash FROM users WHERE id=?').get(currentPasswordUser.id) as { password_hash: string };
  assert(verifyPassword('CurrentPasswordChanged123!', currentPasswordRow.password_hash));
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='password_changed' AND object_id=?`).get(String(currentPasswordUser.id)) as { count: number }).count, 1);

  const recoveryUser = (await json(await request('/users', teacher.cookie, { method: 'POST', body: JSON.stringify({
    username: 'acceptance-password-recovery', displayName: '验收密码恢复成员', role: 'member', password: 'RecoveryOriginal123!',
  }) }), 201)).user;
  const recoverySession = await login('acceptance-password-recovery', 'RecoveryOriginal123!');
  const adminRecoverySocket = await connect(admin.cookie);
  const requestChanged = event(adminRecoverySocket, 'password-reset-request:changed');
  const requestNotification = event(adminRecoverySocket, 'notification:created');
  const recoveryCreatedResponse = await request('/password-recovery/request', undefined, { method: 'POST', body: JSON.stringify({ displayName: '验收密码恢复成员' }) });
  const recoveryCreated = await json(recoveryCreatedResponse, 201);
  assert.deepEqual(recoveryCreated, { state: 'pending' });
  const recoveryCookieHeader = recoveryCreatedResponse.headers.get('set-cookie')!;
  assert.match(recoveryCookieHeader, /^lab_password_recovery=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Expires=/);
  const recoveryCookie = recoveryCookieHeader.split(';')[0]!;
  const recoveryToken = recoveryCookie.slice('lab_password_recovery='.length);
  assert.equal(Buffer.from(recoveryToken, 'base64url').length, 32);
  const requestEvent = await requestChanged; const requestMessage = await requestNotification;
  assert.equal(requestEvent.status, 'pending'); assert.equal(requestMessage.category, 'password_reset');
  const recoveryRow = system.db.prepare(`SELECT id,recovery_token_hash,status,version FROM password_reset_requests WHERE user_id=?`).get(recoveryUser.id) as { id: number; recovery_token_hash: string; status: string; version: number };
  assert.equal(recoveryRow.recovery_token_hash, digestToken(recoveryToken)); assert.notEqual(recoveryRow.recovery_token_hash, recoveryToken);
  assert.deepEqual(await json(await request('/password-recovery/lookup', undefined, { method: 'POST', headers: { cookie: recoveryCookie }, body: JSON.stringify({ displayName: '验收密码恢复成员' }) })), { state: 'pending' });
  assert.deepEqual(await json(await request('/password-recovery/lookup', undefined, { method: 'POST', headers: { cookie: 'lab_password_recovery=wrong-browser' }, body: JSON.stringify({ displayName: '验收密码恢复成员' }) })), { state: 'verify_current' });
  assert.equal((await request('/password-recovery/request', undefined, { method: 'POST', body: JSON.stringify({ displayName: '验收密码恢复成员' }) })).status, 409);
  assert.equal((await request('/password-reset-requests', recoverySession.cookie)).status, 403);
  assert.equal((await request('/password-reset-requests', hazard.cookie)).status, 403);
  const pendingQueue = await json(await request('/password-reset-requests', admin.cookie));
  const queuedRecovery = pendingQueue.requests.find((item: any) => item.id === recoveryRow.id);
  assert.deepEqual({ status: queuedRecovery.status, version: queuedRecovery.version, username: queuedRecovery.user.username }, { status: 'pending', version: 1, username: 'acceptance-password-recovery' });
  assert(!JSON.stringify(pendingQueue).includes(recoveryToken)); assert(!JSON.stringify(pendingQueue).includes(recoveryRow.recovery_token_hash));

  const approvedChanged = event(adminRecoverySocket, 'password-reset-request:changed');
  const approvedRecovery = (await json(await request(`/password-reset-requests/${recoveryRow.id}/decision`, admin.cookie, { method: 'POST', body: JSON.stringify({
    decision: 'approved', comment: '验收人工核验通过', version: queuedRecovery.version,
  }) }))).request;
  assert.equal(approvedRecovery.status, 'approved'); assert.equal((await approvedChanged).status, 'approved');
  assert.deepEqual(await json(await request('/password-recovery/lookup', undefined, { method: 'POST', headers: { cookie: recoveryCookie }, body: JSON.stringify({ displayName: '验收密码恢复成员' }) })), { state: 'approved' });
  const missingReset = await request('/password-recovery/reset-approved', undefined, { method: 'POST', body: JSON.stringify({ newPassword: 'RecoveryChanged123!', newPasswordConfirm: 'RecoveryChanged123!' }) });
  const wrongReset = await request('/password-recovery/reset-approved', undefined, { method: 'POST', headers: { cookie: 'lab_password_recovery=wrong-browser' }, body: JSON.stringify({ newPassword: 'RecoveryChanged123!', newPasswordConfirm: 'RecoveryChanged123!' }) });
  assert.equal(missingReset.status, 401); assert.equal(wrongReset.status, 401); assert.deepEqual(await missingReset.json(), await wrongReset.json());
  const consumedChanged = event(adminRecoverySocket, 'password-reset-request:changed');
  const resetResponse = await request('/password-recovery/reset-approved', undefined, { method: 'POST', headers: { cookie: recoveryCookie }, body: JSON.stringify({
    newPassword: 'RecoveryChanged123!', newPasswordConfirm: 'RecoveryChanged123!',
  }) });
  assert.deepEqual(await json(resetResponse), { changed: true }); assert.match(resetResponse.headers.get('set-cookie')!, /^lab_password_recovery=;.*Max-Age=0/);
  assert.equal((await consumedChanged).status, 'consumed'); assert.equal((await request('/auth/me', recoverySession.cookie)).status, 401);
  assert.equal((await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username: 'acceptance-password-recovery', password: 'RecoveryOriginal123!' }) })).status, 401);
  assert.equal((await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username: 'acceptance-password-recovery', password: 'RecoveryChanged123!' }) })).status, 200);

  const appealUser = (await json(await request('/users', teacher.cookie, { method: 'POST', body: JSON.stringify({
    username: 'acceptance-password-appeal', displayName: '验收密码申诉成员', role: 'member', password: 'AppealOriginal123!',
  }) }), 201)).user;
  const appealCreatedResponse = await request('/password-recovery/request', undefined, { method: 'POST', body: JSON.stringify({ displayName: '验收密码申诉成员' }) });
  await json(appealCreatedResponse, 201);
  const appealCookie = appealCreatedResponse.headers.get('set-cookie')!.split(';')[0]!;
  const appealToken = appealCookie.slice('lab_password_recovery='.length);
  const appealRow = system.db.prepare(`SELECT id,version FROM password_reset_requests WHERE user_id=?`).get(appealUser.id) as { id: number; version: number };
  const rejectedAppeal = (await json(await request(`/password-reset-requests/${appealRow.id}/decision`, teacher.cookie, { method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '首次身份资料不足', version: appealRow.version }) }))).request;
  assert.equal(rejectedAppeal.status, 'rejected');
  assert.deepEqual(await json(await request('/password-recovery/appeal', undefined, { method: 'POST', headers: { cookie: appealCookie }, body: JSON.stringify({ reason: '补充课题组登记信息，请重新核验' }) })), { state: 'appealed' });
  const appealedQueue = await json(await request('/password-reset-requests', teacher.cookie));
  const queuedAppeal = appealedQueue.requests.find((item: any) => item.id === appealRow.id);
  assert.deepEqual({ status: queuedAppeal.status, version: queuedAppeal.version, reason: queuedAppeal.appealReason }, { status: 'appealed', version: 3, reason: '补充课题组登记信息，请重新核验' });
  const approvedAppeal = (await json(await request(`/password-reset-requests/${appealRow.id}/decision`, teacher.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: queuedAppeal.version }) }))).request;
  assert.equal(approvedAppeal.status, 'approved');
  await json(await request('/password-recovery/reset-approved', undefined, { method: 'POST', headers: { cookie: appealCookie }, body: JSON.stringify({ newPassword: 'AppealChanged123!', newPasswordConfirm: 'AppealChanged123!' }) }));
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM password_reset_requests WHERE status='consumed' AND user_id IN (?,?)`).get(recoveryUser.id, appealUser.id) as { count: number }).count, 2);
  assert.deepEqual(await json(await request('/purchases/tasks/summary', admin.cookie)), { approvalCount: 0, procurementCount: 0 });
  const recoveryActions = JSON.stringify({
    audits: system.db.prepare(`SELECT summary,details_json FROM audit_logs WHERE object_type='password_reset_request' OR action='password_changed'`).all(),
    notifications: system.db.prepare(`SELECT category,title,body,object_type,object_id FROM notifications WHERE category='password_reset'`).all(),
  });
  for (const secret of [recoveryToken, appealToken, 'RecoveryOriginal123!', 'RecoveryChanged123!', 'AppealOriginal123!', 'AppealChanged123!']) assert(!recoveryActions.includes(secret));
  console.log('PASS password recovery: current-password change, HttpOnly hash-only request, cookie isolation, admin queue/decision, appeal, approved reset, session revocation, zero plaintext leakage');

  assert.equal((await request('/registration-invites', alice.cookie, { method: 'POST' })).status, 403);
  assert.equal((await request('/registration-invites', hazard.cookie, { method: 'POST' })).status, 403);
  assert.equal((await register({ username: 'no-invite', displayName: '无邀请注册', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!' })).response.status, 400);
  const registrationInvite = await createInvite(admin.cookie);
  assert.match(registrationInvite.code, /^LSF-[A-Za-z0-9_-]{32}$/);
  assert.equal(JSON.stringify(system.db.prepare('SELECT * FROM registration_invites WHERE id=?').get(registrationInvite.id)).includes(registrationInvite.code), false);
  const registered = await register({ username: 'acceptance-member', displayName: '验收注册成员', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!', inviteCode: registrationInvite.code });
  assert.equal(registered.response.status, 201); assert.equal(registered.user.role, 'member'); assert.equal(registered.user.active, true); assert.equal(registered.user.demo, false);
  assert.equal((await json(await request('/auth/me', registered.cookie))).user.id, registered.user.id);
  const registeredRow = system.db.prepare('SELECT * FROM users WHERE id=?').get(registered.user.id) as Record<string, unknown>;
  assert(verifyPassword('Acceptance123!', String(registeredRow.password_hash)));
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='account_register' AND object_id=?`).get(String(registered.user.id)) as { count: number }).count, 1);
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.username='teacher' AND n.category='account' AND n.object_id=?`).get(String(registered.user.id)) as { count: number }).count, 1);
  const reuse = await register({ username: 'invite-reuse', displayName: '重复使用邀请', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!', inviteCode: registrationInvite.code });
  assert.equal(reuse.response.status, 400); assert.equal((await reuse.response.json()).error.message, '邀请码无效或已失效');
  const injectedInvite = await createInvite(teacher.cookie);
  assert.equal((await register({ username: 'role-injection', displayName: '越权注册', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!', inviteCode: injectedInvite.code, role: 'super_admin' })).response.status, 400);
  const duplicateInvite = await createInvite(admin.cookie);
  assert.equal((await register({ username: 'acceptance-member', displayName: '重复注册', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!', inviteCode: duplicateInvite.code })).response.status, 409);
  const revokedInvite = await createInvite(admin.cookie);
  assert.equal((await request(`/registration-invites/${revokedInvite.id}/revoke`, admin.cookie, { method: 'POST', body: JSON.stringify({ version: revokedInvite.version }) })).status, 200);
  assert.equal((await register({ username: 'revoked-invite', displayName: '撤销邀请', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!', inviteCode: revokedInvite.code })).response.status, 400);
  const expiredInvite = await createInvite(admin.cookie);
  system.db.prepare('UPDATE registration_invites SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expiredInvite.id);
  assert.equal((await register({ username: 'expired-invite', displayName: '过期邀请', password: 'Acceptance123!', passwordConfirm: 'Acceptance123!', inviteCode: expiredInvite.code })).response.status, 400);
  const candidateCodes = [registrationInvite.code, injectedInvite.code, duplicateInvite.code, revokedInvite.code, expiredInvite.code];
  const persistentData = JSON.stringify({ invites: system.db.prepare('SELECT * FROM registration_invites').all(), audits: system.db.prepare(`SELECT * FROM audit_logs WHERE object_type='registration_invite'`).all(), notifications: system.db.prepare(`SELECT * FROM notifications WHERE object_type='registration_invite'`).all() });
  assert(candidateCodes.every((code) => !persistentData.includes(code)));
  console.log('PASS invite registration: admin generation, member/hazard 403, hash-only storage, member-only registration, reuse/revoke/expiry failure');

  const aliceSocket = await connect(alice.cookie); const bobSocket = await connect(bob.cookie);
  const firstRealtime = event(aliceSocket, 'chemical:changed'); const secondRealtime = event(bobSocket, 'chemical:changed');
  const inbound = (await json(await request('/chemicals', bob.cookie, { method: 'POST', body: JSON.stringify({ name: '验收乙醇', specification: 'AR 500mL', casNumber: ' 64-17-5 ', inboundAt: new Date().toISOString(), cabinet: 'A', shelf: 1 }) }), 201)).chemical;
  assert.equal((await firstRealtime).id, inbound.id); assert.equal((await secondRealtime).id, inbound.id);
  assert.equal(inbound.casNumber, '64-17-5');
  assert((await json(await request('/chemicals?search=64-17-5', alice.cookie))).chemicals.some((item: any) => item.id === inbound.id));
  assert.equal((await request(`/chemicals/${inbound.id}/details`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ name: '越权更正', version: inbound.version }) })).status, 403);
  assert.equal((await request(`/chemicals/${inbound.id}/details`, admin.cookie, { method: 'PATCH', body: JSON.stringify({ name: '角色越权更正', version: inbound.version }) })).status, 403);
  assert.equal((await request(`/chemicals/${inbound.id}/details`, hazard.cookie, { method: 'PATCH', body: JSON.stringify({ name: '危险采购越权更正', version: inbound.version }) })).status, 403);
  const correctedAlice = event(aliceSocket, 'chemical:changed'); const correctedBob = event(bobSocket, 'chemical:changed'); const correctionAuditEvent = event(aliceSocket, 'audit:created');
  const ownerCorrected = (await json(await request(`/chemicals/${inbound.id}/details`, bob.cookie, { method: 'PATCH', body: JSON.stringify({ name: '验收乙醇（更正）', version: inbound.version }) }))).chemical;
  assert.equal((await correctedAlice).name, '验收乙醇（更正）'); assert.equal((await correctedBob).name, '验收乙醇（更正）');
  const publicCorrectionAudit = await correctionAuditEvent;
  assert.equal(publicCorrectionAudit.summary, '更正药品信息：验收乙醇（更正）（名称）'); assert.equal('details' in publicCorrectionAudit, false);
  const storedCorrection = system.db.prepare(`SELECT summary,details_json FROM audit_logs WHERE action='inventory_details_corrected' AND object_id=?`).get(String(inbound.id)) as { summary: string; details_json: string };
  assert.deepEqual(JSON.parse(storedCorrection.details_json), { before: { name: '验收乙醇' }, after: { name: '验收乙醇（更正）' } });
  assert.equal((await request(`/chemicals/${inbound.id}/details`, bob.cookie, { method: 'PATCH', body: JSON.stringify({ name: '验收乙醇（更正）', version: ownerCorrected.version }) })).status, 400);
  assert.equal((await request(`/chemicals/${inbound.id}/details`, bob.cookie, { method: 'PATCH', body: JSON.stringify({ name: '旧版本更正', version: inbound.version }) })).status, 409);
  const superCorrected = (await json(await request(`/chemicals/${inbound.id}/details`, teacher.cookie, { method: 'PATCH', body: JSON.stringify({ specification: 'AR 1L', version: ownerCorrected.version }) }))).chemical;
  assert.equal(superCorrected.specification, 'AR 1L');
  assert.equal((await request(`/chemicals/${inbound.id}/move`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ cabinet: 'B', shelf: 9, version: superCorrected.version }) })).status, 400);
  const moved = (await json(await request(`/chemicals/${inbound.id}/move`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ cabinet: 'B', shelf: 4, version: superCorrected.version }) }))).chemical;
  const discarded = (await json(await request(`/chemicals/${inbound.id}/discard`, bob.cookie, { method: 'PATCH', body: JSON.stringify({ confirmed: true, reason: '验收废弃', version: moved.version }) }))).chemical;
  assert.equal(discarded.status, 'discarded'); assert.equal((await json(await request('/chemicals?cabinet=B&shelf=4', alice.cookie))).chemicals.length, 0);
  assert.equal((await request(`/chemicals/${inbound.id}/details`, teacher.cookie, { method: 'PATCH', body: JSON.stringify({ name: '废弃后更正', version: discarded.version }) })).status, 409);
  assert.equal((await request('/chemicals', alice.cookie, { method: 'POST', body: JSON.stringify({ name: '越权归属', specification: '1 瓶', ownerId: bob.user.id, inboundAt: new Date().toISOString(), cabinet: 'A', shelf: 2 }) })).status, 400);
  console.log('PASS inventory/realtime/correction: CAS inbound/search, owner/super authorization, strict state/version/no-op guards, structured private audit, summary-only public audit, cross-owner move, discard, two clients');

  assert.equal((await request('/chemicals', alice.cookie, { method: 'POST', body: JSON.stringify({ name: '旧柜号', specification: 'AR', inboundAt: new Date().toISOString(), cabinet: 'C', shelf: 1 }) })).status, 400);
  assert.equal((await request('/chemicals', alice.cookie, { method: 'POST', body: JSON.stringify({ name: '错误碱柜', specification: 'AR', inboundAt: new Date().toISOString(), cabinet: 'C2', shelf: 2 }) })).status, 400);
  const acid = (await json(await request('/chemicals', alice.cookie, { method: 'POST', body: JSON.stringify({ name: '验收盐酸', specification: 'AR 500mL', casNumber: '7647-01-0', inboundAt: new Date().toISOString(), cabinet: 'C1', shelf: 1 }) }), 201)).chemical;
  const baseChemical = (await json(await request('/chemicals', alice.cookie, { method: 'POST', body: JSON.stringify({ name: '验收氢氧化钠', specification: 'AR 500g', casNumber: '1310-73-2', inboundAt: new Date().toISOString(), cabinet: 'C2', shelf: 1 }) }), 201)).chemical;
  const gloveOne = (await json(await request('/chemicals', alice.cookie, { method: 'POST', body: JSON.stringify({ name: '验收手套箱样品一', specification: '1瓶', inboundAt: new Date().toISOString(), cabinet: 'G1', shelf: 1 }) }), 201)).chemical;
  const gloveTwo = (await json(await request('/chemicals', alice.cookie, { method: 'POST', body: JSON.stringify({ name: '验收手套箱样品二', specification: '1瓶', inboundAt: new Date().toISOString(), cabinet: 'G2', shelf: 1 }) }), 201)).chemical;
  for (const [cabinet, id] of [['C1', acid.id], ['C2', baseChemical.id], ['G1', gloveOne.id], ['G2', gloveTwo.id]]) {
    assert((await json(await request(`/chemicals?cabinet=${cabinet}&shelf=1`, alice.cookie))).chemicals.some((item: any) => item.id === id));
    assert.equal((await request(`/chemicals?cabinet=${cabinet}&shelf=2`, alice.cookie)).status, 400);
  }
  const acidInA = (await json(await request(`/chemicals/${acid.id}/move`, bob.cookie, { method: 'PATCH', body: JSON.stringify({ cabinet: 'A', shelf: 3, version: acid.version }) }))).chemical;
  const acidBackInC = (await json(await request(`/chemicals/${acid.id}/move`, bob.cookie, { method: 'PATCH', body: JSON.stringify({ cabinet: 'C1', shelf: 1, version: acidInA.version }) }))).chemical;
  assert.deepEqual({ cabinet: acidBackInC.cabinet, shelf: acidBackInC.shelf }, { cabinet: 'C1', shelf: 1 });
  console.log('PASS storage locations: legacy C rejected; C1/C2/G1/G2 direct inbound/query; illegal single-location shelves rejected; A↔C1 movement');

  assert.equal((await request('/inbound-requests', alice.cookie, { method: 'POST', body: JSON.stringify({ targetUserId: bob.user.id, name: '错误代入库碱', specification: 'AR', inboundAt: new Date().toISOString(), cabinet: 'C2', shelf: 2 }) })).status, 400);
  const pendingEvent = event(aliceSocket, 'inbound-request:changed'); const proxy = await createInboundRequest(alice.cookie, bob.user.id, '验收代入库盐酸', 'C1', 1, ' 7647-01-0 ');
  assert.equal((await pendingEvent).status, 'pending'); assert.equal((await json(await request('/chemicals?search=验收代入库盐酸', alice.cookie))).chemicals.length, 0);
  assert.equal(proxy.casNumber, '7647-01-0');
  assert((await json(await request('/inbound-requests?scope=mine', alice.cookie))).requests.some((item: any) => item.id === proxy.id));
  assert((await json(await request('/inbound-requests?scope=incoming', bob.cookie))).requests.some((item: any) => item.id === proxy.id));
  assert.equal((await request(`/inbound-requests/${proxy.id}/decision`, teacher.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: proxy.version }) })).status, 403);
  assert.equal((await request(`/inbound-requests/${proxy.id}/decision`, bob.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: 99 }) })).status, 409);
  const approvedEvent = event(aliceSocket, 'inbound-request:changed'); const proxyChemicalEvent = event(bobSocket, 'chemical:changed');
  const approvedProxy = await json(await request(`/inbound-requests/${proxy.id}/decision`, bob.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', comment: '验收同意', version: proxy.version }) }));
  assert.equal((await approvedEvent).status, 'approved'); assert.equal((await proxyChemicalEvent).id, approvedProxy.chemical.id);
  assert.equal(approvedProxy.chemical.owner.id, bob.user.id); assert.equal(approvedProxy.chemical.inboundOperator.id, alice.user.id);
  assert.deepEqual({ cabinet: approvedProxy.chemical.cabinet, shelf: approvedProxy.chemical.shelf, casNumber: approvedProxy.chemical.casNumber }, { cabinet: 'C1', shelf: 1, casNumber: '7647-01-0' });
  assert.equal((await request(`/inbound-requests/${proxy.id}/decision`, bob.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: approvedProxy.request.version }) })).status, 409);
  const rejectableProxy = await createInboundRequest(alice.cookie, bob.user.id, '验收拒绝代入库');
  const rejectedProxy = (await json(await request(`/inbound-requests/${rejectableProxy.id}/decision`, bob.cookie, { method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '验收拒绝', version: rejectableProxy.version }) }))).request;
  const withdrawableProxy = await createInboundRequest(alice.cookie, bob.user.id, '验收撤销代入库');
  const withdrawnProxy = (await json(await request(`/inbound-requests/${withdrawableProxy.id}/withdraw`, alice.cookie, { method: 'POST', body: JSON.stringify({ version: withdrawableProxy.version }) }))).request;
  assert.equal(rejectedProxy.status, 'rejected'); assert.equal(withdrawnProxy.status, 'withdrawn');
  assert.equal((await json(await request('/chemicals?search=验收拒绝代入库', alice.cookie))).chemicals.length, 0); assert.equal((await json(await request('/chemicals?search=验收撤销代入库', alice.cookie))).chemicals.length, 0);
  console.log('PASS proxy inbound: normalized CAS retained through C1 approval, C2 shelf rejection, pending scopes, authorization/version conflicts, reject/withdraw, realtime');

  const normal = await createPurchase(alice.cookie, '普通试剂', 'normal'); const urgent = await createPurchase(alice.cookie, '加急试剂', 'urgent');
  const dangerous = await createPurchase(alice.cookie, '叠氮化钠', 'normal', true); const dangerousUrgent = await createPurchase(alice.cookie, '加急危险试剂', 'urgent', true); const rejectable = await createPurchase(bob.cookie, '驳回试剂', 'normal');
  assert.deepEqual([normal.status, urgent.status, dangerous.status, dangerousUrgent.status], ['pending_normal', 'pending_super', 'pending_hazardous', 'pending_super']);
  assert.deepEqual(await json(await request('/purchases/tasks/summary', admin.cookie)), { approvalCount: 2, procurementCount: 0 });
  assert.deepEqual(await json(await request('/purchases/tasks/summary', hazard.cookie)), { approvalCount: 1, procurementCount: 0 });
  assert.deepEqual(await json(await request('/purchases/tasks/summary', teacher.cookie)), { approvalCount: 5, procurementCount: 0 });
  const adminApprovals = (await json(await request('/purchases/tasks/approvals', admin.cookie))).purchases.map((item: any) => item.id);
  const hazardApprovals = (await json(await request('/purchases/tasks/approvals', hazard.cookie))).purchases.map((item: any) => item.id);
  const teacherApprovals = (await json(await request('/purchases/tasks/approvals', teacher.cookie))).purchases.map((item: any) => item.id);
  assert(adminApprovals.includes(normal.id) && adminApprovals.includes(rejectable.id) && !adminApprovals.includes(dangerous.id) && !adminApprovals.includes(urgent.id));
  assert.deepEqual(hazardApprovals, [dangerous.id]);
  assert(teacherApprovals.includes(normal.id) && teacherApprovals.includes(urgent.id) && teacherApprovals.includes(dangerous.id) && teacherApprovals.includes(dangerousUrgent.id) && teacherApprovals.includes(rejectable.id));
  const requestNotificationRecipients = (purchaseId: number) => (system.db.prepare(`SELECT u.username FROM notifications n JOIN users u ON u.id=n.user_id
    WHERE n.object_type='purchase' AND n.object_id=? ORDER BY u.username`).all(String(purchaseId)) as Array<{ username: string }>).map(({ username }) => username);
  assert.deepEqual(requestNotificationRecipients(normal.id), ['admin', 'teacher']);
  assert.deepEqual(requestNotificationRecipients(dangerous.id), ['hazard', 'teacher']);
  assert.deepEqual(requestNotificationRecipients(urgent.id), ['teacher']);
  assert.deepEqual(requestNotificationRecipients(dangerousUrgent.id), ['teacher']);
  assert.equal((await request(`/purchases/${urgent.id}/decision`, admin.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: urgent.version }) })).status, 403);
  assert.equal((await request(`/purchases/${dangerous.id}/decision`, admin.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: dangerous.version }) })).status, 403);
  assert.equal((await request(`/purchases/${dangerousUrgent.id}/decision`, hazard.cookie, { method: 'POST', body: JSON.stringify({ decision: 'approved', version: dangerousUrgent.version }) })).status, 403);
  const approvedNormal = await decide(admin.cookie, normal, 'approved');
  const currentWeek = currentBeijingWeekStart(); const previousWeek = shiftWeek(currentWeek, -7);
  const archiveEntry = system.db.prepare('SELECT week_start,added_at FROM purchase_weekly_entries WHERE purchase_id=?').get(normal.id) as { week_start: string; added_at: string };
  assert.equal(archiveEntry.week_start, currentWeek); assert.equal(archiveEntry.added_at, approvedNormal.decidedAt);
  let deferredUrgent = await decide(teacher.cookie, urgent, 'deferred', '等待预算');
  deferredUrgent = (await json(await request(`/purchases/${urgent.id}`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ purpose: '补充后的加急用途', version: deferredUrgent.version }) }))).purchase;
  assert.equal(deferredUrgent.status, 'pending_super'); assert.equal(deferredUrgent.approvalComment, null);
  const approvedUrgent = await decide(teacher.cookie, deferredUrgent, 'approved'); const approvedDangerous = await decide(hazard.cookie, dangerous, 'approved');
  const dangerousHazardousStage = await decide(teacher.cookie, dangerousUrgent, 'approved', '老师初审通过');
  assert.equal(dangerousHazardousStage.status, 'pending_hazardous');
  const hazardousReviewRecipients = (system.db.prepare(`SELECT u.username FROM notifications n JOIN users u ON u.id=n.user_id
    WHERE n.object_type='purchase' AND n.object_id=? AND n.title='危险品复核任务' ORDER BY u.username`).all(String(dangerousUrgent.id)) as Array<{ username: string }>).map(({ username }) => username);
  assert.deepEqual(hazardousReviewRecipients, ['hazard', 'teacher']);
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM notifications WHERE object_type='purchase' AND object_id=? AND title='待采购任务'`).get(String(dangerousUrgent.id)) as { count: number }).count, 0);
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE object_type='purchase' AND object_id=? AND action='purchase_hazardous_review_requested'`).get(String(dangerousUrgent.id)) as { count: number }).count, 1);
  assert((await json(await request('/purchases/tasks/approvals', hazard.cookie))).purchases.some((item: any) => item.id === dangerousUrgent.id));
  let deferredDangerousUrgent = await decide(hazard.cookie, dangerousHazardousStage, 'deferred', '补充危险品操作方案');
  assert.equal(deferredDangerousUrgent.status, 'deferred_hazardous');
  deferredDangerousUrgent = (await json(await request(`/purchases/${dangerousUrgent.id}`, alice.cookie, { method: 'PATCH', body: JSON.stringify({ purpose: '补充后的加急危险用途', version: deferredDangerousUrgent.version }) }))).purchase;
  assert.equal(deferredDangerousUrgent.status, 'pending_hazardous'); assert.equal(deferredDangerousUrgent.approvalComment, null);
  const approvedDangerousUrgent = await decide(hazard.cookie, deferredDangerousUrgent, 'approved', '危险品复核通过');
  const rejected = await decide(admin.cookie, rejectable, 'rejected', '不符合采购要求');
  assert.equal(approvedNormal.status, 'approved'); assert.equal(approvedUrgent.status, 'approved'); assert.equal(approvedDangerous.status, 'approved'); assert.equal(approvedDangerousUrgent.status, 'approved'); assert.equal(rejected.status, 'rejected');
  const withdrawable = await createPurchase(bob.cookie, '撤销试剂', 'normal'); const withdrawn = (await json(await request(`/purchases/${withdrawable.id}/withdraw`, bob.cookie, { method: 'POST', body: JSON.stringify({ version: withdrawable.version }) }))).purchase; assert.equal(withdrawn.status, 'withdrawn');
  console.log('PASS purchase state machine: four-class matrix, super-only urgent first stage, hazardous second-stage defer/edit/approve, reject/withdraw');

  assert.deepEqual(await json(await request('/purchases/tasks/summary', admin.cookie)), { approvalCount: 0, procurementCount: 2 });
  assert.deepEqual(await json(await request('/purchases/tasks/summary', hazard.cookie)), { approvalCount: 0, procurementCount: 2 });
  assert.deepEqual(await json(await request('/purchases/tasks/summary', teacher.cookie)), { approvalCount: 0, procurementCount: 4 });
  assert.deepEqual(await json(await request('/purchases/tasks/summary', alice.cookie)), { approvalCount: 0, procurementCount: 0 });
  assert.deepEqual((await json(await request('/purchases/tasks/approvals', hazard.cookie))).purchases, []); assert.equal((await request('/purchases/tasks/procurement', alice.cookie)).status, 403);
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
  assert.deepEqual(procurementTaskRecipients(normal.id), ['admin', 'teacher']); assert.deepEqual(procurementTaskRecipients(dangerous.id), ['hazard', 'teacher']); assert.deepEqual(procurementTaskRecipients(dangerousUrgent.id), ['hazard', 'teacher']);
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
  console.log('PASS preferences/audit: future category blocked while inventory and immutable public audit remain');

  const deletionCandidate = (await json(await request('/users', teacher.cookie, { method: 'POST', body: JSON.stringify({
    username: 'acceptance-delete', displayName: '验收删除管理员', role: 'normal_admin', password: 'AcceptanceDelete123!',
  }) }), 201)).user;
  assert.equal((await request(`/users/${deletionCandidate.id}`, alice.cookie, { method: 'DELETE' })).status, 403);
  assert.equal((await request(`/users/${teacher.user.id}`, teacher.cookie, { method: 'DELETE' })).status, 400);
  assert.equal((await request('/users/999999', teacher.cookie, { method: 'DELETE' })).status, 404);
  assert.throws(() => deleteAccount(system.db, admin.user.id, teacher.user.id), (error: any) => error?.status === 409 && error?.message === '不能删除最后一个启用的超级管理员');

  const candidateSession = await login('acceptance-delete', 'AcceptanceDelete123!');
  const candidateInvite = await createInvite(candidateSession.cookie);
  await json(await request('/notifications/preferences', candidateSession.cookie, { method: 'PUT', body: JSON.stringify({ category: 'account', enabled: false }) }));
  const historyChemical = (await json(await request('/chemicals', candidateSession.cookie, { method: 'POST', body: JSON.stringify({
    name: '删除验收历史药品', specification: 'AR 1 瓶', inboundAt: new Date().toISOString(), cabinet: 'B', shelf: 1,
  }) }), 201)).chemical;
  const historyPurchase = await createPurchase(candidateSession.cookie, '删除验收历史采购', 'normal');
  const historyInbound = await createInboundRequest(candidateSession.cookie, bob.user.id, '删除验收历史代入库');
  const historyCounts = {
    chemicals: (system.db.prepare('SELECT COUNT(*) count FROM chemicals').get() as { count: number }).count,
    movements: (system.db.prepare('SELECT COUNT(*) count FROM inventory_movements').get() as { count: number }).count,
    purchases: (system.db.prepare('SELECT COUNT(*) count FROM purchases').get() as { count: number }).count,
    inbound: (system.db.prepare('SELECT COUNT(*) count FROM inbound_requests').get() as { count: number }).count,
    invites: (system.db.prepare('SELECT COUNT(*) count FROM registration_invites').get() as { count: number }).count,
  };
  const originalCandidate = system.db.prepare('SELECT * FROM users WHERE id=?').get(deletionCandidate.id) as Record<string, unknown>;
  assert((system.db.prepare('SELECT COUNT(*) count FROM sessions WHERE user_id=?').get(deletionCandidate.id) as { count: number }).count > 0);
  assert((system.db.prepare('SELECT COUNT(*) count FROM notifications WHERE user_id=?').get(deletionCandidate.id) as { count: number }).count > 0);
  assert.equal((system.db.prepare('SELECT COUNT(*) count FROM notification_preferences WHERE user_id=?').get(deletionCandidate.id) as { count: number }).count, 1);

  const candidateSocket = await connect(candidateSession.cookie);
  const changedEvent = event(aliceSocket, 'user:changed'); const disconnectEvent = event(candidateSocket, 'disconnect');
  const deleted = await json(await request(`/users/${deletionCandidate.id}`, teacher.cookie, { method: 'DELETE' }));
  assert.deepEqual(deleted, { deleted: { id: deletionCandidate.id, mode: 'anonymized' } });
  assert.deepEqual(await changedEvent, deleted.deleted); assert.equal(await disconnectEvent, 'io server disconnect');
  const tombstone = system.db.prepare('SELECT * FROM users WHERE id=?').get(deletionCandidate.id) as Record<string, unknown>;
  assert.match(String(tombstone.username), new RegExp(`^deleted-${deletionCandidate.id}-[A-Za-z0-9_-]+$`));
  assert.equal(tombstone.display_name, `已删除用户 #${deletionCandidate.id}`); assert.equal(tombstone.role, 'normal_admin');
  assert.equal(tombstone.active, 0); assert.equal(tombstone.demo, 0); assert.equal(tombstone.version, Number(originalCandidate.version) + 1);
  assert.equal(verifyPassword('AcceptanceDelete123!', String(tombstone.password_hash)), false); assert(!Number.isNaN(Date.parse(String(tombstone.deleted_at))));
  for (const table of ['sessions', 'notifications', 'notification_preferences']) {
    assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`).get(deletionCandidate.id) as { count: number }).count, 0);
  }
  assert.deepEqual(system.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((system.db.prepare('SELECT COUNT(*) count FROM chemicals').get() as { count: number }).count, historyCounts.chemicals);
  assert.equal((system.db.prepare('SELECT COUNT(*) count FROM inventory_movements').get() as { count: number }).count, historyCounts.movements);
  assert.equal((system.db.prepare('SELECT COUNT(*) count FROM purchases').get() as { count: number }).count, historyCounts.purchases);
  assert.equal((system.db.prepare('SELECT COUNT(*) count FROM inbound_requests').get() as { count: number }).count, historyCounts.inbound);
  assert.equal((system.db.prepare('SELECT COUNT(*) count FROM registration_invites').get() as { count: number }).count, historyCounts.invites);
  assert.equal((await request('/auth/me', candidateSession.cookie)).status, 401);
  assert.equal((await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username: 'acceptance-delete', password: 'AcceptanceDelete123!' }) })).status, 401);
  assert.equal((await request(`/users/${deletionCandidate.id}`, teacher.cookie, { method: 'PATCH', body: JSON.stringify({ displayName: '不能恢复', version: tombstone.version }) })).status, 404);
  assert.equal((await request(`/users/${deletionCandidate.id}`, teacher.cookie, { method: 'DELETE' })).status, 404);
  assert(!(await json(await request('/users', teacher.cookie))).users.some((user: any) => user.id === deletionCandidate.id));
  assert(!(await json(await request('/members', teacher.cookie))).users.some((user: any) => user.id === deletionCandidate.id));

  const deletionAudit = system.db.prepare(`SELECT * FROM audit_logs WHERE action='account_deleted' AND object_id=?`).get(String(deletionCandidate.id)) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(String(deletionAudit.details_json)), { mode: 'anonymized' });
  const deletionAuditText = JSON.stringify(deletionAudit);
  for (const oldPii of [String(originalCandidate.username), String(originalCandidate.display_name), String(originalCandidate.password_hash), 'AcceptanceDelete123!']) assert(!deletionAuditText.includes(oldPii));

  const reused = await register({ username: 'acceptance-delete', displayName: '验收重用账号', password: 'AcceptanceReused123!', passwordConfirm: 'AcceptanceReused123!', inviteCode: candidateInvite.code });
  assert.equal(reused.response.status, 201); assert.notEqual(reused.user.id, deletionCandidate.id); assert.equal(reused.user.role, 'member');
  assert.equal((await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username: 'acceptance-delete', password: 'AcceptanceDelete123!' }) })).status, 401);
  assert.equal((await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ username: 'acceptance-delete', password: 'AcceptanceReused123!' }) })).status, 200);
  const anonymous = { id: deletionCandidate.id, username: String(tombstone.username), displayName: `已删除用户 #${deletionCandidate.id}` };
  assert.deepEqual((await json(await request(`/chemicals/${historyChemical.id}`, teacher.cookie))).chemical.owner, anonymous);
  assert.deepEqual((await json(await request('/purchases', teacher.cookie))).purchases.find((item: any) => item.id === historyPurchase.id).applicant, anonymous);
  assert.deepEqual((await json(await request('/inbound-requests?scope=incoming', bob.cookie))).requests.find((item: any) => item.id === historyInbound.id).requester, anonymous);
  const historicalInvite = (await json(await request('/registration-invites', teacher.cookie))).invites.find((item: any) => item.id === candidateInvite.id);
  assert.deepEqual(historicalInvite.creator, anonymous); assert.equal(historicalInvite.usedBy.id, reused.user.id);

  const race = (await json(await request('/users', teacher.cookie, { method: 'POST', body: JSON.stringify({
    username: 'acceptance-delete-race', displayName: '验收并发删除', role: 'member', password: 'AcceptanceRace123!',
  }) }), 201)).user;
  const raceStatuses = (await Promise.all([
    request(`/users/${race.id}`, teacher.cookie, { method: 'DELETE' }), request(`/users/${race.id}`, teacher.cookie, { method: 'DELETE' }),
  ])).map(({ status }) => status).sort((left, right) => left - right);
  assert.deepEqual(raceStatuses, [200, 404]);
  assert.equal((system.db.prepare(`SELECT COUNT(*) count FROM audit_logs WHERE action='account_deleted' AND object_id=?`).get(String(race.id)) as { count: number }).count, 1);

  const hazardRow = system.db.prepare('SELECT id,demo FROM users WHERE id=?').get(hazard.user.id) as { id: number; demo: number };
  assert.equal(hazardRow.demo, 1); assert.equal((await request(`/users/${hazard.user.id}`, teacher.cookie, { method: 'DELETE' })).status, 200);
  assert.equal((system.db.prepare('SELECT demo FROM users WHERE id=?').get(hazard.user.id) as { demo: number }).demo, 0);
  assert.equal((await request('/auth/me', hazard.cookie)).status, 401); assert.deepEqual(system.db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS account deletion: guards, cleanup, random tombstone, safe realtime/disconnect, username reuse, history/FK retention, demo/non-demo, concurrent idempotence');

  const logs = (await json(await request('/audit-logs', alice.cookie))).logs; assert(logs.some((log: any) => log.summary.includes('偏好屏蔽验证'))); assert(logs.some((log: any) => log.action === 'purchase_rejected')); assert.equal(logs.filter((log: any) => log.action === 'purchase_purchased').length, 4); assert(logs.some((log: any) => log.action === 'account_deleted')); assert(logs.every((log: any) => !('details' in log)));
  console.log(`ACCEPTANCE OK (${logs.length} audit entries verified)`);
} finally {
  for (const socket of sockets) socket.close(); await system.close();
}
