import type { ReactNode } from 'react';

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({
  on,
  title,
  disabled,
  onClick,
  children,
}: {
  on?: boolean;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={'iconbtn' + (on ? ' on' : '')} title={title} aria-label={title} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={'switch' + (on ? ' on' : '')} role="switch" aria-checked={on} onClick={() => onChange(!on)} />;
}

export function Dialog({ title, onClose, children, className = '' }: { title?: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card dialog ${className}`} role="dialog" aria-modal="true">
        {title && (
          <header>
            <h2>{title}</h2>
            <button className="btn ghost sm" onClick={onClose} aria-label="Close">
              Close
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
