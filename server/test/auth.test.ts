import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createSystem, type RunningSystem } from '../src/system.js';

let system: RunningSystem | undefined;

async function start() {
  system = createSystem({ databasePath: ':memory:', seedDemo: true });
  await new Promise<void>((resolve) => system!.httpServer.listen(0, '127.0.0.1', resolve));
  const address = system.httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (system) await system.close();
  system = undefined;
});

describe('authentication and server-side roles', () => {
  it('logs in with an HttpOnly cookie and rejects invalid credentials', async () => {
    const base = await start();
    const bad = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'teacher', password: 'wrong' }) });
    expect(bad.status).toBe(401);

    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'teacher', password: 'Demo1234!' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/lab_session=.*HttpOnly.*SameSite=Lax/i);
    expect((await response.json()).user.role).toBe('super_admin');
  });

  it('enforces account administration on the server', async () => {
    const base = await start();
    const memberLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'member-a', password: 'Demo1234!' }) });
    const memberCookie = memberLogin.headers.get('set-cookie')!.split(';')[0];
    const forbidden = await fetch(`${base}/api/users`, { headers: { cookie: memberCookie } });
    expect(forbidden.status).toBe(403);

    const teacherLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'teacher', password: 'Demo1234!' }) });
    const teacherCookie = teacherLogin.headers.get('set-cookie')!.split(';')[0];
    const allowed = await fetch(`${base}/api/users`, { headers: { cookie: teacherCookie } });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).users).toHaveLength(5);
  });
});
