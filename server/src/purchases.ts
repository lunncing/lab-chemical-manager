import { Router } from 'express';
import type { Server as SocketServer } from 'socket.io';
import type { Db } from './database.js';
import { transaction } from './database.js';
import { asyncRoute, type AuthedRequest, HttpError, parseBody, roleRequired } from './http.js';
import { decisionSchema, purchaseCreateSchema, purchaseUpdateSchema, versionSchema } from './validation.js';
import { eligibleUserIds, emitCommitted, insertAudit, insertNotifications } from './domain.js';
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

function mondayIso(): string {
  const value = new Date(); const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1)); value.setUTCHours(0, 0, 0, 0);
  return value.toISOString();
}

export function purchasesRouter(db: Db, io: SocketServer): Router {
  const router = Router();
  router.get('/catalog/normal', roleRequired('normal_admin', 'super_admin'), (_req, res) => {
    const rows = db.prepare(`${selectPurchase} WHERE p.status='approved' AND p.request_type='normal' AND p.decided_at>=? ORDER BY p.id DESC`).all(mondayIso()) as Array<Record<string, unknown>>;
    res.json({ purchases: rows.map(mapPurchase) });
  });
  router.get('/catalog/urgent', roleRequired('normal_admin', 'super_admin'), (_req, res) => {
    const rows = db.prepare(`${selectPurchase} WHERE p.status='approved' AND p.request_type='urgent' ORDER BY p.id DESC`).all() as Array<Record<string, unknown>>;
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
      const labels = { approved: '通过', deferred: '推迟', rejected: '驳回' } as const;
      const audit = insertAudit(db, { actorId: req.user.id, action: `purchase_${input.decision}`, objectType: 'purchase', objectId: id, summary: `${labels[input.decision]}采购申请：${purchase.chemicalName}`, details: { comment: input.comment ?? null } }, now);
      const approvalIds = new Set<number>(eligibleUserIds(db, 'approval', `u.id=? OR u.role='super_admin'`, [current.applicant.id]));
      if (input.decision === 'approved') for (const userId of eligibleUserIds(db, 'approval', `u.role='normal_admin'`)) approvalIds.add(userId);
      const notifications = insertNotifications(db, { userIds: [...approvalIds], category: 'approval', title: `采购申请${labels[input.decision]}`, body: `${purchase.chemicalName} 的申请已${labels[input.decision]}`, objectType: 'purchase', objectId: id }, now);
      if (input.decision === 'approved' && purchase.hazardous) notifications.push(...insertNotifications(db, { userIds: eligibleUserIds(db, 'hazardous', `u.role IN ('hazardous_buyer','super_admin')`), category: 'hazardous', title: '危险品采购任务', body: `${purchase.chemicalName} 已通过审批，请安排采购`, objectType: 'purchase', objectId: id }, now));
      return { purchase, audit, notifications };
    });
    emitCommitted(io, 'purchase:changed', committed.purchase, committed.audit, committed.notifications); res.json({ purchase: committed.purchase });
  }));
  return router;
}
