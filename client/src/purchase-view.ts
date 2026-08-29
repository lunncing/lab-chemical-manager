import type { Role } from './types.js';
import type { PurchaseTaskSummaryValue } from './purchase-tasks-ui.js';

export type PurchaseViewMode = 'all' | 'mine' | 'approvals' | 'procurement' | 'catalog_normal' | 'catalog_urgent' | 'catalog_hazardous';

export interface PurchaseFilters {
  status?: string;
  kind?: string;
  hazardous?: string;
}

const tabDefinitions: Array<{ mode: PurchaseViewMode; label: string; roles?: Role[]; count?: keyof PurchaseTaskSummaryValue }> = [
  { mode: 'all', label: '全部申请' },
  { mode: 'mine', label: '我的申请' },
  { mode: 'approvals', label: '我的审批', roles: ['normal_admin', 'super_admin'], count: 'approvalCount' },
  { mode: 'procurement', label: '待采购', roles: ['normal_admin', 'hazardous_buyer', 'super_admin'], count: 'procurementCount' },
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

export function purchaseTabs(role: Role, current: PurchaseViewMode, summary: PurchaseTaskSummaryValue = { approvalCount: 0, procurementCount: 0 }) {
  return tabDefinitions
    .filter(({ roles }) => !roles || roles.includes(role))
    .map(({ mode, label, count }) => ({ mode, label: count ? `${label}（${summary[count]}）` : label, pressed: mode === current }));
}
