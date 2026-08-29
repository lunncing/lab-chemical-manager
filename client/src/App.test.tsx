import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CabinetBoard, canAdministerAccounts, canApprove } from './components.js';

describe('front-end critical behavior', () => {
  it('renders two cabinets with five ordered, clickable shelves and chemical entries', () => {
    const html = renderToStaticMarkup(<CabinetBoard chemicals={[{
      id: 1, name: '乙醇', specification: 'AR', cabinet: 'A', shelf: 1, status: 'active', version: 1,
      owner: { id: 4, username: 'member-a', displayName: '成员甲' }, inboundOperator: { id: 4, username: 'member-a', displayName: '成员甲' },
      inboundAt: '', createdAt: '', updatedAt: '', discardReason: null,
    }]} onChemical={() => undefined} />);
    expect((html.match(/data-shelf=/g) ?? [])).toHaveLength(10);
    expect(html).toContain('A · 常温柜'); expect(html).toContain('B · 冷藏柜'); expect(html).toContain('乙醇');
    expect(html.indexOf('data-shelf="1"')).toBeLessThan(html.indexOf('data-shelf="5"'));
  });

  it('maps role affordances to the same approval model used by the server', () => {
    expect(canApprove('normal_admin', 'normal')).toBe(true);
    expect(canApprove('normal_admin', 'urgent')).toBe(false);
    expect(canApprove('super_admin', 'urgent')).toBe(true);
    expect(canAdministerAccounts('member')).toBe(false);
    expect(canAdministerAccounts('super_admin')).toBe(true);
  });
});
