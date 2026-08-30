import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from './api.js';
import type { CreatedRegistrationInvite, RegistrationInvite, RegistrationInviteStatus } from './types.js';
import { ActionDialog } from './action-dialog.js';

const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const messageOf = (error: unknown) => error instanceof ApiError ? error.message : '操作失败，请重试';

export const inviteStatusLabel: Record<RegistrationInviteStatus, string> = {
  active: '有效', used: '已使用', revoked: '已撤销', expired: '已过期',
};

export async function loadInvites(): Promise<RegistrationInvite[]> {
  return (await api<{ invites: RegistrationInvite[] }>('/registration-invites')).invites;
}

export async function createInvite(): Promise<CreatedRegistrationInvite> {
  return (await api<{ invite: CreatedRegistrationInvite }>('/registration-invites', { method: 'POST' })).invite;
}

export async function revokeInvite(invite: RegistrationInvite): Promise<RegistrationInvite> {
  return (await api<{ invite: RegistrationInvite }>(`/registration-invites/${invite.id}/revoke`, { method: 'POST', body: JSON.stringify({ version: invite.version }) })).invite;
}

export function GeneratedInviteNotice({ invite, onCopy }: { invite: CreatedRegistrationInvite; onCopy: () => void }) {
  return <section className="invite-reveal" aria-live="polite">
    <div><strong>邀请码已生成</strong><p>只显示本次，请立即复制</p></div>
    <code>{invite.code}</code>
    <p>过期时间：{formatTime(invite.expiresAt)}</p>
    <button type="button" className="primary" onClick={onCopy}>复制邀请码</button>
  </section>;
}

export function InviteTable({ invites, onRevoke }: { invites: RegistrationInvite[]; onRevoke: (invite: RegistrationInvite) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>提示</th><th>创建人</th><th>创建时间</th><th>过期时间</th><th>状态</th><th>使用人 / 时间</th><th>操作</th></tr></thead><tbody>
    {invites.length === 0 ? <tr><td colSpan={7}>暂无邀请码</td></tr> : invites.map((invite) => <tr key={invite.id}>
      <td><code>{invite.codeHint}</code></td><td>{invite.creator.displayName}<small className="cell-subtitle">@{invite.creator.username}</small></td>
      <td>{formatTime(invite.createdAt)}</td><td>{formatTime(invite.expiresAt)}</td><td><span className={`invite-status ${invite.status}`}>{inviteStatusLabel[invite.status]}</span></td>
      <td>{invite.usedBy ? <>{invite.usedBy.displayName}<small className="cell-subtitle">@{invite.usedBy.username} · {formatTime(invite.usedAt)}</small></> : '—'}</td>
      <td>{invite.status === 'active' ? <button type="button" onClick={() => onRevoke(invite)}>撤销</button> : '—'}</td>
    </tr>)}
  </tbody></table></div>;
}

export function InviteRevokeDialog({ invite, onClose, onDone }: { invite: RegistrationInvite; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { await revokeInvite(invite); setBusy(false); onDone(); }
    catch (reason) { setError(messageOf(reason)); setBusy(false); }
  }
  return <ActionDialog
    title="撤销邀请码"
    description="撤销后不能再用于注册，已经使用的邀请码和历史记录不会改变。"
    confirmLabel="确认撤销"
    danger
    busy={busy}
    error={error}
    onClose={onClose}
    onSubmit={submit}
  >
    <p className="dialog-summary"><strong>{invite.codeHint}</strong><br />创建人：{invite.creator.displayName}</p>
  </ActionDialog>;
}

export function InviteManagementView({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [invites, setInvites] = useState<RegistrationInvite[]>([]);
  const [revealed, setRevealed] = useState<CreatedRegistrationInvite | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<RegistrationInvite | null>(null);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { let current = true; loadInvites().then((items) => { if (current) { setInvites(items); setError(''); } }).catch((reason) => { if (current) setError(messageOf(reason)); }); return () => { current = false; }; }, [revision]);

  async function generate() {
    setBusy(true); setError(''); setMessage('');
    try { setRevealed(await createInvite()); onChanged(); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }
  async function copy() {
    if (!revealed) return;
    try { await navigator.clipboard.writeText(revealed.code); setMessage('邀请码已复制'); } catch { setError('复制失败，请手动复制邀请码'); }
  }

  return <><header className="page-header"><div><p className="eyebrow">ACCESS / 注册</p><h1>邀请码管理</h1><p>生成一次性、7 天有效的成员注册链接凭证。完整邀请码只显示一次。</p></div><button type="button" className="primary" disabled={busy} onClick={generate}>{busy ? '生成中…' : '＋ 生成邀请码'}</button></header>
    {revealed && <GeneratedInviteNotice invite={revealed} onCopy={copy} />}
    {message && <div className="status success" role="status">{message}</div>}{error && <div className="status error" role="alert">{error}</div>}
    <InviteTable invites={invites} onRevoke={(invite) => { setMessage(''); setError(''); setPendingRevoke(invite); }} />
    {pendingRevoke && <InviteRevokeDialog invite={pendingRevoke} onClose={() => setPendingRevoke(null)} onDone={() => { setPendingRevoke(null); setMessage('邀请码已撤销'); onChanged(); }} />}
  </>;
}
