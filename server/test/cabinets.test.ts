import { describe, expect, it } from 'vitest';
import { cabinets, formatLocation, isCabinet, locationError, shelvesForCabinet } from '../../shared/cabinets.js';

describe('central cabinet rules', () => {
  it('defines stable A/B/C1/C2/G1/G2 locations with honest confirmation wording', () => {
    expect(cabinets).toEqual([
      { id: 'A', name: '常温柜', label: 'A · 常温柜', description: null, shelves: [1, 2, 3, 4, 5] },
      { id: 'B', name: '冷藏柜', label: 'B · 冷藏柜', description: null, shelves: [1, 2, 3, 4, 5] },
      { id: 'C1', name: '酸柜', label: 'C1 · 酸柜', description: '单层 · 仅允许已确认的酸性物质', shelves: [1] },
      { id: 'C2', name: '碱柜', label: 'C2 · 碱柜', description: '单层 · 仅允许已确认的碱性物质', shelves: [1] },
      { id: 'G1', name: '高效液相色谱旁手套箱', label: 'G1 · 高效液相色谱旁手套箱', description: '独立单层位置 · 不分层', shelves: [1] },
      { id: 'G2', name: '靠墙手套箱', label: 'G2 · 靠墙手套箱', description: '独立单层位置 · 不分层', shelves: [1] },
    ]);
    expect(isCabinet('C')).toBe(false);
    expect(isCabinet('C1')).toBe(true);
    expect(isCabinet('C2')).toBe(true);
    expect(isCabinet('G1')).toBe(true);
    expect(isCabinet('G2')).toBe(true);
    expect(isCabinet('D')).toBe(false);
    for (const cabinet of ['C1', 'C2', 'G1', 'G2'] as const) expect(shelvesForCabinet(cabinet)).toEqual([1]);
    expect(formatLocation('C1', 1)).toBe('C1 柜 1 层');
  });

  it('accepts A/B shelves 1–5 and only shelf 1 for every single-location ID', () => {
    expect(locationError('A', 1)).toBeNull();
    expect(locationError('B', 5)).toBeNull();
    expect(locationError('A', 2.5)).toBe('A 柜层必须是 1–5 的整数');
    for (const cabinet of ['C1', 'C2', 'G1', 'G2'] as const) {
      expect(locationError(cabinet, 1)).toBeNull();
      expect(locationError(cabinet, 2)).toBe(`${cabinet} 仅允许第 1 层`);
      expect(locationError(cabinet, 1.5)).toBe(`${cabinet} 仅允许第 1 层`);
    }
    expect(locationError('C', 1)).toBe('柜号仅允许 A、B、C1、C2、G1 或 G2');
    expect(locationError('D', 1)).toBe('柜号仅允许 A、B、C1、C2、G1 或 G2');
  });
});
