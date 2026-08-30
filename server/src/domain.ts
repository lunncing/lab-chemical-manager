import type { Server as SocketServer } from 'socket.io';
import type { Db } from './database.js';
import type { NotificationCategory } from '../../shared/types.js';

export interface AuditInput { actorId: number; action: string; objectType: string; objectId: string | number; summary: string; details?: unknown; }

export function insertAudit(db: Db, input: AuditInput, now = new Date().toISOString()): Record<string, unknown> {
  const result = db.prepare(`INSERT INTO audit_logs (actor_id,action,object_type,object_id,summary,details_json,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(input.actorId, input.action, input.objectType, String(input.objectId), input.summary, JSON.stringify(input.details ?? {}), now);
  return mapAudit(db.prepare(`SELECT a.*, u.username actor_username, u.display_name actor_name FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.id=?`).get(Number(result.lastInsertRowid)) as Record<string, unknown>);
}

export function mapAudit(row: Record<string, unknown>) {
  return { id: Number(row.id), actor: { id: Number(row.actor_id), username: String(row.actor_username), displayName: String(row.actor_name) }, action: String(row.action),
    objectType: String(row.object_type), objectId: String(row.object_id), summary: String(row.summary), details: JSON.parse(String(row.details_json)), createdAt: String(row.created_at) };
}

interface NotifyInput { userIds: number[]; category: NotificationCategory; title: string; body: string; objectType?: string; objectId?: string | number; }

export function eligibleUserIds(db: Db, category: NotificationCategory, clause = '1=1', params: Array<string | number> = []): number[] {
  const rows = db.prepare(`SELECT u.id FROM users u WHERE u.active=1 AND u.deleted_at IS NULL AND (${clause}) AND NOT EXISTS (
    SELECT 1 FROM notification_preferences p WHERE p.user_id=u.id AND p.category=? AND p.enabled=0
  )`).all(...params, category) as Array<{ id: number }>;
  return rows.map((row) => Number(row.id));
}

export function insertNotifications(db: Db, input: NotifyInput, now = new Date().toISOString()): Array<Record<string, unknown>> {
  const unique = [...new Set(input.userIds)];
  const statement = db.prepare(`INSERT INTO notifications (user_id,category,title,body,object_type,object_id,created_at) VALUES (?,?,?,?,?,?,?)`);
  return unique.map((userId) => {
    const result = statement.run(userId, input.category, input.title, input.body, input.objectType ?? null, input.objectId === undefined ? null : String(input.objectId), now);
    return mapNotification(db.prepare('SELECT * FROM notifications WHERE id=?').get(Number(result.lastInsertRowid)) as Record<string, unknown>);
  });
}

export function mapNotification(row: Record<string, unknown>) {
  return { id: Number(row.id), userId: Number(row.user_id), category: String(row.category), title: String(row.title), body: String(row.body),
    objectType: row.object_type === null ? null : String(row.object_type), objectId: row.object_id === null ? null : String(row.object_id), readAt: row.read_at === null ? null : String(row.read_at), createdAt: String(row.created_at) };
}

export function emitCommitted(io: SocketServer, entityEvent: string, entity: unknown, audit: unknown, notifications: Array<Record<string, unknown>>): void {
  io.emit(entityEvent, entity);
  io.emit('audit:created', audit);
  for (const notification of notifications) io.to(`user:${notification.userId}`).emit('notification:created', notification);
}
