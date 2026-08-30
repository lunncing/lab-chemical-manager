import { useState, type FormEvent } from 'react';
import { ActionDialog } from './action-dialog.js';
import { api, ApiError } from './api.js';
import { RoleOptions } from './role-labels.js';
import { roles, type Role } from '../../shared/types.js';
import type { UserView } from './types.js';

export type AccountDialogAction = 'edit' | 'toggle' | 'delete';
export interface AccountEditValues { displayName: string; role: Role; password: string; passwordConfirm: string; }

const messageOf = (error: unknown) => error instanceof ApiError || error instanceof Error ? error.message : '操作失败，请重试';

export function accountEditError(values: AccountEditValues): string {
  if (!values.displayName.trim()) return '姓名不能为空';
  if (values.displayName.trim().length > 100) return '姓名不能超过 100 个字符';
  if (!roles.includes(values.role)) return '角色无效';
  if (!values.password && !values.passwordConfirm) return '';
  if (values.password.length < 10) return '新密码至少需要 10 个字符';
  if (values.password.length > 200) return '新密码不能超过 200 个字符';
  if (values.password !== values.passwordConfirm) return '两次输入的新密码不一致';
  return '';
}

export function buildAccountEditPayload(account: UserView, values: AccountEditValues) {
  const validationError = accountEditError(values);
  if (validationError) throw new Error(validationError);
  return {
    displayName: values.displayName.trim(), role: values.role,
    ...(values.password ? { password: values.password } : {}), version: account.version,
  };
}

export async function saveAccountEdit(account: UserView, values: AccountEditValues): Promise<void> {
  await api(`/users/${account.id}`, { method: 'PATCH', body: JSON.stringify(buildAccountEditPayload(account, values)) });
}

export async function toggleManagedAccount(account: UserView): Promise<void> {
  await api(`/users/${account.id}`, { method: 'PATCH', body: JSON.stringify({ active: !account.active, version: account.version }) });
}

export async function deleteManagedAccount(account: UserView): Promise<void> {
  await api(`/users/${account.id}`, { method: 'DELETE' });
}

export function canDeleteAccount(account: UserView, confirmation: string): boolean { return confirmation === account.username; }

export function AccountRowActions({ account, currentUserId, onAction }: {
  account: UserView; currentUserId: number; onAction: (account: UserView, action: AccountDialogAction) => void;
}) {
  return <div className="row-actions">
    <button type="button" onClick={() => onAction(account, 'edit')}>编辑</button>
    <button type="button" onClick={() => onAction(account, 'toggle')}>{account.active ? '停用' : '启用'}</button>
    {account.id !== currentUserId && <button type="button" className="danger-text" onClick={() => onAction(account, 'delete')}>删除</button>}
  </div>;
}

export function AccountActionDialog({ account, action, onClose, onDone }: {
  account: UserView; action: AccountDialogAction; onClose: () => void; onDone: () => void;
}) {
  const [displayName, setDisplayName] = useState(account.displayName); const [role, setRole] = useState<Role>(account.role);
  const [password, setPassword] = useState(''); const [passwordConfirm, setPasswordConfirm] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const disabling = action === 'toggle' && account.active;
  const title = action === 'edit' ? '编辑账号' : action === 'delete' ? '删除账号' : disabling ? '停用账号' : '启用账号';
  const description = action === 'edit'
    ? '可修改姓名和角色；新密码留空表示保持现有密码。'
    : action === 'delete'
      ? '删除不可逆。账号将匿名化，历史业务记录会保留，但该账号无法恢复或登录。'
      : disabling ? '停用后该账号无法登录，之后可以重新启用。' : '启用后该账号可以再次登录。';
  const confirmLabel = action === 'edit' ? '保存修改' : action === 'delete' ? '确认删除' : disabling ? '确认停用' : '确认启用';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action === 'edit') {
      const validationError = accountEditError({ displayName, role, password, passwordConfirm });
      if (validationError) { setError(validationError); return; }
    }
    if (action === 'delete' && !canDeleteAccount(account, confirmation)) { setError(`请输入 ${account.username} 确认删除`); return; }
    setBusy(true); setError('');
    try {
      if (action === 'edit') await saveAccountEdit(account, { displayName, role, password, passwordConfirm });
      else if (action === 'toggle') await toggleManagedAccount(account);
      else await deleteManagedAccount(account);
      setBusy(false); onDone();
    } catch (failure) { setError(messageOf(failure)); setBusy(false); }
  }
  return <ActionDialog
    title={title}
    description={description}
    confirmLabel={confirmLabel}
    danger={action === 'delete' || disabling}
    busy={busy}
    error={error}
    submitDisabled={action === 'delete' && !canDeleteAccount(account, confirmation)}
    onClose={onClose}
    onSubmit={submit}
  >
    <p className="dialog-summary"><strong>{account.displayName}</strong><br />@{account.username}</p>
    {action === 'edit' && <div className="form-grid dialog-form-grid">
      <label>姓名<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={100} required autoFocus /></label>
      <label>角色<select value={role} onChange={(event) => setRole(event.target.value as Role)}><RoleOptions /></select></label>
      <label>新密码（可选）<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={200} /></label>
      <label>确认新密码<input type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} minLength={10} maxLength={200} /></label>
    </div>}
    {action === 'delete' && <label>输入用户名 {account.username} 确认删除<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required autoFocus /></label>}
  </ActionDialog>;
}
