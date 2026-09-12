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
    (text: string, kind: Toast['kind'] = '') => {
      const id = nextId++;
      setToasts((t) => [...t, { id, text, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttlMs);
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
