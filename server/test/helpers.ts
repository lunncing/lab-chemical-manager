import type { AddressInfo } from 'node:net';
import { createSystem, type RunningSystem, type SystemOptions } from '../src/system.js';

export interface TestContext { system: RunningSystem; base: string; }

export async function startTestSystem(options: Partial<Omit<SystemOptions, 'databasePath'>> = {}): Promise<TestContext> {
  const system = createSystem({ databasePath: ':memory:', seedDemo: true, ...options });
  await new Promise<void>((resolve) => system.httpServer.listen(0, '127.0.0.1', resolve));
  const address = system.httpServer.address() as AddressInfo;
  return { system, base: `http://127.0.0.1:${address.port}` };
}

export async function login(base: string, username: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'Demo1234!' }),
  });
  if (!response.ok) throw new Error(`login ${username}: ${response.status}`);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

export async function api(base: string, cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', cookie, ...init.headers } });
}
