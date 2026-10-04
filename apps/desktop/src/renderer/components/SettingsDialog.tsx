import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AppSettings, DesktopToPhone, PairingInfo, StreamStats, VirtualCamStats } from '@omnicam/protocol';
import type { UpdateState } from '../../shared/ipc';
import { Dialog, Segmented, Switch } from './ui';
import { updateOnOffer, updateSummary } from './UpdateDialog';

interface Props {
  settings: AppSettings;
  pairing: PairingInfo | null;
  vcam: VirtualCamStats;
  vcamError: string | null;
  stats: StreamStats;
  update: UpdateState;
  version: string;
  onSettings: (patch: Partial<AppSettings>) => void;
  onControl: (msg: DesktopToPhone) => void;
  onOpenUpdate: () => void;
  onClose: () => void;
}

/** The port in settings was taken, so the server is somewhere else — shown wherever the port is. */
export function portFallback(pairing: PairingInfo | null): PairingInfo | null {
  return pairing && pairing.port !== pairing.requestedPort ? pairing : null;
}

export function portFallbackMessage(requested: number, actual: number): string {
  return `Port ${requested} is used by another program, so OmniCam is on ${actual} instead. The QR code already points there, so pairing works; pick a free port if you need a fixed one.`;
}

export function SettingsDialog({ settings, pairing, vcam, vcamError, stats, update, version, onSettings, onControl, onOpenUpdate, onClose }: Props) {
  const [port, setPort] = useState(String(settings.port));
  const live = stats.state === 'connected' || stats.state === 'stalled';
  const android = live && stats.device?.platform === 'Android';
  const track = stats.trackInfo;
  const fallback = portFallback(pairing);
  const commitPort = () => {
    const n = Number(port);
    if (Number.isInteger(n) && n > 1024 && n < 65536 && n !== settings.port) onSettings({ port: n });
    else setPort(String(settings.port));
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      {vcamError ? (
        <div className="notice bad">
          <AlertTriangle />
          <span>
            The "OmniCam" camera device is unavailable: <code>{vcamError}</code>
            <br />
            Run the OmniCam installer again to register the camera driver. From a source checkout: <code>npm run native:build</code> then <code>npm run native:register</code> (admin).
          </span>
        </div>
      ) : (
        <div className="notice ok">
          <CheckCircle2 />
          <span>
            "OmniCam" camera device is {vcam.running ? `active at ${vcam.width}×${vcam.height} @ ${vcam.fps} fps` : 'starting'}
            {vcam.consumers > 0 ? ` and in use by ${vcam.consumers} app${vcam.consumers > 1 ? 's' : ''}` : ''}.
          </span>
        </div>
      )}

      <div className="section">Camera device</div>
      <div className="field">
        <div className="k">
          Output resolution
          <small>
            The "OmniCam" camera Discord, Zoom… see, phone or not. Apps get exactly this frame rate; the resolution buttons set it to match (60
            for 720p60). Changing it restarts the device.
          </small>
        </div>
        <div className="v">
          <Segmented
            value={settings.outputPreset}
            options={[
              { value: '720p', label: '720p' },
              { value: '1080p', label: '1080p' },
              {
                value: '4k',
                label: '4K',
                title: 'For OBS or recording. Discord, Zoom and Teams send at most 1080p, and 4K costs much more CPU.',
              },
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
        </div>
      </div>
      <div className="field">
        <div className="k">
          When the phone pauses
          <small>Locked screen, switched app, lost Wi-Fi.</small>
        </div>
        <div className="v">
          <Segmented
            value={settings.holdLastFrame ? 'hold' : 'placeholder'}
            options={[
              { value: 'hold', label: 'Hold last frame' },
              { value: 'placeholder', label: 'Show placeholder' },
            ]}
            onChange={(v) => onSettings({ holdLastFrame: v === 'hold' })}
          />
        </div>
      </div>

      <div className="field">
        <div className="k">
          Hardware video decoding
          <small>Off is faster up to 1080p on most machines (the camera needs frames in system memory anyway). Try On for 4K. Applies after restart.</small>
        </div>
        <div className="v">
          <Switch on={settings.hardwareDecode} onChange={(v) => onSettings({ hardwareDecode: v })} />
        </div>
      </div>

      <div className="field">
        <div className="k">
          Stream details
          <small>Resolution, real fps and bitrate over the preview. The preview itself is a reduced 10 fps snapshot; apps get the full stream.</small>
        </div>
        <div className="v">
          <Segmented
            value={settings.streamDetails}
            options={[
              { value: 'always', label: 'Always' },
              { value: 'hover', label: 'On hover' },
            ]}
            onChange={(v) => onSettings({ streamDetails: v })}
          />
        </div>
      </div>

      <div className="section">Phone camera</div>
      <div className="field">
        <div className="k">
          1080p at 60 fps (beta, Android only)
          <small>
            Works on Android phones whose maker lets the browser use 60 fps at 1080p. Otherwise the phone drops to the largest size that
            reaches 60. Not on iPhone: every iPhone browser runs on Safari's engine, which only gives 60 fps up to 720p, so use 720p60 there.
            {live && track ? ` Phone is sending ${track.width}×${track.height} @ ${Math.round(track.frameRate)} fps.` : ''}
          </small>
        </div>
        <div className="v">
          <button
            className="btn"
            disabled={!android}
            title={android ? '' : live ? 'Only for Android phones' : 'Connect an Android phone first'}
            onClick={() => onControl({ type: 'setResolution', preset: '1080p60' })}
          >
            Try 1080p60
          </button>
        </div>
      </div>

      <div className="section">Network</div>
      <div className="field">
        <div className="k">
          Network interface
          <small>The address embedded in the QR code.</small>
        </div>
        <div className="v">
          <select className="select" value={settings.preferredIp || pairing?.ip || ''} onChange={(e) => onSettings({ preferredIp: e.target.value })}>
            {(pairing?.addresses ?? []).map((a) => (
              <option key={a.ip} value={a.ip}>
                {a.ip} — {a.interfaceName}
                {a.wifi ? ' (Wi-Fi)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <div className="k">
          Port
          <small>Changes the QR code. Pick another if something else uses it.</small>
        </div>
        <div className="v">
          <input className="input" value={port} onChange={(e) => setPort(e.target.value)} onBlur={commitPort} onKeyDown={(e) => e.key === 'Enter' && commitPort()} />
        </div>
      </div>
      {fallback && (
        <div className="notice warn">
          <AlertTriangle />
          <span>{portFallbackMessage(fallback.requestedPort, fallback.port)}</span>
        </div>
      )}

      <div className="section">App</div>
      <div className="field">
        <div className="k">
          Appearance
          <small>System follows the Windows light/dark setting.</small>
        </div>
        <div className="v">
          <Segmented
            value={settings.theme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' },
            ]}
            onChange={(v) => onSettings({ theme: v })}
          />
        </div>
      </div>
      <div className="field">
        <div className="k">
          Keep running in the tray
          <small>Closing the window keeps the camera available.</small>
        </div>
        <div className="v">
          <Switch on={settings.closeToTray} onChange={(v) => onSettings({ closeToTray: v })} />
        </div>
      </div>
      <div className="field">
        <div className="k">Start OmniCam when I sign in</div>
        <div className="v">
          <Switch on={settings.launchAtLogin} onChange={(v) => onSettings({ launchAtLogin: v })} />
        </div>
      </div>
      <div className="field">
        <div className="k">
          Log file
          <small>Attach it to a bug report. Nothing is ever sent automatically.</small>
        </div>
        <div className="v">
          <button className="btn" onClick={() => void window.omnicam.openLogs()}>
            Open log folder
          </button>
        </div>
      </div>
      <div className="field">
        <div className="k">
          Check for updates automatically
          <small>Asks GitHub for a newer version at launch and once a day. Nothing is downloaded until you click.</small>
        </div>
        <div className="v">
          <Switch on={settings.autoUpdateCheck} onChange={(v) => onSettings({ autoUpdateCheck: v })} />
        </div>
      </div>
      <div className="field">
        <div className="k">
          OmniCam {version}
          <small>{updateSummary(update)}</small>
        </div>
        <div className="v">
          {updateOnOffer(update) ? (
            <button className="btn primary" onClick={onOpenUpdate}>
              {update.status === 'downloaded' ? 'Restart to update' : `Update to ${update.version}`}
            </button>
          ) : (
            <button
              className="btn"
              disabled={update.status === 'checking' || update.status === 'unsupported'}
              onClick={() => void window.omnicam.checkForUpdates()}
            >
              {update.status === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
