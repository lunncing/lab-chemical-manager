import type { FormEventHandler, ReactNode } from 'react';
import { Modal, Status } from './components.js';

export function shouldSubmitActionDialogOnKey(key: string, shiftKey: boolean, tagName: string, isComposing = false): boolean {
  return key === 'Enter' && !shiftKey && !isComposing && tagName === 'TEXTAREA';
}

export function ActionDialog({
  title, description, confirmLabel, children, busy = false, error = '', danger = false, submitDisabled = false, onClose, onSubmit,
}: {
  title: string; description: string; confirmLabel: string; children?: ReactNode; busy?: boolean; error?: string;
  danger?: boolean; submitDisabled?: boolean; onClose: () => void; onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const close = () => { if (!busy) onClose(); };
  return <Modal title={title} description={description} onClose={close} closeDisabled={busy}>
    <form className="action-dialog-form" aria-busy={busy || undefined} onSubmit={onSubmit} onKeyDown={(event) => {
      if (!busy && shouldSubmitActionDialogOnKey(event.key, event.shiftKey, (event.target as HTMLElement).tagName, event.nativeEvent.isComposing)) {
        event.preventDefault(); event.currentTarget.requestSubmit();
      }
    }}>
      {children && <div className="action-dialog-body">{children}</div>}
      {error && <Status kind="error">{error}</Status>}
      <div className="form-actions">
        <button type="button" disabled={busy} onClick={close}>取消</button>
        <button type="submit" className={danger ? 'danger' : 'primary'} disabled={busy || submitDisabled}>{busy ? '处理中…' : confirmLabel}</button>
      </div>
    </form>
  </Modal>;
}
