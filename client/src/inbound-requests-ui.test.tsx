import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildProxyInboundPayload, InboundModeControls, InboundRequestActions, pendingInboundCount, ProxyInboundLaunchers,
  ProxyInboundQueueModal, proxyInboundStatusLabel,
} from './inbound-requests-ui.js';
import type { InboundRequest, UserView } from './types.js';
import { InventoryView } from './views.js';

const alice: UserView = { id: 4, username: 'member-a', displayName: '成员甲', role: 'member', active: true, demo: true, version: 1 };
const bob: UserView = { id: 5, username: 'member-b', displayName: '成员乙', role: 'member', active: true, demo: true, version: 1 };
const pending: InboundRequest = {
  id: 11, requester: alice, targetUser: bob, name: '乙腈', specification: 'HPLC 4L', casNumber: null, inboundAt: '2026-08-30T08:00:00.000Z',
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
      targetUserId: 5, name: '乙腈', specification: 'HPLC 4L', casNumber: null, inboundAt: pending.inboundAt, cabinet: 'B', shelf: 2,
    });
    expect(buildProxyInboundPayload({ name: '盐酸', specification: 'AR', casNumber: '7647-01-0', inboundAt: pending.inboundAt, cabinet: 'C1', shelf: '1' }, '5')).toMatchObject({ targetUserId: 5, casNumber: '7647-01-0', cabinet: 'C1', shelf: 1 });
    expect(() => buildProxyInboundPayload({ name: '错误盐酸', specification: 'AR', inboundAt: pending.inboundAt, cabinet: 'C1', shelf: '2' }, '5')).toThrow('C1 仅允许第 1 层');
    expect(proxyInboundStatusLabel('approved')).toBe('已同意');
    const incomingActions = renderToStaticMarkup(<InboundRequestActions request={pending} currentUserId={bob.id} onDecision={() => undefined} onWithdraw={() => undefined} />);
    expect(incomingActions).toContain('同意'); expect(incomingActions).toContain('拒绝');
  });

  it('counts only pending requests and renders the three launchers in the required accessible order', () => {
    const history = { ...pending, id: 12, status: 'approved' as const, name: '乙醇' };
    expect(pendingInboundCount([pending, history])).toBe(1);
    const html = renderToStaticMarkup(<ProxyInboundLaunchers incoming={[pending, history]} mine={[pending]} onQueue={() => undefined} onInbound={() => undefined} />);
    expect(html).toContain('aria-label="查看待我确认的代入库，1 条待确认"');
    expect(html).toContain('aria-label="查看我发起的代入库，1 条待确认"');
    expect(html.indexOf('待我确认的代入库（1）')).toBeLessThan(html.indexOf('我发起的代入库（1）'));
    expect(html.indexOf('我发起的代入库（1）')).toBeLessThan(html.indexOf('＋ 药品入库'));
  });

  it('uses an accessible modal with only the selected queue and its permitted actions', () => {
    const history = { ...pending, id: 12, status: 'approved' as const, name: '乙醇' };
    const incoming = renderToStaticMarkup(<ProxyInboundQueueModal scope="incoming" requests={[pending]} onClose={() => undefined} onDecision={() => undefined} onWithdraw={() => undefined} />);
    expect(incoming).toContain('role="dialog"'); expect(incoming).toContain('aria-modal="true"');
    expect(incoming).toContain('待我确认的代入库'); expect(incoming).not.toContain('我发起的代入库');
    expect(incoming).toContain('同意'); expect(incoming).toContain('拒绝'); expect(incoming).not.toContain('撤销');

    const mine = renderToStaticMarkup(<ProxyInboundQueueModal scope="mine" requests={[pending, history]} onClose={() => undefined} onDecision={() => undefined} onWithdraw={() => undefined} />);
    expect(mine).toContain('我发起的代入库'); expect(mine).not.toContain('待我确认的代入库');
    expect(mine).toContain('乙腈'); expect(mine).toContain('乙醇'); expect(mine).toContain('已同意');
    expect(mine).toContain('撤销'); expect(mine).not.toMatch(/<button[^>]*>同意<\/button>/); expect(mine).not.toMatch(/<button[^>]*>拒绝<\/button>/);
  });

  it('places launchers before search and cabinets without a permanently rendered queue', () => {
    const html = renderToStaticMarkup(<InventoryView user={alice} revision={0} onChanged={() => undefined} />);
    expect(html.indexOf('待我确认的代入库（0）')).toBeLessThan(html.indexOf('搜索药品'));
    expect(html.indexOf('我发起的代入库（0）')).toBeLessThan(html.indexOf('cabinet-grid'));
    expect(html).not.toContain('proxy-request-list');
  });
});
