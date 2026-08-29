import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as socketClient, type Socket } from 'socket.io-client';
import { api, login, startTestSystem, type TestContext } from './helpers.js';

let ctx: TestContext; const sockets: Socket[] = [];
beforeEach(async () => { ctx = await startTestSystem(); });
afterEach(async () => { for (const socket of sockets) socket.close(); await ctx.system.close(); });

function connect(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = socketClient(ctx.base, { transports: ['websocket'], extraHeaders: { cookie }, forceNew: true }); sockets.push(socket);
    socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject);
  });
}

function nextEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 4000);
    socket.once(event, (value) => { clearTimeout(timer); resolve(value); });
  });
}

describe('authenticated Socket.IO realtime', () => {
  it('delivers one committed change to two authenticated clients without refresh', async () => {
    const aliceCookie = await login(ctx.base, 'member-a'); const bobCookie = await login(ctx.base, 'member-b');
    const alice = await connect(aliceCookie); const bob = await connect(bobCookie);
    const aliceChange = nextEvent<any>(alice, 'chemical:changed'); const bobChange = nextEvent<any>(bob, 'chemical:changed');
    const aliceAudit = nextEvent<any>(alice, 'audit:created'); const bobNotification = nextEvent<any>(bob, 'notification:created');
    const response = await api(ctx.base, aliceCookie, '/api/chemicals', { method: 'POST', body: JSON.stringify({
      name: '实时乙腈', specification: 'HPLC 4L', inboundAt: '2026-08-29T08:00:00.000Z', cabinet: 'B', shelf: 2,
    }) });
    expect(response.status).toBe(201);
    expect((await aliceChange).name).toBe('实时乙腈'); expect((await bobChange).name).toBe('实时乙腈');
    expect((await aliceAudit).action).toBe('inventory_inbound'); expect((await bobNotification).category).toBe('inventory_inbound');
  });

  it('rejects a Socket.IO connection without an authenticated cookie', async () => {
    const error = await new Promise<Error>((resolve) => {
      const socket = socketClient(ctx.base, { transports: ['websocket'], forceNew: true }); sockets.push(socket); socket.once('connect_error', resolve);
    });
    expect(error.message).toContain('UNAUTHENTICATED');
  });
});
