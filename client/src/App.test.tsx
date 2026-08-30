import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CabinetBoard, canAdministerAccounts, canApprove } from './components.js';
import { Login, PrimaryNavigation, RegisterForm, registerAccount, safeViewForRole, taskSummaryPath } from './App.js';
import type { UserView } from './types.js';
import { revisionEvents } from './realtime-events.js';

describe('front-end critical behavior', () => {
  it('renders a clean login form with empty credentials and no demo guidance', () => {
    const html = renderToStaticMarkup(<Login onLogin={() => undefined} />);
    expect(html).toContain('登录');
    expect(html).not.toContain('member-a');
    expect(html).not.toContain('Demo1234!');
    expect(html).not.toContain('首测演示凭据');
    expect(html).not.toContain('统一密码');
    expect(html).not.toContain('demo-note');
    expect(html).toContain('注册');
  });

  it('renders strict member registration fields without any role control', () => {
    const html = renderToStaticMarkup(<RegisterForm onAuthenticated={() => undefined} />);
    expect(html).toContain('用户名'); expect(html).toContain('姓名');
    expect(html).toContain('密码'); expect(html).toContain('确认密码'); expect(html).toContain('邀请码');
    expect(html).toContain('邀请码由审批与普通采购人或超级管理员生成，一次性且 7 天有效');
    expect(html).toContain('注册账号默认为普通成员，管理员权限由超级管理员设置');
    expect(html).not.toContain('name="role"');
    expect(html).not.toContain('超级管理员</option>');
  });

  it('posts only registration fields and returns the user used for automatic login', async () => {
    const user: UserView = { id: 9, username: 'fresh', displayName: '新用户', role: 'member', active: true, demo: false, version: 1 };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ user }), { status: 201, headers: { 'content-type': 'application/json' } }));
    try {
      const input = { username: 'fresh', displayName: '新用户', password: 'LongPassword123!', passwordConfirm: 'LongPassword123!', inviteCode: `LSF-${'A'.repeat(32)}` };
      await expect(registerAccount(input)).resolves.toEqual(user);
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
        method: 'POST', credentials: 'same-origin', body: JSON.stringify(input),
      }));
      expect(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]?.body)).not.toContain('role');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders A/B then the single-shelf acid cabinet with 11 ordered, clickable shelves', () => {
    const html = renderToStaticMarkup(<CabinetBoard chemicals={[{
      id: 1, name: '乙醇', specification: 'AR', cabinet: 'A', shelf: 1, status: 'active', version: 1,
      owner: { id: 4, username: 'member-a', displayName: '成员甲' }, inboundOperator: { id: 4, username: 'member-a', displayName: '成员甲' },
      inboundAt: '', createdAt: '', updatedAt: '', discardReason: null,
    }]} onChemical={() => undefined} />);
    expect((html.match(/data-shelf=/g) ?? [])).toHaveLength(11);
    expect(html).toContain('A · 常温柜'); expect(html).toContain('B · 冷藏柜'); expect(html).toContain('C · 酸柜');
    expect(html).toContain('单层 · 仅酸性物质'); expect(html).toContain('乙醇');
    expect(html.indexOf('A · 常温柜')).toBeLessThan(html.indexOf('B · 冷藏柜'));
    expect(html.indexOf('B · 冷藏柜')).toBeLessThan(html.indexOf('C · 酸柜'));
    expect(html.indexOf('data-shelf="1"')).toBeLessThan(html.indexOf('data-shelf="5"'));
  });

  it('maps role affordances to the same approval model used by the server', () => {
    expect(canApprove('normal_admin', 'normal')).toBe(true);
    expect(canApprove('normal_admin', 'urgent')).toBe(false);
    expect(canApprove('super_admin', 'urgent')).toBe(true);
    expect(canAdministerAccounts('member')).toBe(false);
    expect(canAdministerAccounts('super_admin')).toBe(true);
  });
});

describe('role-filtered primary navigation', () => {
  const summary = { approvalCount: 3, procurementCount: 2 };

  function navigation(role: 'member' | 'normal_admin' | 'super_admin' | 'hazardous_buyer') {
    return renderToStaticMarkup(<PrimaryNavigation role={role} view="inventory" summary={summary} unread={0} onView={() => undefined} />);
  }

  it('omits task navigation DOM entirely for members', () => {
    const html = navigation('member');
    expect(html).not.toContain('待审批');
    expect(html).not.toContain('待采购');
    expect(html).not.toContain('邀请码管理');
    expect(navigation('hazardous_buyer')).not.toContain('邀请码管理');
  });

  it('shows only procurement to hazardous buyers and both counted tasks to administrators', () => {
    const hazardous = navigation('hazardous_buyer');
    expect(hazardous).not.toContain('待审批');
    expect(hazardous).toContain('待采购（2）');

    for (const role of ['normal_admin', 'super_admin'] as const) {
      const html = navigation(role);
      expect(html).toContain('邀请码管理');
      expect(html).toContain('待审批（3）');
      expect(html).toContain('待采购（2）');
      expect(html).not.toContain('我的审批');
      expect(html.indexOf('采购申请')).toBeLessThan(html.indexOf('待审批（3）'));
      expect(html.indexOf('待审批（3）')).toBeLessThan(html.indexOf('待采购（2）'));
      expect(html.indexOf('待采购（2）')).toBeLessThan(html.indexOf('改动日志'));
    }
  });

  it('uses the server summary path, refreshes on purchase revisions, and falls back from forbidden views', () => {
    expect(taskSummaryPath).toBe('/purchases/tasks/summary');
    expect(revisionEvents).toContain('purchase:changed');
    expect(safeViewForRole('approvals', 'member')).toBe('inventory');
    expect(safeViewForRole('approvals', 'hazardous_buyer')).toBe('inventory');
    expect(safeViewForRole('procurement', 'member')).toBe('inventory');
    expect(safeViewForRole('procurement', 'hazardous_buyer')).toBe('procurement');
    expect(safeViewForRole('accounts', 'normal_admin')).toBe('inventory');
    expect(safeViewForRole('invites', 'member')).toBe('inventory');
    expect(safeViewForRole('invites', 'hazardous_buyer')).toBe('inventory');
    expect(safeViewForRole('invites', 'normal_admin')).toBe('invites');
    expect(revisionEvents).toContain('registration-invite:changed');
  });
});
