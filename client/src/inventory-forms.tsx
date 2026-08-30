import { cabinets, isCabinet, locationError, shelvesForCabinet } from '../../shared/cabinets.js';
import type { Cabinet } from '../../shared/types.js';

export interface MovePayload {
  cabinet: Cabinet;
  shelf: number;
  version: number;
}

export function CabinetOptions() {
  return <>{cabinets.map((cabinet) => <option value={cabinet.id} key={cabinet.id}>{cabinet.label}{cabinet.id === 'C' ? '（仅酸性物质）' : ''}</option>)}</>;
}

export function ShelfOptions({ cabinet = 'A' }: { cabinet?: Cabinet }) {
  return <>{shelvesForCabinet(cabinet).map((value) => <option value={value} key={value}>{value} 层</option>)}</>;
}

export function ShelfSelect({ cabinet, value, name, onChange }: { cabinet: Cabinet; value: string; name?: string; onChange: (value: string) => void }) {
  return <select name={name} value={value} disabled={cabinet === 'C'} onChange={(event) => onChange(event.target.value)}><ShelfOptions cabinet={cabinet} /></select>;
}

export function locationAfterCabinetChange(cabinetValue: unknown, currentShelf: unknown): { cabinet: Cabinet; shelf: string } {
  if (!isCabinet(cabinetValue)) throw new Error('柜号仅允许 A、B 或 C');
  if (cabinetValue === 'C') return { cabinet: cabinetValue, shelf: '1' };
  const shelf = Number(currentShelf);
  return { cabinet: cabinetValue, shelf: shelvesForCabinet(cabinetValue).includes(shelf) ? String(shelf) : '1' };
}

export function InboundOwnerDisplay({ displayName }: { displayName: string }) {
  return <p className="read-only-owner">入库人：{displayName}</p>;
}

interface InboundFields { name: unknown; specification: unknown; inboundAt: unknown; cabinet: unknown; shelf: unknown; }

export function buildDirectInboundPayload(fields: InboundFields) {
  const name = String(fields.name ?? '').trim(); const specification = String(fields.specification ?? '').trim();
  const inboundAt = String(fields.inboundAt ?? '');
  if (!name) throw new Error('请填写药品名称');
  if (!specification) throw new Error('请填写规格');
  if (Number.isNaN(Date.parse(inboundAt))) throw new Error('入库时间无效');
  if (!isCabinet(fields.cabinet)) throw new Error('柜号仅允许 A、B 或 C');
  const shelf = Number(fields.shelf);
  const error = locationError(fields.cabinet, shelf);
  if (error) throw new Error(fields.cabinet === 'C' ? error : '柜层必须是 1–5 的整数');
  return { name, specification, inboundAt, cabinet: fields.cabinet, shelf };
}

export function buildMovePayload(cabinet: unknown, shelfValue: unknown, version: unknown): MovePayload {
  if (!isCabinet(cabinet)) throw new Error('柜号仅允许 A、B 或 C');
  const shelf = Number(shelfValue);
  const error = locationError(cabinet, shelf);
  if (error) throw new Error(cabinet === 'C' ? error : '柜层必须是 1–5 的整数');
  if (!Number.isInteger(version) || Number(version) < 1) throw new Error('药品版本无效');
  return { cabinet, shelf, version: Number(version) };
}
