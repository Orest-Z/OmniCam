import { useState } from 'react';
import type { AppSettings, VirtualCamStats } from '@omnicam/protocol';

interface Props {
  settings: AppSettings;
  vcam: VirtualCamStats;
  vcamError: string | null;
  onSettings: (patch: Partial<AppSettings>) => void;
}

export function Settings({ settings, vcam, vcamError, onSettings }: Props) {
  const [port, setPort] = useState(String(settings.port));

  const commitPort = () => {
    const n = Number(port);
    if (Number.isInteger(n) && n > 1024 && n < 65536 && n !== settings.port) onSettings({ port: n });
    else setPort(String(settings.port));
  };

  return (
    <section className="panel">
      <h2>Virtual camera & settings</h2>

      {vcamError ? (
        <div className="banner bad" style={{ marginBottom: 12 }}>
          Virtual camera unavailable: <code>{vcamError}</code>
          <div className="muted" style={{ marginTop: 4 }}>
            Re-run the installer, or build the native addon (<code>npm run native:build</code>) and register the driver.
          </div>
        </div>
      ) : vcam.running ? (
        <div className="banner ok" style={{ marginBottom: 12 }}>
          “OmniCam” camera is active at {vcam.width}×{vcam.height} @ {vcam.fps} fps
          {vcam.consumers > 0 ? ` — in use by ${vcam.consumers} app${vcam.consumers > 1 ? 's' : ''}` : ' — not opened by any app yet'}.
        </div>
      ) : (
        <div className="banner warn" style={{ marginBottom: 12 }}>
          Virtual camera not started yet.
        </div>
      )}

      <div className="grid2">
        <div className="field">
          <label>When the phone pauses</label>
          <select
            className="sel"
            value={settings.holdLastFrame ? 'hold' : 'placeholder'}
            onChange={(e) => onSettings({ holdLastFrame: e.target.value === 'hold' })}
          >
            <option value="hold">Keep showing the last frame</option>
            <option value="placeholder">Show the OmniCam placeholder</option>
          </select>
        </div>
        <div className="field">
          <label>Server port</label>
          <div className="row">
            <input
              className="inp"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onBlur={commitPort}
              onKeyDown={(e) => e.key === 'Enter' && commitPort()}
            />
            <span className="muted">changes the QR code</span>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.closeToTray} onChange={(e) => onSettings({ closeToTray: e.target.checked })} />
          Keep running in the tray when the window is closed
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.launchAtLogin} onChange={(e) => onSettings({ launchAtLogin: e.target.checked })} />
          Start OmniCam when I sign in
        </label>
      </div>
    </section>
  );
}
