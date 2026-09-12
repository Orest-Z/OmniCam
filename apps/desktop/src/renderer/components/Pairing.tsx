import { useState } from 'react';
import type { AppSettings, PairingInfo } from '@omnicam/protocol';

interface Props {
  pairing: PairingInfo | null;
  settings: AppSettings;
  onSettings: (patch: Partial<AppSettings>) => void;
}

export function Pairing({ pairing, settings, onSettings }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="panel">
      <h2>Connect your phone</h2>
      {pairing ? (
        <img className="qr" src={pairing.qrDataUrl} alt="Scan to connect" />
      ) : (
        <div className="muted">Starting server…</div>
      )}
      <div className="url">
        <span title={pairing?.url}>{pairing?.url ?? '—'}</span>
        <button className="btn sm" onClick={copy} disabled={!pairing}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <ol className="steps">
        <li>
          <span className="n">1</span>
          <span>
            <b>Same Wi-Fi.</b> Phone and this computer must be on the same network.
          </span>
        </li>
        <li>
          <span className="n">2</span>
          <span>
            <b>Scan the QR</b> with the phone's camera app and open the link.
          </span>
        </li>
        <li>
          <span className="n">3</span>
          <span>
            <b>Accept the security warning once.</b> iPhone: <i>Show Details → visit this website</i>. Android:{' '}
            <i>Advanced → Proceed</i>. It appears because the connection is private to your Wi-Fi and has no public
            certificate.
          </span>
        </li>
        <li>
          <span className="n">4</span>
          <span>
            <b>Tap Start camera</b> and allow camera access. Pick “OmniCam” as the camera in Discord, Zoom, Teams…
          </span>
        </li>
      </ol>

      <div className="row" style={{ marginTop: 14 }}>
        <label htmlFor="ip">Network</label>
        <select
          id="ip"
          className="sel"
          value={settings.preferredIp || pairing?.ip || ''}
          onChange={(e) => onSettings({ preferredIp: e.target.value })}
        >
          {(pairing?.addresses ?? []).map((a) => (
            <option key={a.ip} value={a.ip}>
              {a.ip} — {a.interfaceName}
              {a.wifi ? ' (Wi-Fi)' : ''}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => void window.omnicam.rotateToken()} title="Invalidate the current QR code">
          New code
        </button>
      </div>
    </section>
  );
}
