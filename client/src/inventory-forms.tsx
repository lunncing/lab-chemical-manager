import type { InputHTMLAttributes } from 'react';
import { cabinets, isCabinet, locationError, shelvesForCabinet } from '../../shared/cabinets.js';
import { normalizeCasNumber } from '../../shared/cas.js';
import type { Cabinet } from '../../shared/types.js';

export interface MovePayload {
  cabinet: Cabinet;
  shelf: number;
  version: number;
}

export function CabinetOptions() {
  return <>{cabinets.map((cabinet) => <option value={cabinet.id} key={cabinet.id}>{cabinet.label}{cabinet.id === 'C1' ? '（仅允许已确认的酸性物质）' : cabinet.id === 'C2' ? '（仅允许已确认的碱性物质）' : ''}</option>)}</>;
}

export function ShelfOptions({ cabinet = 'A' }: { cabinet?: Cabinet }) {
  return <>{shelvesForCabinet(cabinet).map((value) => <option value={value} key={value}>{value} 层</option>)}</>;
}

export function ShelfSelect({ cabinet, value, name, onChange }: { cabinet: Cabinet; value: string; name?: string; onChange: (value: string) => void }) {
  return <select name={name} value={value} disabled={shelvesForCabinet(cabinet).length === 1} onChange={(event) => onChange(event.target.value)}><ShelfOptions cabinet={cabinet} /></select>;
}

export function locationAfterCabinetChange(cabinetValue: unknown, currentShelf: unknown): { cabinet: Cabinet; shelf: string } {
  if (!isCabinet(cabinetValue)) throw new Error('柜号仅允许 A、B、C1、C2、G1 或 G2');
  const shelf = Number(currentShelf);
  return { cabinet: cabinetValue, shelf: shelvesForCabinet(cabinetValue).includes(shelf) ? String(shelf) : '1' };
}

export function InboundOwnerDisplay({ displayName }: { displayName: string }) {
  return <p className="read-only-owner">入库人：{displayName}</p>;
}

export function CasNumberField(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'name'> = {}) {
  return <label>CAS号（推荐填写）<input name="casNumber" autoComplete="off" placeholder="例如：75-05-8" maxLength={12} {...props} /></label>;
}

interface InboundFields { name: unknown; specification: unknown; casNumber?: unknown; inboundAt: unknown; cabinet: unknown; shelf: unknown; }

export function buildDirectInboundPayload(fields: InboundFields) {
  const name = String(fields.name ?? '').trim(); const specification = String(fields.specification ?? '').trim();
  const casNumber = normalizeCasNumber(fields.casNumber); const inboundAt = String(fields.inboundAt ?? '');
  if (!name) throw new Error('请填写药品名称');
  if (!specification) throw new Error('请填写规格');
  if (Number.isNaN(Date.parse(inboundAt))) throw new Error('入库时间无效');
  if (!isCabinet(fields.cabinet)) throw new Error('柜号仅允许 A、B、C1、C2、G1 或 G2');
  const shelf = Number(fields.shelf);
  const error = locationError(fields.cabinet, shelf);
  if (error) throw new Error(error);
  return { name, specification, casNumber, inboundAt, cabinet: fields.cabinet, shelf };
}

export function buildMovePayload(cabinet: unknown, shelfValue: unknown, version: unknown): MovePayload {
  if (!isCabinet(cabinet)) throw new Error('柜号仅允许 A、B、C1、C2、G1 或 G2');
  const shelf = Number(shelfValue);
  const error = locationError(cabinet, shelf);
  if (error) throw new Error(error);
  if (!Number.isInteger(version) || Number(version) < 1) throw new Error('药品版本无效');
  return { cabinet, shelf, version: Number(version) };
}
