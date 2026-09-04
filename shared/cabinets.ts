import type { Cabinet } from './types.js';

const standardShelves = [1, 2, 3, 4, 5] as const;
const singleShelves = [1] as const;

export const cabinets = [
  { id: 'A', name: '常温柜', label: 'A · 常温柜', description: null, shelves: standardShelves },
  { id: 'B', name: '冷藏柜', label: 'B · 冷藏柜', description: null, shelves: standardShelves },
  { id: 'C1', name: '酸柜', label: 'C1 · 酸柜', description: '单层 · 仅允许已确认的酸性物质', shelves: singleShelves },
  { id: 'C2', name: '碱柜', label: 'C2 · 碱柜', description: '单层 · 仅允许已确认的碱性物质', shelves: singleShelves },
  { id: 'G1', name: '高效液相色谱旁手套箱', label: 'G1 · 高效液相色谱旁手套箱', description: '独立单层位置 · 不分层', shelves: singleShelves },
  { id: 'G2', name: '靠墙手套箱', label: 'G2 · 靠墙手套箱', description: '独立单层位置 · 不分层', shelves: singleShelves },
] as const satisfies ReadonlyArray<{
  id: Cabinet;
  name: string;
  label: string;
  description: string | null;
  shelves: readonly number[];
}>;

export const cabinetIds = ['A', 'B', 'C1', 'C2', 'G1', 'G2'] as const satisfies readonly Cabinet[];

export function isCabinet(value: unknown): value is Cabinet {
  return typeof value === 'string' && cabinetIds.some((cabinet) => cabinet === value);
}

export function shelvesForCabinet(cabinet: Cabinet): readonly number[] {
  return cabinet === 'A' || cabinet === 'B' ? standardShelves : singleShelves;
}

export function formatLocation(cabinet: Cabinet, shelf: number): string {
  return `${cabinet} 柜 ${shelf} 层`;
}

export function locationError(cabinet: unknown, shelf: unknown): string | null {
  if (!isCabinet(cabinet)) return '柜号仅允许 A、B、C1、C2、G1 或 G2';
  if (cabinet !== 'A' && cabinet !== 'B') return shelf === 1 ? null : `${cabinet} 仅允许第 1 层`;
  if (!Number.isInteger(shelf)) return `${cabinet} 柜层必须是 1–5 的整数`;
  return Number(shelf) >= 1 && Number(shelf) <= 5 ? null : `${cabinet} 柜层必须是 1–5 的整数`;
}
