import { useEffect, type ReactNode } from 'react';
import type { PurchaseType, Role } from '../../shared/types.js';
import { cabinets } from '../../shared/cabinets.js';
import type { Chemical } from './types.js';

export function canApprove(role: Role, type: PurchaseType): boolean {
  return role === 'super_admin' || (role === 'normal_admin' && type === 'normal');
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

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭弹窗">×</button></header>{children}
    </section>
  </div>;
}

export function Status({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) { return <div className={`status ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div>; }
