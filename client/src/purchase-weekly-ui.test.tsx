import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { choosePurchaseWeek, purchaseWeekCatalogPath, PurchaseWeekPanel, purchaseWeekOptionLabel, shouldShowPurchaseWeekPanel } from './purchase-weekly-ui.js';
import type { Purchase, PurchaseWeekSummary } from './types.js';

const weeks: PurchaseWeekSummary[] = [
  { weekStart: '2026-08-24', weekEnd: '2026-08-30', count: 3, approvedCount: 1, purchasedCount: 2, isCurrent: true },
  { weekStart: '2026-08-17', weekEnd: '2026-08-23', count: 5, approvedCount: 4, purchasedCount: 1, isCurrent: false },
];

const purchases = [
  { id: 1, status: 'approved' }, { id: 2, status: 'purchased' }, { id: 3, status: 'purchased' },
] as Purchase[];

describe('weekly purchase catalog UI', () => {
  it('builds the specified-week endpoint and exact Chinese option labels', () => {
    expect(purchaseWeekCatalogPath('2026-08-17')).toBe('/purchases/catalog/normal?week=2026-08-17');
    expect(purchaseWeekOptionLabel(weeks[0]!)).toBe('本周：2026-08-24 至 2026-08-30（3 条）');
    expect(purchaseWeekOptionLabel(weeks[1]!)).toBe('历史：2026-08-17 至 2026-08-23（5 条）');
  });

  it('renders the week selector, selected range, and all three read-only statistics', () => {
    const html = renderToStaticMarkup(<PurchaseWeekPanel weeks={weeks} selectedWeekStart="2026-08-24" purchases={purchases} onChange={() => undefined} />);
    expect(html).toContain('采购周次');
    expect(html).toContain('本周：2026-08-24 至 2026-08-30（3 条）');
    expect(html).toContain('历史：2026-08-17 至 2026-08-23（5 条）');
    expect(html).toContain('所选周次：2026-08-24 至 2026-08-30');
    expect(html).toContain('总数'); expect(html).toContain('待采购数'); expect(html).toContain('已采购数');
    expect(html).toMatch(/总数<\/span><strong>3<\/strong>/);
    expect(html).toMatch(/待采购数<\/span><strong>1<\/strong>/);
    expect(html).toMatch(/已采购数<\/span><strong>2<\/strong>/);
    expect(html).not.toContain('操作');
  });

  it('keeps a valid revision selection and safely falls back to current when it disappears', () => {
    expect(choosePurchaseWeek(weeks, '2026-08-17')).toBe('2026-08-17');
    expect(choosePurchaseWeek(weeks, '2026-08-10')).toBe('2026-08-24');
    expect(choosePurchaseWeek(weeks, '')).toBe('2026-08-24');
  });

  it('shows weekly controls only on the normal catalog tab', () => {
    expect(shouldShowPurchaseWeekPanel('catalog_normal')).toBe(true);
    for (const mode of ['all', 'mine', 'catalog_urgent', 'catalog_hazardous'] as const) expect(shouldShowPurchaseWeekPanel(mode)).toBe(false);
  });
});
