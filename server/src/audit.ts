import { Router } from 'express';
import type { Db } from './database.js';
import { mapAudit } from './domain.js';

export function auditRouter(db: Db): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    const rows = db.prepare(`SELECT a.*,u.username actor_username,u.display_name actor_name FROM audit_logs a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 500`).all() as Array<Record<string, unknown>>;
    res.json({ logs: rows.map(mapAudit) });
  });
  return router;
}
