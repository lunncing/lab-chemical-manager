import type { Role } from './types.js';

export interface PurchaseTaskSummaryValue { approvalCount: number; procurementCount: number; }

export function canMarkPurchased(role: Role, hazardous: boolean): boolean {
  return role === 'super_admin' || (hazardous ? role === 'hazardous_buyer' : role === 'normal_admin');
}

export function PurchaseTaskSummary({ summary }: { summary: PurchaseTaskSummaryValue }) {
  return <div className="task-summary" aria-label="采购任务提醒">
    <p>您有 {summary.approvalCount} 条采购待审批</p>
    <p>您有 {summary.procurementCount} 个药品待采购</p>
  </div>;
}
