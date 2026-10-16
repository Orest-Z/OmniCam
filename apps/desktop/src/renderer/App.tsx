import { useEffect, useRef, useState } from 'react';
import { Bug, Heart, Moon, Settings as SettingsIcon, Sun } from 'lucide-react';
import type { ConnectionState, UpdateState } from '../shared/ipc';
import { LiveView } from './components/LiveView';
import { MicGuide } from './components/MicGuide';
import { Mark } from './components/Mark';
import { PairView } from './components/PairView';
import { SettingsDialog, portFallback, portFallbackMessage } from './components/SettingsDialog';
import { UpdateDialog, WhatsNewDialog, updateOnOffer } from './components/UpdateDialog';
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

const SPONSORS_URL = 'https://github.com/sponsors/Orest-Z';

/**
 * A new GitHub issue with a short form already filled in: which OmniCam and which phone (never an
 * address or a name), and where the log is.
 */
function bugReportUrl(version: string, platform: NodeJS.Platform, phone?: string): string {
  const os = platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform;
  const body = [
    '**What happened?**',
    '',
    '',
    '**What did you expect instead?**',
    '',
    '',
    '---',
    `OmniCam ${version} · ${os}${phone ? ` · phone: ${phone}` : ''}`,
    'The log helps a lot: Settings → About → Open log folder, then attach omnicam.log here.',
  ].join('\n');
  return `https://github.com/Orest-Z/OmniCam/issues/new?body=${encodeURIComponent(body)}`;
}

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
  const [micGuideOpen, setMicGuideOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
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

  // First launch after an update: what it brought, once (closing the dialog marks it seen).
  const notesUnseen = Boolean(state && __RELEASE_NOTES__ && state.settings.notesSeen !== state.version);
  useEffect(() => {
    if (notesUnseen) setWhatsNewOpen(true);
  }, [notesUnseen]);

  if (!state) return <div className="app" />;
  const { pairing, settings, stats, vcam, vcamError } = state;
  const showLive = stats.state !== 'idle';
  const badge = updateBadge(state.update);
  // What is on screen now ('system' resolves through the OS); the toggle picks the other one.
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
        <IconButton title="Report a bug on GitHub" onClick={() => void window.omnicam.openExternal(bugReportUrl(state.version, state.platform, stats.device?.platform))}>
          <Bug />
        </IconButton>
        <IconButton title="Sponsor OmniCam on GitHub" className="heart" onClick={() => void window.omnicam.openExternal(SPONSORS_URL)}>
          <Heart />
        </IconButton>
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
            virtualMic={state.virtualMic}
            onSettings={(p) => void setSettings(p)}
            onControl={(m) => void control(m)}
            onShowQr={() => setQrOpen(true)}
            onOpenMicGuide={() => setMicGuideOpen(true)}
          />
        ) : (
          <PairView pairing={pairing} vcam={vcam} vcamError={vcamError} platform={state.platform} distro={state.distro} onOpenSettings={() => setSettingsOpen(true)} />
        )}
      </main>

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          pairing={pairing}
          vcam={vcam}
          vcamError={vcamError}
          update={state.update}
          version={state.version}
          platform={state.platform}
          distro={state.distro}
          trayAvailable={state.trayAvailable}
          virtualMic={state.virtualMic}
          onSettings={(p) => void setSettings(p)}
          onOpenUpdate={() => {
            setSettingsOpen(false);
            setUpdateOpen(true);
          }}
          onOpenMicGuide={() => {
            setSettingsOpen(false);
            setMicGuideOpen(true);
          }}
          onOpenWhatsNew={() => {
            setSettingsOpen(false);
            setWhatsNewOpen(true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {whatsNewOpen && (
        <WhatsNewDialog
          version={state.version}
          onClose={() => {
            setWhatsNewOpen(false);
            if (settings.notesSeen !== state.version) void setSettings({ notesSeen: state.version });
          }}
        />
      )}
      {micGuideOpen && (
        <MicGuide stats={stats} settings={settings} virtualMic={state.virtualMic} onControl={(m) => void control(m)} onClose={() => setMicGuideOpen(false)} />
      )}
      {updateOpen && (
        <UpdateDialog update={state.update} version={state.version} stats={stats} vcam={vcam} platform={state.platform} onClose={() => setUpdateOpen(false)} />
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
