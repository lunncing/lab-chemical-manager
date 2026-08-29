import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CabinetBoard, canAdministerAccounts, canApprove } from './components.js';
import { PrimaryNavigation, safeViewForRole, taskSummaryPath } from './App.js';
import { revisionEvents } from './realtime-events.js';

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

describe('role-filtered primary navigation', () => {
  const summary = { approvalCount: 3, procurementCount: 2 };

  function navigation(role: 'member' | 'normal_admin' | 'super_admin' | 'hazardous_buyer') {
    return renderToStaticMarkup(<PrimaryNavigation role={role} view="inventory" summary={summary} unread={0} onView={() => undefined} />);
  }

  it('omits task navigation DOM entirely for members', () => {
    const html = navigation('member');
    expect(html).not.toContain('待审批');
    expect(html).not.toContain('待采购');
  });

  it('shows only procurement to hazardous buyers and both counted tasks to administrators', () => {
    const hazardous = navigation('hazardous_buyer');
    expect(hazardous).not.toContain('待审批');
    expect(hazardous).toContain('待采购（2）');

    for (const role of ['normal_admin', 'super_admin'] as const) {
      const html = navigation(role);
      expect(html).toContain('待审批（3）');
      expect(html).toContain('待采购（2）');
      expect(html).not.toContain('我的审批');
      expect(html.indexOf('采购申请')).toBeLessThan(html.indexOf('待审批（3）'));
      expect(html.indexOf('待审批（3）')).toBeLessThan(html.indexOf('待采购（2）'));
      expect(html.indexOf('待采购（2）')).toBeLessThan(html.indexOf('改动日志'));
    }
  });

  it('uses the server summary path, refreshes on purchase revisions, and falls back from forbidden views', () => {
    expect(taskSummaryPath).toBe('/purchases/tasks/summary');
    expect(revisionEvents).toContain('purchase:changed');
    expect(safeViewForRole('approvals', 'member')).toBe('inventory');
    expect(safeViewForRole('approvals', 'hazardous_buyer')).toBe('inventory');
    expect(safeViewForRole('procurement', 'member')).toBe('inventory');
    expect(safeViewForRole('procurement', 'hazardous_buyer')).toBe('procurement');
    expect(safeViewForRole('accounts', 'normal_admin')).toBe('inventory');
  });
});
