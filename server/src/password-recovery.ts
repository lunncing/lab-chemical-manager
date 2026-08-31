import { Router } from 'express';
import type { Server as SocketServer } from 'socket.io';
import type { Db } from './database.js';
import { transaction } from './database.js';
import { eligibleUserIds, emitCommitted, insertAudit, insertNotifications } from './domain.js';
import { asyncRoute, type AuthedRequest, HttpError, parseBody, roleRequired } from './http.js';
import { createRecoveryToken, digestToken, hashPassword, verifyPassword } from './security.js';
import {
  passwordChangeWithCurrentSchema, passwordRecoveryAppealSchema, passwordRecoveryLookupSchema,
  passwordResetApprovedSchema, passwordResetDecisionSchema,
} from './validation.js';

const unresolvedStatuses = ['pending', 'approved', 'rejected', 'appealed'] as const;
type RecoveryState = (typeof unresolvedStatuses)[number];

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function recoveryCookie(token: string, expires: Date, secure: boolean): string {
  return `lab_password_recovery=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`;
}

function clearRecoveryCookie(secure: boolean): string {
  return `lab_password_recovery=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

const requestSelect = `SELECT r.*,
  u.username user_username,u.display_name user_display_name,
  reviewer.username reviewer_username,reviewer.display_name reviewer_display_name
  FROM password_reset_requests r
  JOIN users u ON u.id=r.user_id
  LEFT JOIN users reviewer ON reviewer.id=r.reviewer_id`;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function passwordResetRequestView(db: Db, id: number): Record<string, unknown> {
  const row = db.prepare(`${requestSelect} WHERE r.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, '密码修改申请不存在', 'NOT_FOUND');
  return {
    id: Number(row.id),
    user: { id: Number(row.user_id), username: String(row.user_username), displayName: String(row.user_display_name) },
    status: String(row.status),
    appealReason: nullableString(row.appeal_reason),
    reviewer: row.reviewer_id === null ? null : {
      id: Number(row.reviewer_id), username: String(row.reviewer_username), displayName: String(row.reviewer_display_name),
    },
    reviewComment: nullableString(row.review_comment),
    version: Number(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), expiresAt: String(row.expires_at),
    reviewedAt: nullableString(row.reviewed_at), consumedAt: nullableString(row.consumed_at),
  };
}

function passwordResetRequestEvent(request: Record<string, unknown>): Record<string, unknown> {
  return { id: Number(request.id), status: String(request.status), version: Number(request.version), updatedAt: String(request.updatedAt) };
}

function matchingActiveUsers(db: Db, displayName: string): Array<Record<string, unknown>> {
  return db.prepare(`SELECT * FROM users WHERE display_name=? AND active=1 AND deleted_at IS NULL ORDER BY id`).all(displayName) as Array<Record<string, unknown>>;
}

function recoveryUnauthorized(): HttpError {
  return new HttpError(401, '密码恢复凭据无效或已失效', 'RECOVERY_NOT_AUTHORIZED');
}

function recoveryStateConflict(): HttpError {
  return new HttpError(409, '密码恢复申请状态已变化，请重新开始', 'RECOVERY_STATE_CONFLICT');
}

function expireMatchingRequest(db: Db, io: SocketServer, id: number, version: number, now: string): boolean {
  const changed = transaction(db, () => db.prepare(`UPDATE password_reset_requests
    SET status='expired',version=version+1,updated_at=?
    WHERE id=? AND version=? AND status IN ('pending','approved','rejected','appealed') AND expires_at<=?`).run(now, id, version, now).changes === 1);
  if (changed) io.emit('password-reset-request:changed', passwordResetRequestEvent(passwordResetRequestView(db, id)));
  return changed;
}

function expireOverdueRequests(db: Db, io: SocketServer, now: string): number[] {
  const candidates = db.prepare(`SELECT id,version FROM password_reset_requests
    WHERE status IN ('pending','approved','rejected','appealed') AND expires_at<=? ORDER BY id`).all(now) as Array<{ id: number; version: number }>;
  if (!candidates.length) return [];
  const expired = transaction(db, () => {
    const ids: number[] = [];
    const update = db.prepare(`UPDATE password_reset_requests SET status='expired',version=version+1,updated_at=?
      WHERE id=? AND version=? AND status IN ('pending','approved','rejected','appealed') AND expires_at<=?`);
    for (const candidate of candidates) {
      if (update.run(now, candidate.id, candidate.version, now).changes === 1) ids.push(Number(candidate.id));
    }
    return ids;
  });
  for (const id of expired) io.emit('password-reset-request:changed', passwordResetRequestEvent(passwordResetRequestView(db, id)));
  return expired;
}

export function passwordRecoveryPublicRouter(db: Db, io: SocketServer, cookieSecure = false): Router {
  const router = Router();

  router.post('/lookup', asyncRoute((request, res) => {
    const input = parseBody(passwordRecoveryLookupSchema, request.body);
    const users = matchingActiveUsers(db, input.displayName);
    if (users.length === 0) throw new HttpError(404, '未找到可用账号', 'NOT_FOUND');
    if (users.length > 1) throw new HttpError(409, '存在同名账号，请联系管理员', 'AMBIGUOUS_DISPLAY_NAME');
    const token = cookieValue(request.headers.cookie, 'lab_password_recovery');
    if (!token) return res.json({ state: 'verify_current' });
    const row = db.prepare(`SELECT id,status,version,expires_at FROM password_reset_requests
      WHERE user_id=? AND recovery_token_hash=? ORDER BY id DESC LIMIT 1`).get(Number(users[0]!.id), digestToken(token)) as {
        id: number; status: string; version: number; expires_at: string;
      } | undefined;
    if (!row || !unresolvedStatuses.includes(row.status as RecoveryState)) return res.json({ state: 'verify_current' });
    const now = new Date().toISOString();
    if (row.expires_at <= now) {
      expireMatchingRequest(db, io, Number(row.id), Number(row.version), now);
      return res.json({ state: 'verify_current' });
    }
    return res.json({ state: row.status });
  }));

  router.post('/change-with-current', asyncRoute((request, res) => {
    const input = parseBody(passwordChangeWithCurrentSchema, request.body);
    const users = matchingActiveUsers(db, input.displayName);
    const user = users.length === 1 ? users[0]! : undefined;
    if (!user || !verifyPassword(input.currentPassword, String(user.password_hash))) {
      throw new HttpError(401, '姓名或原密码错误', 'INVALID_CREDENTIALS');
    }
    const now = new Date().toISOString();
    const passwordHash = hashPassword(input.newPassword);
    const committed = transaction(db, () => {
      const recoveryIds = (db.prepare(`SELECT id FROM password_reset_requests WHERE user_id=?
        AND status IN ('pending','approved','rejected','appealed')`).all(Number(user.id)) as Array<{ id: number }>).map(({ id }) => Number(id));
      const changed = db.prepare(`UPDATE users SET password_hash=?,version=version+1,updated_at=?
        WHERE id=? AND version=? AND password_hash=? AND active=1 AND deleted_at IS NULL`).run(
        passwordHash, now, Number(user.id), Number(user.version), String(user.password_hash),
      );
      if (changed.changes !== 1) throw new HttpError(409, '密码修改状态已变化，请重试', 'CONFLICT');
      db.prepare(`UPDATE password_reset_requests SET status='expired',version=version+1,updated_at=?
        WHERE user_id=? AND status IN ('pending','approved','rejected','appealed')`).run(now, Number(user.id));
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(Number(user.id));
      const audit = insertAudit(db, {
        actorId: Number(user.id), action: 'password_changed', objectType: 'user', objectId: Number(user.id),
        summary: `${String(user.display_name)} 已使用原密码修改密码`, details: { method: 'current_password' },
      }, now);
      return { audit, recoveryIds };
    });
    io.emit('audit:created', committed.audit);
    for (const id of committed.recoveryIds) io.emit('password-reset-request:changed', passwordResetRequestEvent(passwordResetRequestView(db, id)));
    io.in(`user:${Number(user.id)}`).disconnectSockets(true);
    res.json({ changed: true });
  }));

  router.post('/request', asyncRoute((request, res) => {
    const input = parseBody(passwordRecoveryLookupSchema, request.body);
    const users = matchingActiveUsers(db, input.displayName);
    if (users.length === 0) throw new HttpError(404, '未找到可用账号', 'NOT_FOUND');
    if (users.length > 1) throw new HttpError(409, '存在同名账号，请联系管理员', 'AMBIGUOUS_DISPLAY_NAME');
    const user = users[0]!;
    const token = createRecoveryToken();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 86_400_000);
    let committed;
    try {
      committed = transaction(db, () => {
        const expiredIds = (db.prepare(`SELECT id FROM password_reset_requests WHERE user_id=?
          AND status IN ('pending','approved','rejected','appealed') AND expires_at<=?`).all(Number(user.id), now) as Array<{ id: number }>).map(({ id }) => Number(id));
        db.prepare(`UPDATE password_reset_requests SET status='expired',version=version+1,updated_at=? WHERE user_id=?
          AND status IN ('pending','approved','rejected','appealed') AND expires_at<=?`).run(now, Number(user.id), now);
        const unresolved = db.prepare(`SELECT id FROM password_reset_requests WHERE user_id=?
          AND status IN ('pending','approved','rejected','appealed') LIMIT 1`).get(Number(user.id));
        if (unresolved) throw new HttpError(409, '已有未完成的密码修改申请', 'CONFLICT');
        const result = db.prepare(`INSERT INTO password_reset_requests
          (user_id,recovery_token_hash,status,created_at,updated_at,expires_at)
          VALUES (?,?,'pending',?,?,?)`).run(Number(user.id), digestToken(token), now, now, expires.toISOString());
        const id = Number(result.lastInsertRowid);
        const audit = insertAudit(db, {
          actorId: Number(user.id), action: 'password_reset_requested', objectType: 'password_reset_request', objectId: id,
          summary: `收到针对 ${String(user.display_name)} 的密码修改申请`,
          details: { subjectUserId: Number(user.id), status: 'pending', source: 'public_password_recovery', identityVerified: false },
        }, now);
        const notifications = insertNotifications(db, {
          userIds: eligibleUserIds(db, 'password_reset', `u.role IN ('normal_admin','super_admin')`),
          category: 'password_reset', title: '密码修改申请',
          body: `收到针对 ${String(user.display_name)} (@${String(user.username)}) 的密码修改申请，请先人工核实身份`,
          objectType: 'password_reset_request', objectId: id,
        }, now);
        return { request: passwordResetRequestView(db, id), audit, notifications, expiredIds };
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new HttpError(409, '已有未完成的密码修改申请', 'CONFLICT');
      }
      throw error;
    }
    for (const id of committed.expiredIds) io.emit('password-reset-request:changed', passwordResetRequestEvent(passwordResetRequestView(db, id)));
    emitCommitted(io, 'password-reset-request:changed', passwordResetRequestEvent(committed.request), committed.audit, committed.notifications);
    res.setHeader('Set-Cookie', recoveryCookie(token, expires, cookieSecure));
    res.status(201).json({ state: 'pending' });
  }));

  router.post('/appeal', asyncRoute((request, res) => {
    const input = parseBody(passwordRecoveryAppealSchema, request.body);
    const token = cookieValue(request.headers.cookie, 'lab_password_recovery');
    if (!token) throw recoveryUnauthorized();
    const tokenHash = digestToken(token);
    const current = db.prepare(`SELECT r.*,u.username,u.display_name,u.active,u.deleted_at FROM password_reset_requests r
      JOIN users u ON u.id=r.user_id WHERE r.recovery_token_hash=?`).get(tokenHash) as Record<string, unknown> | undefined;
    if (!current) throw recoveryUnauthorized();
    const now = new Date().toISOString();
    if (unresolvedStatuses.includes(String(current.status) as RecoveryState) && String(current.expires_at) <= now) {
      expireMatchingRequest(db, io, Number(current.id), Number(current.version), now);
      throw recoveryStateConflict();
    }
    if (!Boolean(current.active) || current.deleted_at !== null || current.status !== 'rejected') throw recoveryStateConflict();
    const committed = transaction(db, () => {
      const updated = db.prepare(`UPDATE password_reset_requests SET status='appealed',appeal_reason=?,updated_at=?,version=version+1
        WHERE id=? AND user_id=? AND recovery_token_hash=? AND status='rejected' AND version=? AND expires_at>?`).run(
        input.reason, now, Number(current.id), Number(current.user_id), tokenHash, Number(current.version), now,
      );
      if (updated.changes !== 1) throw recoveryStateConflict();
      const audit = insertAudit(db, {
        actorId: Number(current.user_id), action: 'password_reset_appealed', objectType: 'password_reset_request', objectId: Number(current.id),
        summary: `收到针对 ${String(current.display_name)} 的密码修改申诉`,
        details: { subjectUserId: Number(current.user_id), status: 'appealed', source: 'public_password_recovery', identityVerified: false },
      }, now);
      const notifications = insertNotifications(db, {
        userIds: eligibleUserIds(db, 'password_reset', `u.role IN ('normal_admin','super_admin')`),
        category: 'password_reset', title: '密码修改申诉',
        body: `收到针对 ${String(current.display_name)} (@${String(current.username)}) 的密码修改申诉，请再次人工核实身份`,
        objectType: 'password_reset_request', objectId: Number(current.id),
      }, now);
      return { request: passwordResetRequestView(db, Number(current.id)), audit, notifications };
    });
    emitCommitted(io, 'password-reset-request:changed', passwordResetRequestEvent(committed.request), committed.audit, committed.notifications);
    res.json({ state: 'appealed' });
  }));

  router.post('/reset-approved', asyncRoute((request, res) => {
    const input = parseBody(passwordResetApprovedSchema, request.body);
    const token = cookieValue(request.headers.cookie, 'lab_password_recovery');
    if (!token) throw recoveryUnauthorized();
    const tokenHash = digestToken(token);
    const current = db.prepare(`SELECT r.*,u.username,u.display_name,u.password_hash,u.version user_version,u.active,u.deleted_at
      FROM password_reset_requests r JOIN users u ON u.id=r.user_id WHERE r.recovery_token_hash=?`).get(tokenHash) as Record<string, unknown> | undefined;
    if (!current) throw recoveryUnauthorized();
    const now = new Date().toISOString();
    if (unresolvedStatuses.includes(String(current.status) as RecoveryState) && String(current.expires_at) <= now) {
      expireMatchingRequest(db, io, Number(current.id), Number(current.version), now);
      throw recoveryStateConflict();
    }
    if (!Boolean(current.active) || current.deleted_at !== null || current.status !== 'approved') throw recoveryStateConflict();
    const passwordHash = hashPassword(input.newPassword);
    const committed = transaction(db, () => {
      const consumed = db.prepare(`UPDATE password_reset_requests SET status='consumed',consumed_at=?,updated_at=?,version=version+1
        WHERE id=? AND user_id=? AND recovery_token_hash=? AND status='approved' AND version=? AND expires_at>?`).run(
        now, now, Number(current.id), Number(current.user_id), tokenHash, Number(current.version), now,
      );
      if (consumed.changes !== 1) throw recoveryStateConflict();
      const passwordChanged = db.prepare(`UPDATE users SET password_hash=?,updated_at=?,version=version+1
        WHERE id=? AND version=? AND password_hash=? AND active=1 AND deleted_at IS NULL`).run(
        passwordHash, now, Number(current.user_id), Number(current.user_version), String(current.password_hash),
      );
      if (passwordChanged.changes !== 1) throw recoveryStateConflict();
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(Number(current.user_id));
      const audit = insertAudit(db, {
        actorId: Number(current.user_id), action: 'password_reset_consumed', objectType: 'password_reset_request', objectId: Number(current.id),
        summary: `${String(current.display_name)} 已通过批准申请重置密码`,
        details: { method: 'approved_recovery', userId: Number(current.user_id) },
      }, now);
      return { request: passwordResetRequestView(db, Number(current.id)), audit };
    });
    emitCommitted(io, 'password-reset-request:changed', passwordResetRequestEvent(committed.request), committed.audit, []);
    io.in(`user:${Number(current.user_id)}`).disconnectSockets(true);
    res.setHeader('Set-Cookie', clearRecoveryCookie(cookieSecure));
    res.json({ changed: true });
  }));

  return router;
}

export function passwordResetRequestsRouter(db: Db, io: SocketServer): Router {
  const router = Router();
  router.use(roleRequired('normal_admin', 'super_admin'));

  router.get('/', (_request, res) => {
    expireOverdueRequests(db, io, new Date().toISOString());
    const rows = db.prepare(`SELECT r.id FROM password_reset_requests r JOIN users u ON u.id=r.user_id
      WHERE r.status IN ('pending','appealed') AND u.active=1 AND u.deleted_at IS NULL
      ORDER BY r.created_at,r.id`).all() as Array<{ id: number }>;
    res.json({ requests: rows.map(({ id }) => passwordResetRequestView(db, Number(id))) });
  });

  router.post('/:id/decision', asyncRoute((request, res) => {
    const req = request as AuthedRequest;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, '密码修改申请不存在', 'NOT_FOUND');
    const input = parseBody(passwordResetDecisionSchema, req.body);
    const now = new Date().toISOString();
    expireOverdueRequests(db, io, now);
    const current = db.prepare(`SELECT r.*,u.username,u.display_name,u.active,u.deleted_at FROM password_reset_requests r
      JOIN users u ON u.id=r.user_id WHERE r.id=?`).get(id) as Record<string, unknown> | undefined;
    if (!current) throw new HttpError(404, '密码修改申请不存在', 'NOT_FOUND');
    if (!Boolean(current.active) || current.deleted_at !== null || !['pending', 'appealed'].includes(String(current.status)) || Number(current.version) !== input.version) {
      throw new HttpError(409, '申请状态已变化，请刷新后重试', 'CONFLICT');
    }
    const committed = transaction(db, () => {
      const updated = db.prepare(`UPDATE password_reset_requests SET status=?,reviewer_id=?,review_comment=?,reviewed_at=?,
        updated_at=?,version=version+1 WHERE id=? AND version=? AND status IN ('pending','appealed') AND expires_at>?`).run(
        input.decision, req.user.id, input.comment || null, now, now, id, input.version, now,
      );
      if (updated.changes !== 1) throw new HttpError(409, '申请状态已变化，请刷新后重试', 'CONFLICT');
      const approved = input.decision === 'approved';
      const audit = insertAudit(db, {
        actorId: req.user.id, action: approved ? 'password_reset_approved' : 'password_reset_rejected',
        objectType: 'password_reset_request', objectId: id,
        summary: `${String(current.display_name)} 的密码修改申请已${approved ? '批准' : '拒绝'}`,
        details: { userId: Number(current.user_id), fromStatus: String(current.status), status: input.decision },
      }, now);
      const notifications = insertNotifications(db, {
        userIds: eligibleUserIds(db, 'password_reset', 'u.id=?', [Number(current.user_id)]), category: 'password_reset',
        title: approved ? '密码修改申请已批准' : '密码修改申请已拒绝',
        body: approved ? '您的密码修改申请已批准，请在原浏览器继续设置新密码' : `您的密码修改申请已拒绝：${input.comment}`,
        objectType: 'password_reset_request', objectId: id,
      }, now);
      return { request: passwordResetRequestView(db, id), audit, notifications };
    });
    emitCommitted(io, 'password-reset-request:changed', passwordResetRequestEvent(committed.request), committed.audit, committed.notifications);
    res.json({ request: committed.request });
  }));

  return router;
}
