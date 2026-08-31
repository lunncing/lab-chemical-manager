import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createSystem, type RunningSystem } from '../src/system.js';

export const BENCHMARK_AUDIT_ROWS = 1200;
export const BENCHMARK_PURCHASE_ROWS = 600;
export const BENCHMARK_HEALTH_RUNS = 100;
export const BENCHMARK_LIST_RUNS = 30;
export const BENCHMARK_CONCURRENCY = 20;
export const P95_LIMIT_MS = 200;
export const RSS_LIMIT_BYTES = 250 * 1024 * 1024;

export interface PerformanceThresholdSample { name: string; p95Ms: number; }

export function percentile(values: number[], percentage: number): number {
  if (!values.length) throw new Error('percentile requires at least one value');
  if (percentage <= 0 || percentage > 100) throw new Error('percentile must be within (0, 100]');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil((percentage / 100) * sorted.length) - 1]!;
}

export function performanceThresholdFailures(samples: PerformanceThresholdSample[], rssBytes: number, concurrentErrors: number): string[] {
  const failures = samples
    .filter(({ p95Ms }) => p95Ms >= P95_LIMIT_MS)
    .map(({ name, p95Ms }) => `${name} p95 ${p95Ms.toFixed(2)}ms is not below ${P95_LIMIT_MS}ms`);
  if (rssBytes >= RSS_LIMIT_BYTES) failures.push(`RSS ${(rssBytes / 1024 / 1024).toFixed(2)}MB is not below ${RSS_LIMIT_BYTES / 1024 / 1024}MB`);
  if (concurrentErrors > 0) failures.push(`${BENCHMARK_CONCURRENCY}-request concurrency check had ${concurrentErrors} error(s)`);
  return failures;
}

interface EndpointMeasurement extends PerformanceThresholdSample {
  runs: number;
  p50Ms: number;
  responseBytes: number;
  rowCount: number;
}

function seedBenchmarkRows(system: RunningSystem): { auditRows: number; purchaseRows: number } {
  const user = system.db.prepare(`SELECT id FROM users WHERE username='member-a'`).get() as { id: number } | undefined;
  if (!user) throw new Error('benchmark seed user is missing');
  const audit = system.db.prepare(`INSERT INTO audit_logs
    (actor_id,action,object_type,object_id,summary,details_json,created_at) VALUES (?,?,?,?,?,?,?)`);
  const purchase = system.db.prepare(`INSERT INTO purchases
    (chemical_name,specification,purpose,hazardous,request_type,applicant_id,status,created_at,updated_at)
    VALUES (?,?,?,0,'normal',?,'pending_normal',?,?)`);
  const start = Date.UTC(2026, 7, 30, 0, 0, 0);
  system.db.exec('BEGIN IMMEDIATE');
  try {
    for (let index = 0; index < BENCHMARK_AUDIT_ROWS; index += 1) {
      audit.run(user.id, 'benchmark_audit', 'chemical', String(index + 1), `基准审计 ${index + 1}`, '{"benchmark":true}', new Date(start + index * 1000).toISOString());
    }
    for (let index = 0; index < BENCHMARK_PURCHASE_ROWS; index += 1) {
      const at = new Date(start + index * 1000).toISOString();
      purchase.run(`基准采购 ${index + 1}`, '1瓶', '低配性能回归', user.id, at, at);
    }
    system.db.exec('COMMIT');
  } catch (error) {
    system.db.exec('ROLLBACK');
    throw error;
  }
  return {
    auditRows: Number((system.db.prepare('SELECT COUNT(*) count FROM audit_logs').get() as { count: number }).count),
    purchaseRows: Number((system.db.prepare('SELECT COUNT(*) count FROM purchases').get() as { count: number }).count),
  };
}

async function listen(system: RunningSystem): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => reject(error);
    system.httpServer.once('error', onError);
    system.httpServer.listen(0, '127.0.0.1', () => {
      system.httpServer.off('error', onError);
      resolveListen();
    });
  });
  const address = system.httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function login(base: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'member-a', password: 'Demo1234!' }),
  });
  if (!response.ok) throw new Error(`benchmark login failed with HTTP ${response.status}`);
  await response.arrayBuffer();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('benchmark login did not return a session cookie');
  return cookie;
}

function rowsIn(key: string): (body: unknown) => number {
  return (body) => {
    if (!body || typeof body !== 'object') return 0;
    const rows = (body as Record<string, unknown>)[key];
    return Array.isArray(rows) ? rows.length : 0;
  };
}

async function measureEndpoint(input: {
  name: string; url: string; runs: number; cookie?: string; rowCount: (body: unknown) => number;
}): Promise<EndpointMeasurement> {
  const durations: number[] = []; const sizes: number[] = []; const rowCounts: number[] = [];
  for (let index = 0; index < input.runs; index += 1) {
    const started = performance.now();
    const response = await fetch(input.url, { headers: input.cookie ? { cookie: input.cookie } : undefined });
    const text = await response.text();
    durations.push(performance.now() - started);
    if (!response.ok) throw new Error(`${input.name} request ${index + 1} failed with HTTP ${response.status}`);
    sizes.push(Buffer.byteLength(text));
    rowCounts.push(input.rowCount(JSON.parse(text) as unknown));
  }
  return {
    name: input.name,
    runs: input.runs,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    responseBytes: Math.max(...sizes),
    rowCount: Math.max(...rowCounts),
  };
}

async function runConcurrentHealth(base: string): Promise<{ requests: number; errors: number; elapsedMs: number }> {
  const started = performance.now();
  const results = await Promise.allSettled(Array.from({ length: BENCHMARK_CONCURRENCY }, async () => {
    const response = await fetch(`${base}/api/health`);
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }));
  return {
    requests: BENCHMARK_CONCURRENCY,
    errors: results.filter(({ status }) => status === 'rejected').length,
    elapsedMs: performance.now() - started,
  };
}

export async function runPerformanceBenchmark(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'lab-v18-performance-'));
  const databasePath = join(directory, 'benchmark.sqlite');
  let system: RunningSystem | undefined;
  try {
    system = createSystem({ databasePath, seedDemo: true, clientDistPath: join(directory, 'no-client') });
    const seeded = seedBenchmarkRows(system);
    const base = await listen(system);
    const cookie = await login(base);
    const endpoints = [
      await measureEndpoint({ name: 'health', url: `${base}/api/health`, runs: BENCHMARK_HEALTH_RUNS, rowCount: () => 1 }),
      await measureEndpoint({ name: 'audit', url: `${base}/api/audit-logs`, runs: BENCHMARK_LIST_RUNS, cookie, rowCount: rowsIn('logs') }),
      await measureEndpoint({ name: 'purchases', url: `${base}/api/purchases`, runs: BENCHMARK_LIST_RUNS, cookie, rowCount: rowsIn('purchases') }),
    ];
    const concurrency = await runConcurrentHealth(base);
    const rssBytes = process.memoryUsage().rss;
    const failures = performanceThresholdFailures(endpoints, rssBytes, concurrency.errors);
    if (seeded.auditRows < BENCHMARK_AUDIT_ROWS) failures.push(`seeded only ${seeded.auditRows} audit rows`);
    if (seeded.purchaseRows < BENCHMARK_PURCHASE_ROWS) failures.push(`seeded only ${seeded.purchaseRows} purchase rows`);
    if (endpoints.find(({ name }) => name === 'audit')?.rowCount !== 500) failures.push('audit endpoint did not return its 500-row bound');
    if (endpoints.find(({ name }) => name === 'purchases')?.rowCount !== 500) failures.push('purchases endpoint did not return its 500-row bound');

    const report = {
      context: 'current-machine regression only; not a claim of target-server equivalence',
      database: { temporaryFile: true, journalMode: 'WAL', seeded },
      endpoints: endpoints.map((sample) => ({
        ...sample,
        p50Ms: Number(sample.p50Ms.toFixed(2)),
        p95Ms: Number(sample.p95Ms.toFixed(2)),
      })),
      concurrency: { ...concurrency, elapsedMs: Number(concurrency.elapsedMs.toFixed(2)) },
      rss: { bytes: rssBytes, megabytes: Number((rssBytes / 1024 / 1024).toFixed(2)) },
      thresholds: { p95BelowMs: P95_LIMIT_MS, rssBelowMegabytes: RSS_LIMIT_BYTES / 1024 / 1024, passed: failures.length === 0, failures },
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) throw new Error(`performance benchmark failed: ${failures.join('; ')}`);
  } finally {
    try { if (system) await system.close(); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  runPerformanceBenchmark().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
