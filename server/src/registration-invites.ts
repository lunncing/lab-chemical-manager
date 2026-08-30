import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Server as SocketServer } from 'socket.io';
import type { Db } from './database.js';
import { transaction } from './database.js';
import { emitCommitted, insertAudit } from './domain.js';
import { asyncRoute, type AuthedRequest, HttpError, parseBody, roleRequired } from './http.js';
import { registrationInviteCreateSchema, versionSchema } from './validation.js';

const INVITE_PREFIX = 'LSF-';
const INVITE_RANDOM_BYTES = 24;
export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreatedRegistrationInvite {
  id: number;
  code: string;
  codeHint: string;
  createdAt: string;
  expiresAt: string;
  version: number;
}

export function canonicalizeInviteCode(code: string): string {
  return code.trim();
}

export function digestInviteCode(code: string): string {
  return createHash('sha256').update(canonicalizeInviteCode(code), 'utf8').digest('hex');
}

export function inviteCodeHint(code: string): string {
  const body = canonicalizeInviteCode(code).slice(INVITE_PREFIX.length);
  return `${INVITE_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}`;
}

export function createRegistrationInvite(db: Db, createdBy: number, now = new Date()): CreatedRegistrationInvite {
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS).toISOString();
  for (;;) {
    const code = `${INVITE_PREFIX}${randomBytes(INVITE_RANDOM_BYTES).toString('base64url')}`;
    const codeHint = inviteCodeHint(code);
    try {
      const result = db.prepare(`INSERT INTO registration_invites (code_hash,code_hint,created_by,created_at,expires_at)
        VALUES (?,?,?,?,?)`).run(digestInviteCode(code), codeHint, createdBy, createdAt, expiresAt);
      return { id: Number(result.lastInsertRowid), code, codeHint, createdAt, expiresAt, version: 1 };
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: registration_invites.code_hash')) continue;
      throw error;
    }
  }
}

function inviteStatus(row: Record<string, unknown>, now: string): 'active' | 'used' | 'revoked' | 'expired' {
  if (row.used_at !== null) return 'used';
  if (row.revoked_at !== null) return 'revoked';
  if (String(row.expires_at) <= now) return 'expired';
  return 'active';
}

function mapInvite(row: Record<string, unknown>, now = new Date().toISOString()) {
  return {
    id: Number(row.id), codeHint: String(row.code_hint),
    creator: { id: Number(row.created_by), username: String(row.creator_username), displayName: String(row.creator_name) },
    createdAt: String(row.created_at), expiresAt: String(row.expires_at), status: inviteStatus(row, now),
    usedBy: row.used_by === null ? null : { id: Number(row.used_by), username: String(row.used_username), displayName: String(row.used_name) },
    usedAt: row.used_at === null ? null : String(row.used_at),
    revokedAt: row.revoked_at === null ? null : String(row.revoked_at), version: Number(row.version),
  };
}

const inviteSelect = `SELECT i.*, creator.username creator_username, creator.display_name creator_name,
  used.username used_username, used.display_name used_name
  FROM registration_invites i JOIN users creator ON creator.id=i.created_by LEFT JOIN users used ON used.id=i.used_by`;

export function registrationInviteView(db: Db, id: number, now?: string) {
  const row = db.prepare(`${inviteSelect} WHERE i.id=?`).get(id) as Record<string, unknown> | undefined;
  return row ? mapInvite(row, now) : undefined;
}

export function registrationInvitesRouter(db: Db, io: SocketServer): Router {
  const router = Router();
  router.use(roleRequired('normal_admin', 'super_admin'));

  router.post('/', asyncRoute((request, res) => {
    const req = request as AuthedRequest;
    parseBody(registrationInviteCreateSchema, req.body ?? {});
    const now = new Date();
    const committed = transaction(db, () => {
      const created = createRegistrationInvite(db, req.user.id, now);
      const audit = insertAudit(db, {
        actorId: req.user.id, action: 'registration_invite_created', objectType: 'registration_invite', objectId: created.id,
        summary: `生成邀请码 ${created.codeHint}`, details: { inviteId: created.id, hint: created.codeHint, expiresAt: created.expiresAt },
      }, created.createdAt);
      return { created, invite: registrationInviteView(db, created.id, created.createdAt)!, audit };
    });
    emitCommitted(io, 'registration-invite:changed', committed.invite, committed.audit, []);
    res.status(201).json({ invite: committed.created });
  }));

  router.get('/', (request, res) => {
    const req = request as AuthedRequest;
    const rows = db.prepare(`${inviteSelect}${req.user.role === 'normal_admin' ? ' WHERE i.created_by=?' : ''} ORDER BY i.id DESC`).all(...(req.user.role === 'normal_admin' ? [req.user.id] : [])) as Array<Record<string, unknown>>;
    const now = new Date().toISOString();
    res.json({ invites: rows.map((row) => mapInvite(row, now)) });
  });

  router.post('/:id/revoke', asyncRoute((request, res) => {
    const req = request as AuthedRequest;
    const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, '邀请码不存在', 'NOT_FOUND');
    const input = parseBody(versionSchema, req.body);
    const current = db.prepare('SELECT * FROM registration_invites WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!current) throw new HttpError(404, '邀请码不存在', 'NOT_FOUND');
    if (req.user.role === 'normal_admin' && Number(current.created_by) !== req.user.id) throw new HttpError(403, '权限不足', 'FORBIDDEN');
    const now = new Date().toISOString();
    if (Number(current.version) !== input.version || inviteStatus(current, now) !== 'active') throw new HttpError(409, '邀请码状态已变化', 'CONFLICT');
    const committed = transaction(db, () => {
      const result = db.prepare(`UPDATE registration_invites SET revoked_by=?,revoked_at=?,version=version+1
        WHERE id=? AND version=? AND used_by IS NULL AND revoked_at IS NULL AND expires_at>?`).run(req.user.id, now, id, input.version, now);
      if (result.changes !== 1) throw new HttpError(409, '邀请码状态已变化', 'CONFLICT');
      const invite = registrationInviteView(db, id, now)!;
      const audit = insertAudit(db, {
        actorId: req.user.id, action: 'registration_invite_revoked', objectType: 'registration_invite', objectId: id,
        summary: `撤销邀请码 ${invite.codeHint}`, details: { inviteId: id, hint: invite.codeHint },
      }, now);
      return { invite, audit };
    });
    emitCommitted(io, 'registration-invite:changed', committed.invite, committed.audit, []);
    res.json({ invite: committed.invite });
  }));
  return router;
}
