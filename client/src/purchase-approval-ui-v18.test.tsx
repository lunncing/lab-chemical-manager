import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrimaryNavigation, safeViewForRole } from './App.js';
import { purchaseStatusLabel, purchaseStatusOptions } from './purchase-status.js';
import { canReviewPurchase, PurchaseTable, purchaseApprovalStageLabel } from './purchase-tasks-ui.js';
import { revisionEvents } from './realtime-events.js';
import { roleLabel } from './role-labels.js';
import type { Purchase, Role } from './types.js';

function purchase(overrides: Partial<Purchase>): Purchase {
  return {
    id: 71,
    chemicalName: '叠氮化钠',
    specification: 'AR 500g',
    purpose: 'V1.8 UI 矩阵',
    hazardous: true,
    requestType: 'urgent',
    applicant: { id: 4, username: 'member-a', displayName: '成员甲' },
    status: 'pending_super',
    approvalComment: null,
    version: 3,
    createdAt: '2026-08-31T02:00:00.000Z',
    updatedAt: '2026-08-31T02:00:00.000Z',
    ...overrides,
  };
}

describe('V1.8 purchase approval UI model', () => {
  it('matches the server role/stage matrix for every actionable approval state', () => {
    const roles: Role[] = ['member', 'normal_admin', 'hazardous_buyer', 'super_admin'];
    const cases: Array<{ value: Purchase; allowed: Role[] }> = [
      { value: purchase({ hazardous: false, requestType: 'normal', status: 'pending_normal' }), allowed: ['normal_admin', 'super_admin'] },
      { value: purchase({ hazardous: false, requestType: 'normal', status: 'deferred' }), allowed: ['normal_admin', 'super_admin'] },
      { value: purchase({ hazardous: false, requestType: 'urgent', status: 'pending_super' }), allowed: ['super_admin'] },
      { value: purchase({ hazardous: true, requestType: 'urgent', status: 'deferred' }), allowed: ['super_admin'] },
      { value: purchase({ hazardous: true, requestType: 'normal', status: 'pending_hazardous' }), allowed: ['hazardous_buyer', 'super_admin'] },
      { value: purchase({ hazardous: true, requestType: 'urgent', status: 'pending_hazardous' }), allowed: ['hazardous_buyer', 'super_admin'] },
      { value: purchase({ hazardous: true, requestType: 'urgent', status: 'deferred_hazardous' }), allowed: ['hazardous_buyer', 'super_admin'] },
      { value: purchase({ hazardous: true, requestType: 'normal', status: 'deferred' }), allowed: ['hazardous_buyer', 'super_admin'] },
    ];
    for (const testCase of cases) {
      for (const role of roles) expect(canReviewPurchase(role, testCase.value), `${role}/${testCase.value.status}/${testCase.value.requestType}/${testCase.value.hazardous}`).toBe(testCase.allowed.includes(role));
    }
    expect(canReviewPurchase('super_admin', purchase({ status: 'approved' }))).toBe(false);
    expect(canReviewPurchase('hazardous_buyer', purchase({ status: 'pending_super' }))).toBe(false);
  });

  it('labels hazardous second-stage rows explicitly and never presents them as teacher urgent approval', () => {
    const firstStage = purchase({ status: 'pending_super' });
    const hazardousStage = purchase({ status: 'pending_hazardous' });
    const deferredHazardousStage = purchase({ status: 'deferred_hazardous' });
    expect(purchaseApprovalStageLabel(firstStage)).toBe('老师加急审批');
    expect(purchaseApprovalStageLabel(hazardousStage)).toBe('危险品复核');
    expect(purchaseApprovalStageLabel(deferredHazardousStage)).toBe('危险品复核');

    const html = renderToStaticMarkup(<PurchaseTable
      purchases={[hazardousStage, deferredHazardousStage]}
      mode="approvals"
      role="hazardous_buyer"
      currentUserId={3}
      empty="空"
      onAction={() => undefined}
    />);
    expect((html.match(/危险品复核/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('老师加急审批');
    expect((html.match(/>通过<\/button>/g) ?? [])).toHaveLength(2);
  });

  it('adds both hazardous-stage statuses and their exact visible names', () => {
    expect(purchaseStatusOptions).toEqual([
      { value: 'pending_normal', label: '待审批与普通采购人审批' },
      { value: 'pending_super', label: '待超级管理员审批' },
      { value: 'pending_hazardous', label: '待危险品复核' },
      { value: 'approved', label: '已通过' },
      { value: 'purchased', label: '已采购' },
      { value: 'deferred', label: '已推迟' },
      { value: 'deferred_hazardous', label: '危险品复核已推迟' },
      { value: 'rejected', label: '已驳回' },
      { value: 'withdrawn', label: '已撤销' },
    ]);
    expect(purchaseStatusLabel('pending_hazardous')).toBe('待危险品复核');
    expect(purchaseStatusLabel('deferred_hazardous')).toBe('危险品复核已推迟');
  });

  it('shows hazardous buyers both counted task nav items, the corrected role name, and no password-reset task nav', () => {
    const html = renderToStaticMarkup(<PrimaryNavigation
      role="hazardous_buyer"
      view="inventory"
      summary={{ approvalCount: 5, procurementCount: 2 }}
      unread={0}
      onView={() => undefined}
    />);
    expect(html).toContain('待审批（5）');
    expect(html).toContain('待采购（2）');
    expect(html).not.toContain('密码修改');
    expect(html).not.toContain('密码重置');
    expect(safeViewForRole('approvals', 'hazardous_buyer')).toBe('approvals');
    expect(roleLabel('hazardous_buyer')).toBe('审批与危险采购人');
  });

  it('invalidates Message Center queues on password-reset realtime changes', () => {
    expect(revisionEvents).toContain('password-reset-request:changed');
  });
});
