import type { Cabinet } from './types.js';

const standardShelves = [1, 2, 3, 4, 5] as const;
const acidShelves = [1] as const;

export const cabinets = [
  { id: 'A', name: '常温柜', label: 'A · 常温柜', description: null, shelves: standardShelves },
  { id: 'B', name: '冷藏柜', label: 'B · 冷藏柜', description: null, shelves: standardShelves },
  { id: 'C', name: '酸柜', label: 'C · 酸柜', description: '单层 · 仅酸性物质', shelves: acidShelves },
] as const satisfies ReadonlyArray<{
  id: Cabinet;
  name: string;
  label: string;
  description: string | null;
  shelves: readonly number[];
}>;

export const cabinetIds = ['A', 'B', 'C'] as const satisfies readonly Cabinet[];

export function isCabinet(value: unknown): value is Cabinet {
  return typeof value === 'string' && cabinetIds.some((cabinet) => cabinet === value);
}

export function shelvesForCabinet(cabinet: Cabinet): readonly number[] {
  return cabinet === 'C' ? acidShelves : standardShelves;
}

export function formatLocation(cabinet: Cabinet, shelf: number): string {
  return `${cabinet} 柜 ${shelf} 层`;
}

export function locationError(cabinet: unknown, shelf: unknown): string | null {
  if (!isCabinet(cabinet)) return '柜号仅允许 A、B 或 C';
  if (!Number.isInteger(shelf)) return cabinet === 'C' ? 'C 柜仅允许第 1 层' : `${cabinet} 柜层必须是 1–5 的整数`;
  if (cabinet === 'C') return shelf === 1 ? null : 'C 柜仅允许第 1 层';
  return Number(shelf) >= 1 && Number(shelf) <= 5 ? null : `${cabinet} 柜层必须是 1–5 的整数`;
}
