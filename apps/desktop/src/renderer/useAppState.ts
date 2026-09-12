import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, DesktopToPhone } from '@omnicam/protocol';
import type { AppState } from '../shared/ipc';

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);

  useEffect(() => {
    let alive = true;
    void window.omnicam.getState().then((s) => alive && setState(s));
    const offState = window.omnicam.onState((patch) => setState((prev) => (prev ? { ...prev, ...patch } : prev)));
    const offErr = window.omnicamVcamError.on((vcamError) => setState((prev) => (prev ? { ...prev, vcamError } : prev)));
    return () => {
      alive = false;
      offState();
      offErr();
    };
  }, []);

  const setSettings = useCallback(async (patch: Partial<AppSettings>) => {
    // optimistic
    setState((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev));
    const settings = await window.omnicam.setSettings(patch);
    setState((prev) => (prev ? { ...prev, settings } : prev));
  }, []);

  const control = useCallback((msg: DesktopToPhone) => window.omnicam.control(msg), []);

  return { state, setSettings, control };
}
