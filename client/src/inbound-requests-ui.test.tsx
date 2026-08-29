import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildProxyInboundPayload, InboundModeControls, InboundRequestActions, ProxyInboundQueues, proxyInboundStatusLabel,
} from './inbound-requests-ui.js';
import type { InboundRequest, UserView } from './types.js';

const alice: UserView = { id: 4, username: 'member-a', displayName: '成员甲', role: 'member', active: true, demo: true, version: 1 };
const bob: UserView = { id: 5, username: 'member-b', displayName: '成员乙', role: 'member', active: true, demo: true, version: 1 };
const pending: InboundRequest = {
  id: 11, requester: alice, targetUser: bob, name: '乙腈', specification: 'HPLC 4L', inboundAt: '2026-08-30T08:00:00.000Z',
  cabinet: 'B', shelf: 2, status: 'pending', decisionComment: null, chemicalId: null, version: 1,
  createdAt: '2026-08-30T08:00:00.000Z', updatedAt: '2026-08-30T08:00:00.000Z', decidedAt: null, withdrawnAt: null,
};

describe('proxy inbound front-end controls', () => {
  it('keeps direct inbound read-only and exposes other active users only in proxy mode', () => {
    const direct = renderToStaticMarkup(<InboundModeControls proxyMode={false} currentUser={alice} members={[alice, bob]} targetUserId="" onProxyMode={() => undefined} onTarget={() => undefined} />);
    expect(direct).toContain('代他人入库'); expect(direct).toContain('确认入库'); expect(direct).not.toContain('name="targetUserId"');

    const proxy = renderToStaticMarkup(<InboundModeControls proxyMode currentUser={alice} members={[alice, bob]} targetUserId="5" onProxyMode={() => undefined} onTarget={() => undefined} />);
    expect(proxy).toContain('name="targetUserId"'); expect(proxy).toContain('成员乙'); expect(proxy).not.toContain('成员甲 (@member-a)');
    expect(proxy).toContain('提交代入库申请');
  });

  it('builds a proxy request payload and renders Chinese queue states/actions', () => {
    expect(buildProxyInboundPayload({ name: '乙腈', specification: 'HPLC 4L', inboundAt: pending.inboundAt, cabinet: 'B', shelf: '2' }, '5')).toEqual({
      targetUserId: 5, name: '乙腈', specification: 'HPLC 4L', inboundAt: pending.inboundAt, cabinet: 'B', shelf: 2,
    });
    expect(proxyInboundStatusLabel('approved')).toBe('已同意');
    const queues = renderToStaticMarkup(<ProxyInboundQueues incoming={[pending]} mine={[pending]} currentUserId={alice.id} onDecision={() => undefined} onWithdraw={() => undefined} />);
    expect(queues).toContain('待我确认的代入库'); expect(queues).toContain('我发起的代入库'); expect(queues).toContain('撤销');
    const incomingActions = renderToStaticMarkup(<InboundRequestActions request={pending} currentUserId={bob.id} onDecision={() => undefined} onWithdraw={() => undefined} />);
    expect(incomingActions).toContain('同意'); expect(incomingActions).toContain('拒绝');
  });
});
