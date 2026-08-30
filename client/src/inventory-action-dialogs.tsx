import { useState, type FormEvent } from 'react';
import { ActionDialog } from './action-dialog.js';
import { api, ApiError } from './api.js';
import type { Chemical, InboundRequest } from './types.js';

const messageOf = (error: unknown) => error instanceof ApiError ? error.message : '操作失败，请重试';
const optionalText = (value: string) => value.trim() || undefined;

export async function discardChemical(chemical: Chemical, reason: string): Promise<void> {
  const normalizedReason = optionalText(reason);
  await api(`/chemicals/${chemical.id}/discard`, {
    method: 'PATCH',
    body: JSON.stringify({ confirmed: true, ...(normalizedReason ? { reason: normalizedReason } : {}), version: chemical.version }),
  });
}

export function ChemicalDiscardDialog({ chemical, onClose, onDone }: { chemical: Chemical; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { await discardChemical(chemical, reason); setBusy(false); onDone(); }
    catch (failure) { setError(messageOf(failure)); setBusy(false); }
  }
  return <ActionDialog
    title="废弃药品"
    description="废弃后不能恢复为活动库存，系统会保留审计记录。"
    confirmLabel="确认废弃"
    danger
    busy={busy}
    error={error}
    onClose={onClose}
    onSubmit={submit}
  >
    <dl className="details"><dt>药品</dt><dd><strong>{chemical.name}</strong><small>{chemical.specification}</small></dd><dt>当前位置</dt><dd>{chemical.cabinet} 柜 {chemical.shelf} 层</dd></dl>
    <label>废弃原因（可选）<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} autoFocus /></label>
  </ActionDialog>;
}

export type InboundRequestDialogAction = 'approved' | 'rejected' | 'withdraw';

export async function submitInboundRequestAction(request: InboundRequest, action: InboundRequestDialogAction, comment: string): Promise<void> {
  if (action === 'withdraw') {
    await api(`/inbound-requests/${request.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: request.version }) });
    return;
  }
  const normalizedComment = optionalText(comment);
  await api(`/inbound-requests/${request.id}/decision`, {
    method: 'POST', body: JSON.stringify({ decision: action, ...(normalizedComment ? { comment: normalizedComment } : {}), version: request.version }),
  });
}

const inboundDialogText: Record<InboundRequestDialogAction, { title: string; description: string; confirm: string }> = {
  approved: { title: '同意代入库申请', description: '同意后，药品将按申请信息进入对方名下库存。', confirm: '确认同意' },
  rejected: { title: '拒绝代入库申请', description: '拒绝后不会创建库存，申请人会收到处理结果。', confirm: '确认拒绝' },
  withdraw: { title: '撤销代入库申请', description: '撤销后对方将无法再处理这条申请。', confirm: '确认撤销' },
};

export function InboundRequestActionDialog({ request, action, onClose, onDone }: {
  request: InboundRequest; action: InboundRequestDialogAction; onClose: () => void; onDone: () => void;
}) {
  const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const text = inboundDialogText[action];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { await submitInboundRequestAction(request, action, comment); setBusy(false); onDone(); }
    catch (failure) { setError(messageOf(failure)); setBusy(false); }
  }
  return <ActionDialog
    title={text.title}
    description={text.description}
    confirmLabel={text.confirm}
    danger={action !== 'approved'}
    busy={busy}
    error={error}
    onClose={onClose}
    onSubmit={submit}
  >
    <dl className="details"><dt>申请</dt><dd>#{request.id}</dd><dt>发起人</dt><dd>{request.requester.displayName} <small>@{request.requester.username}</small></dd><dt>药品</dt><dd><strong>{request.name}</strong><small>{request.specification}</small></dd><dt>位置</dt><dd>{request.cabinet} 柜 {request.shelf} 层</dd></dl>
    {action !== 'withdraw' && <label>{action === 'approved' ? '同意说明（可选）' : '拒绝说明（可选）'}<textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={3} autoFocus /></label>}
  </ActionDialog>;
}
