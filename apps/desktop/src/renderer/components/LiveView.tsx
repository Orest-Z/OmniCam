import { Flashlight, FlipHorizontal2, QrCode, RotateCw, Unplug } from 'lucide-react';
import type { AppSettings, DesktopToPhone, StreamStats, VirtualCamStats } from '@omnicam/protocol';
import { activePreset } from '../../shared/stream-format';
import { Preview } from './Preview';
import { IconButton, Segmented } from './ui';

interface Props {
  stats: StreamStats;
  vcam: VirtualCamStats;
  settings: AppSettings;
  onSettings: (patch: Partial<AppSettings>) => void;
  onControl: (msg: DesktopToPhone) => void;
  onShowQr: () => void;
}

export function LiveView({ stats, vcam, settings, onSettings, onControl, onShowQr }: Props) {
  const live = stats.state === 'connected' || stats.state === 'stalled';
  const facing = stats.trackInfo?.facing ?? 'user';
  const preset = activePreset(stats.trackInfo);
  const phone = stats.device?.platform ?? 'Phone';

  return (
    <div className="live">
      <div className="stage">
        <Preview stats={stats} alwaysShowStats={settings.streamDetails === 'always'} />
      </div>

      <div className="bar">
        <div className="group">
          <Segmented
            value={facing}
            disabled={!live}
            options={[
              { value: 'user', label: 'Front' },
              { value: 'environment', label: 'Back' },
            ]}
            onChange={(f) => onControl({ type: 'switchCamera', facing: f })}
          />
          <Segmented
            value={preset}
            disabled={!live}
            options={[
              { value: '720p', label: '720p' },
              {
                value: '720p60',
                label: '720p60',
                title: '60 fps for smoother motion. Phone browsers only allow 60 fps up to 720p, so 1080p stays at 30 fps.',
              },
              { value: '1080p', label: '1080p' },
              { value: '4k', label: '4K' },
            ]}
            onChange={(p) => onControl({ type: 'setResolution', preset: p })}
          />
          {stats.caps?.torch && (
            <IconButton
              title="Torch"
              on={Boolean(stats.caps.torchOn)}
              disabled={!live}
              onClick={() => onControl({ type: 'setTorch', on: !stats.caps?.torchOn })}
            >
              <Flashlight />
            </IconButton>
          )}
        </div>

        <span className="divider" />

        <div className="group">
          <IconButton title="Mirror" on={settings.mirror} onClick={() => onSettings({ mirror: !settings.mirror })}>
            <FlipHorizontal2 />
          </IconButton>
          <IconButton
            title={`Rotate output (${settings.rotation}°)`}
            on={settings.rotation !== 0}
            onClick={() => onSettings({ rotation: ((settings.rotation + 90) % 360) as AppSettings['rotation'] })}
          >
            <RotateCw />
          </IconButton>
          <Segmented
            value={settings.scaleMode}
            options={[
              { value: 'fill', label: 'Fill', title: 'Crop to fill the frame (like a webcam)' },
              { value: 'fit', label: 'Fit', title: 'Show everything, with black bars if needed' },
            ]}
            onChange={(v) => onSettings({ scaleMode: v })}
          />
        </div>

        <span className="spacer" />

        <span className={'inuse' + (vcam.consumers > 0 ? ' on' : '')} title="Apps currently reading the OmniCam camera">
          <i />
          {vcam.consumers > 0 ? `In use by ${vcam.consumers} app${vcam.consumers > 1 ? 's' : ''}` : 'No app is using the camera yet'}
        </span>

        <span className="divider" />

        <span className="muted" style={{ fontSize: 12.5 }}>
          {phone}
          {stats.trackInfo?.label ? ` · ${facing === 'user' ? 'front' : 'back'} camera` : ''}
        </span>
        <IconButton title="Show QR code" onClick={onShowQr}>
          <QrCode />
        </IconButton>
        <IconButton title="Disconnect phone" onClick={() => void window.omnicam.disconnect()}>
          <Unplug />
        </IconButton>
      </div>
    </div>
  );
}
