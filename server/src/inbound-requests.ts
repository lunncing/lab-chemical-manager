import { Router } from 'express';
import type { Server as SocketServer } from 'socket.io';
import type { Db } from './database.js';
import { transaction } from './database.js';
import { eligibleUserIds, emitCommitted, insertAudit, insertNotifications } from './domain.js';
import { asyncRoute, type AuthedRequest, HttpError, parseBody } from './http.js';
import { getChemical } from './inventory.js';
import { inboundRequestCreateSchema, inboundRequestDecisionSchema, versionSchema } from './validation.js';
import type { InboundRequestStatus } from '../../shared/types.js';

const requestSelect = `SELECT r.*,
  requester.username requester_username, requester.display_name requester_name,
  target.username target_username, target.display_name target_name
  FROM inbound_requests r
  JOIN users requester ON requester.id=r.requester_id
  JOIN users target ON target.id=r.target_user_id`;

function mapInboundRequest(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    requester: { id: Number(row.requester_id), username: String(row.requester_username), displayName: String(row.requester_name) },
    targetUser: { id: Number(row.target_user_id), username: String(row.target_username), displayName: String(row.target_name) },
    name: String(row.name), specification: String(row.specification), inboundAt: String(row.inbound_at),
    cabinet: row.cabinet as 'A' | 'B', shelf: Number(row.shelf), status: row.status as InboundRequestStatus,
    decisionComment: row.decision_comment === null ? null : String(row.decision_comment),
    chemicalId: row.chemical_id === null ? null : Number(row.chemical_id), version: Number(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    decidedAt: row.decided_at === null ? null : String(row.decided_at), withdrawnAt: row.withdrawn_at === null ? null : String(row.withdrawn_at),
  };
}

function requestRow(db: Db, id: number) {
  const row = db.prepare(`${requestSelect} WHERE r.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, '代入库申请不存在', 'NOT_FOUND');
  return row;
}

function emitNotifications(io: SocketServer, notifications: Array<Record<string, unknown>>) {
  for (const notification of notifications) io.to(`user:${notification.userId}`).emit('notification:created', notification);
}

export function inboundRequestsRouter(db: Db, io: SocketServer): Router {
  const router = Router();

  router.get('/', asyncRoute((request, res) => {
    const req = request as AuthedRequest;
    if (req.query.scope !== 'incoming' && req.query.scope !== 'mine') throw new HttpError(400, 'scope 仅允许 incoming 或 mine', 'VALIDATION_ERROR');
    const column = req.query.scope === 'incoming' ? 'r.target_user_id' : 'r.requester_id';
    const rows = db.prepare(`${requestSelect} WHERE ${column}=? ORDER BY r.id DESC`).all(req.user.id) as Array<Record<string, unknown>>;
    res.json({ requests: rows.map(mapInboundRequest) });
  }));

  router.post('/', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const input = parseBody(inboundRequestCreateSchema, req.body); const now = new Date().toISOString();
    if (input.targetUserId === req.user.id) throw new HttpError(400, '代入库对象不能是自己', 'VALIDATION_ERROR');
    const target = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(input.targetUserId) as Record<string, unknown> | undefined;
    if (!target) throw new HttpError(400, '代入库对象不存在或已停用', 'VALIDATION_ERROR');
    const committed = transaction(db, () => {
      const result = db.prepare(`INSERT INTO inbound_requests
        (requester_id,target_user_id,name,specification,inbound_at,cabinet,shelf,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'pending',?,?)`).run(req.user.id, input.targetUserId, input.name, input.specification, input.inboundAt, input.cabinet, input.shelf, now, now);
      const id = Number(result.lastInsertRowid); const inboundRequest = mapInboundRequest(requestRow(db, id));
      const audit = insertAudit(db, { actorId: req.user.id, action: 'proxy_inbound_requested', objectType: 'inbound_request', objectId: id, summary: `向 ${target.display_name} 提交 ${input.name} 的代入库申请`, details: { targetUserId: input.targetUserId, cabinet: input.cabinet, shelf: input.shelf } }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'proxy_inbound', 'u.id=?', [input.targetUserId]), category: 'proxy_inbound', title: '代入库申请', body: `${req.user.displayName} 为您提交了 ${input.name} 的代入库申请，是否同意？`, objectType: 'inbound_request', objectId: id }, now);
      return { inboundRequest, audit, notifications };
    });
    emitCommitted(io, 'inbound-request:changed', committed.inboundRequest, committed.audit, committed.notifications);
    res.status(201).json({ request: committed.inboundRequest });
  }));

  router.post('/:id/decision', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const id = Number(req.params.id); const input = parseBody(inboundRequestDecisionSchema, req.body); const now = new Date().toISOString();
    const current = requestRow(db, id);
    if (Number(current.target_user_id) !== req.user.id) throw new HttpError(403, '只有代入库对象可以处理申请', 'FORBIDDEN');
    if (String(current.status) !== 'pending' || Number(current.version) !== input.version) throw new HttpError(409, '申请状态或版本已变化', 'CONFLICT');

    if (input.decision === 'rejected') {
      const committed = transaction(db, () => {
        const updated = db.prepare(`UPDATE inbound_requests SET status='rejected',decision_comment=?,version=version+1,updated_at=?,decided_at=?
          WHERE id=? AND status='pending' AND version=?`).run(input.comment ?? null, now, now, id, input.version);
        if (!updated.changes) throw new HttpError(409, '申请状态或版本已变化', 'CONFLICT');
        const inboundRequest = mapInboundRequest(requestRow(db, id));
        const audit = insertAudit(db, { actorId: req.user.id, action: 'proxy_inbound_rejected', objectType: 'inbound_request', objectId: id, summary: `拒绝 ${current.requester_name} 提交的 ${current.name} 代入库申请`, details: { comment: input.comment } }, now);
        const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'proxy_inbound', 'u.id=?', [Number(current.requester_id)]), category: 'proxy_inbound', title: '代入库申请已拒绝', body: `${current.target_name} 已拒绝 ${current.name} 的代入库申请${input.comment ? `：${input.comment}` : ''}`, objectType: 'inbound_request', objectId: id }, now);
        return { inboundRequest, audit, notifications };
      });
      emitCommitted(io, 'inbound-request:changed', committed.inboundRequest, committed.audit, committed.notifications);
      res.json({ request: committed.inboundRequest }); return;
    }

    const committed = transaction(db, () => {
      const updated = db.prepare(`UPDATE inbound_requests SET status='approved',decision_comment=?,version=version+1,updated_at=?,decided_at=?
        WHERE id=? AND status='pending' AND version=?`).run(input.comment ?? null, now, now, id, input.version);
      if (!updated.changes) throw new HttpError(409, '申请状态或版本已变化', 'CONFLICT');
      const result = db.prepare(`INSERT INTO chemicals (name,specification,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'active',?,?)`).run(String(current.name), String(current.specification), Number(current.target_user_id), Number(current.requester_id), String(current.inbound_at), String(current.cabinet), Number(current.shelf), now, now);
      const chemicalId = Number(result.lastInsertRowid);
      db.prepare(`INSERT INTO inventory_movements (chemical_id,operator_id,action,to_cabinet,to_shelf,created_at) VALUES (?,?,'inbound',?,?,?)`).run(chemicalId, Number(current.requester_id), String(current.cabinet), Number(current.shelf), now);
      db.prepare('UPDATE inbound_requests SET chemical_id=? WHERE id=?').run(chemicalId, id);
      const inboundRequest = mapInboundRequest(requestRow(db, id)); const chemical = getChemical(db, chemicalId);
      const approvalAudit = insertAudit(db, { actorId: req.user.id, action: 'proxy_inbound_approved', objectType: 'inbound_request', objectId: id, summary: `同意 ${current.requester_name} 提交的 ${current.name} 代入库申请`, details: { comment: input.comment, chemicalId } }, now);
      const inboundAudit = insertAudit(db, { actorId: Number(current.requester_id), action: 'inventory_inbound', objectType: 'chemical', objectId: chemicalId, summary: `代 ${current.target_name} 入库 ${current.name} 至 ${current.cabinet}-${current.shelf}`, details: { cabinet: current.cabinet, shelf: current.shelf, ownerId: current.target_user_id, inboundRequestId: id } }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'proxy_inbound', 'u.id=?', [Number(current.requester_id)]), category: 'proxy_inbound', title: '代入库申请已同意', body: `${current.target_name} 已同意 ${current.name} 的代入库申请`, objectType: 'inbound_request', objectId: id }, now);
      return { inboundRequest, chemical, audits: [approvalAudit, inboundAudit], notifications };
    });
    io.emit('inbound-request:changed', committed.inboundRequest); io.emit('chemical:changed', committed.chemical);
    for (const audit of committed.audits) io.emit('audit:created', audit); emitNotifications(io, committed.notifications);
    res.json({ request: committed.inboundRequest, chemical: committed.chemical });
  }));

  router.post('/:id/withdraw', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const id = Number(req.params.id); const input = parseBody(versionSchema, req.body); const now = new Date().toISOString();
    const current = requestRow(db, id);
    if (Number(current.requester_id) !== req.user.id) throw new HttpError(403, '只有发起人可以撤销申请', 'FORBIDDEN');
    if (String(current.status) !== 'pending' || Number(current.version) !== input.version) throw new HttpError(409, '申请状态或版本已变化', 'CONFLICT');
    const committed = transaction(db, () => {
      const updated = db.prepare(`UPDATE inbound_requests SET status='withdrawn',version=version+1,updated_at=?,withdrawn_at=?
        WHERE id=? AND status='pending' AND version=?`).run(now, now, id, input.version);
      if (!updated.changes) throw new HttpError(409, '申请状态或版本已变化', 'CONFLICT');
      const inboundRequest = mapInboundRequest(requestRow(db, id));
      const audit = insertAudit(db, { actorId: req.user.id, action: 'proxy_inbound_withdrawn', objectType: 'inbound_request', objectId: id, summary: `撤销向 ${current.target_name} 提交的 ${current.name} 代入库申请`, details: {} }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'proxy_inbound', 'u.id=?', [Number(current.target_user_id)]), category: 'proxy_inbound', title: '代入库申请已撤销', body: `${current.requester_name} 已撤销 ${current.name} 的代入库申请`, objectType: 'inbound_request', objectId: id }, now);
      return { inboundRequest, audit, notifications };
    });
    emitCommitted(io, 'inbound-request:changed', committed.inboundRequest, committed.audit, committed.notifications);
    res.json({ request: committed.inboundRequest });
  }));

  return router;
}
