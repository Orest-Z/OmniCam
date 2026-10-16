import { useState, type ReactNode } from 'react';
import { AlertTriangle, AppWindow, CheckCircle2, ChevronRight, Info, Mic, Video, Wifi, type LucideIcon } from 'lucide-react';
import type { AppSettings, PairingInfo, UpdateState, VirtualCamStats } from '../../shared/ipc';
import { micNameFor, pickSink } from '../../shared/audio-sink';
import { useLoopbacks } from '../useLoopbacks';
import { Dialog, Segmented, Switch } from './ui';
import { updateOnOffer, updateSummary } from './UpdateDialog';

interface Props {
  settings: AppSettings;
  pairing: PairingInfo | null;
  vcam: VirtualCamStats;
  vcamError: string | null;
  update: UpdateState;
  version: string;
  platform: NodeJS.Platform;
  trayAvailable: boolean;
  onSettings: (patch: Partial<AppSettings>) => void;
  onOpenUpdate: () => void;
  onOpenMicGuide: () => void;
  onOpenWhatsNew: () => void;
  onClose: () => void;
}

/** The port in settings was taken, so the server is somewhere else — shown wherever the port is. */
export function portFallback(pairing: PairingInfo | null): PairingInfo | null {
  return pairing && pairing.port !== pairing.requestedPort ? pairing : null;
}

export function portFallbackMessage(requested: number, actual: number): string {
  return `Port ${requested} is used by another program, so OmniCam is on ${actual} instead. The QR code already points there, so pairing works; pick a free port if you need a fixed one.`;
}

type SectionId = 'camera' | 'mic' | 'connection' | 'app' | 'about';
/** A dot on a section's icon: something to fix (bad, warn) or something new (an update). */
type Attention = 'bad' | 'warn' | 'new' | null;

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: 'camera', label: 'Camera', icon: Video },
  { id: 'mic', label: 'Microphone', icon: Mic },
  { id: 'connection', label: 'Connection', icon: Wifi },
  { id: 'app', label: 'App', icon: AppWindow },
  { id: 'about', label: 'About', icon: Info },
];

/**
 * Settings as five sections in a sidebar. Each opens with a status line, and a section that needs
 * attention carries a dot. Long explanations sit in ⓘ tooltips.
 */
export function SettingsDialog({ settings, pairing, vcam, vcamError, update, version, platform, trayAvailable, onSettings, onOpenUpdate, onOpenMicGuide, onOpenWhatsNew, onClose }: Props) {
  const fallback = portFallback(pairing);
  const loopbacks = useLoopbacks();
  const sink = loopbacks && pickSink(loopbacks.outputs, settings.micOutput);
  const attention: Record<SectionId, Attention> = {
    camera: vcamError ? 'bad' : null,
    mic: loopbacks?.isDefault ? 'bad' : null,
    connection: fallback ? 'warn' : null,
    app: null,
    about: updateOnOffer(update) ? 'new' : null,
  };
  // Until a section is picked, Settings shows the first one with a problem, including the microphone's,
  // which is only known once the devices have been listed.
  const [picked, setSection] = useState<SectionId | null>(null);
  const section = picked ?? SECTIONS.find((s) => attention[s.id] === 'bad' || attention[s.id] === 'warn')?.id ?? 'camera';
  const pane = {
    camera: <CameraPane settings={settings} vcam={vcam} vcamError={vcamError} onSettings={onSettings} />,
    mic: <MicPane settings={settings} loopbacks={loopbacks} sink={sink} onSettings={onSettings} onOpenMicGuide={onOpenMicGuide} />,
    connection: <ConnectionPane settings={settings} pairing={pairing} onSettings={onSettings} />,
    app: <AppPane settings={settings} platform={platform} trayAvailable={trayAvailable} onSettings={onSettings} />,
    about: <AboutPane settings={settings} update={update} version={version} onSettings={onSettings} onOpenUpdate={onOpenUpdate} onOpenWhatsNew={onOpenWhatsNew} />,
  }[section];

  return (
    <Dialog title="Settings" className="settings" onClose={onClose}>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={id === section ? 'on' : ''} aria-current={id === section} onClick={() => setSection(id)}>
              <span className="ic">
                <Icon />
              </span>
              {label}
              {attention[id] && <i className={`dot ${attention[id]}`} />}
            </button>
          ))}
        </nav>
        <section className="settings-pane">{pane}</section>
      </div>
    </Dialog>
  );
}

function CameraPane({ settings, vcam, vcamError, onSettings }: Pick<Props, 'settings' | 'vcam' | 'vcamError' | 'onSettings'>) {
  return (
    <>
      <h3>Camera</h3>
      {vcamError ? (
        <div className="notice bad">
          <AlertTriangle />
          <span>
            The "OmniCam" camera isn't available: <code>{vcamError}</code>
            <br />
            Run the OmniCam installer again to register it. From a source checkout: <code>npm run native:build</code>, then{' '}
            <code>npm run native:register</code> as admin.
          </span>
        </div>
      ) : (
        <Status ok>
          {vcam.running ? `"OmniCam" camera active · ${vcam.width}×${vcam.height} · ${vcam.fps} fps` : '"OmniCam" camera starting…'}
          {vcam.consumers > 0 ? ` · in use by ${vcam.consumers} app${vcam.consumers > 1 ? 's' : ''}` : ''}
        </Status>
      )}

      <Field
        title="Output resolution"
        sub="What Discord, Zoom and Teams receive."
        info="Apps get exactly this frame rate, so it follows the phone's camera (60 for 720p60). Changing it restarts the camera. 4K is for OBS or recording: calls send at most 1080p, and 4K costs much more CPU."
      >
        <Segmented
          value={settings.outputPreset}
          options={[
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p' },
            { value: '4k', label: '4K' },
          ]}
          onChange={(v) => onSettings({ outputPreset: v })}
        />
        <Segmented
          value={settings.outputFps}
          options={[
            { value: 30, label: '30' },
            { value: 60, label: '60' },
          ]}
          onChange={(v) => onSettings({ outputFps: v })}
        />
      </Field>
      <Field title="When the phone pauses" sub="Locked screen, switched app, lost Wi-Fi.">
        <Segmented
          value={settings.holdLastFrame ? 'hold' : 'placeholder'}
          options={[
            { value: 'hold', label: 'Hold last frame' },
            { value: 'placeholder', label: 'Placeholder' },
          ]}
          onChange={(v) => onSettings({ holdLastFrame: v === 'hold' })}
        />
      </Field>
      <Field
        title="Stream details"
        sub="Numbers over the preview."
        info="Resolution, real frame rate and bitrate. The preview itself is a reduced 10 fps snapshot; apps get the full stream."
      >
        <Segmented
          value={settings.streamDetails}
          options={[
            { value: 'always', label: 'Always' },
            { value: 'hover', label: 'On hover' },
          ]}
          onChange={(v) => onSettings({ streamDetails: v })}
        />
      </Field>

      <details className="advanced">
        <summary>
          <ChevronRight />
          Advanced
        </summary>
        <Field
          title="Hardware video decoding"
          sub="Applies after a restart."
          info="Off is faster up to 1080p on most computers, because the camera needs frames in system memory anyway. Try On for 4K."
        >
          <Switch on={settings.hardwareDecode} onChange={(v) => onSettings({ hardwareDecode: v })} />
        </Field>
      </details>
    </>
  );
}

function MicPane({
  settings,
  loopbacks,
  sink,
  onSettings,
  onOpenMicGuide,
}: Pick<Props, 'settings' | 'onSettings' | 'onOpenMicGuide'> & { loopbacks: ReturnType<typeof useLoopbacks>; sink: MediaDeviceInfo | null }) {
  return (
    <>
      <h3>Microphone</h3>
      {!loopbacks ? (
        <Status>Looking for VB-CABLE…</Status>
      ) : loopbacks.isDefault ? (
        <div className="notice bad">
          <AlertTriangle />
          <span>
            VB-CABLE is the default sound output in Windows, so apps would hear everything this computer plays through the phone. Make your
            speakers or headphones the default again.
            <br />
            <button className="link" onClick={onOpenMicGuide}>
              Show me how
            </button>
          </span>
        </div>
      ) : sink ? (
        <Status ok>Ready · apps pick "{micNameFor(sink.label)}"</Status>
      ) : (
        <Status>Not set up yet</Status>
      )}

      {loopbacks && !sink ? (
        <div className="callout">
          <span className="ic">
            <Mic />
          </span>
          <div>
            <b>Use your phone as a microphone</b>
            <p>With or without its camera. It needs VB-CABLE, a free helper; the guide shows each step with pictures.</p>
          </div>
          <button className="btn primary" onClick={onOpenMicGuide}>
            Set up
          </button>
        </div>
      ) : (
        loopbacks &&
        sink && (
          <>
            <Field title="Play the phone's sound into" sub="The cable apps record from.">
              <select className="select" value={sink.label} onChange={(e) => onSettings({ micOutput: e.target.value })}>
                {loopbacks.outputs.map((d) => (
                  <option key={d.deviceId} value={d.label}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field title="Camera, microphone or both" sub="Switch on the phone, or with the buttons in the window.">
              <button className="btn" onClick={onOpenMicGuide}>
                Setup guide
              </button>
            </Field>
          </>
        )
      )}
    </>
  );
}

function ConnectionPane({ settings, pairing, onSettings }: Pick<Props, 'settings' | 'pairing' | 'onSettings'>) {
  const [port, setPort] = useState(String(settings.port));
  const fallback = portFallback(pairing);
  const commitPort = () => {
    const n = Number(port);
    if (Number.isInteger(n) && n > 1024 && n < 65536 && n !== settings.port) onSettings({ port: n });
    else setPort(String(settings.port));
  };
  return (
    <>
      <h3>Connection</h3>
      {fallback ? (
        <div className="notice warn">
          <AlertTriangle />
          <span>{portFallbackMessage(fallback.requestedPort, fallback.port)}</span>
        </div>
      ) : (
        <Status ok>{pairing ? `Phone page at ${pairing.ip}:${pairing.port}` : 'Starting…'}</Status>
      )}
      <Field title="Network" sub="The address in the QR code." info="Pick the adapter on the same Wi-Fi as the phone if the computer has several.">
        <select className="select" value={settings.preferredIp || pairing?.ip || ''} onChange={(e) => onSettings({ preferredIp: e.target.value })}>
          {(pairing?.addresses ?? []).map((a) => (
            <option key={a.ip} value={a.ip}>
              {a.ip} — {a.interfaceName}
              {a.wifi ? ' (Wi-Fi)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field title="Port" sub="Changes the QR code." info="Pick another if something else on this computer uses it.">
        <input className="input" value={port} onChange={(e) => setPort(e.target.value)} onBlur={commitPort} onKeyDown={(e) => e.key === 'Enter' && commitPort()} />
      </Field>
    </>
  );
}

function AppPane({ settings, platform, trayAvailable, onSettings }: Pick<Props, 'settings' | 'platform' | 'trayAvailable' | 'onSettings'>) {
  return (
    <>
      <h3>App</h3>
      <Field title="Appearance" sub={platform === 'win32' ? 'System follows Windows.' : 'System follows your desktop.'}>
        <Segmented
          value={settings.theme}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
          onChange={(v) => onSettings({ theme: v })}
        />
      </Field>
      {trayAvailable ? (
        <Field title="Keep running in the tray" sub="Closing the window keeps the camera available.">
          <Switch on={settings.closeToTray} onChange={(v) => onSettings({ closeToTray: v })} />
        </Field>
      ) : (
        // No tray to hide in (stock GNOME): the window minimises instead. Off is the way to quit.
        <Field title="Keep running when the window closes" sub="No tray here, so the window minimises." info="GNOME needs the AppIndicator extension for a tray icon.">
          <Switch on={settings.closeToTray} onChange={(v) => onSettings({ closeToTray: v })} />
        </Field>
      )}
      <Field title="Start OmniCam when I sign in">
        <Switch on={settings.launchAtLogin} onChange={(v) => onSettings({ launchAtLogin: v })} />
      </Field>
    </>
  );
}

function AboutPane({
  settings,
  update,
  version,
  onSettings,
  onOpenUpdate,
  onOpenWhatsNew,
}: Pick<Props, 'settings' | 'update' | 'version' | 'onSettings' | 'onOpenUpdate' | 'onOpenWhatsNew'>) {
  return (
    <>
      <h3>About</h3>
      <Status ok={update.status === 'not-available'}>
        OmniCam {version} · {updateSummary(update)}
      </Status>
      {__RELEASE_NOTES__ && (
        <Field title={`What's new in ${version}`} sub="What this version brought.">
          <button className="btn" onClick={onOpenWhatsNew}>
            Show
          </button>
        </Field>
      )}
      <Field title="Updates">
        {updateOnOffer(update) ? (
          <button className="btn primary" onClick={onOpenUpdate}>
            {update.status === 'downloaded' ? 'Restart to update' : `Update to ${update.version}`}
          </button>
        ) : (
          <button className="btn" disabled={update.status === 'checking' || update.status === 'unsupported'} onClick={() => void window.omnicam.checkForUpdates()}>
            {update.status === 'checking' ? 'Checking…' : 'Check now'}
          </button>
        )}
      </Field>
      <Field
        title="Check for updates automatically"
        sub="At launch and once a day."
        info="Asks GitHub for a newer version. Nothing is downloaded until you click."
      >
        <Switch on={settings.autoUpdateCheck} onChange={(v) => onSettings({ autoUpdateCheck: v })} />
      </Field>
      <Field title="Log file" sub="For bug reports. Nothing is sent automatically.">
        <button className="btn" onClick={() => void window.omnicam.openLogs()}>
          Open log folder
        </button>
      </Field>
    </>
  );
}

/** A section's one-line state, under its title. */
function Status({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <p className={'pane-status' + (ok ? ' ok' : '')}>
      {ok ? <CheckCircle2 /> : <Info />}
      <span>{children}</span>
    </p>
  );
}

/** A setting: title, at most one short line, the longer story in an ⓘ tooltip, the control on the right. */
function Field({ title, sub, info, children }: { title: string; sub?: string; info?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="k">
        <span className="title">
          {title}
          {info && (
            <span className="info" tabIndex={0} title={info} aria-label={info}>
              <Info />
            </span>
          )}
        </span>
        {sub && <small>{sub}</small>}
      </div>
      <div className="v">{children}</div>
    </div>
  );
}
