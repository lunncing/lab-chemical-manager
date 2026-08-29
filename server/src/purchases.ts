import { Router } from 'express';
import type { Server as SocketServer } from 'socket.io';
import type { Db } from './database.js';
import { transaction } from './database.js';
import { asyncRoute, type AuthedRequest, HttpError, parseBody, roleRequired } from './http.js';
import { decisionSchema, purchaseCreateSchema, purchaseUpdateSchema, versionSchema } from './validation.js';
import { eligibleUserIds, emitCommitted, insertAudit, insertNotifications } from './domain.js';
import { beijingWeekStart, currentBeijingWeekStart, isValidWeekStart, weekEnd } from './purchase-weeks.js';
import type { NotificationCategory, PurchaseStatus } from '../../shared/types.js';

const selectPurchase = `SELECT p.*,u.username applicant_username,u.display_name applicant_name FROM purchases p JOIN users u ON u.id=p.applicant_id`;

export function mapPurchase(row: Record<string, unknown>) {
  return { id: Number(row.id), chemicalName: String(row.chemical_name), specification: String(row.specification), purpose: String(row.purpose),
    hazardous: Boolean(row.hazardous), requestType: row.request_type as 'normal' | 'urgent', applicant: { id: Number(row.applicant_id), username: String(row.applicant_username), displayName: String(row.applicant_name) },
    status: row.status as PurchaseStatus, approvalComment: row.approval_comment === null ? null : String(row.approval_comment), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    decidedAt: row.decided_at === null ? null : String(row.decided_at), withdrawnAt: row.withdrawn_at === null ? null : String(row.withdrawn_at) };
}

function getPurchase(db: Db, id: number) {
  const row = db.prepare(`${selectPurchase} WHERE p.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, '申请不存在', 'NOT_FOUND');
  return mapPurchase(row);
}

function requestRecipients(db: Db, requestType: string, category: NotificationCategory): number[] {
  const clause = requestType === 'urgent' ? `u.role='super_admin'` : `u.role IN ('normal_admin','super_admin')`;
  return eligibleUserIds(db, category, clause);
}

function approvalTaskWhere(role: AuthedRequest['user']['role']): string | null {
  if (role === 'normal_admin') return `p.status IN ('pending_normal','deferred') AND p.request_type='normal'`;
  if (role === 'super_admin') return `p.status IN ('pending_normal','pending_super','deferred')`;
  return null;
}

function procurementTaskWhere(role: AuthedRequest['user']['role']): string | null {
  if (role === 'normal_admin') return `p.status='approved' AND p.hazardous=0`;
  if (role === 'hazardous_buyer') return `p.status='approved' AND p.hazardous=1`;
  if (role === 'super_admin') return `p.status='approved'`;
  return null;
}

function taskPurchases(db: Db, where: string, params: Array<string | number> = []): ReturnType<typeof mapPurchase>[] {
  const rows = db.prepare(`${selectPurchase} WHERE ${where} ORDER BY p.id DESC`).all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapPurchase);
}

function taskCount(db: Db, where: string | null): number {
  if (!where) return 0;
  return Number((db.prepare(`SELECT COUNT(*) count FROM purchases p WHERE ${where}`).get() as { count: number }).count);
}

function canMarkPurchased(role: AuthedRequest['user']['role'], hazardous: boolean): boolean {
  return role === 'super_admin' || (hazardous ? role === 'hazardous_buyer' : role === 'normal_admin');
}

function normalCatalogWeek(value: unknown, current: string): string {
  if (value === undefined) return current;
  if (!isValidWeekStart(value)) throw new HttpError(400, '采购周次必须是格式严格的真实周一日期', 'VALIDATION_ERROR');
  return value;
}

export function purchasesRouter(db: Db, io: SocketServer): Router {
  const router = Router();
  router.get('/tasks/summary', (request, res) => {
    const req = request as AuthedRequest;
    res.json({ approvalCount: taskCount(db, approvalTaskWhere(req.user.role)), procurementCount: taskCount(db, procurementTaskWhere(req.user.role)) });
  });
  router.get('/tasks/approvals', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const where = approvalTaskWhere(req.user.role);
    if (!where) throw new HttpError(403, '当前角色没有采购审批任务', 'FORBIDDEN');
    res.json({ purchases: taskPurchases(db, where) });
  }));
  router.get('/tasks/procurement', asyncRoute((request, res) => {
    const req = request as AuthedRequest; let where = procurementTaskWhere(req.user.role);
    if (!where) throw new HttpError(403, '当前角色没有采购任务', 'FORBIDDEN');
    const requestType = req.query.requestType;
    if (requestType !== undefined && (typeof requestType !== 'string' || !['normal', 'urgent'].includes(requestType))) {
      throw new HttpError(400, '采购类型筛选无效', 'VALIDATION_ERROR');
    }
    const params: Array<string | number> = [];
    if (requestType) { where += ' AND p.request_type=?'; params.push(requestType); }
    res.json({ purchases: taskPurchases(db, where, params) });
  }));
  router.get('/catalog/normal/weeks', roleRequired('normal_admin', 'super_admin'), (_req, res) => {
    const current = currentBeijingWeekStart();
    const archived = db.prepare(`SELECT e.week_start,
      COUNT(*) count,
      SUM(CASE WHEN p.status='approved' THEN 1 ELSE 0 END) approved_count,
      SUM(CASE WHEN p.status='purchased' THEN 1 ELSE 0 END) purchased_count
      FROM purchase_weekly_entries e JOIN purchases p ON p.id=e.purchase_id
      WHERE p.request_type='normal' AND p.hazardous=0
      GROUP BY e.week_start`).all() as Array<{ week_start: string; count: number; approved_count: number; purchased_count: number }>;
    const weeks = archived.map((row) => ({ weekStart: row.week_start, weekEnd: weekEnd(row.week_start), count: Number(row.count), approvedCount: Number(row.approved_count), purchasedCount: Number(row.purchased_count), isCurrent: row.week_start === current }));
    if (!weeks.some(({ weekStart }) => weekStart === current)) weeks.push({ weekStart: current, weekEnd: weekEnd(current), count: 0, approvedCount: 0, purchasedCount: 0, isCurrent: true });
    weeks.sort((left, right) => right.weekStart.localeCompare(left.weekStart));
    res.json({ weeks });
  });
  router.get('/catalog/normal', roleRequired('normal_admin', 'super_admin'), asyncRoute((request, res) => {
    const current = currentBeijingWeekStart(); const selected = normalCatalogWeek(request.query.week, current);
    const rows = db.prepare(`${selectPurchase} JOIN purchase_weekly_entries e ON e.purchase_id=p.id
      WHERE e.week_start=? AND p.request_type='normal' AND p.hazardous=0 ORDER BY p.id DESC`).all(selected) as Array<Record<string, unknown>>;
    res.json({ week: { weekStart: selected, weekEnd: weekEnd(selected), isCurrent: selected === current }, purchases: rows.map(mapPurchase) });
  }));
  router.get('/catalog/urgent', roleRequired('normal_admin', 'super_admin'), (_req, res) => {
    const rows = db.prepare(`${selectPurchase} WHERE p.status='approved' AND p.request_type='urgent' AND p.hazardous=0 ORDER BY p.id DESC`).all() as Array<Record<string, unknown>>;
    res.json({ purchases: rows.map(mapPurchase) });
  });
  router.get('/catalog/hazardous', roleRequired('hazardous_buyer', 'super_admin'), (_req, res) => {
    const rows = db.prepare(`${selectPurchase} WHERE p.status='approved' AND p.hazardous=1 ORDER BY p.id DESC`).all() as Array<Record<string, unknown>>;
    res.json({ purchases: rows.map(mapPurchase) });
  });
  router.get('/', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const clauses = ['1=1']; const params: Array<string | number> = [];
    if (req.query.scope === 'mine') { clauses.push('p.applicant_id=?'); params.push(req.user.id); }
    if (typeof req.query.status === 'string') { clauses.push('p.status=?'); params.push(req.query.status); }
    if (req.query.requestType === 'normal' || req.query.requestType === 'urgent') { clauses.push('p.request_type=?'); params.push(req.query.requestType); }
    if (req.query.hazardous === 'true' || req.query.hazardous === 'false') { clauses.push('p.hazardous=?'); params.push(req.query.hazardous === 'true' ? 1 : 0); }
    const rows = db.prepare(`${selectPurchase} WHERE ${clauses.join(' AND ')} ORDER BY p.id DESC`).all(...params) as Array<Record<string, unknown>>;
    res.json({ purchases: rows.map(mapPurchase) });
  }));
  router.post('/', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const input = parseBody(purchaseCreateSchema, req.body); const now = new Date().toISOString();
    const status: PurchaseStatus = input.requestType === 'normal' ? 'pending_normal' : 'pending_super';
    const category: NotificationCategory = input.requestType === 'normal' ? 'purchase_normal' : 'purchase_urgent';
    const committed = transaction(db, () => {
      const result = db.prepare(`INSERT INTO purchases (chemical_name,specification,purpose,hazardous,request_type,applicant_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(input.chemicalName, input.specification, input.purpose, Number(input.hazardous), input.requestType, req.user.id, status, now, now);
      const id = Number(result.lastInsertRowid); const purchase = getPurchase(db, id);
      const audit = insertAudit(db, { actorId: req.user.id, action: 'purchase_create', objectType: 'purchase', objectId: id, summary: `创建${input.requestType === 'urgent' ? '加急' : '普通'}采购申请：${input.chemicalName}`, details: input }, now);
      const notifications = insertNotifications(db, { userIds: requestRecipients(db, input.requestType, category), category, title: input.requestType === 'urgent' ? '新的加急申请' : '新的普通申请', body: `${req.user.displayName} 申请采购 ${input.chemicalName}`, objectType: 'purchase', objectId: id }, now);
      return { purchase, audit, notifications };
    });
    emitCommitted(io, 'purchase:changed', committed.purchase, committed.audit, committed.notifications); res.status(201).json({ purchase: committed.purchase });
  }));
  router.patch('/:id', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const id = Number(req.params.id); const input = parseBody(purchaseUpdateSchema, req.body); const current = getPurchase(db, id);
    if (current.applicant.id !== req.user.id) throw new HttpError(403, '只能修改自己的申请', 'FORBIDDEN');
    if (!['pending_normal', 'pending_super', 'deferred'].includes(String(current.status))) throw new HttpError(409, '当前状态不能修改', 'CONFLICT');
    const requestType = input.requestType ?? current.requestType as 'normal' | 'urgent'; const status = requestType === 'normal' ? 'pending_normal' : 'pending_super';
    const now = new Date().toISOString(); const category: NotificationCategory = requestType === 'normal' ? 'purchase_normal' : 'purchase_urgent';
    const committed = transaction(db, () => {
      const result = db.prepare(`UPDATE purchases SET chemical_name=?,specification=?,purpose=?,hazardous=?,request_type=?,status=?,approval_comment=NULL,decided_at=NULL,version=version+1,updated_at=? WHERE id=? AND version=?`).run(
        input.chemicalName ?? current.chemicalName, input.specification ?? current.specification, input.purpose ?? current.purpose,
        Number(input.hazardous ?? current.hazardous), requestType, status, now, id, input.version);
      if (!result.changes) throw new HttpError(409, '申请已被其他人修改', 'CONFLICT');
      const purchase = getPurchase(db, id);
      const audit = insertAudit(db, { actorId: req.user.id, action: 'purchase_update', objectType: 'purchase', objectId: id, summary: `修改采购申请：${purchase.chemicalName}`, details: input }, now);
      const notifications = insertNotifications(db, { userIds: requestRecipients(db, requestType, category), category, title: requestType === 'urgent' ? '加急申请已修改' : '普通申请已修改', body: `${req.user.displayName} 修改了 ${purchase.chemicalName} 的申请`, objectType: 'purchase', objectId: id }, now);
      return { purchase, audit, notifications };
    });
    emitCommitted(io, 'purchase:changed', committed.purchase, committed.audit, committed.notifications); res.json({ purchase: committed.purchase });
  }));
  router.post('/:id/withdraw', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const id = Number(req.params.id); const input = parseBody(versionSchema, req.body); const current = getPurchase(db, id);
    if (current.applicant.id !== req.user.id) throw new HttpError(403, '只能撤销自己的申请', 'FORBIDDEN');
    if (!['pending_normal', 'pending_super', 'deferred'].includes(String(current.status))) throw new HttpError(409, '当前状态不能撤销', 'CONFLICT');
    const now = new Date().toISOString(); const category: NotificationCategory = current.requestType === 'normal' ? 'purchase_normal' : 'purchase_urgent';
    const committed = transaction(db, () => {
      const result = db.prepare(`UPDATE purchases SET status='withdrawn',withdrawn_at=?,version=version+1,updated_at=? WHERE id=? AND version=?`).run(now, now, id, input.version);
      if (!result.changes) throw new HttpError(409, '申请已被其他人修改', 'CONFLICT');
      const purchase = getPurchase(db, id);
      const audit = insertAudit(db, { actorId: req.user.id, action: 'purchase_withdraw', objectType: 'purchase', objectId: id, summary: `撤销采购申请：${purchase.chemicalName}` }, now);
      const notifications = insertNotifications(db, { userIds: requestRecipients(db, String(current.requestType), category), category, title: '采购申请已撤销', body: `${req.user.displayName} 撤销了 ${purchase.chemicalName} 的申请`, objectType: 'purchase', objectId: id }, now);
      return { purchase, audit, notifications };
    });
    emitCommitted(io, 'purchase:changed', committed.purchase, committed.audit, committed.notifications); res.json({ purchase: committed.purchase });
  }));
  router.post('/:id/purchased', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const id = Number(req.params.id); const input = parseBody(versionSchema, req.body); const current = getPurchase(db, id);
    if (!canMarkPurchased(req.user.role, current.hazardous)) throw new HttpError(403, '当前角色不能完成此采购任务', 'FORBIDDEN');
    if (current.status !== 'approved') throw new HttpError(409, '只有已通过的申请可以标记为已采购', 'CONFLICT');
    const now = new Date().toISOString();
    const committed = transaction(db, () => {
      const result = db.prepare(`UPDATE purchases SET status='purchased',version=version+1,updated_at=? WHERE id=? AND status='approved' AND version=?`).run(now, id, input.version);
      if (!result.changes) throw new HttpError(409, '申请已被其他人修改', 'CONFLICT');
      const purchase = getPurchase(db, id);
      const audit = insertAudit(db, { actorId: req.user.id, action: 'purchase_purchased', objectType: 'purchase', objectId: id, summary: `标记已采购：${purchase.chemicalName}` }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'approval', 'u.id=?', [purchase.applicant.id]), category: 'approval', title: '采购已完成', body: `${purchase.chemicalName} 已采购完成`, objectType: 'purchase', objectId: id }, now);
      return { purchase, audit, notifications };
    });
    emitCommitted(io, 'purchase:changed', committed.purchase, committed.audit, committed.notifications); res.json({ purchase: committed.purchase });
  }));
  router.post('/:id/decision', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const id = Number(req.params.id); const input = parseBody(decisionSchema, req.body); const current = getPurchase(db, id);
    if (current.requestType === 'urgent' && req.user.role !== 'super_admin') throw new HttpError(403, '加急申请仅超级管理员可审批', 'FORBIDDEN');
    if (current.requestType === 'normal' && req.user.role !== 'normal_admin' && req.user.role !== 'super_admin') throw new HttpError(403, '普通申请仅管理员可审批', 'FORBIDDEN');
    if (!['pending_normal', 'pending_super', 'deferred'].includes(String(current.status))) throw new HttpError(409, '当前状态不能审批', 'CONFLICT');
    const now = new Date().toISOString();
    const committed = transaction(db, () => {
      const result = db.prepare('UPDATE purchases SET status=?,approval_comment=?,decided_at=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(input.decision, input.comment ?? null, now, now, id, input.version);
      if (!result.changes) throw new HttpError(409, '申请已被其他人修改', 'CONFLICT');
      const purchase = getPurchase(db, id);
      if (input.decision === 'approved' && purchase.requestType === 'normal' && !purchase.hazardous) {
        db.prepare('INSERT OR IGNORE INTO purchase_weekly_entries (purchase_id,week_start,added_at) VALUES (?,?,?)').run(id, beijingWeekStart(now), now);
      }
      const labels = { approved: '通过', deferred: '推迟', rejected: '驳回' } as const;
      const audit = insertAudit(db, { actorId: req.user.id, action: `purchase_${input.decision}`, objectType: 'purchase', objectId: id, summary: `${labels[input.decision]}采购申请：${purchase.chemicalName}`, details: { comment: input.comment ?? null } }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'approval', 'u.id=?', [current.applicant.id]), category: 'approval', title: `采购申请${labels[input.decision]}`, body: `${purchase.chemicalName} 的申请已${labels[input.decision]}`, objectType: 'purchase', objectId: id }, now);
      if (input.decision === 'approved') {
        const taskCategory: NotificationCategory = purchase.hazardous ? 'hazardous' : 'approval';
        const taskRoles = purchase.hazardous ? `u.role IN ('hazardous_buyer','super_admin')` : `u.role IN ('normal_admin','super_admin')`;
        notifications.push(...insertNotifications(db, { userIds: eligibleUserIds(db, taskCategory, taskRoles), category: taskCategory, title: '待采购任务', body: `${purchase.chemicalName} 已通过审批，请安排采购`, objectType: 'purchase', objectId: id }, now));
      }
      return { purchase, audit, notifications };
    });
    emitCommitted(io, 'purchase:changed', committed.purchase, committed.audit, committed.notifications); res.json({ purchase: committed.purchase });
  }));
  return router;
}
