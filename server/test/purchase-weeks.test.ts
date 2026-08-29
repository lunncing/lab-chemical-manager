import { describe, expect, it } from 'vitest';
import { beijingWeekStart, isValidWeekStart, weekEnd } from '../src/purchase-weeks.js';

describe('Beijing purchase weeks', () => {
  it('switches weeks exactly at Beijing Monday midnight', () => {
    expect(beijingWeekStart('2026-08-30T15:59:59Z')).toBe('2026-08-24');
    expect(beijingWeekStart('2026-08-30T16:00:00Z')).toBe('2026-08-31');
  });

  it('handles month and year boundaries using the fixed UTC+08:00 calendar', () => {
    expect(beijingWeekStart('2025-12-28T16:00:00Z')).toBe('2025-12-29');
    expect(beijingWeekStart('2026-01-04T15:59:59Z')).toBe('2025-12-29');
    expect(beijingWeekStart('2026-02-28T16:00:00Z')).toBe('2026-02-23');
    expect(beijingWeekStart('2026-03-01T16:00:00Z')).toBe('2026-03-02');
  });

  it('rejects invalid ISO timestamps', () => {
    for (const value of ['', 'not-an-iso-time', '2026-02-30T00:00:00Z', '2026-08-30']) {
      expect(() => beijingWeekStart(value)).toThrow('ISO 时间无效');
    }
  });

  it('strictly validates real Monday identifiers and calculates Sunday', () => {
    expect(isValidWeekStart('2026-08-24')).toBe(true);
    expect(weekEnd('2026-08-24')).toBe('2026-08-30');
    for (const value of ['2026-08-23', '2026-02-30', '2026-8-24', '2026-08-24T00:00:00Z', '']) {
      expect(isValidWeekStart(value)).toBe(false);
      expect(() => weekEnd(value)).toThrow('采购周次无效');
    }
  });
});
