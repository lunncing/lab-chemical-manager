import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Purchase } from './types.js';
import { PurchaseActionDialog, purchaseActionValueError, submitPurchaseAction } from './purchase-action-dialog.js';

const purchase: Purchase = {
  id: 23, chemicalName: '硝酸', specification: 'AR 500mL', purpose: '样品消解', hazardous: true, requestType: 'urgent',
  applicant: { id: 4, username: 'member-a', displayName: '成员甲' }, status: 'pending_super', approvalComment: null, version: 6,
  createdAt: '2026-08-30T08:00:00.000Z', updatedAt: '2026-08-30T08:00:00.000Z',
};

afterEach(() => { vi.restoreAllMocks(); });

describe('PurchaseActionDialog', () => {
  it('enforces nonblank edit/defer/reject text while approval remains optional', () => {
    expect(purchaseActionValueError('edit', '   ')).toBe('用途说明不能为空');
    expect(purchaseActionValueError('deferred', '\n ')).toBe('推迟说明不能为空');
    expect(purchaseActionValueError('rejected', '')).toBe('驳回说明不能为空');
    expect(purchaseActionValueError('approved', '')).toBe('');
    expect(purchaseActionValueError('withdraw', '')).toBe('');
    expect(purchaseActionValueError('purchased', '')).toBe('');
  });

  it('renders the edit and approval forms with their exact required/optional labels', () => {
    const edit = renderToStaticMarkup(<PurchaseActionDialog purchase={purchase} action="edit" onClose={() => undefined} onDone={() => undefined} />);
    expect(edit).toContain('修改采购申请'); expect(edit).toContain('用途说明（必填）');
    expect(edit).toContain('required=""'); expect(edit).toContain('样品消解'); expect(edit).toContain('保存修改');

    const approved = renderToStaticMarkup(<PurchaseActionDialog purchase={purchase} action="approved" onClose={() => undefined} onDone={() => undefined} />);
    expect(approved).toContain('通过采购申请'); expect(approved).toContain('审批意见（可选）');
    expect(approved).not.toContain('审批意见（可选）</label>'); expect(approved).toContain('确认通过');

    const deferred = renderToStaticMarkup(<PurchaseActionDialog purchase={purchase} action="deferred" onClose={() => undefined} onDone={() => undefined} />);
    expect(deferred).toContain('推迟说明（必填）'); expect(deferred).toContain('required=""');

    const rejected = renderToStaticMarkup(<PurchaseActionDialog purchase={purchase} action="rejected" onClose={() => undefined} onDone={() => undefined} />);
    expect(rejected).toContain('驳回说明（必填）'); expect(rejected).toContain('class="danger"');
  });

  it('uses confirmation dialogs for withdrawal and purchased, including hazardous context', () => {
    const withdraw = renderToStaticMarkup(<PurchaseActionDialog purchase={purchase} action="withdraw" onClose={() => undefined} onDone={() => undefined} />);
    expect(withdraw).toContain('撤销采购申请'); expect(withdraw).toContain('确认撤销'); expect(withdraw).not.toContain('<textarea');

    const purchased = renderToStaticMarkup(<PurchaseActionDialog purchase={purchase} action="purchased" onClose={() => undefined} onDone={() => undefined} />);
    expect(purchased).toContain('确认已采购'); expect(purchased).toContain('硝酸');
    expect(purchased).toContain('危险品'); expect(purchased).toContain('是'); expect(purchased).not.toContain('<textarea');
  });

  it('preserves all six API routes, normalized values, decisions, and versions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await submitPurchaseAction(purchase, 'edit', '  新用途  ');
    await submitPurchaseAction(purchase, 'withdraw', '');
    await submitPurchaseAction(purchase, 'approved', '   ');
    await submitPurchaseAction(purchase, 'deferred', '  等待经费  ');
    await submitPurchaseAction(purchase, 'rejected', '  不符合要求  ');
    await submitPurchaseAction(purchase, 'purchased', '');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/purchases/23', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ purpose: '新用途', version: 6 }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/purchases/23/withdraw', expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 6 }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/purchases/23/decision', expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'approved', version: 6 }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/purchases/23/decision', expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'deferred', comment: '等待经费', version: 6 }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/purchases/23/decision', expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '不符合要求', version: 6 }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/purchases/23/purchased', expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 6 }) }));
  });
});
