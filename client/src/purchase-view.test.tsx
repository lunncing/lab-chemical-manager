import { describe, expect, it } from 'vitest';
import { purchaseRequestPath, purchaseTabs, purchaseTaskDefinition, type PurchaseViewMode } from './purchase-view.js';

describe('purchase view modes', () => {
  it('returns to the all-purchases endpoint after opening the normal catalog', () => {
    const modes: PurchaseViewMode[] = ['all', 'approvals', 'procurement', 'catalog_normal', 'all'];

    expect(modes.map((mode) => purchaseRequestPath(mode, {}))).toEqual([
      '/purchases?',
      '/purchases/tasks/approvals',
      '/purchases/tasks/procurement',
      '/purchases/catalog/normal',
      '/purchases?',
    ]);
  });

  it('maps all seven modes to their endpoints and applies filters only to list modes', () => {
    const filters = { status: 'approved', kind: 'urgent', hazardous: 'true' };

    expect(purchaseRequestPath('all', filters)).toBe('/purchases?status=approved&requestType=urgent&hazardous=true');
    expect(purchaseRequestPath('mine', filters)).toBe('/purchases?scope=mine&status=approved&requestType=urgent&hazardous=true');
    expect(purchaseRequestPath('approvals', filters)).toBe('/purchases/tasks/approvals');
    expect(purchaseRequestPath('procurement', filters)).toBe('/purchases/tasks/procurement');
    expect(purchaseRequestPath('catalog_normal', filters)).toBe('/purchases/catalog/normal');
    expect(purchaseRequestPath('catalog_urgent', filters)).toBe('/purchases/catalog/urgent');
    expect(purchaseRequestPath('catalog_hazardous', filters)).toBe('/purchases/catalog/hazardous');
  });

  it('keeps task queues out of purchase-request tabs and marks the current catalog tab as pressed', () => {
    expect(purchaseTabs('member', 'all').map(({ mode }) => mode)).toEqual(['all', 'mine']);
    expect(purchaseTabs('normal_admin', 'catalog_normal').map(({ mode }) => mode)).toEqual(['all', 'mine', 'catalog_normal', 'catalog_urgent']);
    expect(purchaseTabs('hazardous_buyer', 'catalog_hazardous').map(({ mode }) => mode)).toEqual(['all', 'mine', 'catalog_hazardous']);

    const superAdminTabs = purchaseTabs('super_admin', 'catalog_urgent');
    expect(superAdminTabs.map(({ mode }) => mode)).toEqual(['all', 'mine', 'catalog_normal', 'catalog_urgent', 'catalog_hazardous']);
    expect(superAdminTabs.map(({ mode }) => mode)).not.toContain('approvals');
    expect(superAdminTabs.map(({ mode }) => mode)).not.toContain('procurement');
    expect(superAdminTabs.filter(({ pressed }) => pressed).map(({ mode }) => mode)).toEqual(['catalog_urgent']);
  });

  it('defines top-level task pages with their exact server endpoints and Chinese empty states', () => {
    expect(purchaseTaskDefinition('approvals')).toEqual({
      title: '待审批', path: '/purchases/tasks/approvals', empty: '暂无待审批的采购申请',
    });
    expect(purchaseTaskDefinition('procurement')).toEqual({
      title: '待采购', path: '/purchases/tasks/procurement', empty: '暂无待采购的药品',
    });
  });
});
