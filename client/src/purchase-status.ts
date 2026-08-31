import type { PurchaseStatus } from '../../shared/types.js';

const purchaseStatusLabels: Record<PurchaseStatus, string> = {
  pending_normal: '待审批与普通采购人审批',
  pending_super: '待超级管理员审批',
  pending_hazardous: '待危险品复核',
  approved: '已通过',
  purchased: '已采购',
  deferred: '已推迟',
  deferred_hazardous: '危险品复核已推迟',
  rejected: '已驳回',
  withdrawn: '已撤销',
};

export const purchaseStatusOptions = (Object.entries(purchaseStatusLabels) as Array<[PurchaseStatus, string]>)
  .map(([value, label]) => ({ value, label }));

export function purchaseStatusLabel(value: string) {
  return purchaseStatusLabels[value as PurchaseStatus] ?? value;
}
