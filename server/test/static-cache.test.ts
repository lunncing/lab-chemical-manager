import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystem, type RunningSystem } from '../src/system.js';

let system: RunningSystem | undefined;
let directory: string | undefined;

afterEach(async () => {
  if (system) await system.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  system = undefined; directory = undefined;
});

describe('production static cache policy', () => {
  it('caches hashed assets immutably, revalidates the SPA, and never caches API or Socket responses', async () => {
    directory = mkdtempSync(join(tmpdir(), 'lab-static-cache-'));
    const clientDistPath = join(directory, 'client-dist');
    mkdirSync(join(clientDistPath, 'assets'), { recursive: true });
    writeFileSync(join(clientDistPath, 'index.html'), '<!doctype html><main>cache-test-spa</main>');
    writeFileSync(join(clientDistPath, 'assets', 'app-a1b2c3.js'), 'globalThis.cacheTest = true;');

    system = createSystem({ databasePath: ':memory:', seedDemo: false, clientDistPath });
    await new Promise<void>((resolve) => system!.httpServer.listen(0, '127.0.0.1', resolve));
    const address = system.httpServer.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const asset = await fetch(`${base}/assets/app-a1b2c3.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('cacheTest');
    expect(asset.headers.get('cache-control')).toBe('public,max-age=31536000,immutable');

    for (const path of ['/', '/index.html', '/inventory/deep-link']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('cache-test-spa');
      expect(response.headers.get('cache-control')).toBe('no-cache');
    }

    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');

    const socket = await fetch(`${base}/socket.io/?EIO=4&transport=polling&t=cache-test`);
    expect(socket.status).toBe(200);
    expect(socket.headers.get('cache-control')).toBe('no-store');
  });
});
