import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildDirectInboundPayload, buildMovePayload, CabinetOptions, CasNumberField, InboundOwnerDisplay, locationAfterCabinetChange, ShelfSelect } from './inventory-forms.js';

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
    expect(() => buildMovePayload('C1', '2', 3)).toThrow('C1 仅允许第 1 层');
    expect(() => buildMovePayload('G2', '5', 3)).toThrow('G2 仅允许第 1 层');
    expect(() => buildMovePayload('A', '2', 0)).toThrow('药品版本无效');
  });

  it('offers all stable locations with honest warnings and locks every single-location shelf', () => {
    const cabinets = renderToStaticMarkup(<select><CabinetOptions /></select>);
    expect(cabinets).toContain('C1 · 酸柜（仅允许已确认的酸性物质）');
    expect(cabinets).toContain('C2 · 碱柜（仅允许已确认的碱性物质）');
    expect(cabinets).toContain('G1 · 高效液相色谱旁手套箱');
    expect(cabinets).toContain('G2 · 靠墙手套箱');
    expect((cabinets.match(/<option/g) ?? [])).toHaveLength(6);
    for (const cabinet of ['C1', 'C2', 'G1', 'G2'] as const) {
      const singleShelves = renderToStaticMarkup(<ShelfSelect cabinet={cabinet} value="1" onChange={() => undefined} />);
      expect(singleShelves).toContain('disabled=""');
      expect((singleShelves.match(/<option/g) ?? [])).toHaveLength(1);
      expect(locationAfterCabinetChange(cabinet, '4')).toEqual({ cabinet, shelf: '1' });
      expect(buildMovePayload(cabinet, '1', 3)).toEqual({ cabinet, shelf: 1, version: 3 });
    }
    expect(locationAfterCabinetChange('A', '1')).toEqual({ cabinet: 'A', shelf: '1' });
    const normalShelves = renderToStaticMarkup(<ShelfSelect cabinet="A" value="1" onChange={() => undefined} />);
    expect((normalShelves.match(/<option/g) ?? [])).toHaveLength(5);
  });
});

describe('direct inbound ownership', () => {
  it('shows the current user as read-only and omits ownerId from the request payload', () => {
    const html = renderToStaticMarkup(<InboundOwnerDisplay displayName="成员甲" />);
    expect(html).toContain('入库人：成员甲');
    expect(html).not.toContain('<select');

    const payload = buildDirectInboundPayload({
      name: '乙腈', specification: 'HPLC 4L', casNumber: ' 75-05-8 ', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'A', shelf: '2',
    });
    expect(payload).toEqual({ name: '乙腈', specification: 'HPLC 4L', casNumber: '75-05-8', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'A', shelf: 2 });
    expect(payload).not.toHaveProperty('ownerId');
    expect(buildDirectInboundPayload({
      name: '盐酸', specification: 'AR', casNumber: '   ', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'C1', shelf: '1',
    })).toMatchObject({ casNumber: null, cabinet: 'C1', shelf: 1 });
    expect(() => buildDirectInboundPayload({
      name: '错误盐酸', specification: 'AR', casNumber: null, inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'C1', shelf: '2',
    })).toThrow('C1 仅允许第 1 层');
  });

  it('renders optional CAS copy and rejects invalid CAS client-side', () => {
    const html = renderToStaticMarkup(<CasNumberField />);
    expect(html).toContain('CAS号（推荐填写）');
    expect(html).toContain('name="casNumber"');
    expect(html).not.toContain('required');
    expect(() => buildDirectInboundPayload({
      name: '乙腈', specification: 'HPLC', casNumber: '75-05-9', inboundAt: '2026-08-30T08:00:00.000Z', cabinet: 'A', shelf: '1',
    })).toThrow('CAS号校验位不正确');
  });
});
