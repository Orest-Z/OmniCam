import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

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
  className = '',
  onClick,
  children,
}: {
  on?: boolean;
  title: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={`iconbtn ${className}` + (on ? ' on' : '')} title={title} aria-label={title} aria-pressed={on} disabled={disabled} onClick={onClick}>
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

/** A shell command to paste into a terminal, with a copy button. */
export function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className="cmd">
      <code>{text}</code>
      <button className="btn ghost sm" title={copied ? 'Copied' : 'Copy'} aria-label="Copy the command" onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </button>
    </div>
  );
}
