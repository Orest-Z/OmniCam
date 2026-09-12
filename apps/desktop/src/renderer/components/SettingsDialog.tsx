import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AppSettings, PairingInfo, VirtualCamStats } from '@omnicam/protocol';
import { Dialog, Segmented, Switch } from './ui';

interface Props {
  settings: AppSettings;
  pairing: PairingInfo | null;
  vcam: VirtualCamStats;
  vcamError: string | null;
  version: string;
  onSettings: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, pairing, vcam, vcamError, version, onSettings, onClose }: Props) {
  const [port, setPort] = useState(String(settings.port));
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
            Reinstall OmniCam, or from a checkout run <code>npm run native:build</code> then <code>npm run native:register</code> (admin).
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
          <small>What Discord, Zoom… receive. Changing it restarts the device.</small>
        </div>
        <div className="v">
          <Segmented
            value={settings.outputPreset}
            options={[
              { value: '720p', label: '720p' },
              { value: '1080p', label: '1080p' },
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

      <div className="section">App</div>
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
          <span className="muted">OmniCam {version}</span>
        </div>
      </div>
    </Dialog>
  );
}
