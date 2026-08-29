import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, ApiError } from './api.js';
import { AccountsView, AuditView, InventoryView, NotificationsView, PurchasesView } from './views.js';
import type { UserView } from './types.js';

type View = 'inventory' | 'purchases' | 'audit' | 'notifications' | 'accounts';

export function App() {
  const [user, setUser] = useState<UserView | null>(null); const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>('inventory'); const [revision, setRevision] = useState(0); const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => { api<{ user: UserView }>('/auth/me').then((value) => setUser(value.user)).catch(() => undefined).finally(() => setChecking(false)); }, []);
  useEffect(() => {
    if (!user) return;
    api<{ unreadCount: number }>('/notifications/unread-count').then((value) => setUnread(value.unreadCount)).catch(() => undefined);
    const socket: Socket = io({ path: '/socket.io' });
    const changed = () => refresh(); const notification = () => { refresh(); setUnread((value) => value + 1); };
    socket.on('chemical:changed', changed).on('purchase:changed', changed).on('audit:created', changed).on('notification:created', notification).on('notifications:read', changed).on('notifications:read-all', () => setUnread(0)).on('preferences:changed', changed);
    return () => { socket.close(); };
  }, [user, refresh]);
  if (checking) return <main className="center"><div className="loader" />正在连接实验室数据…</main>;
  if (!user) return <Login onLogin={setUser} />;

  const nav: Array<[View, string]> = [['inventory', '首页药品柜'], ['purchases', '采购申请'], ['audit', '改动日志'], ['notifications', `消息${unread ? ` (${unread})` : ''}`]];
  if (user.role === 'super_admin') nav.push(['accounts', '账号管理']);
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">LSF</span><div><strong>李少锋课题组</strong><small>药品管理</small></div></div>
      <nav aria-label="主导航">{nav.map(([key, label]) => <button key={key} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}>{label}</button>)}</nav>
      <div className="identity"><span>{user.displayName}</span><small>{roleName(user.role)} · @{user.username}</small><button onClick={async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); }}>退出登录</button></div>
    </aside>
    <main className="workspace">
      {view === 'inventory' && <InventoryView user={user} revision={revision} onChanged={refresh} />}
      {view === 'purchases' && <PurchasesView user={user} revision={revision} onChanged={refresh} />}
      {view === 'audit' && <AuditView revision={revision} />}
      {view === 'notifications' && <NotificationsView revision={revision} onChanged={(count) => { refresh(); if (count !== undefined) setUnread(count); }} />}
      {view === 'accounts' && user.role === 'super_admin' && <AccountsView revision={revision} onChanged={refresh} />}
    </main>
  </div>;
}

function Login({ onLogin }: { onLogin: (user: UserView) => void }) {
  const [username, setUsername] = useState('member-a'); const [password, setPassword] = useState('Demo1234!'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <main className="login-page"><section className="login-panel">
    <div className="brand login-brand"><span className="brand-mark">LSF</span><div><h1>李少锋课题组 · 药品管理</h1><p>实验室药品操作台</p></div></div>
    <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { onLogin((await api<{ user: UserView }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })).user); } catch (reason) { setError(reason instanceof ApiError ? reason.message : '登录失败'); } finally { setBusy(false); } }}>
      <label>用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
      <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {error && <div className="status error" role="alert">{error}</div>}<button className="primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
    </form>
    <div className="demo-note"><strong>首测演示凭据（仅限首次测试）</strong><p>teacher / admin / hazard / member-a / member-b</p><p>统一密码：<code>Demo1234!</code>。部署后请立即创建真实账号并停用演示账号。</p></div>
  </section></main>;
}

function roleName(role: UserView['role']) { return { member: '普通成员', normal_admin: '普通管理员', super_admin: '超级管理员', hazardous_buyer: '危险品采购人' }[role]; }
