import { useState, type FormEvent } from 'react';
import { api, ApiError } from './api.js';
import { Status } from './components.js';

export type PasswordRecoveryLookupState = 'verify_current' | 'pending' | 'appealed' | 'approved' | 'rejected';
export type PasswordRecoveryScreen =
  | { stage: 'lookup' }
  | { stage: 'verify_current'; displayName: string }
  | { stage: 'request_confirm'; displayName: string }
  | { stage: 'approved'; displayName: string }
  | { stage: 'waiting'; displayName: string; requestState: 'pending' | 'appealed' }
  | { stage: 'rejected'; displayName: string }
  | { stage: 'appeal'; displayName: string };

export interface CurrentPasswordChangeInput {
  displayName: string;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
}

export interface ApprovedPasswordResetInput { newPassword: string; newPasswordConfirm: string; }

export function recoveryScreenFromLookup(displayName: string, state: PasswordRecoveryLookupState): PasswordRecoveryScreen {
  if (state === 'pending' || state === 'appealed') return { stage: 'waiting', displayName, requestState: state };
  return { stage: state, displayName };
}

export async function lookupPasswordRecovery(displayName: string): Promise<PasswordRecoveryLookupState> {
  const normalized = displayName.trim();
  return (await api<{ state: PasswordRecoveryLookupState }>('/password-recovery/lookup', {
    method: 'POST', body: JSON.stringify({ displayName: normalized }),
  })).state;
}

export async function changePasswordWithCurrent(input: CurrentPasswordChangeInput): Promise<void> {
  await api('/password-recovery/change-with-current', { method: 'POST', body: JSON.stringify(input) });
}

export async function requestPasswordRecovery(displayName: string): Promise<'pending'> {
  return (await api<{ state: 'pending' }>('/password-recovery/request', {
    method: 'POST', body: JSON.stringify({ displayName: displayName.trim() }),
  })).state;
}

export async function resetApprovedPassword(input: ApprovedPasswordResetInput): Promise<void> {
  await api('/password-recovery/reset-approved', { method: 'POST', body: JSON.stringify(input) });
}

export async function appealPasswordRecovery(reason: string): Promise<'appealed'> {
  return (await api<{ state: 'appealed' }>('/password-recovery/appeal', {
    method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
  })).state;
}

interface ScreenViewProps {
  screen: PasswordRecoveryScreen;
  busy: boolean;
  error: string;
  onLookup: (displayName: string) => void;
  onBack: () => void;
  onForgot: () => void;
  onChangeWithCurrent: (input: CurrentPasswordChangeInput) => void;
  onRequest: () => void;
  onResetApproved: (input: ApprovedPasswordResetInput) => void;
  onStartAppeal: () => void;
  onAppeal: (reason: string) => void;
}

function RecoveryHeader({ step, title, displayName }: { step: number; title: string; displayName?: string }) {
  return <header className="recovery-header"><p className="eyebrow">第 {step} 步 / 7</p><h2>{title}</h2>{displayName && <p>账号姓名：<strong>{displayName}</strong></p>}</header>;
}

function FormError({ error }: { error: string }) { return error ? <Status kind="error">{error}</Status> : null; }

function BackToLogin({ onBack, busy }: { onBack: () => void; busy: boolean }) {
  return <button type="button" onClick={onBack} disabled={busy}>返回登录页</button>;
}

export function PasswordRecoveryScreenView(props: ScreenViewProps) {
  const { screen, busy, error } = props;
  if (screen.stage === 'lookup') return <section className="recovery-flow">
    <RecoveryHeader step={1} title="按姓名查询账号" />
    <form onSubmit={(event) => { event.preventDefault(); props.onLookup(String(new FormData(event.currentTarget).get('displayName') ?? '')); }}>
      <label>姓名<input name="displayName" autoComplete="name" maxLength={100} required autoFocus /></label>
      <FormError error={error} />
      <div className="form-actions recovery-actions"><BackToLogin onBack={props.onBack} busy={busy} /><button className="primary" disabled={busy}>{busy ? '查询中…' : '查询账号'}</button></div>
    </form>
  </section>;

  if (screen.stage === 'verify_current') return <section className="recovery-flow">
    <RecoveryHeader step={2} title="使用原密码修改" displayName={screen.displayName} />
    <form onSubmit={(event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      props.onChangeWithCurrent({
        displayName: screen.displayName,
        currentPassword: String(data.get('currentPassword') ?? ''),
        newPassword: String(data.get('newPassword') ?? ''),
        newPasswordConfirm: String(data.get('newPasswordConfirm') ?? ''),
      });
    }}>
      <label>原密码<input name="currentPassword" type="password" autoComplete="current-password" maxLength={200} required autoFocus /></label>
      <button type="button" className="text-button" onClick={props.onForgot} disabled={busy}>忘记原密码？</button>
      <label>新密码<input name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></label>
      <label>确认新密码<input name="newPasswordConfirm" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></label>
      <FormError error={error} />
      <div className="form-actions recovery-actions"><BackToLogin onBack={props.onBack} busy={busy} /><button className="primary" disabled={busy}>{busy ? '修改中…' : '确认修改'}</button></div>
    </form>
  </section>;

  if (screen.stage === 'request_confirm') return <section className="recovery-flow">
    <RecoveryHeader step={3} title="申请忘记密码恢复" displayName={screen.displayName} />
    <Status kind="info">管理员会先人工核实申请人身份。申请批准后，只有当前浏览器可以继续设置新密码。</Status>
    <FormError error={error} />
    <div className="form-actions recovery-actions"><BackToLogin onBack={props.onBack} busy={busy} /><button type="button" className="primary" onClick={props.onRequest} disabled={busy}>{busy ? '提交中…' : '提交申请'}</button></div>
  </section>;

  if (screen.stage === 'approved') return <section className="recovery-flow">
    <RecoveryHeader step={4} title="申请已批准" displayName={screen.displayName} />
    <form onSubmit={(event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      props.onResetApproved({ newPassword: String(data.get('newPassword') ?? ''), newPasswordConfirm: String(data.get('newPasswordConfirm') ?? '') });
    }}>
      <label>新密码<input name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={200} required autoFocus /></label>
      <label>确认新密码<input name="newPasswordConfirm" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></label>
      <FormError error={error} />
      <div className="form-actions recovery-actions"><BackToLogin onBack={props.onBack} busy={busy} /><button className="primary" disabled={busy}>{busy ? '重置中…' : '完成密码重置'}</button></div>
    </form>
  </section>;

  if (screen.stage === 'waiting') return <section className="recovery-flow">
    <RecoveryHeader step={5} title={screen.requestState === 'appealed' ? '申诉等待审批' : '申请等待审批'} displayName={screen.displayName} />
    <Status kind="info">已有一个待审批的密码修改申请，请等待</Status>
    <div className="form-actions recovery-actions"><BackToLogin onBack={props.onBack} busy={busy} /></div>
  </section>;

  if (screen.stage === 'rejected') return <section className="recovery-flow">
    <RecoveryHeader step={6} title="密码修改申请被拒绝" displayName={screen.displayName} />
    <Status kind="error">管理员已拒绝，您可以提交申诉</Status>
    <FormError error={error} />
    <div className="form-actions recovery-actions"><BackToLogin onBack={props.onBack} busy={busy} /><button type="button" className="primary" onClick={props.onStartAppeal} disabled={busy}>确认并申诉</button></div>
  </section>;

  return <section className="recovery-flow">
    <RecoveryHeader step={7} title="提交密码修改申诉" displayName={screen.displayName} />
    <form onSubmit={(event) => { event.preventDefault(); props.onAppeal(String(new FormData(event.currentTarget).get('reason') ?? '')); }}>
      <label>申诉理由<textarea name="reason" rows={5} maxLength={1000} required autoFocus /></label>
      <FormError error={error} />
      <div className="form-actions recovery-actions"><BackToLogin onBack={props.onBack} busy={busy} /><button className="primary" disabled={busy}>{busy ? '提交中…' : '提交申诉并申请'}</button></div>
    </form>
  </section>;
}

function messageOf(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : '操作失败，请重试';
}

export function PasswordRecoveryFlow({ onBack, onComplete }: { onBack: () => void; onComplete: (message: string) => void }) {
  const [screen, setScreen] = useState<PasswordRecoveryScreen>({ stage: 'lookup' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };
  const displayName = 'displayName' in screen ? screen.displayName : '';
  return <PasswordRecoveryScreenView
    screen={screen} busy={busy} error={error}
    onBack={onBack}
    onLookup={(name) => { void run(async () => { const normalized = name.trim(); const state = await lookupPasswordRecovery(normalized); setScreen(recoveryScreenFromLookup(normalized, state)); }); }}
    onForgot={() => { setError(''); setScreen({ stage: 'request_confirm', displayName }); }}
    onChangeWithCurrent={(input) => { void run(async () => { await changePasswordWithCurrent(input); onComplete('密码修改成功，请使用新密码登录'); }); }}
    onRequest={() => { void run(async () => { await requestPasswordRecovery(displayName); setScreen({ stage: 'waiting', displayName, requestState: 'pending' }); }); }}
    onResetApproved={(input) => { void run(async () => { await resetApprovedPassword(input); onComplete('密码重置成功，请使用新密码登录'); }); }}
    onStartAppeal={() => { setError(''); setScreen({ stage: 'appeal', displayName }); }}
    onAppeal={(reason) => { void run(async () => { await appealPasswordRecovery(reason); setScreen({ stage: 'waiting', displayName, requestState: 'appealed' }); }); }}
  />;
}
