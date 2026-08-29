import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Server as SocketServer } from 'socket.io';
import { openDatabase, transaction, type Db, userView } from './database.js';
import { createSessionToken, digestToken, hashPassword, verifyPassword } from './security.js';
import { asyncRoute, type AuthedRequest, HttpError, parseBody, roleRequired } from './http.js';
import { loginSchema, userCreateSchema, userUpdateSchema } from './validation.js';
import { inventoryRouter } from './inventory.js';
import { auditRouter } from './audit.js';
import { notificationsRouter } from './notifications.js';
import { purchasesRouter } from './purchases.js';
import { eligibleUserIds, emitCommitted, insertAudit, insertNotifications } from './domain.js';

export interface RunningSystem { app: express.Express; httpServer: HttpServer; io: SocketServer; db: Db; close(): Promise<void>; }
export interface SystemOptions { databasePath: string; seedDemo?: boolean; cookieSecure?: boolean; sessionDays?: number; }

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function createSystem(options: SystemOptions): RunningSystem {
  const db = openDatabase(options.databasePath, options.seedDemo ?? true);
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { path: '/socket.io' });
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  const getUserFromCookie = (header: string | undefined) => {
    const token = cookieValue(header, 'lab_session');
    if (!token) return undefined;
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(digestToken(token), new Date().toISOString()) as Record<string, unknown> | undefined;
    return row ? userView(row) : undefined;
  };

  const authenticate = (request: Request, _response: Response, next: NextFunction) => {
    const user = getUserFromCookie(request.headers.cookie);
    if (!user) return next(new HttpError(401, '请先登录', 'UNAUTHENTICATED'));
    (request as AuthedRequest).user = user;
    next();
  };

  io.use((socket, next) => {
    const user = getUserFromCookie(socket.handshake.headers.cookie);
    if (!user) return next(new Error('UNAUTHENTICATED'));
    socket.data.user = user;
    socket.join(`user:${user.id}`);
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/auth/login', asyncRoute((req, res) => {
    const input = parseBody(loginSchema, req.body);
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(input.username) as Record<string, unknown> | undefined;
    if (!row || !row.active || !verifyPassword(input.password, String(row.password_hash))) throw new HttpError(401, '用户名或密码错误', 'INVALID_CREDENTIALS');
    const token = createSessionToken();
    const expires = new Date(Date.now() + (options.sessionDays ?? 7) * 86_400_000);
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(digestToken(token), Number(row.id), expires.toISOString());
    const secure = options.cookieSecure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `lab_session=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}${secure}`);
    res.json({ user: userView(row) });
  }));
  app.post('/api/auth/logout', authenticate, (req, res) => {
    const token = cookieValue(req.headers.cookie, 'lab_session');
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digestToken(token));
    res.setHeader('Set-Cookie', 'lab_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.status(204).end();
  });
  app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: (req as AuthedRequest).user }));

  app.use('/api', authenticate);
  app.use('/api/chemicals', inventoryRouter(db, io));
  app.use('/api/audit-logs', auditRouter(db));
  app.use('/api/notifications', notificationsRouter(db, io));
  app.use('/api/purchases', purchasesRouter(db, io));
  app.get('/api/members', (_req, res) => {
    const rows = db.prepare('SELECT * FROM users WHERE active=1 ORDER BY display_name, id').all() as Array<Record<string, unknown>>;
    res.json({ users: rows.map(userView) });
  });
  app.get('/api/users', roleRequired('super_admin'), (_req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY id').all() as Array<Record<string, unknown>>;
    res.json({ users: rows.map(userView) });
  });
  app.post('/api/users', roleRequired('super_admin'), asyncRoute((request, res) => {
    const req = request as AuthedRequest;
    const input = parseBody(userCreateSchema, req.body);
    const now = new Date().toISOString();
    let committed;
    try { committed = transaction(db, () => {
      const result = db.prepare('INSERT INTO users (username,display_name,role,password_hash,active,demo,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)').run(input.username, input.displayName, input.role, hashPassword(input.password), now, now);
      const user = userView(db.prepare('SELECT * FROM users WHERE id=?').get(Number(result.lastInsertRowid)) as Record<string, unknown>);
      const audit = insertAudit(db, { actorId: req.user.id, action: 'account_create', objectType: 'user', objectId: user.id, summary: `创建账号 ${input.username}`, details: { role: input.role } }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'account', `u.role='super_admin'`), category: 'account', title: '账号已创建', body: `${input.username} 账号已创建`, objectType: 'user', objectId: user.id }, now);
      return { user, audit, notifications };
    }); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(409, '用户名已存在', 'CONFLICT'); }
    emitCommitted(io, 'user:changed', committed.user, committed.audit, committed.notifications);
    res.status(201).json({ user: committed.user });
  }));
  app.patch('/api/users/:id', roleRequired('super_admin'), asyncRoute((request, res) => {
    const req = request as AuthedRequest;
    const id = Number(req.params.id); const input = parseBody(userUpdateSchema, req.body);
    if (id === req.user.id && input.active === false) throw new HttpError(400, '不能停用当前账号');
    const current = db.prepare('SELECT * FROM users WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!current) throw new HttpError(404, '账号不存在');
    const now = new Date().toISOString();
    const committed = transaction(db, () => {
      const result = db.prepare(`UPDATE users SET display_name=?, role=?, active=?, password_hash=?, version=version+1, updated_at=? WHERE id=? AND version=?`).run(
        input.displayName ?? String(current.display_name), input.role ?? String(current.role), input.active === undefined ? Number(current.active) : Number(input.active), input.password ? hashPassword(input.password) : String(current.password_hash), now, id, input.version,
      );
      if (result.changes === 0) throw new HttpError(409, '账号已被其他人修改', 'CONFLICT');
      if (input.active === false) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      const user = userView(db.prepare('SELECT * FROM users WHERE id=?').get(id) as Record<string, unknown>);
      const audit = insertAudit(db, { actorId: req.user.id, action: 'account_update', objectType: 'user', objectId: id, summary: `更新账号 ${current.username}`, details: { displayName: input.displayName, role: input.role, active: input.active } }, now);
      const notifications = insertNotifications(db, { userIds: eligibleUserIds(db, 'account', `u.role='super_admin'`), category: 'account', title: '账号已更新', body: `${current.username} 账号已更新`, objectType: 'user', objectId: id }, now);
      return { user, audit, notifications };
    });
    emitCommitted(io, 'user:changed', committed.user, committed.audit, committed.notifications);
    if (input.active === false) io.in(`user:${id}`).disconnectSockets(true);
    res.json({ user: committed.user });
  }));

  const clientDist = resolve(process.cwd(), 'client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (req, res, next) => req.path.startsWith('/api/') || req.path.startsWith('/socket.io') ? next() : res.sendFile(resolve(clientDist, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const known = error instanceof HttpError;
    if (!known) console.error(error);
    res.status(known ? error.status : 500).json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '服务器内部错误' } });
  });

  return { app, httpServer, io, db, close: () => new Promise<void>((resolveClose) => io.close(() => { db.close(); resolveClose(); })) };
}
