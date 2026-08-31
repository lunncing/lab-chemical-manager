import { Router } from 'express';
import type { Server as SocketServer } from 'socket.io';
import type { Db } from './database.js';
import { transaction } from './database.js';
import { asyncRoute, type AuthedRequest, HttpError, parseBody } from './http.js';
import { mapNotification } from './domain.js';
import { preferencesSchema } from './validation.js';
import { notificationCategories } from '../../shared/types.js';

function unreadCount(db: Db, userId: number): number {
  const row = db.prepare('SELECT COUNT(*) count FROM notifications WHERE user_id=? AND read_at IS NULL').get(userId) as { count: number };
  return Number(row.count);
}

export function notificationsRouter(db: Db, io: SocketServer): Router {
  const router = Router();
  router.get('/', (request, res) => {
    const req = request as AuthedRequest;
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 500').all(req.user.id) as Array<Record<string, unknown>>;
    res.json({ notifications: rows.map(mapNotification), unreadCount: unreadCount(db, req.user.id) });
  });
  router.get('/unread-count', (request, res) => {
    const req = request as AuthedRequest;
    res.json({ unreadCount: unreadCount(db, req.user.id) });
  });
  router.patch('/:id/read', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const now = new Date().toISOString();
    const result = db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?').run(now, Number(req.params.id), req.user.id);
    if (!result.changes) throw new HttpError(404, '消息不存在', 'NOT_FOUND');
    io.to(`user:${req.user.id}`).emit('notifications:read', { id: Number(req.params.id), readAt: now }); res.status(204).end();
  }));
  router.post('/read-all', (request, res) => {
    const req = request as AuthedRequest; const now = new Date().toISOString();
    db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now, req.user.id);
    io.to(`user:${req.user.id}`).emit('notifications:read-all', { readAt: now }); res.status(204).end();
  });
  router.get('/preferences', (request, res) => {
    const req = request as AuthedRequest; const rows = db.prepare('SELECT category,enabled FROM notification_preferences WHERE user_id=?').all(req.user.id) as Array<{ category: string; enabled: number }>;
    const stored = new Map(rows.map((row) => [row.category, Boolean(row.enabled)]));
    res.json({ preferences: notificationCategories.map((category) => ({ category, enabled: stored.get(category) ?? true })) });
  });
  router.put('/preferences', asyncRoute((request, res) => {
    const req = request as AuthedRequest; const input = parseBody(preferencesSchema, req.body); const now = new Date().toISOString();
    transaction(db, () => db.prepare(`INSERT INTO notification_preferences (user_id,category,enabled,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id,category) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`).run(req.user.id, input.category, Number(input.enabled), now));
    io.to(`user:${req.user.id}`).emit('preferences:changed', input); res.json(input);
  }));
  return router;
}
