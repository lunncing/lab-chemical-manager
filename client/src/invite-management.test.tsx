import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GeneratedInviteNotice, InviteTable, createInvite, inviteStatusLabel, revokeInvite } from './invite-management.js';
import type { CreatedRegistrationInvite, RegistrationInvite } from './types.js';

const base: RegistrationInvite = {
  id: 7, codeHint: 'LSF-Ab12…xY_9', creator: { id: 2, username: 'admin', displayName: '普通管理员' },
  createdAt: '2026-08-30T08:00:00.000Z', expiresAt: '2026-09-06T08:00:00.000Z', status: 'active',
  usedBy: null, usedAt: null, revokedAt: null, version: 1,
};

describe('invite management UI', () => {
  it('renders safe list fields, all Chinese statuses, usage details, and active-only revoke controls without plaintext', () => {
    const invites: RegistrationInvite[] = [
      base,
      { ...base, id: 8, status: 'used', codeHint: 'LSF-Cd34…zZ_8', usedBy: { id: 9, username: 'fresh', displayName: '新成员' }, usedAt: '2026-08-31T08:00:00.000Z', version: 2 },
      { ...base, id: 9, status: 'revoked', codeHint: 'LSF-Ef56…qQ_7', revokedAt: '2026-08-31T09:00:00.000Z', version: 2 },
      { ...base, id: 10, status: 'expired', codeHint: 'LSF-Gh78…pP_6' },
    ];
    const html = renderToStaticMarkup(<InviteTable invites={invites} onRevoke={() => undefined} />);
    for (const text of ['提示', '创建人', '创建时间', '过期时间', '状态', '使用人 / 时间', '有效', '已使用', '已撤销', '已过期', '新成员', '@fresh']) expect(html).toContain(text);
    expect((html.match(/>撤销</g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('LSF-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(inviteStatusLabel).toEqual({ active: '有效', used: '已使用', revoked: '已撤销', expired: '已过期' });
  });

  it('shows a newly generated full code with the one-time warning and expiry', () => {
    const created: CreatedRegistrationInvite = { id: 11, code: `LSF-${'A'.repeat(32)}`, codeHint: 'LSF-AAAA…AAAA', createdAt: base.createdAt, expiresAt: base.expiresAt, version: 1 };
    const html = renderToStaticMarkup(<GeneratedInviteNotice invite={created} onCopy={() => undefined} />);
    expect(html).toContain(created.code); expect(html).toContain('只显示本次，请立即复制'); expect(html).toContain('复制邀请码'); expect(html).toContain('过期时间');
  });

  it('uses strict create and versioned revoke API payloads', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input) => new Response(JSON.stringify(String(input).endsWith('/revoke') ? { invite: { ...base, status: 'revoked', version: 2 } } : { invite: { ...base, code: `LSF-${'B'.repeat(32)}` } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      await createInvite(); await revokeInvite(base);
      expect(globalThis.fetch).toHaveBeenNthCalledWith(1, '/api/registration-invites', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]?.body).toBeUndefined();
      expect(globalThis.fetch).toHaveBeenNthCalledWith(2, '/api/registration-invites/7/revoke', expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 1 }) }));
    } finally { globalThis.fetch = originalFetch; }
  });
});
