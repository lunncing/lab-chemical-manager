import type { Role } from './types.js';
import type { Purchase } from './types.js';
import type { ProcurementRequestType, PurchaseTaskViewMode, PurchaseViewMode } from './purchase-view.js';
import { Empty } from './components.js';
import { purchaseStatusLabel } from './purchase-status.js';

export interface PurchaseTaskSummaryValue { approvalCount: number; procurementCount: number; }

export function canMarkPurchased(role: Role, hazardous: boolean): boolean {
  return role === 'super_admin' || (hazardous ? role === 'hazardous_buyer' : role === 'normal_admin');
}

type ApprovalStage = 'normal' | 'super' | 'hazardous';

function purchaseApprovalStage(purchase: Purchase): ApprovalStage | null {
  if (purchase.status === 'pending_super') return 'super';
  if (purchase.status === 'pending_hazardous' || purchase.status === 'deferred_hazardous') return 'hazardous';
  if (purchase.status === 'pending_normal') return purchase.hazardous ? 'hazardous' : 'normal';
  if (purchase.status !== 'deferred') return null;
  if (purchase.requestType === 'urgent') return 'super';
  return purchase.hazardous ? 'hazardous' : 'normal';
}

export function canReviewPurchase(role: Role, purchase: Purchase): boolean {
  const stage = purchaseApprovalStage(purchase);
  return stage !== null && (role === 'super_admin' || (stage === 'normal' && role === 'normal_admin') || (stage === 'hazardous' && role === 'hazardous_buyer'));
}

export function purchaseApprovalStageLabel(purchase: Purchase): string {
  const stage = purchaseApprovalStage(purchase);
  if (stage === 'super') return '老师加急审批';
  if (stage === 'hazardous') return '危险品复核';
  if (stage === 'normal') return '普通采购审批';
  return '';
}

export type PurchaseAction = 'edit' | 'withdraw' | 'approved' | 'deferred' | 'rejected' | 'purchased';

const tableCapabilities: Record<PurchaseViewMode, PurchaseAction[]> = {
  all: [],
  mine: ['edit', 'withdraw'],
  approvals: ['approved', 'deferred', 'rejected'],
  procurement: ['purchased'],
  catalog_normal: [],
  catalog_urgent: [],
  catalog_hazardous: [],
};

export function purchaseTableCapabilities(mode: PurchaseViewMode): PurchaseAction[] { return tableCapabilities[mode]; }

const actionLabels: Record<PurchaseAction, string> = {
  edit: '修改', withdraw: '撤销', approved: '通过', deferred: '推迟', rejected: '驳回', purchased: '已采购',
};

export function formatPurchaseCreatedAt(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function visibleActions(purchase: Purchase, mode: PurchaseViewMode, role: Role, currentUserId: number) {
  const capabilities = purchaseTableCapabilities(mode);
  if (mode === 'mine') {
    return purchase.applicant.id === currentUserId && ['pending_normal', 'pending_super', 'pending_hazardous', 'deferred', 'deferred_hazardous'].includes(purchase.status) ? capabilities : [];
  }
  if (mode === 'approvals') return canReviewPurchase(role, purchase) ? capabilities : [];
  if (mode === 'procurement') return purchase.status === 'approved' ? capabilities : [];
  return [];
}

export function PurchaseTable({ purchases, mode, role, currentUserId, empty, onAction }: {
  purchases: Purchase[]; mode: PurchaseViewMode; role: Role; currentUserId: number; empty: string;
  onAction: (purchase: Purchase, action: PurchaseAction) => void;
}) {
  if (!purchases.length) return <Empty>{empty}</Empty>;
  const hasActions = purchaseTableCapabilities(mode).length > 0;
  return <div className="table-wrap"><table><thead><tr><th>药品</th><th>申请人</th><th>提交日期</th><th>类型</th><th>状态</th><th>用途 / 意见</th>{hasActions && <th>操作</th>}</tr></thead><tbody>{purchases.map((purchase) => <tr key={purchase.id}>
    <td><strong>{purchase.chemicalName}</strong><small>{purchase.specification}</small>{purchase.hazardous && <span className="badge danger-badge">危险品</span>}</td>
    <td>{purchase.applicant.displayName}</td><td>{formatPurchaseCreatedAt(purchase.createdAt)}</td><td>{purchase.requestType === 'urgent' ? '加急' : '普通'}{mode === 'approvals' && <small className={`approval-stage stage-${purchaseApprovalStage(purchase)}`}>{purchaseApprovalStageLabel(purchase)}</small>}</td>
    <td><span className={`badge status-${purchase.status}`}>{purchaseStatusLabel(purchase.status)}</span></td>
    <td>{purchase.purpose}{purchase.approvalComment && <small>审批：{purchase.approvalComment}</small>}</td>
    {hasActions && <td><div className="row-actions">{visibleActions(purchase, mode, role, currentUserId).map((action) => <button type="button" className={action === 'approved' || action === 'purchased' ? 'approve' : action === 'rejected' ? 'danger-text' : undefined} key={action} onClick={() => onAction(purchase, action)}>{actionLabels[action]}</button>)}</div></td>}
  </tr>)}</tbody></table></div>;
}

export function PurchaseTaskSummary({ summary }: { summary: PurchaseTaskSummaryValue }) {
  return <div className="task-summary" aria-label="采购任务提醒">
    <p>您有 {summary.approvalCount} 条采购待审批</p>
    <p>您有 {summary.procurementCount} 个药品待采购</p>
  </div>;
}

export function ProcurementTypeFilter({ mode, value, onChange }: {
  mode: PurchaseTaskViewMode; value: ProcurementRequestType; onChange: (value: ProcurementRequestType) => void;
}) {
  if (mode !== 'procurement') return null;
  return <div className="filters"><label>采购类型<select value={value} onChange={(event) => onChange(event.target.value as ProcurementRequestType)}><option value="">全部</option><option value="normal">普通</option><option value="urgent">加急</option></select></label></div>;
}
