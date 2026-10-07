import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CATEGORY_BY_ID, feelingColor, feelingLabel, formatFeeling, type CategoryId } from '../lib/feeling';
import { useUI } from '../state/ui';
import Icon from './Icon';

export function Modal({
  title,
  onClose,
  children,
  wide,
  actions,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2 className="ellipsis">{title}</h2>
          <div className="row">
            {actions}
            <button className="btn ghost icon" onClick={onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function FeelBadge({ value, label = true }: { value: number; label?: boolean }) {
  return (
    <span className="feel-badge" title={`Feeling ${formatFeeling(value)} — ${feelingLabel(value)}`}>
      <span className="feel-dot" style={{ background: feelingColor(value) }} />
      {formatFeeling(value)}
      {label && <span className="dim" style={{ fontWeight: 500 }}>{feelingLabel(value)}</span>}
    </span>
  );
}

export function CategoryLabel({ id }: { id: CategoryId }) {
  const c = CATEGORY_BY_ID.get(id);
  if (!c) return null;
  return (
    <span className="cat" style={{ color: c.color }}>
      <span aria-hidden>{c.icon}</span> {c.label}
    </span>
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className={`check ${on ? 'on' : ''}`} role="checkbox" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      {on && <Icon name="check" />}
    </button>
  );
}

/** A button that asks for a second click before doing something destructive. */
export function ConfirmButton({ onConfirm, children, className = 'btn danger' }: { onConfirm: () => void; children: ReactNode; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={className} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? 'Tap again to confirm' : children}
    </button>
  );
}

export function Toast() {
  const toast = useUI((s) => s.toast);
  const [shown, setShown] = useState<{ msg: string; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), 2600);
  }, [toast]);
  if (!shown) return null;
  return (
    <div className="toast" role="status" key={shown.n}>
      {shown.msg}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
