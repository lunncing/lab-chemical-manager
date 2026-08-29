import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, ApiError } from './api.js';
import { AccountsView, AuditView, InventoryView, NotificationsView, PurchasesView, PurchaseTaskView } from './views.js';
import type { Role, UserView } from './types.js';
import { revisionEvents } from './realtime-events.js';
import type { PurchaseTaskSummaryValue } from './purchase-tasks-ui.js';
import { roleLabel } from './role-labels.js';

export type View = 'inventory' | 'purchases' | 'approvals' | 'procurement' | 'audit' | 'notifications' | 'accounts';
export const taskSummaryPath = '/purchases/tasks/summary';

const approvalRoles: Role[] = ['normal_admin', 'super_admin'];
const procurementRoles: Role[] = ['normal_admin', 'hazardous_buyer', 'super_admin'];

export function safeViewForRole(view: View, role: Role): View {
  if (view === 'approvals' && !approvalRoles.includes(role)) return 'inventory';
  if (view === 'procurement' && !procurementRoles.includes(role)) return 'inventory';
  if (view === 'accounts' && role !== 'super_admin') return 'inventory';
  return view;
}

export function PrimaryNavigation({ role, view, summary, unread, onView }: {
  role: Role; view: View; summary: PurchaseTaskSummaryValue; unread: number; onView: (view: View) => void;
}) {
  const nav: Array<[View, string]> = [['inventory', '首页药品柜'], ['purchases', '采购申请']];
  if (approvalRoles.includes(role)) nav.push(['approvals', `待审批（${summary.approvalCount}）`]);
  if (procurementRoles.includes(role)) nav.push(['procurement', `待采购（${summary.procurementCount}）`]);
  nav.push(['audit', '改动日志'], ['notifications', `消息${unread ? ` (${unread})` : ''}`]);
  if (role === 'super_admin') nav.push(['accounts', '账号管理']);
  return <nav aria-label="主导航">{nav.map(([key, label]) => <button key={key} aria-current={view === key ? 'page' : undefined} onClick={() => onView(key)}>{label}</button>)}</nav>;
}

export function App() {
  const [user, setUser] = useState<UserView | null>(null); const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>('inventory'); const [revision, setRevision] = useState(0); const [unread, setUnread] = useState(0);
  const [taskSummary, setTaskSummary] = useState<PurchaseTaskSummaryValue>({ approvalCount: 0, procurementCount: 0 });
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => { api<{ user: UserView }>('/auth/me').then((value) => setUser(value.user)).catch(() => undefined).finally(() => setChecking(false)); }, []);
  useEffect(() => {
    if (!user) return;
    api<PurchaseTaskSummaryValue>(taskSummaryPath).then(setTaskSummary).catch(() => undefined);
  }, [user, revision]);
  useEffect(() => {
    if (!user) return;
    setView((current) => safeViewForRole(current, user.role));
  }, [user]);
  useEffect(() => {
    if (!user) return;
    api<{ unreadCount: number }>('/notifications/unread-count').then((value) => setUnread(value.unreadCount)).catch(() => undefined);
    const socket: Socket = io({ path: '/socket.io' });
    const changed = () => refresh(); const notification = () => { refresh(); setUnread((value) => value + 1); };
    for (const event of revisionEvents) socket.on(event, changed);
    socket.on('notification:created', notification).on('notifications:read', changed).on('notifications:read-all', () => setUnread(0)).on('preferences:changed', changed);
    return () => { socket.close(); };
  }, [user, refresh]);
  if (checking) return <main className="center"><div className="loader" />正在连接实验室数据…</main>;
  if (!user) return <Login onLogin={setUser} />;

  const activeView = safeViewForRole(view, user.role);
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">LSF</span><div><strong>李少锋课题组</strong><small>药品管理</small></div></div>
      <PrimaryNavigation role={user.role} view={activeView} summary={taskSummary} unread={unread} onView={setView} />
      <div className="identity"><span>{user.displayName}</span><small>{roleLabel(user.role)} · @{user.username}</small><button onClick={async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); }}>退出登录</button></div>
    </aside>
    <main className="workspace">
      {activeView === 'inventory' && <InventoryView user={user} revision={revision} onChanged={refresh} />}
      {activeView === 'purchases' && <PurchasesView user={user} revision={revision} onChanged={refresh} />}
      {activeView === 'approvals' && <PurchaseTaskView mode="approvals" user={user} revision={revision} onChanged={refresh} />}
      {activeView === 'procurement' && <PurchaseTaskView mode="procurement" user={user} revision={revision} onChanged={refresh} />}
      {activeView === 'audit' && <AuditView revision={revision} />}
      {activeView === 'notifications' && <NotificationsView user={user} revision={revision} onChanged={(count) => { if (count !== undefined) setUnread(count); else refresh(); }} />}
      {activeView === 'accounts' && user.role === 'super_admin' && <AccountsView revision={revision} onChanged={refresh} />}
    </main>
  </div>;
}

export function Login({ onLogin }: { onLogin: (user: UserView) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <main className="login-page"><section className="login-panel">
    <div className="brand login-brand"><span className="brand-mark">LSF</span><div><h1>李少锋课题组 · 药品管理</h1><p>实验室药品操作台</p></div></div>
    <div className="auth-modes" aria-label="登录或注册"><button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>登录</button><button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>注册</button></div>
    {mode === 'login' ? <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { onLogin((await api<{ user: UserView }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })).user); } catch (reason) { setError(reason instanceof ApiError ? reason.message : '登录失败'); } finally { setBusy(false); } }}>
      <label>用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
      <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {error && <div className="status error" role="alert">{error}</div>}<button className="primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
    </form> : <RegisterForm onAuthenticated={onLogin} />}
  </section></main>;
}

export interface RegistrationInput { username: string; displayName: string; password: string; passwordConfirm: string; }

export async function registerAccount(input: RegistrationInput): Promise<UserView> {
  return (await api<{ user: UserView }>('/auth/register', { method: 'POST', body: JSON.stringify(input) })).user;
}

export function RegisterForm({ onAuthenticated }: { onAuthenticated: (user: UserView) => void }) {
  const [username, setUsername] = useState(''); const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState(''); const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { onAuthenticated(await registerAccount({ username, displayName, password, passwordConfirm })); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : '注册失败，请重试'); }
    finally { setBusy(false); }
  }}>
    <label>用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={80} pattern="[a-zA-Z0-9._-]+" required /></label>
    <label>姓名<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={100} required /></label>
    <label>密码<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={200} required /></label>
    <label>确认密码<input type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} minLength={10} maxLength={200} required /></label>
    <p className="registration-note">注册账号默认为普通成员，管理员权限由超级管理员设置</p>
    {error && <div className="status error" role="alert">{error}</div>}<button className="primary" disabled={busy}>{busy ? '注册中…' : '注册并登录'}</button>
  </form>;
}
