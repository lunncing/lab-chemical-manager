import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_AUDIT_ROWS,
  BENCHMARK_CONCURRENCY,
  BENCHMARK_HEALTH_RUNS,
  BENCHMARK_PURCHASE_ROWS,
  P95_LIMIT_MS,
  RSS_LIMIT_BYTES,
  performanceThresholdFailures,
  percentile,
} from '../scripts/performance-benchmark.js';

describe('dependency-free performance benchmark contract', () => {
  it('locks the required seed, sample, concurrency, and low-spec regression thresholds', () => {
    expect(BENCHMARK_AUDIT_ROWS).toBeGreaterThanOrEqual(1000);
    expect(BENCHMARK_PURCHASE_ROWS).toBeGreaterThanOrEqual(500);
    expect(BENCHMARK_HEALTH_RUNS).toBe(100);
    expect(BENCHMARK_CONCURRENCY).toBe(20);
    expect(P95_LIMIT_MS).toBe(200);
    expect(RSS_LIMIT_BYTES).toBe(250 * 1024 * 1024);
  });

  it('calculates nearest-rank p50/p95 without a statistics dependency', () => {
    const values = [9, 1, 5, 3, 7];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(9);
    expect(values).toEqual([9, 1, 5, 3, 7]);
  });

  it('fails at or above either strict threshold and on any concurrent request error', () => {
    expect(performanceThresholdFailures([
      { name: 'health', p95Ms: 199.99 }, { name: 'audit', p95Ms: 100 }, { name: 'purchases', p95Ms: 50 },
    ], RSS_LIMIT_BYTES - 1, 0)).toEqual([]);

    expect(performanceThresholdFailures([
      { name: 'health', p95Ms: 200 }, { name: 'audit', p95Ms: 201 },
    ], RSS_LIMIT_BYTES, 1)).toEqual([
      'health p95 200.00ms is not below 200ms',
      'audit p95 201.00ms is not below 200ms',
      'RSS 250.00MB is not below 250MB',
      '20-request concurrency check had 1 error(s)',
    ]);
  });
});
