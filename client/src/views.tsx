import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from './api.js';
import { CabinetBoard, canApprove, Empty, Modal, Status } from './components.js';
import type { AuditLog, Chemical, NotificationItem, Purchase, UserView } from './types.js';
import { notificationCategories, roles } from '../../shared/types.js';

function messageOf(error: unknown) { return error instanceof ApiError ? error.message : '操作失败，请重试'; }
const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

export function InventoryView({ user, revision, onChanged }: { user: UserView; revision: number; onChanged: () => void }) {
  const [chemicals, setChemicals] = useState<Chemical[]>([]); const [members, setMembers] = useState<UserView[]>([]); const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Chemical | null>(null); const [showInbound, setShowInbound] = useState(false); const [error, setError] = useState('');
  useEffect(() => { Promise.all([api<{ chemicals: Chemical[] }>(`/chemicals${search ? `?search=${encodeURIComponent(search)}` : ''}`), api<{ users: UserView[] }>('/members')]).then(([stock, people]) => { setChemicals(stock.chemicals); setMembers(people.users); setError(''); }).catch((reason) => setError(messageOf(reason))); }, [revision, search]);
  return <><header className="page-header"><div><p className="eyebrow">OPERATE / 库存</p><h1>药品柜</h1><p>点击药品查看详情、调动或废弃。柜层由上到下为 1–5。</p></div><button className="primary" onClick={() => setShowInbound(true)}>＋ 药品入库</button></header>
    <div className="toolbar"><label className="search">搜索药品<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称 / 规格 / 归属人" /></label><span>{chemicals.length} 件活动库存</span></div>
    {error && <Status kind="error">{error}</Status>}<CabinetBoard chemicals={chemicals} onChemical={setSelected} />
    {showInbound && <InboundModal user={user} members={members} onClose={() => setShowInbound(false)} onDone={() => { setShowInbound(false); onChanged(); }} />}
    {selected && <ChemicalModal chemical={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); onChanged(); }} />}
  </>;
}

function InboundModal({ user, members, onClose, onDone }: { user: UserView; members: UserView[]; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title="药品入库" onClose={onClose}><form className="form-grid" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError(''); const data = new FormData(event.currentTarget);
    try { await api('/chemicals', { method: 'POST', body: JSON.stringify({ name: data.get('name'), specification: data.get('specification'), ownerId: Number(data.get('ownerId')), inboundAt: new Date(String(data.get('inboundAt'))).toISOString(), cabinet: data.get('cabinet'), shelf: Number(data.get('shelf')) }) }); onDone(); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }}>
    <label>药品名称<input name="name" required autoFocus /></label><label>规格<input name="specification" required /></label>
    <label>归属人<select name="ownerId" defaultValue={user.id}>{members.map((member) => <option value={member.id} key={member.id}>{member.displayName} (@{member.username})</option>)}</select></label>
    <label>入库时间<input name="inboundAt" type="datetime-local" required defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} /></label>
    <label>柜号<select name="cabinet"><option value="A">A · 常温柜</option><option value="B">B · 冷藏柜</option></select></label>
    <label>柜层<select name="shelf">{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
    {error && <Status kind="error">{error}</Status>}<div className="form-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy ? '保存中…' : '确认入库'}</button></div>
  </form></Modal>;
}

function ChemicalModal({ chemical, onClose, onDone }: { chemical: Chemical; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [cabinet, setCabinet] = useState(chemical.cabinet); const [shelf, setShelf] = useState(chemical.shelf);
  async function move() { setBusy(true); setError(''); try { await api(`/chemicals/${chemical.id}/move`, { method: 'PATCH', body: JSON.stringify({ cabinet, shelf, version: chemical.version }) }); onDone(); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } }
  async function discard() { if (!confirm(`确认废弃“${chemical.name}”？该操作会保留审计记录。`)) return; const reason = prompt('废弃原因（可选）') ?? undefined; setBusy(true); try { await api(`/chemicals/${chemical.id}/discard`, { method: 'PATCH', body: JSON.stringify({ confirmed: true, reason: reason || undefined, version: chemical.version }) }); onDone(); } catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); } }
  return <Modal title={chemical.name} onClose={onClose}><dl className="details"><dt>规格</dt><dd>{chemical.specification}</dd><dt>归属人</dt><dd>{chemical.owner.displayName}</dd><dt>入库操作</dt><dd>{chemical.inboundOperator.displayName}</dd><dt>入库时间</dt><dd>{formatTime(chemical.inboundAt)}</dd><dt>当前位置</dt><dd>{chemical.cabinet} 柜 {chemical.shelf} 层</dd><dt>版本</dt><dd>{chemical.version}</dd></dl>
    <fieldset><legend>调动位置</legend><div className="inline-fields"><select value={cabinet} onChange={(event) => setCabinet(event.target.value as 'A' | 'B')}><option>A</option><option>B</option></select><select value={shelf} onChange={(event) => setShelf(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value} 层</option>)}</select><button className="primary" disabled={busy} onClick={move}>调动</button></div></fieldset>
    {error && <Status kind="error">{error}</Status>}<div className="danger-zone"><button className="danger" disabled={busy} onClick={discard}>废弃药品</button></div>
  </Modal>;
}

export function PurchasesView({ user, revision, onChanged }: { user: UserView; revision: number; onChanged: () => void }) {
  const [purchases, setPurchases] = useState<Purchase[]>([]); const [scope, setScope] = useState('all'); const [status, setStatus] = useState(''); const [kind, setKind] = useState(''); const [hazardous, setHazardous] = useState(''); const [error, setError] = useState(''); const [showCreate, setShowCreate] = useState(false);
  useEffect(() => { const query = new URLSearchParams(); if (scope === 'mine') query.set('scope', 'mine'); if (status) query.set('status', status); if (kind) query.set('requestType', kind); if (hazardous) query.set('hazardous', hazardous); api<{ purchases: Purchase[] }>(`/purchases?${query}`).then((value) => { setPurchases(value.purchases); setError(''); }).catch((reason) => setError(messageOf(reason))); }, [revision, scope, status, kind, hazardous]);
  async function action(purchase: Purchase, actionName: 'edit' | 'withdraw' | 'approved' | 'deferred' | 'rejected') {
    try {
      if (actionName === 'edit') { const purpose = prompt('修改用途说明', purchase.purpose); if (!purpose) return; await api(`/purchases/${purchase.id}`, { method: 'PATCH', body: JSON.stringify({ purpose, version: purchase.version }) }); }
      else if (actionName === 'withdraw') { if (!confirm('确认撤销此申请？')) return; await api(`/purchases/${purchase.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: purchase.version }) }); }
      else { const comment = actionName === 'approved' ? (prompt('审批意见（可选）') ?? '') : prompt(actionName === 'deferred' ? '推迟说明（必填）' : '驳回说明（必填）'); if (comment === null || (actionName !== 'approved' && !comment.trim())) return; await api(`/purchases/${purchase.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: actionName, comment: comment || undefined, version: purchase.version }) }); }
      onChanged();
    } catch (reason) { setError(messageOf(reason)); }
  }
  return <><header className="page-header"><div><p className="eyebrow">OPERATE / 采购</p><h1>采购申请</h1><p>全体成员可查看；修改、撤销和审批权限由服务端校验。</p></div><button className="primary" onClick={() => setShowCreate(true)}>＋ 新建申请</button></header>
    <div className="tabs"><button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>全部申请</button><button aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>我的申请</button>
      {(user.role === 'normal_admin' || user.role === 'super_admin') && <><button onClick={() => loadCatalog('normal', setPurchases, setError)}>普通周目录</button><button onClick={() => loadCatalog('urgent', setPurchases, setError)}>加急目录</button></>}
      {(user.role === 'hazardous_buyer' || user.role === 'super_admin') && <button onClick={() => loadCatalog('hazardous', setPurchases, setError)}>危险品队列</button>}
    </div>
    <div className="filters"><label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部</option>{['pending_normal','pending_super','approved','deferred','rejected','withdrawn'].map((value) => <option key={value}>{value}</option>)}</select></label><label>类型<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">全部</option><option value="normal">普通</option><option value="urgent">加急</option></select></label><label>危险品<select value={hazardous} onChange={(e) => setHazardous(e.target.value)}><option value="">全部</option><option value="true">是</option><option value="false">否</option></select></label></div>
    {error && <Status kind="error">{error}</Status>}{purchases.length ? <div className="table-wrap"><table><thead><tr><th>药品</th><th>申请人</th><th>类型</th><th>状态</th><th>用途 / 意见</th><th>操作</th></tr></thead><tbody>{purchases.map((purchase) => <tr key={purchase.id}><td><strong>{purchase.chemicalName}</strong><small>{purchase.specification}</small>{purchase.hazardous && <span className="badge danger-badge">危险品</span>}</td><td>{purchase.applicant.displayName}</td><td>{purchase.requestType === 'urgent' ? '加急' : '普通'}</td><td><span className={`badge status-${purchase.status}`}>{purchase.status}</span></td><td>{purchase.purpose}{purchase.approvalComment && <small>审批：{purchase.approvalComment}</small>}</td><td><div className="row-actions">{purchase.applicant.id === user.id && ['pending_normal','pending_super','deferred'].includes(purchase.status) && <><button onClick={() => action(purchase, 'edit')}>修改</button><button onClick={() => action(purchase, 'withdraw')}>撤销</button></>}{canApprove(user.role, purchase.requestType) && ['pending_normal','pending_super','deferred'].includes(purchase.status) && <><button className="approve" onClick={() => action(purchase, 'approved')}>通过</button><button onClick={() => action(purchase, 'deferred')}>推迟</button><button className="danger-text" onClick={() => action(purchase, 'rejected')}>驳回</button></>}</div></td></tr>)}</tbody></table></div> : <Empty>没有符合条件的采购申请</Empty>}
    {showCreate && <PurchaseCreate onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); onChanged(); }} />}
  </>;
}

async function loadCatalog(kind: string, set: (items: Purchase[]) => void, error: (value: string) => void) { try { set((await api<{ purchases: Purchase[] }>(`/purchases/catalog/${kind}`)).purchases); error(''); } catch (reason) { error(messageOf(reason)); } }
function PurchaseCreate({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('');
  return <Modal title="新建采购申请" onClose={onClose}><form className="form-grid" onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { await api('/purchases', { method: 'POST', body: JSON.stringify({ chemicalName: data.get('name'), specification: data.get('specification'), purpose: data.get('purpose'), hazardous: data.get('hazardous') === 'on', requestType: data.get('requestType') }) }); onDone(); } catch (reason) { setError(messageOf(reason)); } }}><label>药品信息<input name="name" required autoFocus /></label><label>规格<input name="specification" required /></label><label className="span-2">用途说明<textarea name="purpose" required rows={3} /></label><label>申请类型<select name="requestType"><option value="normal">普通</option><option value="urgent">加急</option></select></label><label className="checkbox"><input type="checkbox" name="hazardous" /> 危险品</label>{error && <Status kind="error">{error}</Status>}<div className="form-actions"><button type="button" onClick={onClose}>取消</button><button className="primary">提交申请</button></div></form></Modal>;
}

export function AuditView({ revision }: { revision: number }) {
  const [logs, setLogs] = useState<AuditLog[]>([]); const [error, setError] = useState('');
  useEffect(() => { api<{ logs: AuditLog[] }>('/audit-logs').then((value) => setLogs(value.logs)).catch((reason) => setError(messageOf(reason))); }, [revision]);
  return <><header className="page-header"><div><p className="eyebrow">MONITOR / 审计</p><h1>公开改动日志</h1><p>业务写入与日志同事务保存。日志只读且对所有登录用户公开。</p></div></header>{error && <Status kind="error">{error}</Status>}<div className="timeline">{logs.map((log) => <article key={log.id}><time>{formatTime(log.createdAt)}</time><div><strong>{log.summary}</strong><p>{log.actor.displayName} · {log.action} · {log.objectType} #{log.objectId}</p><details><summary>结构化详情</summary><pre>{JSON.stringify(log.details, null, 2)}</pre></details></div></article>)}</div>{!logs.length && !error && <Empty>尚无改动记录</Empty>}</>;
}

export function NotificationsView({ revision, onChanged }: { revision: number; onChanged: (unread?: number) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]); const [prefs, setPrefs] = useState<Array<{ category: string; enabled: boolean }>>([]); const [error, setError] = useState('');
  const load = () => Promise.all([api<{ notifications: NotificationItem[]; unreadCount: number }>('/notifications'), api<{ preferences: Array<{ category: string; enabled: boolean }> }>('/notifications/preferences')]).then(([messages, preferences]) => { setItems(messages.notifications); setPrefs(preferences.preferences); onChanged(messages.unreadCount); }).catch((reason) => setError(messageOf(reason)));
  useEffect(() => { void load(); }, [revision]);
  return <><header className="page-header"><div><p className="eyebrow">MONITOR / 消息</p><h1>消息中心</h1><p>分类开关仅影响未来个人消息，不影响业务数据和公开日志。</p></div><button onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); await load(); }}>全部已读</button></header>
    {error && <Status kind="error">{error}</Status>}<section className="preference-panel"><h2>通知偏好</h2><div className="preference-grid">{prefs.map((pref) => <label className="switch" key={pref.category}><input type="checkbox" checked={pref.enabled} onChange={async (event) => { await api('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ category: pref.category, enabled: event.target.checked }) }); await load(); }} /><span>{categoryName(pref.category)}</span></label>)}</div></section>
    <div className="message-list">{items.map((item) => <button key={item.id} className={item.readAt ? 'read' : 'unread'} onClick={async () => { if (!item.readAt) { await api(`/notifications/${item.id}/read`, { method: 'PATCH' }); await load(); } }}><span className="message-dot" /><div><strong>{item.title}</strong><p>{item.body}</p><small>{categoryName(item.category)} · {formatTime(item.createdAt)}</small></div></button>)}</div>{!items.length && <Empty>暂无个人消息</Empty>}
  </>;
}
function categoryName(value: string) { return ({ inventory_inbound: '药品入库', inventory_move: '药品调动', inventory_discard: '药品废弃', purchase_normal: '普通采购', purchase_urgent: '加急采购', approval: '审批结果', hazardous: '危险品', account: '账号' } as Record<string, string>)[value] ?? value; }

export function AccountsView({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [users, setUsers] = useState<UserView[]>([]); const [showCreate, setShowCreate] = useState(false); const [error, setError] = useState('');
  useEffect(() => { api<{ users: UserView[] }>('/users').then((value) => setUsers(value.users)).catch((reason) => setError(messageOf(reason))); }, [revision]);
  async function updateAccount(account: UserView, changes: Record<string, unknown>) { try { await api(`/users/${account.id}`, { method: 'PATCH', body: JSON.stringify({ ...changes, version: account.version }) }); onChanged(); } catch (reason) { setError(messageOf(reason)); } }
  return <><header className="page-header"><div><p className="eyebrow">OPERATE / 权限</p><h1>账号管理</h1><p>创建真实账号、调整角色或停用演示账号。</p></div><button className="primary" onClick={() => setShowCreate(true)}>＋ 新增账号</button></header>{error && <Status kind="error">{error}</Status>}<div className="table-wrap"><table><thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>来源</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((account) => <tr key={account.id}><td>@{account.username}</td><td>{account.displayName}</td><td>{account.role}</td><td>{account.demo ? '演示' : '实际'}</td><td>{account.active ? '启用' : '停用'}</td><td><div className="row-actions"><button onClick={async () => { const displayName = prompt('姓名', account.displayName); if (!displayName) return; const role = prompt(`角色：${roles.join(' / ')}`, account.role); if (!role || !roles.includes(role as UserView['role'])) { setError('角色无效'); return; } const password = prompt('新密码（留空表示不修改）') ?? ''; await updateAccount(account, { displayName, role, ...(password ? { password } : {}) }); }}>编辑</button><button onClick={() => updateAccount(account, { active: !account.active })}>{account.active ? '停用' : '启用'}</button></div></td></tr>)}</tbody></table></div>
    {showCreate && <Modal title="新增实际账号" onClose={() => setShowCreate(false)}><form className="form-grid" onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { await api('/users', { method: 'POST', body: JSON.stringify({ username: data.get('username'), displayName: data.get('displayName'), role: data.get('role'), password: data.get('password') }) }); setShowCreate(false); onChanged(); } catch (reason) { setError(messageOf(reason)); } }}><label>用户名<input name="username" required pattern="[a-zA-Z0-9._-]+" /></label><label>姓名<input name="displayName" required /></label><label>角色<select name="role">{roles.map((role) => <option key={role}>{role}</option>)}</select></label><label>初始密码<input name="password" type="password" minLength={10} required /></label><div className="form-actions"><button type="button" onClick={() => setShowCreate(false)}>取消</button><button className="primary">创建</button></div></form></Modal>}
  </>;
}
