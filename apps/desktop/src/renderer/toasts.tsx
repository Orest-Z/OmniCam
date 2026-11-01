import { useCallback, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'warn' | 'bad' | '';
}

let nextId = 1;

export function useToasts(ttlMs = 3500) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback(
    (text: string, kind: Toast['kind'] = '', ms = ttlMs) => {
      const id = nextId++;
      // At most five on screen: a phone repeating an error can't stack them up the window.
      setToasts((t) => [...t.slice(-4), { id, text, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
    },
    [ttlMs],
  );
  return { toasts, push };
}

export function Toasts({ items }: { items: Toast[] }) {
  if (!items.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <i />
          {t.text}
        </div>
      ))}
    </div>
  );
}
