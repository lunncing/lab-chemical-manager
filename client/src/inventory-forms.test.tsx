import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildDirectInboundPayload, buildMovePayload, InboundOwnerDisplay, ShelfOptions } from './inventory-forms.js';

describe('inventory form payloads', () => {
  it('renders numeric shelf option values and serializes 2 层 as JSON number 2', () => {
    const html = renderToStaticMarkup(<select><ShelfOptions /></select>);
    expect(html).toContain('<option value="2">2 层</option>');

    const payload = buildMovePayload('B', '2', 3);
    expect(JSON.parse(JSON.stringify(payload))).toEqual({ cabinet: 'B', shelf: 2, version: 3 });
    expect(Number.isNaN(payload.shelf)).toBe(false);
  });

  it('rejects invalid move fields with a Chinese client-side error before serialization', () => {
    expect(() => buildMovePayload('B', '2 层', 3)).toThrow('柜层必须是 1–5 的整数');
    expect(() => buildMovePayload('C', '2', 3)).toThrow('柜号必须是 A 或 B');
    expect(() => buildMovePayload('A', '2', 0)).toThrow('药品版本无效');
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
  });
});
