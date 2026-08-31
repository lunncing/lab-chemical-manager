import { useState, type FormEvent } from 'react';
import { ActionDialog } from './action-dialog.js';
import { api, ApiError } from './api.js';
import { Empty } from './components.js';
import type { PasswordResetRequest, Role } from './types.js';

export type PasswordResetDecision = 'approved' | 'rejected';

export function canReviewPasswordResetRequests(role: Role): boolean {
  return role === 'normal_admin' || role === 'super_admin';
}

function requestKind(request: PasswordResetRequest): string {
  return request.status === 'appealed' ? '密码修改申诉' : '密码修改申请';
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function PasswordResetQueue({ requests, onDecision }: {
  requests: PasswordResetRequest[];
  onDecision: (request: PasswordResetRequest, decision: PasswordResetDecision) => void;
}) {
  return <section className="password-reset-queue" aria-label="密码修改审批">
    <header><div><h2>密码修改审批（{requests.length}）</h2><p>管理员批准前必须人工核实申请人身份；此队列不受个人通知偏好影响。</p></div></header>
    {!requests.length ? <Empty>暂无待处理的密码修改申请或申诉</Empty> : <div className="password-reset-list">{requests.map((request) => <article key={request.id}>
      <div><strong>{requestKind(request)}</strong><p>{request.user.displayName} · @{request.user.username}</p><small>提交于 {formatTime(request.createdAt)} · 到期于 {formatTime(request.expiresAt)}</small>
        {request.appealReason && <blockquote><b>申诉理由</b><p>{request.appealReason}</p></blockquote>}
      </div>
      <div className="row-actions"><button type="button" className="approve" onClick={() => onDecision(request, 'approved')}>通过</button><button type="button" className="danger-text" onClick={() => onDecision(request, 'rejected')}>拒绝</button></div>
    </article>)}</div>}
  </section>;
}

export function passwordResetDecisionError(decision: PasswordResetDecision, value: string): string {
  return decision === 'rejected' && !value.trim() ? '拒绝必须填写说明' : '';
}

export async function submitPasswordResetDecision(request: PasswordResetRequest, decision: PasswordResetDecision, value: string): Promise<void> {
  const validationError = passwordResetDecisionError(decision, value);
  if (validationError) throw new Error(validationError);
  const comment = value.trim();
  await api(`/password-reset-requests/${request.id}/decision`, {
    method: 'POST', body: JSON.stringify({ decision, ...(comment ? { comment } : {}), version: request.version }),
  });
}

function messageOf(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : '操作失败，请重试';
}

export function PasswordResetDecisionDialog({ request, decision, onClose, onDone }: {
  request: PasswordResetRequest;
  decision: PasswordResetDecision;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const kind = requestKind(request); const approved = decision === 'approved';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const validationError = passwordResetDecisionError(decision, value);
    if (validationError) { setError(validationError); return; }
    setBusy(true); setError('');
    try { await submitPasswordResetDecision(request, decision, value); setBusy(false); onDone(); }
    catch (reason) { setError(messageOf(reason)); setBusy(false); }
  }
  return <ActionDialog
    title={`${approved ? '通过' : '拒绝'}${kind}`}
    description="作出决定前请确认已经人工核实身份；系统不会把姓名本身视为身份凭据。"
    confirmLabel={approved ? '确认通过' : '确认拒绝'}
    danger={!approved}
    busy={busy}
    error={error}
    onClose={onClose}
    onSubmit={submit}
  >
    <dl className="details"><dt>申请人</dt><dd>{request.user.displayName}<small>@{request.user.username}</small></dd><dt>类型</dt><dd>{kind}</dd><dt>到期时间</dt><dd>{formatTime(request.expiresAt)}</dd></dl>
    {request.appealReason && <div className="appeal-reason"><strong>申诉理由</strong><p>{request.appealReason}</p></div>}
    <label>{approved ? '审批说明（可选）' : '拒绝说明（必填）'}<textarea value={value} onChange={(event) => setValue(event.target.value)} maxLength={1000} rows={4} required={!approved} autoFocus /></label>
  </ActionDialog>;
}
