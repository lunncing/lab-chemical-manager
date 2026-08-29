import type { Role } from './types.js';

export type PurchaseViewMode = 'all' | 'mine' | 'approvals' | 'procurement' | 'catalog_normal' | 'catalog_urgent' | 'catalog_hazardous';
export type PurchaseRequestViewMode = Exclude<PurchaseViewMode, 'approvals' | 'procurement'>;
export type PurchaseTaskViewMode = Extract<PurchaseViewMode, 'approvals' | 'procurement'>;

export interface PurchaseFilters {
  status?: string;
  kind?: string;
  hazardous?: string;
}

const tabDefinitions: Array<{ mode: PurchaseRequestViewMode; label: string; roles?: Role[] }> = [
  { mode: 'all', label: '全部申请' },
  { mode: 'mine', label: '我的申请' },
  { mode: 'catalog_normal', label: '普通周目录', roles: ['normal_admin', 'super_admin'] },
  { mode: 'catalog_urgent', label: '加急目录', roles: ['normal_admin', 'super_admin'] },
  { mode: 'catalog_hazardous', label: '危险品队列', roles: ['hazardous_buyer', 'super_admin'] },
];

export function isPurchaseListMode(mode: PurchaseViewMode) {
  return mode === 'all' || mode === 'mine';
}

export function purchaseRequestPath(mode: PurchaseViewMode, filters: PurchaseFilters) {
  if (mode === 'approvals' || mode === 'procurement') return `/purchases/tasks/${mode}`;
  if (!isPurchaseListMode(mode)) return `/purchases/catalog/${mode.slice('catalog_'.length)}`;

  const query = new URLSearchParams();
  if (mode === 'mine') query.set('scope', 'mine');
  if (filters.status) query.set('status', filters.status);
  if (filters.kind) query.set('requestType', filters.kind);
  if (filters.hazardous) query.set('hazardous', filters.hazardous);
  return `/purchases?${query}`;
}

export function purchaseTabs(role: Role, current: PurchaseRequestViewMode) {
  return tabDefinitions
    .filter(({ roles }) => !roles || roles.includes(role))
    .map(({ mode, label }) => ({ mode, label, pressed: mode === current }));
}

const taskDefinitions: Record<PurchaseTaskViewMode, { title: string; path: string; empty: string }> = {
  approvals: { title: '待审批', path: '/purchases/tasks/approvals', empty: '暂无待审批的采购申请' },
  procurement: { title: '待采购', path: '/purchases/tasks/procurement', empty: '暂无待采购的药品' },
};

export function purchaseTaskDefinition(mode: PurchaseTaskViewMode) { return taskDefinitions[mode]; }
