import type { InboundRequest, UserView } from './types.js';
import { buildDirectInboundPayload } from './inventory-forms.js';

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

function RequestList({ title, requests, empty, currentUserId, onDecision, onWithdraw }: {
  title: string; requests: InboundRequest[]; empty: string; currentUserId: number;
  onDecision: (request: InboundRequest, decision: 'approved' | 'rejected') => void; onWithdraw: (request: InboundRequest) => void;
}) {
  return <section className="proxy-request-list"><h2>{title}</h2>{requests.length ? <div className="table-wrap"><table><thead><tr><th>药品</th><th>人员</th><th>位置</th><th>状态</th><th>操作</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
    <td><strong>{request.name}</strong><small>{request.specification}</small></td><td>{request.requester.id === currentUserId ? `交给 ${request.targetUser.displayName}` : `来自 ${request.requester.displayName}`}</td>
    <td>{request.cabinet} 柜 {request.shelf} 层</td><td><span className={`badge status-${request.status}`}>{proxyInboundStatusLabel(request.status)}</span>{request.decisionComment && <small>{request.decisionComment}</small>}</td>
    <td><InboundRequestActions request={request} currentUserId={currentUserId} onDecision={onDecision} onWithdraw={onWithdraw} /></td>
  </tr>)}</tbody></table></div> : <p className="compact-empty">{empty}</p>}</section>;
}

export function ProxyInboundQueues({ incoming, mine, currentUserId, onDecision, onWithdraw }: {
  incoming: InboundRequest[]; mine: InboundRequest[]; currentUserId: number;
  onDecision: (request: InboundRequest, decision: 'approved' | 'rejected') => void; onWithdraw: (request: InboundRequest) => void;
}) {
  return <section className="proxy-queues" aria-label="代入库申请">
    <RequestList title="待我确认的代入库" requests={incoming} empty="暂无待确认申请" currentUserId={currentUserId} onDecision={onDecision} onWithdraw={onWithdraw} />
    <RequestList title="我发起的代入库" requests={mine} empty="暂无发起记录" currentUserId={currentUserId} onDecision={onDecision} onWithdraw={onWithdraw} />
  </section>;
}
