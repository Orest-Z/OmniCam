import { useEffect, useRef, useState } from 'react';
import { Moon, Settings as SettingsIcon, Sun } from 'lucide-react';
import type { ConnectionState } from '@omnicam/protocol';
import type { UpdateState } from '../shared/ipc';
import { LiveView } from './components/LiveView';
import { Mark } from './components/Mark';
import { PairView } from './components/PairView';
import { SettingsDialog, portFallback, portFallbackMessage } from './components/SettingsDialog';
import { UpdateDialog, updateOnOffer } from './components/UpdateDialog';
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

/** Title-bar badge text while an update is on offer; null hides the badge. */
function updateBadge(u: UpdateState): string | null {
  if (u.status === 'downloading') return `Updating ${u.percent ?? 0}%`;
  if (u.status === 'downloaded') return 'Restart to update';
  if (u.status === 'error' && u.failed === 'download') return 'Update failed';
  // 'available', and also a check that failed while this version was already on offer.
  return updateOnOffer(u) ? 'Update available' : null;
}

export function App() {
  const { state, setSettings, control } = useAppState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const { toasts, push } = useToasts();
  const prevState = useRef<ConnectionState>('idle');
  const prevCheckedAt = useRef<number | null | undefined>(undefined);
  const prevPortFallback = useRef<string | null>(null);

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

  // The server ended up on a different port than the one in settings: say so once, here rather than
  // only in Settings, because someone who set a port may never open that dialog again.
  const fallback = portFallback(state?.pairing ?? null);
  useEffect(() => {
    const key = fallback ? `${fallback.requestedPort}->${fallback.port}` : null;
    if (key === prevPortFallback.current) return;
    prevPortFallback.current = key;
    if (fallback) push(portFallbackMessage(fallback.requestedPort, fallback.port), 'warn');
  }, [fallback, push]);

  // A check the user started gets an answer: the prompt if there is an update, a toast if not.
  // Keyed on checkedAt (set when a check finishes), so it reacts once per finished check.
  const update = state?.update;
  const version = state?.version;
  useEffect(() => {
    if (!update) return;
    const seen = prevCheckedAt.current;
    prevCheckedAt.current = update.checkedAt ?? null;
    // First state after the window opens: remember where we are, don't replay an old result.
    if (seen === undefined || update.checkedAt === undefined || update.checkedAt === seen) return;
    if (!update.manual) return;
    if (update.status === 'available') {
      setSettingsOpen(false);
      setUpdateOpen(true);
    } else if (update.status === 'not-available') {
      push(`You're on the latest version (${version})`, 'ok');
    } else if (update.status === 'error' && update.failed === 'check') {
      push(`Couldn't check for updates. ${update.error}`, 'bad');
    }
  }, [update, version, push]);

  if (!state) return <div className="app" />;
  const { pairing, settings, stats, vcam, vcamError } = state;
  const showLive = stats.state !== 'idle';
  const badge = updateBadge(state.update);
  // What is on screen now ('system' resolves through Windows); the toggle picks the other one.
  const dark = settings.theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : settings.theme === 'dark';

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
        {badge && (
          <button
            className={`status update${state.update.status === 'error' ? ' failed' : ''}`}
            title="See the update"
            onClick={() => setUpdateOpen(true)}
          >
            <i />
            {badge}
          </button>
        )}
        <IconButton title={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => void setSettings({ theme: dark ? 'light' : 'dark' })}>
          {dark ? <Sun /> : <Moon />}
        </IconButton>
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
          stats={stats}
          update={state.update}
          version={state.version}
          onSettings={(p) => void setSettings(p)}
          onControl={(m) => void control(m)}
          onOpenUpdate={() => {
            setSettingsOpen(false);
            setUpdateOpen(true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {updateOpen && (
        <UpdateDialog update={state.update} version={state.version} stats={stats} vcam={vcam} onClose={() => setUpdateOpen(false)} />
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
