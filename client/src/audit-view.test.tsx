import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuditEntries } from './views.js';
import type { AuditLog } from './types.js';

describe('audit log display', () => {
  it('keeps the public evidence summary but omits structured details from production DOM', () => {
    const log: AuditLog & { details: { secretEvidence: string } } = {
      id: 1,
      actor: { id: 4, username: 'member-a', displayName: '成员甲' },
      action: 'chemical_inbound',
      objectType: 'chemical',
      objectId: '9',
      summary: '入库药品：乙醇',
      details: { secretEvidence: 'server-only-detail' },
      createdAt: '2026-08-30T08:00:00.000Z',
    };

    const html = renderToStaticMarkup(<AuditEntries logs={[log]} />);

    expect(html).toContain('入库药品：乙醇');
    expect(html).toContain('成员甲 · chemical_inbound · chemical #9');
    expect(html).not.toContain('结构化详情');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('server-only-detail');
  });
});
