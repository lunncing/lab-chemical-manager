import { describe, expect, it } from 'vitest';
import { chemicalCreateSchema, chemicalQuerySchema, inboundRequestCreateSchema, moveSchema } from '../../shared/validation.js';

const inbound = {
  name: '盐酸', specification: 'AR 500mL', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'C1', shelf: 1,
} as const;

describe('central cabinet Zod validation', () => {
  it('uses the same C1-only location rule for direct, move, and proxy inbound', () => {
    expect(chemicalCreateSchema.safeParse(inbound).success).toBe(true);
    expect(moveSchema.safeParse({ cabinet: 'C1', shelf: 1, version: 1 }).success).toBe(true);
    expect(inboundRequestCreateSchema.safeParse({ ...inbound, targetUserId: 2 }).success).toBe(true);

    for (const cabinet of ['C1', 'C2', 'G1', 'G2'] as const) {
      for (const result of [
        chemicalCreateSchema.safeParse({ ...inbound, cabinet, shelf: 2 }),
        moveSchema.safeParse({ cabinet, shelf: 2, version: 1 }),
        inboundRequestCreateSchema.safeParse({ ...inbound, cabinet, targetUserId: 2, shelf: 2 }),
      ]) {
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues.map(({ message }) => message)).toContain(`${cabinet} 仅允许第 1 层`);
      }
    }
  });

  it('strictly validates cabinet queries and rejects legacy C or non-1 single-location shelves', () => {
    expect(chemicalQuerySchema.parse({ cabinet: 'C1' })).toEqual({ cabinet: 'C1' });
    expect(chemicalQuerySchema.parse({ cabinet: 'G2', shelf: '1', search: '盐酸' })).toEqual({ cabinet: 'G2', shelf: 1, search: '盐酸' });
    expect(chemicalQuerySchema.safeParse({ cabinet: 'C2', shelf: '2' }).success).toBe(false);
    expect(chemicalQuerySchema.safeParse({ cabinet: 'C' }).success).toBe(false);
    expect(chemicalQuerySchema.safeParse({ cabinet: 'D' }).success).toBe(false);
    expect(chemicalQuerySchema.safeParse({ cabinet: ['A', 'C1'] }).success).toBe(false);
    expect(chemicalQuerySchema.safeParse({ shelf: '1', unexpected: 'x' }).success).toBe(false);
  });
});
