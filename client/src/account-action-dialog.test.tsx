import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UserView } from './types.js';
import {
  AccountActionDialog, AccountRowActions, accountEditError, buildAccountEditPayload, canDeleteAccount,
  deleteManagedAccount, saveAccountEdit, toggleManagedAccount,
} from './account-action-dialog.js';

const currentUser: UserView = { id: 1, username: 'super', displayName: '超级管理员', role: 'super_admin', active: true, demo: false, version: 2 };
const account: UserView = { id: 4, username: 'member-a', displayName: '成员甲', role: 'member', active: true, demo: true, version: 5 };

afterEach(() => { vi.restoreAllMocks(); });

describe('account action dialogs', () => {
  it('validates optional password changes and builds only supported PATCH fields', () => {
    expect(accountEditError({ displayName: ' ', role: 'member', password: '', passwordConfirm: '' })).toBe('姓名不能为空');
    expect(accountEditError({ displayName: '成员甲', role: 'member', password: 'short', passwordConfirm: 'short' })).toBe('新密码至少需要 10 个字符');
    expect(accountEditError({ displayName: '成员甲', role: 'member', password: 'LongPassword1', passwordConfirm: 'LongPassword2' })).toBe('两次输入的新密码不一致');
    expect(buildAccountEditPayload(account, { displayName: '  新姓名  ', role: 'normal_admin', password: '', passwordConfirm: '' })).toEqual({
      displayName: '新姓名', role: 'normal_admin', version: 5,
    });
    expect(buildAccountEditPayload(account, { displayName: '新姓名', role: 'hazardous_buyer', password: 'LongPassword1', passwordConfirm: 'LongPassword1' })).toEqual({
      displayName: '新姓名', role: 'hazardous_buyer', password: 'LongPassword1', version: 5,
    });
  });

  it('renders edit fields with exact role labels and optional confirmed new password', () => {
    const html = renderToStaticMarkup(<AccountActionDialog account={account} action="edit" onClose={() => undefined} onDone={() => undefined} />);
    expect(html).toContain('编辑账号'); expect(html).toContain('姓名');
    expect(html).toContain('普通成员'); expect(html).toContain('审批与普通采购人');
    expect(html).toContain('超级管理员'); expect(html).toContain('危险品采购人');
    expect(html).toContain('新密码（可选）'); expect(html).toContain('确认新密码');
    expect(html.match(/minLength="10"/g)).toHaveLength(2);
    expect(html).toContain('保存修改');
  });

  it('renders enable/disable confirmation and username-confirmed irreversible deletion', () => {
    const disable = renderToStaticMarkup(<AccountActionDialog account={account} action="toggle" onClose={() => undefined} onDone={() => undefined} />);
    expect(disable).toContain('停用账号'); expect(disable).toContain('@member-a'); expect(disable).toContain('确认停用');

    const enable = renderToStaticMarkup(<AccountActionDialog account={{ ...account, active: false }} action="toggle" onClose={() => undefined} onDone={() => undefined} />);
    expect(enable).toContain('启用账号'); expect(enable).toContain('确认启用');

    const remove = renderToStaticMarkup(<AccountActionDialog account={account} action="delete" onClose={() => undefined} onDone={() => undefined} />);
    expect(remove).toContain('删除账号'); expect(remove).toContain('不可逆'); expect(remove).toContain('匿名化'); expect(remove).toContain('历史');
    expect(remove).toContain('输入用户名 member-a 确认删除'); expect(remove).toContain('required=""');
    expect(remove).toMatch(/type="submit" class="danger" disabled=""/);
    expect(canDeleteAccount(account, 'member-a')).toBe(true);
    expect(canDeleteAccount(account, ' member-a')).toBe(false);
    expect(canDeleteAccount(account, 'Member-a')).toBe(false);
  });

  it('hides self delete while retaining delete for every other account row', () => {
    const self = renderToStaticMarkup(<AccountRowActions account={currentUser} currentUserId={currentUser.id} onAction={() => undefined} />);
    expect(self).toContain('编辑'); expect(self).toContain('停用'); expect(self).not.toContain('删除');
    const other = renderToStaticMarkup(<AccountRowActions account={account} currentUserId={currentUser.id} onAction={() => undefined} />);
    expect(other).toContain('编辑'); expect(other).toContain('停用'); expect(other).toContain('删除');
  });

  it('wires edit, toggle, and delete to their unchanged endpoints and versions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await saveAccountEdit(account, { displayName: '成员乙', role: 'normal_admin', password: '', passwordConfirm: '' });
    await toggleManagedAccount(account);
    await deleteManagedAccount(account);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/users/4', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ displayName: '成员乙', role: 'normal_admin', version: 5 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/users/4', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ active: false, version: 5 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/users/4', expect.objectContaining({ method: 'DELETE' }));
    expect((fetchMock.mock.calls[2]![1] as RequestInit).body).toBeUndefined();
  });
});
