import { describe, expect, it } from 'vitest';
import { purchaseRequestPath, purchaseTabs, type PurchaseViewMode } from './purchase-view.js';

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

  it('exposes only authorized tabs and marks the current catalog tab as pressed', () => {
    const counts = { approvalCount: 3, procurementCount: 2 };
    expect(purchaseTabs('member', 'all', counts).map(({ mode }) => mode)).toEqual(['all', 'mine']);
    expect(purchaseTabs('normal_admin', 'catalog_normal', counts).map(({ mode }) => mode)).toEqual(['all', 'mine', 'approvals', 'procurement', 'catalog_normal', 'catalog_urgent']);
    expect(purchaseTabs('normal_admin', 'all', counts).map(({ label }) => label)).toContain('我的审批（3）');
    expect(purchaseTabs('hazardous_buyer', 'catalog_hazardous', counts).map(({ mode }) => mode)).toEqual(['all', 'mine', 'procurement', 'catalog_hazardous']);

    const superAdminTabs = purchaseTabs('super_admin', 'catalog_urgent', counts);
    expect(superAdminTabs.map(({ mode }) => mode)).toEqual(['all', 'mine', 'approvals', 'procurement', 'catalog_normal', 'catalog_urgent', 'catalog_hazardous']);
    expect(superAdminTabs.map(({ label }) => label)).toContain('待采购（2）');
    expect(superAdminTabs.filter(({ pressed }) => pressed).map(({ mode }) => mode)).toEqual(['catalog_urgent']);
  });
});
