import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { canMarkPurchased, PurchaseTaskSummary } from './purchase-tasks-ui.js';

describe('purchase task UI', () => {
  it('renders explicit server-derived approval and procurement reminders', () => {
    const html = renderToStaticMarkup(<PurchaseTaskSummary summary={{ approvalCount: 7, procurementCount: 4 }} />);
    expect(html).toContain('您有 7 条采购待审批');
    expect(html).toContain('您有 4 个药品待采购');
  });

  it('matches purchased affordances to hazardous and nonhazardous role permissions', () => {
    expect(canMarkPurchased('member', false)).toBe(false);
    expect(canMarkPurchased('normal_admin', false)).toBe(true);
    expect(canMarkPurchased('normal_admin', true)).toBe(false);
    expect(canMarkPurchased('hazardous_buyer', false)).toBe(false);
    expect(canMarkPurchased('hazardous_buyer', true)).toBe(true);
    expect(canMarkPurchased('super_admin', false)).toBe(true);
    expect(canMarkPurchased('super_admin', true)).toBe(true);
  });
});
