import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { PurchaseType, Role } from '../../shared/types.js';
import { cabinets } from '../../shared/cabinets.js';
import type { Chemical } from './types.js';

export function canApprove(role: Role, type: PurchaseType, hazardous = false): boolean {
  if (type === 'urgent') return role === 'super_admin';
  return role === 'super_admin' || (hazardous ? role === 'hazardous_buyer' : role === 'normal_admin');
}
export function canAdministerAccounts(role: Role): boolean { return role === 'super_admin'; }

export function CabinetBoard({ chemicals, onChemical }: { chemicals: Chemical[]; onChemical: (chemical: Chemical) => void }) {
  return <div className="cabinet-grid">
    {cabinets.map((cabinet) => <section className={`cabinet cabinet-${cabinet.id.toLowerCase()}`} key={cabinet.id} aria-labelledby={`cabinet-${cabinet.id}`}>
      <header><div><h2 id={`cabinet-${cabinet.id}`}>{cabinet.label}</h2>{cabinet.description && <p className="cabinet-description">{cabinet.description}</p>}</div><span>{chemicals.filter((item) => item.cabinet === cabinet.id).length} 件在库</span></header>
      <div className="shelves">{cabinet.shelves.map((shelf) => {
        const items = chemicals.filter((item) => item.cabinet === cabinet.id && item.shelf === shelf);
        return <section className="shelf" data-shelf={shelf} key={shelf} tabIndex={0} aria-label={`${cabinet.id} 柜 ${shelf} 层，${items.length} 件药品`}>
          <div className="shelf-label"><b>{shelf}</b><span>{items.length} 件</span></div>
          <div className="chemical-list">{items.length ? items.map((item) => <button className="chemical-chip" key={item.id} onClick={() => onChemical(item)}>
            <strong>{item.name}</strong><small>{item.specification} · {item.owner.displayName}</small>
          </button>) : <span className="empty-shelf">空</span>}</div>
        </section>;
      })}</div>
    </section>)}
  </div>;
}

export function Modal({ title, description, children, onClose, closeDisabled = false }: {
  title: string; description?: string; children: ReactNode; onClose: () => void; closeDisabled?: boolean;
}) {
  const titleId = useId(); const descriptionId = useId(); const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose); const closeDisabledRef = useRef(closeDisabled);
  onCloseRef.current = onClose; closeDisabledRef.current = closeDisabled;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabledRef.current) { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = focusable(); const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    const initial = dialogRef.current?.querySelector<HTMLElement>(
      '[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    ) ?? focusable()[0] ?? dialogRef.current;
    initial?.focus();
    return () => { document.removeEventListener('keydown', key); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!closeDisabled && event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
      <header><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="关闭弹窗" disabled={closeDisabled}>×</button></header>
      {description && <p className="modal-description" id={descriptionId}>{description}</p>}{children}
    </section>
  </div>;
}

export function Status({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) { return <div className={`status ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div>; }
