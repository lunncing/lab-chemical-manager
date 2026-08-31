import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Login } from './App.js';
import {
  appealPasswordRecovery,
  changePasswordWithCurrent,
  lookupPasswordRecovery,
  PasswordRecoveryScreenView,
  recoveryScreenFromLookup,
  requestPasswordRecovery,
  resetApprovedPassword,
  type PasswordRecoveryScreen,
} from './password-recovery-ui.js';

afterEach(() => { vi.restoreAllMocks(); });

const callbacks = {
  onLookup: () => undefined,
  onBack: () => undefined,
  onForgot: () => undefined,
  onChangeWithCurrent: () => undefined,
  onRequest: () => undefined,
  onResetApproved: () => undefined,
  onStartAppeal: () => undefined,
  onAppeal: () => undefined,
};

function render(screen: PasswordRecoveryScreen): string {
  return renderToStaticMarkup(<PasswordRecoveryScreenView screen={screen} busy={false} error="" {...callbacks} />);
}

describe('seven-stage password change and recovery UI', () => {
  it('adds a password-change entry to login without exposing recovery controls in the default login form', () => {
    const html = renderToStaticMarkup(<Login onLogin={() => undefined} />);
    expect(html).toContain('修改密码');
    expect(html).toContain('用户名');
    expect(html).not.toContain('提交申请');
    expect(html).not.toContain('申诉理由');
  });

  it('maps every public lookup state to the correct browser-bound screen', () => {
    expect(recoveryScreenFromLookup('成员甲', 'verify_current')).toEqual({ stage: 'verify_current', displayName: '成员甲' });
    expect(recoveryScreenFromLookup('成员甲', 'pending')).toEqual({ stage: 'waiting', displayName: '成员甲', requestState: 'pending' });
    expect(recoveryScreenFromLookup('成员甲', 'appealed')).toEqual({ stage: 'waiting', displayName: '成员甲', requestState: 'appealed' });
    expect(recoveryScreenFromLookup('成员甲', 'approved')).toEqual({ stage: 'approved', displayName: '成员甲' });
    expect(recoveryScreenFromLookup('成员甲', 'rejected')).toEqual({ stage: 'rejected', displayName: '成员甲' });
  });

  it('renders all seven stages with only their permitted fields and exact primary actions', () => {
    const lookup = render({ stage: 'lookup' });
    expect(lookup).toContain('第 1 步'); expect(lookup).toContain('姓名'); expect(lookup).toContain('查询账号');
    expect(lookup).toContain('返回登录页'); expect(lookup).not.toContain('原密码');

    const current = render({ stage: 'verify_current', displayName: '成员甲' });
    expect(current).toContain('第 2 步'); expect(current).toContain('成员甲'); expect(current).toContain('原密码');
    expect(current).toContain('新密码'); expect(current).toContain('确认新密码'); expect(current).toContain('忘记原密码？');
    expect(current).toContain('确认修改');

    const request = render({ stage: 'request_confirm', displayName: '成员甲' });
    expect(request).toContain('第 3 步'); expect(request).toContain('提交申请');
    expect(request).toContain('管理员会先人工核实申请人身份'); expect(request).not.toContain('type="password"');

    const approved = render({ stage: 'approved', displayName: '成员甲' });
    expect(approved).toContain('第 4 步'); expect(approved).toContain('申请已批准');
    expect(approved).toContain('新密码'); expect(approved).toContain('确认新密码'); expect(approved).toContain('完成密码重置');
    expect(approved).not.toContain('原密码');

    for (const requestState of ['pending', 'appealed'] as const) {
      const waiting = render({ stage: 'waiting', displayName: '成员甲', requestState });
      expect(waiting).toContain('第 5 步');
      expect(waiting).toContain('已有一个待审批的密码修改申请，请等待');
      expect(waiting).toContain('返回登录页'); expect(waiting).not.toContain('<input'); expect(waiting).not.toContain('<textarea');
    }

    const rejected = render({ stage: 'rejected', displayName: '成员甲' });
    expect(rejected).toContain('第 6 步'); expect(rejected).toContain('管理员已拒绝，您可以提交申诉');
    expect(rejected).toContain('确认并申诉'); expect(rejected).toContain('返回登录页'); expect(rejected).not.toContain('<textarea');

    const appeal = render({ stage: 'appeal', displayName: '成员甲' });
    expect(appeal).toContain('第 7 步'); expect(appeal).toContain('申诉理由');
    expect(appeal).toContain('maxLength="1000"'); expect(appeal).toContain('required=""');
    expect(appeal).toContain('提交申诉并申请');
  });

  it('uses the five Phase A endpoints with exact secret-minimizing request bodies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      const body = path.endsWith('/lookup') ? { state: 'verify_current' }
        : path.endsWith('/request') ? { state: 'pending' }
          : path.endsWith('/appeal') ? { state: 'appealed' }
            : { changed: true };
      return new Response(JSON.stringify(body), { status: path.endsWith('/request') ? 201 : 200, headers: { 'content-type': 'application/json' } });
    });

    await expect(lookupPasswordRecovery('  成员甲  ')).resolves.toBe('verify_current');
    await changePasswordWithCurrent({ displayName: '成员甲', currentPassword: 'OldPassword1!', newPassword: 'NewPassword1!', newPasswordConfirm: 'NewPassword1!' });
    await expect(requestPasswordRecovery('成员甲')).resolves.toBe('pending');
    await resetApprovedPassword({ newPassword: 'ResetPassword1!', newPasswordConfirm: 'ResetPassword1!' });
    await expect(appealPasswordRecovery('  补充课题组身份信息  ')).resolves.toBe('appealed');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/password-recovery/lookup', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ displayName: '成员甲' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/password-recovery/change-with-current', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ displayName: '成员甲', currentPassword: 'OldPassword1!', newPassword: 'NewPassword1!', newPasswordConfirm: 'NewPassword1!' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/password-recovery/request', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ displayName: '成员甲' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/password-recovery/reset-approved', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ newPassword: 'ResetPassword1!', newPasswordConfirm: 'ResetPassword1!' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/password-recovery/appeal', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ reason: '补充课题组身份信息' }),
    }));
    expect(String(fetchMock.mock.calls[3]![1]?.body)).not.toContain('displayName');
    expect(String(fetchMock.mock.calls[4]![1]?.body)).not.toContain('displayName');
  });
});
