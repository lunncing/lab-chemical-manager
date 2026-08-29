import { resolve } from 'node:path';
import { createSystem } from './system.js';

const port = Number(process.env.PORT ?? 3000);
const databasePath = resolve(process.env.DATABASE_PATH ?? './data/lab-chemical-manager.sqlite');
const system = createSystem({ databasePath, cookieSecure: process.env.COOKIE_SECURE === 'true', sessionDays: Number(process.env.SESSION_DAYS ?? 7) });
system.httpServer.listen(port, '0.0.0.0', () => console.log(`李少锋课题组药品管理运行于 http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await system.close(); process.exit(0); });
