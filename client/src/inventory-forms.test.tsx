import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildDirectInboundPayload, buildMovePayload, CabinetOptions, InboundOwnerDisplay, locationAfterCabinetChange, ShelfSelect } from './inventory-forms.js';

describe('inventory form payloads', () => {
  it('renders numeric shelf option values and serializes 2 层 as JSON number 2', () => {
    const html = renderToStaticMarkup(<ShelfSelect cabinet="B" value="2" onChange={() => undefined} />);
    expect(html).toContain('<option value="2" selected="">2 层</option>');

    const payload = buildMovePayload('B', '2', 3);
    expect(JSON.parse(JSON.stringify(payload))).toEqual({ cabinet: 'B', shelf: 2, version: 3 });
    expect(Number.isNaN(payload.shelf)).toBe(false);
  });

  it('rejects invalid move fields with a Chinese client-side error before serialization', () => {
    expect(() => buildMovePayload('B', '2 层', 3)).toThrow('柜层必须是 1–5 的整数');
    expect(() => buildMovePayload('C', '2', 3)).toThrow('C 柜仅允许第 1 层');
    expect(() => buildMovePayload('A', '2', 0)).toThrow('药品版本无效');
  });

  it('offers C with one locked shelf and normalizes cabinet changes without null payloads', () => {
    const cabinets = renderToStaticMarkup(<select><CabinetOptions /></select>);
    expect(cabinets).toContain('C · 酸柜（仅酸性物质）');
    const acidShelves = renderToStaticMarkup(<ShelfSelect cabinet="C" value="1" onChange={() => undefined} />);
    expect(acidShelves).toContain('disabled=""');
    expect((acidShelves.match(/<option/g) ?? [])).toHaveLength(1);
    expect(locationAfterCabinetChange('C', '4')).toEqual({ cabinet: 'C', shelf: '1' });
    expect(locationAfterCabinetChange('A', '1')).toEqual({ cabinet: 'A', shelf: '1' });
    const normalShelves = renderToStaticMarkup(<ShelfSelect cabinet="A" value="1" onChange={() => undefined} />);
    expect((normalShelves.match(/<option/g) ?? [])).toHaveLength(5);
    expect(buildMovePayload('C', '1', 3)).toEqual({ cabinet: 'C', shelf: 1, version: 3 });
  });
});

describe('direct inbound ownership', () => {
  it('shows the current user as read-only and omits ownerId from the request payload', () => {
    const html = renderToStaticMarkup(<InboundOwnerDisplay displayName="成员甲" />);
    expect(html).toContain('入库人：成员甲');
    expect(html).not.toContain('<select');

    const payload = buildDirectInboundPayload({
      name: '乙腈', specification: 'HPLC 4L', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'A', shelf: '2',
    });
    expect(payload).toEqual({ name: '乙腈', specification: 'HPLC 4L', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'A', shelf: 2 });
    expect(payload).not.toHaveProperty('ownerId');
    expect(buildDirectInboundPayload({
      name: '盐酸', specification: 'AR', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'C', shelf: '1',
    })).toMatchObject({ cabinet: 'C', shelf: 1 });
    expect(() => buildDirectInboundPayload({
      name: '错误盐酸', specification: 'AR', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'C', shelf: '2',
    })).toThrow('C 柜仅允许第 1 层');
  });
});
