import { Router } from 'express';
import type { Server as SocketServer } from 'socket.io';
import type { Db } from './database.js';
import { transaction } from './database.js';
import { asyncRoute, type AuthedRequest, HttpError, parseBody } from './http.js';
import { chemicalCorrectionSchema, chemicalCreateSchema, chemicalQuerySchema, discardSchema, moveSchema } from './validation.js';
import { eligibleUserIds, emitCommitted, insertAudit, insertNotifications } from './domain.js';
import { formatLocation } from '../../shared/cabinets.js';
import type { Cabinet } from '../../shared/types.js';

export function mapChemical(row: Record<string, unknown>) {
  return {
    id: Number(row.id), name: String(row.name), specification: String(row.specification),
    casNumber: row.cas_number === null ? null : String(row.cas_number),
    owner: { id: Number(row.owner_id), username: String(row.owner_username), displayName: String(row.owner_name) },
    inboundOperator: { id: Number(row.inbound_operator_id), username: String(row.operator_username), displayName: String(row.operator_name) },
    inboundAt: String(row.inbound_at), cabinet: row.cabinet as Cabinet, shelf: Number(row.shelf), status: row.status as 'active' | 'discarded',
    discardReason: row.discard_reason === null ? null : String(row.discard_reason), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

const chemicalSelect = `SELECT c.*, owner.username owner_username, owner.display_name owner_name,
  operator.username operator_username, operator.display_name operator_name
  FROM chemicals c JOIN users owner ON owner.id=c.owner_id JOIN users operator ON operator.id=c.inbound_operator_id`;

export function getChemical(db: Db, id: number) {
  const row = db.prepare(`${chemicalSelect} WHERE c.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, '药品不存在', 'NOT_FOUND');
  return mapChemical(row);
}

export function inventoryRouter(db: Db, io: SocketServer): Router {
  const router = Router();
  router.get('/', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const query = parseBody(chemicalQuerySchema, req.query);
    const conditions = [`c.status='active'`]; const params: Array<string | number> = [];
    if (query.cabinet !== undefined) {
      conditions.push('c.cabinet=?'); params.push(query.cabinet);
    }
    if (query.shelf !== undefined) {
      conditions.push('c.shelf=?'); params.push(query.shelf);
    }
    if (query.search) {
      conditions.push('(c.name LIKE ? OR c.specification LIKE ? OR c.cas_number LIKE ? OR owner.display_name LIKE ? OR owner.username LIKE ?)');
      const term = `%${query.search}%`; params.push(term, term, term, term, term);
    }
    const rows = db.prepare(`${chemicalSelect} WHERE ${conditions.join(' AND ')} ORDER BY c.cabinet,c.shelf,c.name,c.id`).all(...params) as Array<Record<string, unknown>>;
    res.json({ chemicals: rows.map(mapChemical) });
  }));
  router.get('/:id', asyncRoute((req, res) => {
    const chemical = getChemical(db, Number(req.params.id));
    const movements = db.prepare(`SELECT m.*,u.username operator_username,u.display_name operator_name FROM inventory_movements m JOIN users u ON u.id=m.operator_id WHERE chemical_id=? ORDER BY id DESC`).all(chemical.id);
    res.json({ chemical, movements });
  }));
  router.post('/', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const input = parseBody(chemicalCreateSchema, req.body); const now = new Date().toISOString();
    const ownerId = req.user.id;
    const committed = transaction(db, () => {
      const result = db.prepare(`INSERT INTO chemicals (name,specification,cas_number,owner_id,inbound_operator_id,inbound_at,cabinet,shelf,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'active',?,?)`).run(input.name, input.specification, input.casNumber, ownerId, req.user.id, input.inboundAt, input.cabinet, input.shelf, now, now);
      const id = Number(result.lastInsertRowid);
      db.prepare(`INSERT INTO inventory_movements (chemical_id,operator_id,action,to_cabinet,to_shelf,created_at) VALUES (?,?,'inbound',?,?,?)`).run(id, req.user.id, input.cabinet, input.shelf, now);
      const chemical = getChemical(db, id);
      const audit = insertAudit(db, { actorId: req.user.id, action: 'inventory_inbound', objectType: 'chemical', objectId: id, summary: `入库 ${input.name} 至 ${formatLocation(input.cabinet, input.shelf)}`, details: { cabinet: input.cabinet, shelf: input.shelf, ownerId, casNumber: input.casNumber } }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'inventory_inbound'), category: 'inventory_inbound', title: '药品入库', body: `${input.name} 已入库至 ${input.cabinet} 柜 ${input.shelf} 层`, objectType: 'chemical', objectId: id }, now);
      return { chemical, audit, notifications };
    });
    emitCommitted(io, 'chemical:changed', committed.chemical, committed.audit, committed.notifications);
    res.status(201).json({ chemical: committed.chemical });
  }));
  router.patch('/:id/details', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const id = Number(req.params.id); const input = parseBody(chemicalCorrectionSchema, req.body);
    const current = getChemical(db, id);
    if (current.status !== 'active') throw new HttpError(409, '已废弃药品不能更正', 'CONFLICT');
    if (req.user.role !== 'super_admin' && current.owner.id !== req.user.id) throw new HttpError(403, '只有归属人或超级管理员可以更正药品信息', 'FORBIDDEN');
    if (current.version !== input.version) throw new HttpError(409, '药品已被其他人修改', 'CONFLICT');

    const next = {
      name: input.name ?? current.name,
      specification: input.specification ?? current.specification,
      casNumber: input.casNumber === undefined ? current.casNumber : input.casNumber,
      inboundAt: input.inboundAt ?? current.inboundAt,
    };
    const currentValues = { name: current.name, specification: current.specification, casNumber: current.casNumber, inboundAt: current.inboundAt };
    const fieldLabels = { name: '名称', specification: '规格', casNumber: 'CAS号', inboundAt: '入库时间' } as const;
    type CorrectableField = keyof typeof fieldLabels;
    const changedFields = (Object.keys(fieldLabels) as CorrectableField[]).filter((field) => next[field] !== currentValues[field]);
    if (!changedFields.length) throw new HttpError(400, '没有需要更正的药品信息', 'VALIDATION_ERROR');

    const now = new Date().toISOString();
    const committed = transaction(db, () => {
      const result = db.prepare(`UPDATE chemicals SET name=?,specification=?,cas_number=?,inbound_at=?,version=version+1,updated_at=?
        WHERE id=? AND version=? AND status='active'`).run(next.name, next.specification, next.casNumber, next.inboundAt, now, id, input.version);
      if (!result.changes) throw new HttpError(409, '药品已被其他人修改', 'CONFLICT');
      const chemical = getChemical(db, id);
      const before = Object.fromEntries(changedFields.map((field) => [field, currentValues[field]]));
      const after = Object.fromEntries(changedFields.map((field) => [field, next[field]]));
      const summary = `更正药品信息：${chemical.name}（${changedFields.map((field) => fieldLabels[field]).join('、')}）`;
      const audit = insertAudit(db, { actorId: req.user.id, action: 'inventory_details_corrected', objectType: 'chemical', objectId: id, summary, details: { before, after } }, now);
      return { chemical, audit };
    });
    emitCommitted(io, 'chemical:changed', committed.chemical, committed.audit, []);
    res.json({ chemical: committed.chemical });
  }));
  router.patch('/:id/move', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const id = Number(req.params.id); const input = parseBody(moveSchema, req.body); const now = new Date().toISOString();
    const current = getChemical(db, id); if (current.status !== 'active') throw new HttpError(409, '已废弃药品不能调动', 'CONFLICT');
    if (current.cabinet === input.cabinet && current.shelf === input.shelf) throw new HttpError(400, '目标位置与当前位置相同', 'VALIDATION_ERROR');
    const committed = transaction(db, () => {
      const result = db.prepare('UPDATE chemicals SET cabinet=?,shelf=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=\'active\'').run(input.cabinet, input.shelf, now, id, input.version);
      if (!result.changes) throw new HttpError(409, '药品已被其他人修改', 'CONFLICT');
      db.prepare(`INSERT INTO inventory_movements (chemical_id,operator_id,action,from_cabinet,from_shelf,to_cabinet,to_shelf,created_at) VALUES (?,?,'move',?,?,?,?,?)`).run(id, req.user.id, current.cabinet, current.shelf, input.cabinet, input.shelf, now);
      const chemical = getChemical(db, id);
      const audit = insertAudit(db, { actorId: req.user.id, action: 'inventory_move', objectType: 'chemical', objectId: id, summary: `调动 ${current.name}：${formatLocation(current.cabinet, current.shelf)} → ${formatLocation(input.cabinet, input.shelf)}`, details: { from: { cabinet: current.cabinet, shelf: current.shelf }, to: { cabinet: input.cabinet, shelf: input.shelf } } }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'inventory_move'), category: 'inventory_move', title: '药品调动', body: `${current.name} 已调动至 ${input.cabinet} 柜 ${input.shelf} 层`, objectType: 'chemical', objectId: id }, now);
      return { chemical, audit, notifications };
    });
    emitCommitted(io, 'chemical:changed', committed.chemical, committed.audit, committed.notifications); res.json({ chemical: committed.chemical });
  }));
  router.patch('/:id/discard', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const id = Number(req.params.id); const input = parseBody(discardSchema, req.body); const now = new Date().toISOString();
    const current = getChemical(db, id); if (current.status !== 'active') throw new HttpError(409, '药品已经废弃', 'CONFLICT');
    const committed = transaction(db, () => {
      const result = db.prepare(`UPDATE chemicals SET status='discarded',discard_reason=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status='active'`).run(input.reason ?? null, now, id, input.version);
      if (!result.changes) throw new HttpError(409, '药品已被其他人修改', 'CONFLICT');
      db.prepare(`INSERT INTO inventory_movements (chemical_id,operator_id,action,from_cabinet,from_shelf,reason,created_at) VALUES (?,?,'discard',?,?,?,?)`).run(id, req.user.id, current.cabinet, current.shelf, input.reason ?? null, now);
      const chemical = getChemical(db, id);
      const audit = insertAudit(db, { actorId: req.user.id, action: 'inventory_discard', objectType: 'chemical', objectId: id, summary: `废弃 ${current.name}`, details: { location: { cabinet: current.cabinet, shelf: current.shelf }, reason: input.reason ?? null } }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'inventory_discard'), category: 'inventory_discard', title: '药品废弃', body: `${current.name} 已废弃`, objectType: 'chemical', objectId: id }, now);
      return { chemical, audit, notifications };
    });
    emitCommitted(io, 'chemical:changed', committed.chemical, committed.audit, committed.notifications); res.json({ chemical: committed.chemical });
  }));
  return router;
}
