import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from './api.js';
import { CabinetBoard, Empty, Modal, Status } from './components.js';
import type { AuditLog, Chemical, InboundRequest, NotificationItem, Purchase, UserView } from './types.js';
import { roles } from '../../shared/types.js';
import { isPurchaseListMode, purchaseRequestPath, purchaseTabs, purchaseTaskDefinition, type PurchaseRequestViewMode, type PurchaseTaskViewMode } from './purchase-view.js';
import { filterNotifications, notificationCategoryName, notificationCategoryOptions, notificationReadOptions, type NotificationCategoryFilter, type NotificationReadFilter } from './notification-filter.js';
import { purchaseStatusOptions } from './purchase-status.js';
import { PurchaseTable, type PurchaseAction } from './purchase-tasks-ui.js';
import { buildDirectInboundPayload, buildMovePayload, InboundOwnerDisplay, ShelfOptions } from './inventory-forms.js';
import { buildProxyInboundPayload, InboundModeControls, InboundRequestActions, ProxyInboundLaunchers, ProxyInboundQueueModal, type ProxyInboundQueueScope } from './inbound-requests-ui.js';

function messageOf(error: unknown) { return error instanceof ApiError ? error.message : '操作失败，请重试'; }
const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

export function InventoryView({ user, revision, onChanged }: { user: UserView; revision: number; onChanged: () => void }) {
  const [chemicals, setChemicals] = useState<Chemical[]>([]); const [members, setMembers] = useState<UserView[]>([]); const [incoming, setIncoming] = useState<InboundRequest[]>([]); const [mine, setMine] = useState<InboundRequest[]>([]); const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Chemical | null>(null); const [showInbound, setShowInbound] = useState(false); const [proxyQueue, setProxyQueue] = useState<ProxyInboundQueueScope | null>(null); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  useEffect(() => { Promise.all([
    api<{ chemicals: Chemical[] }>(`/chemicals${search ? `?search=${encodeURIComponent(search)}` : ''}`), api<{ users: UserView[] }>('/members'),
    api<{ requests: InboundRequest[] }>('/inbound-requests?scope=incoming'), api<{ requests: InboundRequest[] }>('/inbound-requests?scope=mine'),
  ]).then(([stock, people, incomingRequests, myRequests]) => { setChemicals(stock.chemicals); setMembers(people.users); setIncoming(incomingRequests.requests); setMine(myRequests.requests); setError(''); }).catch((reason) => setError(messageOf(reason))); }, [revision, search]);
  async function decide(request: InboundRequest, decision: 'approved' | 'rejected') { const comment = prompt(decision === 'approved' ? '同意说明（可选）' : '拒绝说明（可选）') ?? undefined; try { await api(`/inbound-requests/${request.id}/decision`, { method: 'POST', body: JSON.stringify({ decision, comment: comment || undefined, version: request.version }) }); onChanged(); } catch (reason) { setError(messageOf(reason)); } }
  async function withdraw(request: InboundRequest) { if (!confirm(`确认撤销“${request.name}”的代入库申请？`)) return; try { await api(`/inbound-requests/${request.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: request.version }) }); onChanged(); } catch (reason) { setError(messageOf(reason)); } }
  return <><header className="page-header"><div><p className="eyebrow">OPERATE / 库存</p><h1>药品柜</h1><p>点击药品查看详情、调动或废弃。柜层由上到下为 1–5。</p></div><ProxyInboundLaunchers incoming={incoming} mine={mine} onQueue={setProxyQueue} onInbound={() => setShowInbound(true)} /></header>
    <div className="toolbar"><label className="search">搜索药品<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称 / 规格 / 归属人" /></label><span>{chemicals.length} 件活动库存</span></div>
    {error && <Status kind="error">{error}</Status>}{success && <Status kind="success">{success}</Status>}<CabinetBoard chemicals={chemicals} onChemical={setSelected} />
    {proxyQueue && <ProxyInboundQueueModal scope={proxyQueue} requests={proxyQueue === 'incoming' ? incoming : mine} onClose={() => setProxyQueue(null)} onDecision={decide} onWithdraw={withdraw} />}
    {showInbound && <InboundModal user={user} members={members} onClose={() => setShowInbound(false)} onDone={(message) => { setShowInbound(false); setSuccess(message ?? '入库成功'); onChanged(); }} />}
    {selected && <ChemicalModal chemical={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); onChanged(); }} />}
  </>;
}

function InboundModal({ user, members, onClose, onDone }: { user: UserView; members: UserView[]; onClose: () => void; onDone: (message?: string) => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [proxyMode, setProxyMode] = useState(false); const [targetUserId, setTargetUserId] = useState('');
  return <Modal title="药品入库" onClose={onClose}><form className="form-grid" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError(''); const data = new FormData(event.currentTarget);
    try {
      const date = new Date(String(data.get('inboundAt'))); if (Number.isNaN(date.getTime())) throw new Error('入库时间无效');
      const fields = { name: data.get('name'), specification: data.get('specification'), inboundAt: date.toISOString(), cabinet: data.get('cabinet'), shelf: data.get('shelf') };
      if (proxyMode) { const payload = buildProxyInboundPayload(fields, targetUserId); await api('/inbound-requests', { method: 'POST', body: JSON.stringify(payload) }); const target = members.find((member) => member.id === payload.targetUserId); onDone(`已发送给 ${target?.displayName ?? '对方'}，等待对方同意`); }
      else { await api('/chemicals', { method: 'POST', body: JSON.stringify(buildDirectInboundPayload(fields)) }); onDone(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : messageOf(reason)); } finally { setBusy(false); }
  }}>
    <label>药品名称<input name="name" required autoFocus /></label><label>规格<input name="specification" required /></label>
    <InboundOwnerDisplay displayName={user.displayName} />
    <label>入库时间<input name="inboundAt" type="datetime-local" required defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} /></label>
    <label>柜号<select name="cabinet"><option value="A">A · 常温柜</option><option value="B">B · 冷藏柜</option></select></label>
    <label>柜层<select name="shelf"><ShelfOptions /></select></label>
    {error && <Status kind="error">{error}</Status>}<InboundModeControls proxyMode={proxyMode} currentUser={user} members={members} targetUserId={targetUserId} busy={busy} onProxyMode={(enabled) => { setProxyMode(enabled); setTargetUserId(''); }} onTarget={setTargetUserId} onCancel={onClose} />
  </form></Modal>;
}

function ChemicalModal({ chemical, onClose, onDone }: { chemical: Chemical; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [cabinet, setCabinet] = useState(chemical.cabinet); const [shelf, setShelf] = useState(String(chemical.shelf));
  async function move() { setError(''); let payload; try { payload = buildMovePayload(cabinet, shelf, chemical.version); } catch (reason) { setError(reason instanceof Error ? reason.message : '调动参数无效'); return; } setBusy(true); try { await api(`/chemicals/${chemical.id}/move`, { method: 'PATCH', body: JSON.stringify(payload) }); onDone(); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } }
  async function discard() { if (!confirm(`确认废弃“${chemical.name}”？该操作会保留审计记录。`)) return; const reason = prompt('废弃原因（可选）') ?? undefined; setBusy(true); try { await api(`/chemicals/${chemical.id}/discard`, { method: 'PATCH', body: JSON.stringify({ confirmed: true, reason: reason || undefined, version: chemical.version }) }); onDone(); } catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); } }
  return <Modal title={chemical.name} onClose={onClose}><dl className="details"><dt>规格</dt><dd>{chemical.specification}</dd><dt>归属人</dt><dd>{chemical.owner.displayName}</dd><dt>入库操作</dt><dd>{chemical.inboundOperator.displayName}</dd><dt>入库时间</dt><dd>{formatTime(chemical.inboundAt)}</dd><dt>当前位置</dt><dd>{chemical.cabinet} 柜 {chemical.shelf} 层</dd><dt>版本</dt><dd>{chemical.version}</dd></dl>
    <fieldset><legend>调动位置</legend><div className="inline-fields"><select value={cabinet} onChange={(event) => setCabinet(event.target.value as 'A' | 'B')}><option value="A">A</option><option value="B">B</option></select><select value={shelf} onChange={(event) => setShelf(event.target.value)}><ShelfOptions /></select><button className="primary" disabled={busy} onClick={move}>调动</button></div></fieldset>
    {error && <Status kind="error">{error}</Status>}<div className="danger-zone"><button className="danger" disabled={busy} onClick={discard}>废弃药品</button></div>
  </Modal>;
}

async function performPurchaseAction(purchase: Purchase, actionName: PurchaseAction) {
  if (actionName === 'edit') { const purpose = prompt('修改用途说明', purchase.purpose); if (!purpose) return false; await api(`/purchases/${purchase.id}`, { method: 'PATCH', body: JSON.stringify({ purpose, version: purchase.version }) }); }
  else if (actionName === 'withdraw') { if (!confirm('确认撤销此申请？')) return false; await api(`/purchases/${purchase.id}/withdraw`, { method: 'POST', body: JSON.stringify({ version: purchase.version }) }); }
  else if (actionName === 'purchased') { if (!confirm(`确认“${purchase.chemicalName}”已采购？`)) return false; await api(`/purchases/${purchase.id}/purchased`, { method: 'POST', body: JSON.stringify({ version: purchase.version }) }); }
  else { const comment = actionName === 'approved' ? (prompt('审批意见（可选）') ?? '') : prompt(actionName === 'deferred' ? '推迟说明（必填）' : '驳回说明（必填）'); if (comment === null || (actionName !== 'approved' && !comment.trim())) return false; await api(`/purchases/${purchase.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: actionName, comment: comment || undefined, version: purchase.version }) }); }
  return true;
}

const requestEmptyText: Record<PurchaseRequestViewMode, string> = {
  all: '没有符合条件的采购申请', mine: '暂无我的采购申请', catalog_normal: '普通周目录暂无待采购药品',
  catalog_urgent: '加急目录暂无待采购药品', catalog_hazardous: '危险品队列暂无待采购药品',
};

export function PurchasesView({ user, revision, onChanged }: { user: UserView; revision: number; onChanged: () => void }) {
  const [purchases, setPurchases] = useState<Purchase[]>([]); const [mode, setMode] = useState<PurchaseRequestViewMode>('all'); const [status, setStatus] = useState(''); const [kind, setKind] = useState(''); const [hazardous, setHazardous] = useState(''); const [error, setError] = useState(''); const [showCreate, setShowCreate] = useState(false);
  useEffect(() => { api<{ purchases: Purchase[] }>(purchaseRequestPath(mode, { status, kind, hazardous })).then((value) => { setPurchases(value.purchases); setError(''); }).catch((reason) => setError(messageOf(reason))); }, [revision, mode, status, kind, hazardous]);
  async function action(purchase: Purchase, actionName: PurchaseAction) { try { if (await performPurchaseAction(purchase, actionName)) onChanged(); } catch (reason) { setError(messageOf(reason)); } }
  return <><header className="page-header"><div><p className="eyebrow">OPERATE / 采购</p><h1>采购申请</h1><p>全体成员可查看；修改、撤销和审批权限由服务端校验。</p></div><button className="primary" onClick={() => setShowCreate(true)}>＋ 新建申请</button></header>
    <div className="tabs">{purchaseTabs(user.role, mode).map((tab) => <button key={tab.mode} aria-pressed={tab.pressed} onClick={() => setMode(tab.mode)}>{tab.label}</button>)}</div>
    {isPurchaseListMode(mode) && <div className="filters"><label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部</option>{purchaseStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>类型<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">全部</option><option value="normal">普通</option><option value="urgent">加急</option></select></label><label>危险品<select value={hazardous} onChange={(e) => setHazardous(e.target.value)}><option value="">全部</option><option value="true">是</option><option value="false">否</option></select></label></div>}
    {error && <Status kind="error">{error}</Status>}<PurchaseTable purchases={purchases} mode={mode} currentUserId={user.id} empty={requestEmptyText[mode]} onAction={action} />
    {showCreate && <PurchaseCreate onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); onChanged(); }} />}
  </>;
}

export function PurchaseTaskView({ mode, user, revision, onChanged }: { mode: PurchaseTaskViewMode; user: UserView; revision: number; onChanged: () => void }) {
  const definition = purchaseTaskDefinition(mode); const [purchases, setPurchases] = useState<Purchase[]>([]); const [error, setError] = useState('');
  useEffect(() => { api<{ purchases: Purchase[] }>(definition.path).then((value) => { setPurchases(value.purchases); setError(''); }).catch((reason) => setError(messageOf(reason))); }, [definition.path, revision]);
  async function action(purchase: Purchase, actionName: PurchaseAction) { try { if (await performPurchaseAction(purchase, actionName)) onChanged(); } catch (reason) { setError(messageOf(reason)); } }
  return <><header className="page-header"><div><p className="eyebrow">OPERATE / 采购任务</p><h1>{definition.title}</h1><p>{mode === 'approvals' ? '处理需要您决定的采购申请。' : '确认已完成采购的药品。'}</p></div></header>
    {error && <Status kind="error">{error}</Status>}<PurchaseTable purchases={purchases} mode={mode} currentUserId={user.id} empty={definition.empty} onAction={action} />
  </>;
}

function PurchaseCreate({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('');
  return <Modal title="新建采购申请" onClose={onClose}><form className="form-grid" onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { await api('/purchases', { method: 'POST', body: JSON.stringify({ chemicalName: data.get('name'), specification: data.get('specification'), purpose: data.get('purpose'), hazardous: data.get('hazardous') === 'on', requestType: data.get('requestType') }) }); onDone(); } catch (reason) { setError(messageOf(reason)); } }}><label>药品信息<input name="name" required autoFocus /></label><label>规格<input name="specification" required /></label><label className="span-2">用途说明<textarea name="purpose" required rows={3} /></label><label>申请类型<select name="requestType"><option value="normal">普通</option><option value="urgent">加急</option></select></label><label className="checkbox"><input type="checkbox" name="hazardous" /> 危险品</label>{error && <Status kind="error">{error}</Status>}<div className="form-actions"><button type="button" onClick={onClose}>取消</button><button className="primary">提交申请</button></div></form></Modal>;
}

export function AuditView({ revision }: { revision: number }) {
  const [logs, setLogs] = useState<AuditLog[]>([]); const [error, setError] = useState('');
  useEffect(() => { api<{ logs: AuditLog[] }>('/audit-logs').then((value) => setLogs(value.logs)).catch((reason) => setError(messageOf(reason))); }, [revision]);
  return <><header className="page-header"><div><p className="eyebrow">MONITOR / 审计</p><h1>公开改动日志</h1><p>业务写入与日志同事务保存。日志只读且对所有登录用户公开。</p></div></header>{error && <Status kind="error">{error}</Status>}<div className="timeline">{logs.map((log) => <article key={log.id}><time>{formatTime(log.createdAt)}</time><div><strong>{log.summary}</strong><p>{log.actor.displayName} · {log.action} · {log.objectType} #{log.objectId}</p><details><summary>结构化详情</summary><pre>{JSON.stringify(log.details, null, 2)}</pre></details></div></article>)}</div>{!logs.length && !error && <Empty>尚无改动记录</Empty>}</>;
}

export function NotificationsView({ user, revision, onChanged }: { user: UserView; revision: number; onChanged: (unread?: number) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]); const [prefs, setPrefs] = useState<Array<{ category: string; enabled: boolean }>>([]); const [incoming, setIncoming] = useState<InboundRequest[]>([]); const [category, setCategory] = useState<NotificationCategoryFilter>(''); const [readState, setReadState] = useState<NotificationReadFilter>('all'); const [error, setError] = useState('');
  const filteredItems = useMemo(() => filterNotifications(items, category, readState), [items, category, readState]);
  const load = () => Promise.all([api<{ notifications: NotificationItem[]; unreadCount: number }>('/notifications'), api<{ preferences: Array<{ category: string; enabled: boolean }> }>('/notifications/preferences'), api<{ requests: InboundRequest[] }>('/inbound-requests?scope=incoming')]).then(([messages, preferences, requests]) => { setItems(messages.notifications); setPrefs(preferences.preferences); setIncoming(requests.requests); onChanged(messages.unreadCount); }).catch((reason) => setError(messageOf(reason)));
  useEffect(() => { void load(); }, [revision]);
  async function decide(request: InboundRequest, decision: 'approved' | 'rejected') { const comment = prompt(decision === 'approved' ? '同意说明（可选）' : '拒绝说明（可选）') ?? undefined; try { await api(`/inbound-requests/${request.id}/decision`, { method: 'POST', body: JSON.stringify({ decision, comment: comment || undefined, version: request.version }) }); await load(); onChanged(); } catch (reason) { setError(messageOf(reason)); } }
  return <><header className="page-header"><div><p className="eyebrow">MONITOR / 消息</p><h1>消息中心</h1><p>分类开关仅影响未来个人消息，不影响业务数据和公开日志。</p></div><button onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); await load(); }}>全部已读</button></header>
    {error && <Status kind="error">{error}</Status>}<section className="preference-panel"><h2>通知偏好</h2><div className="preference-grid">{prefs.map((pref) => <label className="switch" key={pref.category}><input type="checkbox" checked={pref.enabled} onChange={async (event) => { await api('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ category: pref.category, enabled: event.target.checked }) }); await load(); }} /><span>{notificationCategoryName(pref.category)}</span></label>)}</div></section>
    <div className="filters"><label>通知类别<select value={category} onChange={(event) => setCategory(event.target.value as NotificationCategoryFilter)}>{notificationCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>阅读状态<select value={readState} onChange={(event) => setReadState(event.target.value as NotificationReadFilter)}>{notificationReadOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><span>显示 {filteredItems.length} / 共 {items.length} 条</span></div>
    <div className="message-list">{filteredItems.map((item) => { const request = item.objectType === 'inbound_request' ? incoming.find((entry) => String(entry.id) === item.objectId) : undefined; return <article key={item.id} className={item.readAt ? 'read' : 'unread'}><button className="message-main" onClick={async () => { if (!item.readAt) { await api(`/notifications/${item.id}/read`, { method: 'PATCH' }); await load(); } }}><span className="message-dot" /><div><strong>{item.title}</strong><p>{item.body}</p><small>{notificationCategoryName(item.category)} · {formatTime(item.createdAt)}</small></div></button>{request && <InboundRequestActions request={request} currentUserId={user.id} onDecision={decide} onWithdraw={() => undefined} />}</article>; })}</div>{!items.length ? <Empty>暂无个人消息</Empty> : !filteredItems.length && <Empty>没有符合筛选条件的消息</Empty>}
  </>;
}

export function AccountsView({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [users, setUsers] = useState<UserView[]>([]); const [showCreate, setShowCreate] = useState(false); const [error, setError] = useState('');
  useEffect(() => { api<{ users: UserView[] }>('/users').then((value) => setUsers(value.users)).catch((reason) => setError(messageOf(reason))); }, [revision]);
  async function updateAccount(account: UserView, changes: Record<string, unknown>) { try { await api(`/users/${account.id}`, { method: 'PATCH', body: JSON.stringify({ ...changes, version: account.version }) }); onChanged(); } catch (reason) { setError(messageOf(reason)); } }
  return <><header className="page-header"><div><p className="eyebrow">OPERATE / 权限</p><h1>账号管理</h1><p>创建真实账号、调整角色或停用演示账号。</p></div><button className="primary" onClick={() => setShowCreate(true)}>＋ 新增账号</button></header>{error && <Status kind="error">{error}</Status>}<div className="table-wrap"><table><thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>来源</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((account) => <tr key={account.id}><td>@{account.username}</td><td>{account.displayName}</td><td>{account.role}</td><td>{account.demo ? '演示' : '实际'}</td><td>{account.active ? '启用' : '停用'}</td><td><div className="row-actions"><button onClick={async () => { const displayName = prompt('姓名', account.displayName); if (!displayName) return; const role = prompt(`角色：${roles.join(' / ')}`, account.role); if (!role || !roles.includes(role as UserView['role'])) { setError('角色无效'); return; } const password = prompt('新密码（留空表示不修改）') ?? ''; await updateAccount(account, { displayName, role, ...(password ? { password } : {}) }); }}>编辑</button><button onClick={() => updateAccount(account, { active: !account.active })}>{account.active ? '停用' : '启用'}</button></div></td></tr>)}</tbody></table></div>
    {showCreate && <Modal title="新增实际账号" onClose={() => setShowCreate(false)}><form className="form-grid" onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { await api('/users', { method: 'POST', body: JSON.stringify({ username: data.get('username'), displayName: data.get('displayName'), role: data.get('role'), password: data.get('password') }) }); setShowCreate(false); onChanged(); } catch (reason) { setError(messageOf(reason)); } }}><label>用户名<input name="username" required pattern="[a-zA-Z0-9._-]+" /></label><label>姓名<input name="displayName" required /></label><label>角色<select name="role">{roles.map((role) => <option key={role}>{role}</option>)}</select></label><label>初始密码<input name="password" type="password" minLength={10} required /></label><div className="form-actions"><button type="button" onClick={() => setShowCreate(false)}>取消</button><button className="primary">创建</button></div></form></Modal>}
  </>;
}
