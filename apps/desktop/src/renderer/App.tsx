import { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import type { ConnectionState } from '@omnicam/protocol';
import { LiveView } from './components/LiveView';
import { Mark } from './components/Mark';
import { PairView } from './components/PairView';
import { SettingsDialog } from './components/SettingsDialog';
import { Dialog, IconButton } from './components/ui';
import { useAppState } from './useAppState';
import { Toasts, useToasts } from './toasts';

const STATUS: Record<ConnectionState, string> = {
  idle: 'Waiting for phone',
  connecting: 'Connecting',
  connected: 'Live',
  stalled: 'Paused on phone',
  disconnected: 'Reconnecting',
};

export function App() {
  const { state, setSettings, control } = useAppState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const { toasts, push } = useToasts();
  const prevState = useRef<ConnectionState>('idle');

  // Toasts on meaningful transitions only.
  useEffect(() => {
    const s = state?.stats.state;
    if (!s || s === prevState.current) return;
    const phone = state.stats.device?.platform ?? 'Phone';
    if (s === 'connected' && prevState.current !== 'stalled') push(`${phone} connected`, 'ok');
    if (s === 'disconnected') push(`${phone} disconnected — waiting for it to come back`, 'warn');
    if (s === 'idle' && prevState.current !== 'idle') setQrOpen(false);
    prevState.current = s;
  }, [state?.stats.state, state?.stats.device, push]);

  if (!state) return <div className="app" />;
  const { pairing, settings, stats, vcam, vcamError, version } = state;
  const showLive = stats.state !== 'idle';

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <Mark />
          OmniCam
        </div>
        <span className={`status ${stats.state}`}>
          <i />
          {STATUS[stats.state]}
          {showLive && stats.device ? ` · ${stats.device.platform}` : ''}
        </span>
        <div className="spacer" />
        <IconButton title="Settings" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
        </IconButton>
      </header>

      <main className="content">
        {showLive ? (
          <LiveView
            stats={stats}
            vcam={vcam}
            settings={settings}
            onSettings={(p) => void setSettings(p)}
            onControl={(m) => void control(m)}
            onShowQr={() => setQrOpen(true)}
          />
        ) : (
          <PairView pairing={pairing} vcam={vcam} vcamError={vcamError} onOpenSettings={() => setSettingsOpen(true)} />
        )}
      </main>

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          pairing={pairing}
          vcam={vcam}
          vcamError={vcamError}
          version={version}
          onSettings={(p) => void setSettings(p)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {qrOpen && pairing && (
        <Dialog className="qr" onClose={() => setQrOpen(false)}>
          <img src={pairing.qrDataUrl} alt="Pairing QR code" />
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 12.5 }}>
            Scanning with another phone replaces the current one.
          </p>
          <button className="btn" onClick={() => setQrOpen(false)}>
            Done
          </button>
        </Dialog>
      )}
      <Toasts items={toasts} />
    </div>
  );
}
