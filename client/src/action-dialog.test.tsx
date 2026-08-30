import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionDialog, shouldSubmitActionDialogOnKey } from './action-dialog.js';

describe('ActionDialog', () => {
  it('renders an accessible submit form with description, initial focus, and danger action', () => {
    const html = renderToStaticMarkup(<ActionDialog
      title="废弃药品"
      description="该操作会保留审计记录。"
      confirmLabel="确认废弃"
      danger
      onClose={() => undefined}
      onSubmit={() => undefined}
    >
      <label htmlFor="discard-reason">废弃原因（可选）</label>
      <textarea id="discard-reason" name="reason" autoFocus />
    </ActionDialog>);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain('该操作会保留审计记录。');
    expect(html).toContain('<form');
    expect(html).toContain('autofocus=""');
    expect(html).toContain('type="button"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('class="danger"');
    expect(html).toContain('确认废弃');
  });

  it('announces an error and locks every dismissal path while busy', () => {
    const html = renderToStaticMarkup(<ActionDialog
      title="确认操作"
      description="请核对信息。"
      confirmLabel="确认"
      busy
      error="服务端拒绝了操作"
      onClose={() => undefined}
      onSubmit={() => undefined}
    />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('服务端拒绝了操作');
    expect(html).toContain('处理中…');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  it('submits a multiline form on Enter while preserving Shift+Enter for a newline', () => {
    expect(shouldSubmitActionDialogOnKey('Enter', false, 'TEXTAREA')).toBe(true);
    expect(shouldSubmitActionDialogOnKey('Enter', true, 'TEXTAREA')).toBe(false);
    expect(shouldSubmitActionDialogOnKey('Enter', false, 'INPUT')).toBe(false);
    expect(shouldSubmitActionDialogOnKey('Escape', false, 'TEXTAREA')).toBe(false);
    expect(shouldSubmitActionDialogOnKey('Enter', false, 'TEXTAREA', true)).toBe(false);
  });
});
