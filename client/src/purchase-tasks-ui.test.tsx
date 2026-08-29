import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { canMarkPurchased, formatPurchaseCreatedAt, ProcurementTypeFilter, PurchaseTable, PurchaseTaskSummary, purchaseTableCapabilities } from './purchase-tasks-ui.js';
import type { Purchase } from './types.js';

const purchase: Purchase = {
  id: 17, chemicalName: '乙腈', specification: 'HPLC 4L', purpose: '流动相', hazardous: false, requestType: 'normal',
  applicant: { id: 4, username: 'member-a', displayName: '成员甲' }, status: 'pending_normal', approvalComment: null,
  version: 1, createdAt: '2026-08-30T08:00:00.000Z', updatedAt: '2026-08-30T08:00:00.000Z',
};

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

  it('maps each view to an exact operation capability set', () => {
    expect(purchaseTableCapabilities('all')).toEqual([]);
    expect(purchaseTableCapabilities('catalog_normal')).toEqual([]);
    expect(purchaseTableCapabilities('catalog_urgent')).toEqual([]);
    expect(purchaseTableCapabilities('catalog_hazardous')).toEqual([]);
    expect(purchaseTableCapabilities('mine')).toEqual(['edit', 'withdraw']);
    expect(purchaseTableCapabilities('approvals')).toEqual(['approved', 'deferred', 'rejected']);
    expect(purchaseTableCapabilities('procurement')).toEqual(['purchased']);
  });

  it('omits the operation column for all/catalog and renders only mode-specific actions elsewhere', () => {
    const render = (mode: Parameters<typeof PurchaseTable>[0]['mode'], item: Purchase = purchase) => renderToStaticMarkup(
      <PurchaseTable purchases={[item]} mode={mode} currentUserId={4} empty="空" onAction={() => undefined} />,
    );

    for (const mode of ['all', 'catalog_normal', 'catalog_urgent', 'catalog_hazardous'] as const) {
      expect(render(mode)).not.toContain('操作');
    }

    const mine = render('mine');
    expect(mine).toContain('操作'); expect(mine).toContain('修改'); expect(mine).toContain('撤销');
    expect(mine).not.toContain('通过'); expect(mine).not.toContain('已采购');

    const approvals = render('approvals');
    expect(approvals).toContain('通过'); expect(approvals).toContain('推迟'); expect(approvals).toContain('驳回');
    expect(approvals).not.toContain('修改'); expect(approvals).not.toContain('撤销'); expect(approvals).not.toContain('已采购');

    const approvedPurchase = { ...purchase, status: 'approved' as const };
    const procurement = render('procurement', approvedPurchase);
    expect(procurement).toContain('已采购');
    expect(procurement).not.toMatch(/<button[^>]*>通过<\/button>/); expect(procurement).not.toContain('修改'); expect(procurement).not.toContain('撤销');
  });

  it('shows a Chinese submission date after applicant in every table mode and safely handles invalid values', () => {
    const expected = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(purchase.createdAt));
    expect(formatPurchaseCreatedAt(purchase.createdAt)).toBe(expected);
    expect(formatPurchaseCreatedAt('not-a-date')).toBe('—');
    expect(formatPurchaseCreatedAt('')).toBe('—');

    for (const mode of ['all', 'mine', 'approvals', 'procurement', 'catalog_normal', 'catalog_urgent', 'catalog_hazardous'] as const) {
      const item = mode === 'procurement' ? { ...purchase, status: 'approved' as const } : purchase;
      const html = renderToStaticMarkup(<PurchaseTable purchases={[item]} mode={mode} currentUserId={4} empty="空" onAction={() => undefined} />);
      expect(html).toContain('提交日期');
      expect(html).toContain(expected);
      expect(html.indexOf('申请人')).toBeLessThan(html.indexOf('提交日期'));
      expect(html.indexOf('提交日期')).toBeLessThan(html.indexOf('类型'));
    }

    const invalid = renderToStaticMarkup(<PurchaseTable purchases={[{ ...purchase, createdAt: 'invalid' }]} mode="all" currentUserId={4} empty="空" onAction={() => undefined} />);
    expect(invalid).toContain('<td>—</td>');
  });

  it('renders the purchase-type filter only for procurement tasks', () => {
    const procurement = renderToStaticMarkup(<ProcurementTypeFilter mode="procurement" value="urgent" onChange={() => undefined} />);
    expect(procurement).toContain('采购类型');
    expect(procurement).toContain('<option value="">全部</option>');
    expect(procurement).toContain('<option value="normal">普通</option>');
    expect(procurement).toContain('<option value="urgent" selected="">加急</option>');
    expect(renderToStaticMarkup(<ProcurementTypeFilter mode="approvals" value="" onChange={() => undefined} />)).toBe('');
  });
});
