import type { InboundRequest, UserView } from './types.js';
import { buildDirectInboundPayload } from './inventory-forms.js';
import { Modal } from './components.js';

export function buildProxyInboundPayload(fields: Parameters<typeof buildDirectInboundPayload>[0], targetUserIdValue: unknown) {
  const targetUserId = Number(targetUserIdValue);
  if (!Number.isInteger(targetUserId) || targetUserId < 1) throw new Error('请选择代入库对象');
  return { targetUserId, ...buildDirectInboundPayload(fields) };
}

export function InboundModeControls({ proxyMode, currentUser, members, targetUserId, busy = false, onProxyMode, onTarget, onCancel }: {
  proxyMode: boolean; currentUser: UserView; members: UserView[]; targetUserId: string; busy?: boolean;
  onProxyMode: (enabled: boolean) => void; onTarget: (id: string) => void; onCancel?: () => void;
}) {
  const targets = members.filter((member) => member.active && member.id !== currentUser.id);
  return <>
    <label className="checkbox span-2"><input type="checkbox" checked={proxyMode} onChange={(event) => onProxyMode(event.target.checked)} />代他人入库</label>
    {proxyMode && <label className="span-2">代入库对象<select name="targetUserId" required value={targetUserId} onChange={(event) => onTarget(event.target.value)}>
      <option value="">请选择人员</option>{targets.map((member) => <option value={member.id} key={member.id}>{member.displayName} (@{member.username})</option>)}
    </select></label>}
    <div className="form-actions">{onCancel && <button type="button" onClick={onCancel}>取消</button>}<button className="primary" disabled={busy}>{busy ? '提交中…' : proxyMode ? '提交代入库申请' : '确认入库'}</button></div>
  </>;
}

const statusLabels: Record<InboundRequest['status'], string> = { pending: '待确认', approved: '已同意', rejected: '已拒绝', withdrawn: '已撤销' };
export function proxyInboundStatusLabel(status: InboundRequest['status']) { return statusLabels[status]; }

export function InboundRequestActions({ request, currentUserId, onDecision, onWithdraw }: {
  request: InboundRequest; currentUserId: number;
  onDecision: (request: InboundRequest, decision: 'approved' | 'rejected') => void;
  onWithdraw: (request: InboundRequest) => void;
}) {
  if (request.status !== 'pending') return null;
  if (request.targetUser.id === currentUserId) return <div className="row-actions"><button type="button" className="approve" onClick={() => onDecision(request, 'approved')}>同意</button><button type="button" className="danger-text" onClick={() => onDecision(request, 'rejected')}>拒绝</button></div>;
  if (request.requester.id === currentUserId) return <div className="row-actions"><button type="button" onClick={() => onWithdraw(request)}>撤销</button></div>;
  return null;
}

export type ProxyInboundQueueScope = 'incoming' | 'mine';

export function pendingInboundCount(requests: InboundRequest[]) { return requests.filter((request) => request.status === 'pending').length; }

export function ProxyInboundLaunchers({ incoming, mine, onQueue, onInbound }: {
  incoming: InboundRequest[]; mine: InboundRequest[]; onQueue: (scope: ProxyInboundQueueScope) => void; onInbound: () => void;
}) {
  const incomingCount = pendingInboundCount(incoming); const mineCount = pendingInboundCount(mine);
  return <div className="page-actions">
    <button type="button" aria-label={`查看待我确认的代入库，${incomingCount} 条待确认`} onClick={() => onQueue('incoming')}>待我确认的代入库（{incomingCount}）</button>
    <button type="button" aria-label={`查看我发起的代入库，${mineCount} 条待确认`} onClick={() => onQueue('mine')}>我发起的代入库（{mineCount}）</button>
    <button type="button" className="primary" onClick={onInbound}>＋ 药品入库</button>
  </div>;
}

function QueueActions({ scope, request, onDecision, onWithdraw }: {
  scope: ProxyInboundQueueScope; request: InboundRequest;
  onDecision: (request: InboundRequest, decision: 'approved' | 'rejected') => void; onWithdraw: (request: InboundRequest) => void;
}) {
  if (request.status !== 'pending') return null;
  if (scope === 'incoming') return <div className="row-actions"><button type="button" className="approve" onClick={() => onDecision(request, 'approved')}>同意</button><button type="button" className="danger-text" onClick={() => onDecision(request, 'rejected')}>拒绝</button></div>;
  return <div className="row-actions"><button type="button" onClick={() => onWithdraw(request)}>撤销</button></div>;
}

function RequestList({ scope, requests, empty, onDecision, onWithdraw }: {
  scope: ProxyInboundQueueScope; requests: InboundRequest[]; empty: string;
  onDecision: (request: InboundRequest, decision: 'approved' | 'rejected') => void; onWithdraw: (request: InboundRequest) => void;
}) {
  return <section className="proxy-request-list">{requests.length ? <div className="table-wrap"><table><thead><tr><th>药品</th><th>人员</th><th>位置</th><th>状态</th><th>操作</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
    <td><strong>{request.name}</strong><small>{request.specification}</small></td><td>{scope === 'mine' ? `交给 ${request.targetUser.displayName}` : `来自 ${request.requester.displayName}`}</td>
    <td>{request.cabinet} 柜 {request.shelf} 层</td><td><span className={`badge status-${request.status}`}>{proxyInboundStatusLabel(request.status)}</span>{request.decisionComment && <small>{request.decisionComment}</small>}</td>
    <td><QueueActions scope={scope} request={request} onDecision={onDecision} onWithdraw={onWithdraw} /></td>
  </tr>)}</tbody></table></div> : <p className="compact-empty">{empty}</p>}</section>;
}

export function ProxyInboundQueueModal({ scope, requests, onClose, onDecision, onWithdraw }: {
  scope: ProxyInboundQueueScope; requests: InboundRequest[]; onClose: () => void;
  onDecision: (request: InboundRequest, decision: 'approved' | 'rejected') => void; onWithdraw: (request: InboundRequest) => void;
}) {
  const incoming = scope === 'incoming';
  return <Modal title={incoming ? '待我确认的代入库' : '我发起的代入库'} onClose={onClose}>
    <RequestList scope={scope} requests={requests} empty={incoming ? '暂无待确认申请' : '暂无发起记录'} onDecision={onDecision} onWithdraw={onWithdraw} />
  </Modal>;
}
