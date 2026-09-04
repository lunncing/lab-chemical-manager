import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Chemical, InboundRequest } from './types.js';
import {
  ChemicalDiscardDialog, InboundRequestActionDialog, discardChemical, submitInboundRequestAction,
} from './inventory-action-dialogs.js';

const chemical: Chemical = {
  id: 7, name: '乙腈', specification: 'HPLC 4L', casNumber: '75-05-8', cabinet: 'B', shelf: 2, status: 'active', version: 3,
  owner: { id: 4, username: 'member-a', displayName: '成员甲' },
  inboundOperator: { id: 5, username: 'member-b', displayName: '成员乙' },
  inboundAt: '2026-08-30T08:00:00.000Z', createdAt: '2026-08-30T08:00:00.000Z', updatedAt: '2026-08-30T08:00:00.000Z', discardReason: null,
};
const request: InboundRequest = {
  id: 11, requester: chemical.owner, targetUser: chemical.inboundOperator, name: chemical.name, specification: chemical.specification, casNumber: chemical.casNumber,
  inboundAt: chemical.inboundAt, cabinet: chemical.cabinet, shelf: chemical.shelf, status: 'pending', decisionComment: null,
  chemicalId: null, version: 4, createdAt: chemical.createdAt, updatedAt: chemical.updatedAt, decidedAt: null, withdrawnAt: null,
};

afterEach(() => { vi.restoreAllMocks(); });

describe('chemical and proxy inbound action dialogs', () => {
  it('shows chemical identity/location and an optional discard reason in a danger dialog', () => {
    const html = renderToStaticMarkup(<ChemicalDiscardDialog chemical={chemical} onClose={() => undefined} onDone={() => undefined} />);
    expect(html).toContain('废弃药品');
    expect(html).toContain('乙腈');
    expect(html).toContain('B 柜 2 层');
    expect(html).toContain('废弃原因（可选）');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('确认废弃');
    expect(html).toContain('class="danger"');
  });

  it('submits trimmed optional discard reasons with confirmation and the current version', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await discardChemical(chemical, '  瓶盖破损  ');
    await discardChemical(chemical, '   ');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/chemicals/7/discard', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ confirmed: true, reason: '瓶盖破损', version: 3 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/chemicals/7/discard', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ confirmed: true, version: 3 }),
    }));
  });

  it('uses one contextual dialog for inbound approval, rejection, and withdrawal', () => {
    const approved = renderToStaticMarkup(<InboundRequestActionDialog request={request} action="approved" onClose={() => undefined} onDone={() => undefined} />);
    expect(approved).toContain('同意代入库申请');
    expect(approved).toContain('成员甲'); expect(approved).toContain('@member-a');
    expect(approved).toContain('乙腈'); expect(approved).toContain('B 柜 2 层');
    expect(approved).toContain('同意说明（可选）'); expect(approved).toContain('确认同意');

    const rejected = renderToStaticMarkup(<InboundRequestActionDialog request={request} action="rejected" onClose={() => undefined} onDone={() => undefined} />);
    expect(rejected).toContain('拒绝代入库申请');
    expect(rejected).toContain('拒绝说明（可选）'); expect(rejected).toContain('确认拒绝');
    expect(rejected).toContain('class="danger"');

    const withdrawn = renderToStaticMarkup(<InboundRequestActionDialog request={request} action="withdraw" onClose={() => undefined} onDone={() => undefined} />);
    expect(withdrawn).toContain('撤销代入库申请');
    expect(withdrawn).toContain('确认撤销');
    expect(withdrawn).not.toContain('<textarea');
  });

  it('preserves decision and withdrawal routes, comments, and optimistic versions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await submitInboundRequestAction(request, 'approved', '   ');
    await submitInboundRequestAction(request, 'rejected', '  库位不符  ');
    await submitInboundRequestAction(request, 'withdraw', '不会发送');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/inbound-requests/11/decision', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ decision: 'approved', version: 4 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/inbound-requests/11/decision', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '库位不符', version: 4 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/inbound-requests/11/withdraw', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ version: 4 }),
    }));
  });
});
