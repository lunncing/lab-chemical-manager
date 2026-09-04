import { randomBytes } from 'node:crypto';
import { transaction, type Db } from './database.js';
import { insertAudit } from './domain.js';
import { HttpError } from './http.js';
import { hashPassword } from './security.js';

export interface DeletedAccount {
  id: number;
  mode: 'login_identity_removed_display_name_retained';
}

interface AccountDeletionCommit {
  deleted: DeletedAccount;
  audit: Record<string, unknown>;
}

function unusedDeletedUsername(db: Db, id: number): string {
  for (;;) {
    const candidate = `deleted-${id}-${randomBytes(24).toString('base64url')}`;
    if (!db.prepare('SELECT 1 FROM users WHERE username=?').get(candidate)) return candidate;
  }
}

export function deleteAccount(db: Db, actorId: number, id: number, now = new Date().toISOString()): AccountDeletionCommit {
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, '账号不存在', 'NOT_FOUND');
  if (id === actorId) throw new HttpError(400, '不能删除当前账号', 'VALIDATION_ERROR');

  return transaction(db, () => {
    const current = db.prepare('SELECT id,role,active FROM users WHERE id=? AND deleted_at IS NULL').get(id) as { id: number; role: string; active: number } | undefined;
    if (!current) throw new HttpError(404, '账号不存在', 'NOT_FOUND');

    if (current.role === 'super_admin' && Number(current.active) === 1) {
      const remaining = db.prepare(`SELECT COUNT(*) count FROM users
        WHERE role='super_admin' AND active=1 AND deleted_at IS NULL`).get() as { count: number };
      if (Number(remaining.count) <= 1) throw new HttpError(409, '不能删除最后一个启用的超级管理员', 'CONFLICT');
    }

    const deletedUsername = unusedDeletedUsername(db, id);
    const deletedPasswordHash = hashPassword(randomBytes(48).toString('base64url'));
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM notifications WHERE user_id=?').run(id);
    db.prepare('DELETE FROM notification_preferences WHERE user_id=?').run(id);
    const updated = db.prepare(`UPDATE users
      SET username=?,password_hash=?,active=0,demo=0,deleted_at=?,version=version+1,updated_at=?
      WHERE id=? AND deleted_at IS NULL`).run(deletedUsername, deletedPasswordHash, now, now, id);
    if (updated.changes !== 1) throw new HttpError(404, '账号不存在', 'NOT_FOUND');

    const deleted: DeletedAccount = { id, mode: 'login_identity_removed_display_name_retained' };
    const audit = insertAudit(db, {
      actorId, action: 'account_deleted', objectType: 'user', objectId: id,
      summary: `账号 #${id} 登录身份已删除，历史姓名保留`, details: { mode: deleted.mode },
    }, now);
    return { deleted, audit };
  });
}
