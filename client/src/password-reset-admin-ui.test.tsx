import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  canReviewPasswordResetRequests,
  PasswordResetDecisionDialog,
  passwordResetDecisionError,
  PasswordResetQueue,
  submitPasswordResetDecision,
} from './password-reset-admin-ui.js';
import type { PasswordResetRequest, UserView } from './types.js';
import { NotificationsView } from './views.js';

afterEach(() => { vi.restoreAllMocks(); });

const pending: PasswordResetRequest = {
  id: 31,
  user: { id: 4, username: 'member-a', displayName: '成员甲' },
  status: 'pending',
  appealReason: null,
  reviewer: null,
  reviewComment: null,
  version: 2,
  createdAt: '2026-08-31T01:00:00.000Z',
  updatedAt: '2026-08-31T01:00:00.000Z',
  expiresAt: '2026-09-07T01:00:00.000Z',
  reviewedAt: null,
  consumedAt: null,
};
const appealed: PasswordResetRequest = {
  ...pending,
  id: 32,
  user: { id: 5, username: 'member-b', displayName: '成员乙' },
  status: 'appealed',
  appealReason: '可提供课题组登记和入组记录，请重新核验',
  version: 4,
};

const user = (role: UserView['role']): UserView => ({
  id: role === 'super_admin' ? 1 : role === 'normal_admin' ? 2 : role === 'hazardous_buyer' ? 3 : 4,
  username: role,
  displayName: role,
  role,
  active: true,
  demo: true,
  version: 1,
});

describe('Message Center password-reset admin queue', () => {
  it('is a dedicated normal/super queue and is never granted to member or hazardous roles', () => {
    expect(canReviewPasswordResetRequests('member')).toBe(false);
    expect(canReviewPasswordResetRequests('hazardous_buyer')).toBe(false);
    expect(canReviewPasswordResetRequests('normal_admin')).toBe(true);
    expect(canReviewPasswordResetRequests('super_admin')).toBe(true);

    const adminView = renderToStaticMarkup(<NotificationsView user={user('normal_admin')} revision={0} onChanged={() => undefined} />);
    expect(adminView).toContain('密码修改审批');
    const hazardView = renderToStaticMarkup(<NotificationsView user={user('hazardous_buyer')} revision={0} onChanged={() => undefined} />);
    expect(hazardView).not.toContain('密码修改审批');
  });

  it('renders pending and appealed requests distinctly with identity warning and both decisions', () => {
    const html = renderToStaticMarkup(<PasswordResetQueue requests={[pending, appealed]} onDecision={() => undefined} />);
    expect(html).toContain('密码修改审批（2）');
    expect(html).toContain('密码修改申请');
    expect(html).toContain('密码修改申诉');
    expect(html).toContain('管理员批准前必须人工核实申请人身份');
    expect(html).toContain('成员甲'); expect(html).toContain('@member-a');
    expect(html).toContain('成员乙'); expect(html).toContain('@member-b');
    expect(html).toContain('可提供课题组登记和入组记录，请重新核验');
    expect((html.match(/>通过<\/button>/g) ?? [])).toHaveLength(2);
    expect((html.match(/>拒绝<\/button>/g) ?? [])).toHaveLength(2);
    expect(html).not.toMatch(/token|hash|password_hash|recovery_token/i);
  });

  it('keeps the dedicated queue visible when empty instead of coupling it to notification filters/preferences', () => {
    const html = renderToStaticMarkup(<PasswordResetQueue requests={[]} onDecision={() => undefined} />);
    expect(html).toContain('密码修改审批（0）');
    expect(html).toContain('暂无待处理的密码修改申请或申诉');
  });

  it('uses application dialogs with optional approval comment and mandatory rejection reason', () => {
    const approved = renderToStaticMarkup(<PasswordResetDecisionDialog request={pending} decision="approved" onClose={() => undefined} onDone={() => undefined} />);
    expect(approved).toContain('通过密码修改申请');
    expect(approved).toContain('人工核实身份');
    expect(approved).toContain('审批说明（可选）');
    expect(approved).toContain('确认通过');
    expect(approved).not.toContain('required=""');

    const rejected = renderToStaticMarkup(<PasswordResetDecisionDialog request={appealed} decision="rejected" onClose={() => undefined} onDone={() => undefined} />);
    expect(rejected).toContain('拒绝密码修改申诉');
    expect(rejected).toContain('拒绝说明（必填）');
    expect(rejected).toContain('required=""');
    expect(rejected).toContain('确认拒绝');
    expect(rejected).toContain('class="danger"');
    expect(rejected).toContain('可提供课题组登记和入组记录，请重新核验');
  });

  it('validates and submits exact decision/version payloads without exposing recovery credentials', async () => {
    expect(passwordResetDecisionError('approved', '')).toBe('');
    expect(passwordResetDecisionError('rejected', '   ')).toBe('拒绝必须填写说明');
    expect(passwordResetDecisionError('rejected', '资料不符')).toBe('');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ request: pending }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));

    await submitPasswordResetDecision(pending, 'approved', '   ');
    await submitPasswordResetDecision(appealed, 'rejected', '  无法核验身份  ');
    await expect(submitPasswordResetDecision(appealed, 'rejected', ' \n ')).rejects.toThrow('拒绝必须填写说明');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/password-reset-requests/31/decision', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ decision: 'approved', version: 2 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/password-reset-requests/32/decision', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ decision: 'rejected', comment: '无法核验身份', version: 4 }),
    }));
    const persistedPayloads = fetchMock.mock.calls.map(([, init]) => String(init?.body)).join(' ');
    expect(persistedPayloads).not.toMatch(/token|hash|password_hash|recovery_token/i);
  });
});
