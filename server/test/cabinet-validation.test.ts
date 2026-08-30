import { describe, expect, it } from 'vitest';
import { chemicalCreateSchema, chemicalQuerySchema, inboundRequestCreateSchema, moveSchema } from '../../shared/validation.js';

const inbound = {
  name: '盐酸', specification: 'AR 500mL', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'C', shelf: 1,
} as const;

describe('central cabinet Zod validation', () => {
  it('uses the same C1-only location rule for direct, move, and proxy inbound', () => {
    expect(chemicalCreateSchema.safeParse(inbound).success).toBe(true);
    expect(moveSchema.safeParse({ cabinet: 'C', shelf: 1, version: 1 }).success).toBe(true);
    expect(inboundRequestCreateSchema.safeParse({ ...inbound, targetUserId: 2 }).success).toBe(true);

    for (const result of [
      chemicalCreateSchema.safeParse({ ...inbound, shelf: 2 }),
      moveSchema.safeParse({ cabinet: 'C', shelf: 2, version: 1 }),
      inboundRequestCreateSchema.safeParse({ ...inbound, targetUserId: 2, shelf: 2 }),
    ]) {
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map(({ message }) => message)).toContain('C 柜仅允许第 1 层');
    }
  });

  it('strictly validates cabinet queries and rejects C with a non-1 shelf', () => {
    expect(chemicalQuerySchema.parse({ cabinet: 'C' })).toEqual({ cabinet: 'C' });
    expect(chemicalQuerySchema.parse({ cabinet: 'C', shelf: '1', search: '盐酸' })).toEqual({ cabinet: 'C', shelf: 1, search: '盐酸' });
    expect(chemicalQuerySchema.safeParse({ cabinet: 'C', shelf: '2' }).success).toBe(false);
    expect(chemicalQuerySchema.safeParse({ cabinet: 'D' }).success).toBe(false);
    expect(chemicalQuerySchema.safeParse({ cabinet: ['A', 'C'] }).success).toBe(false);
    expect(chemicalQuerySchema.safeParse({ shelf: '1', unexpected: 'x' }).success).toBe(false);
  });
});
