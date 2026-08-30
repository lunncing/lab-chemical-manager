import { useState, type FormEvent } from 'react';
import { ActionDialog } from './action-dialog.js';
import { api, ApiError } from './api.js';
import type { PurchaseAction } from './purchase-tasks-ui.js';
import type { Purchase } from './types.js';

const optionalText = (value: string) => value.trim() || undefined;
const messageOf = (error: unknown) => error instanceof ApiError || error instanceof Error ? error.message : '操作失败，请重试';

export function purchaseActionValueError(action: PurchaseAction, value: string): string {
  if (action === 'edit' && !value.trim()) return '用途说明不能为空';
  if (action === 'deferred' && !value.trim()) return '推迟说明不能为空';
  if (action === 'rejected' && !value.trim()) return '驳回说明不能为空';
  return '';
}

export async function submitPurchaseAction(purchase: Purchase, action: PurchaseAction, value: string): Promise<void> {
  const validationError = purchaseActionValueError(action, value);
  if (validationError) throw new Error(validationError);
  if (action === 'edit') {
    await api(`/purchases/${purchase.id}`, { method: 'PATCH', body: JSON.stringify({ purpose: value.trim(), version: purchase.version }) });
    return;
  }
  if (action === 'withdraw' || action === 'purchased') {
    await api(`/purchases/${purchase.id}/${action}`, { method: 'POST', body: JSON.stringify({ version: purchase.version }) });
    return;
  }
  const comment = optionalText(value);
  await api(`/purchases/${purchase.id}/decision`, {
    method: 'POST', body: JSON.stringify({ decision: action, ...(comment ? { comment } : {}), version: purchase.version }),
  });
}

const dialogText: Record<PurchaseAction, { title: string; description: string; confirm: string }> = {
  edit: { title: '修改采购申请', description: '更新这条申请的用途说明，其他申请信息保持不变。', confirm: '保存修改' },
  withdraw: { title: '撤销采购申请', description: '撤销后这条申请将不再进入审批或采购流程。', confirm: '确认撤销' },
  approved: { title: '通过采购申请', description: '确认该申请可以进入采购流程，审批意见可以留空。', confirm: '确认通过' },
  deferred: { title: '推迟采购申请', description: '申请将保留在审批流程中，请填写推迟说明。', confirm: '确认推迟' },
  rejected: { title: '驳回采购申请', description: '申请将结束且不能继续采购，请填写驳回说明。', confirm: '确认驳回' },
  purchased: { title: '确认已采购', description: '确认采购已完成后，该药品会从待采购任务中移除。', confirm: '确认已采购' },
};

function ActionField({ action, value, onChange }: { action: PurchaseAction; value: string; onChange: (value: string) => void }) {
  if (action === 'withdraw' || action === 'purchased') return null;
  const labels: Partial<Record<PurchaseAction, string>> = {
    edit: '用途说明（必填）', approved: '审批意见（可选）', deferred: '推迟说明（必填）', rejected: '驳回说明（必填）',
  };
  const required = action === 'edit' || action === 'deferred' || action === 'rejected';
  return <label>{labels[action]}<textarea value={value} onChange={(event) => onChange(event.target.value)} maxLength={1000} rows={4} required={required} autoFocus /></label>;
}

export function PurchaseActionDialog({ purchase, action, onClose, onDone }: {
  purchase: Purchase; action: PurchaseAction; onClose: () => void; onDone: () => void;
}) {
  const [value, setValue] = useState(action === 'edit' ? purchase.purpose : '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const text = dialogText[action];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const validationError = purchaseActionValueError(action, value);
    if (validationError) { setError(validationError); return; }
    setBusy(true); setError('');
    try { await submitPurchaseAction(purchase, action, value); setBusy(false); onDone(); }
    catch (failure) { setError(messageOf(failure)); setBusy(false); }
  }
  return <ActionDialog
    title={text.title}
    description={text.description}
    confirmLabel={text.confirm}
    danger={action === 'withdraw' || action === 'rejected'}
    busy={busy}
    error={error}
    onClose={onClose}
    onSubmit={submit}
  >
    <dl className="details"><dt>药品</dt><dd><strong>{purchase.chemicalName}</strong><small>{purchase.specification}</small></dd><dt>申请人</dt><dd>{purchase.applicant.displayName}</dd><dt>申请类型</dt><dd>{purchase.requestType === 'urgent' ? '加急' : '普通'}</dd><dt>危险品</dt><dd>{purchase.hazardous ? '是' : '否'}</dd></dl>
    <ActionField action={action} value={value} onChange={setValue} />
  </ActionDialog>;
}
