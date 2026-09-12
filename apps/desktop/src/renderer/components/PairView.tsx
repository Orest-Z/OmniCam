import { useState } from 'react';
import { Camera, Check, Copy, RefreshCw, ScanLine, ShieldAlert, Wifi } from 'lucide-react';
import type { PairingInfo, VirtualCamStats } from '@omnicam/protocol';

interface Props {
  pairing: PairingInfo | null;
  vcam: VirtualCamStats;
  vcamError: string | null;
  onOpenSettings: () => void;
}

export function PairView({ pairing, vcam, vcamError, onOpenSettings }: Props) {
  const [copied, setCopied] = useState(false);
  const [os, setOs] = useState<'iphone' | 'android'>('iphone');

  const copy = async () => {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="pair">
      <section className="card qrcard">
        <h1>Scan to connect your phone</h1>
        <p>Point the phone's camera app at the code. No app to install.</p>
        {pairing ? <img src={pairing.qrDataUrl} alt="Pairing QR code" /> : <p className="muted">Starting…</p>}
        <div className="url">
          <span title={pairing?.url}>{pairing?.url ?? '—'}</span>
          <button className="btn ghost sm" onClick={copy} disabled={!pairing} title="Copy link">
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn ghost sm" onClick={() => void window.omnicam.rotateToken()} title="Generate a new code">
            <RefreshCw />
          </button>
        </div>
      </section>

      <div className="steps">
        <div className="card step">
          <div className="ico">
            <Wifi />
          </div>
          <div>
            <h3>Same Wi-Fi</h3>
            <p>
              Phone and computer on the same network. Using <span className="mono">{pairing?.ip ?? '…'}</span> — change it in Settings if you
              have several.
            </p>
          </div>
        </div>
        <div className="card step">
          <div className="ico">
            <ScanLine />
          </div>
          <div>
            <h3>Scan the code</h3>
            <p>Open the link it shows. It only works from this Wi-Fi and expires when you generate a new one.</p>
          </div>
        </div>
        <div className="card step">
          <div className="ico">
            <ShieldAlert />
          </div>
          <div>
            <h3>Accept the security warning — once</h3>
            <p>The link is private to your network, so the phone can't verify it the way it verifies public websites. That's expected.</p>
            <div className="tabs">
              <button className={os === 'iphone' ? 'on' : ''} onClick={() => setOs('iphone')}>
                iPhone
              </button>
              <button className={os === 'android' ? 'on' : ''} onClick={() => setOs('android')}>
                Android
              </button>
            </div>
            {os === 'iphone' ? (
              <div className="mockdialog">
                <b>This Connection Is Not Private</b>
                Safari shows this page. Tap
                <br />
                <span className="tap">Show Details</span>
                <span className="tap">visit this website</span>
              </div>
            ) : (
              <div className="mockdialog">
                <b>Your connection is not private</b>
                Chrome shows this page. Tap
                <br />
                <span className="tap">Advanced</span>
                <span className="tap">Proceed to {pairing?.ip ?? 'address'}</span>
              </div>
            )}
          </div>
        </div>
        <div className="card step">
          <div className="ico">
            <Camera />
          </div>
          <div>
            <h3>Start camera and allow access</h3>
            <p>
              Then pick <b>OmniCam</b> as the camera in Discord, Zoom, Teams, Chrome — anywhere.
            </p>
          </div>
        </div>
      </div>

      <div className="foot">
        {vcamError ? (
          <button className="notice bad" onClick={onOpenSettings}>
            <ShieldAlert />
            <span>
              Camera device unavailable — <code>{vcamError}</code>. Open Settings for details.
            </span>
          </button>
        ) : (
          <span className={'inuse' + (vcam.consumers > 0 ? ' on' : '')}>
            <i />
            {vcam.running
              ? vcam.consumers > 0
                ? `"OmniCam" camera in use by ${vcam.consumers} app${vcam.consumers > 1 ? 's' : ''}`
                : `"OmniCam" camera ready · ${vcam.width}×${vcam.height} · ${vcam.fps} fps`
              : 'Camera device starting…'}
          </span>
        )}
      </div>
    </div>
  );
}
