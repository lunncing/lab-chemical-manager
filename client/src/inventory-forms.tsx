export interface MovePayload {
  cabinet: 'A' | 'B';
  shelf: number;
  version: number;
}

export function ShelfOptions() {
  return <>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value} 层</option>)}</>;
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
  if (fields.cabinet !== 'A' && fields.cabinet !== 'B') throw new Error('柜号必须是 A 或 B');
  const shelf = Number(fields.shelf);
  if (!Number.isInteger(shelf) || shelf < 1 || shelf > 5) throw new Error('柜层必须是 1–5 的整数');
  return { name, specification, inboundAt, cabinet: fields.cabinet, shelf };
}

export function buildMovePayload(cabinet: unknown, shelfValue: unknown, version: unknown): MovePayload {
  if (cabinet !== 'A' && cabinet !== 'B') throw new Error('柜号必须是 A 或 B');
  const shelf = Number(shelfValue);
  if (!Number.isInteger(shelf) || shelf < 1 || shelf > 5) throw new Error('柜层必须是 1–5 的整数');
  if (!Number.isInteger(version) || Number(version) < 1) throw new Error('药品版本无效');
  return { cabinet, shelf, version: Number(version) };
}
