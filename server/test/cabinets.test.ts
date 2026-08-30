import { describe, expect, it } from 'vitest';
import { cabinets, isCabinet, locationError, shelvesForCabinet } from '../../shared/cabinets.js';

describe('central cabinet rules', () => {
  it('defines A, B, then the single-shelf acid cabinet C', () => {
    expect(cabinets).toEqual([
      { id: 'A', name: '常温柜', label: 'A · 常温柜', description: null, shelves: [1, 2, 3, 4, 5] },
      { id: 'B', name: '冷藏柜', label: 'B · 冷藏柜', description: null, shelves: [1, 2, 3, 4, 5] },
      { id: 'C', name: '酸柜', label: 'C · 酸柜', description: '单层 · 仅酸性物质', shelves: [1] },
    ]);
    expect(isCabinet('C')).toBe(true);
    expect(isCabinet('D')).toBe(false);
    expect(shelvesForCabinet('C')).toEqual([1]);
  });

  it('accepts A/B shelves 1–5 and only C shelf 1 with Chinese errors', () => {
    expect(locationError('A', 1)).toBeNull();
    expect(locationError('B', 5)).toBeNull();
    expect(locationError('A', 2.5)).toBe('A 柜层必须是 1–5 的整数');
    expect(locationError('C', 1)).toBeNull();
    expect(locationError('C', 2)).toBe('C 柜仅允许第 1 层');
    expect(locationError('D', 1)).toBe('柜号仅允许 A、B 或 C');
  });
});
