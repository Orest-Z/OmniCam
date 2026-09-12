import { RESOLUTION_PRESETS, type AppSettings, type DesktopToPhone, type StreamStats } from '@omnicam/protocol';

interface Props {
  stats: StreamStats;
  settings: AppSettings;
  onSettings: (patch: Partial<AppSettings>) => void;
  onControl: (msg: DesktopToPhone) => void;
}

export function Controls({ stats, settings, onSettings, onControl }: Props) {
  const live = stats.state === 'connected' || stats.state === 'stalled';
  const facing = stats.trackInfo?.facing;
  const preset =
    Object.entries(RESOLUTION_PRESETS).find(
      ([, p]) => p.width === stats.trackInfo?.width && p.height === stats.trackInfo?.height && p.frameRate === Math.round(stats.trackInfo?.frameRate ?? 0),
    )?.[0] ?? '';

  return (
    <div className="controls">
      <div className="group">
        <label>Phone</label>
        <button className="btn" disabled={!live} onClick={() => onControl({ type: 'switchCamera' })}>
          Flip camera{facing ? ` (${facing === 'user' ? 'front' : 'back'})` : ''}
        </button>
        <select
          className="sel"
          disabled={!live}
          value={preset}
          onChange={(e) => onControl({ type: 'setResolution', preset: e.target.value })}
        >
          <option value="" disabled>
            Resolution
          </option>
          {Object.keys(RESOLUTION_PRESETS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {stats.caps?.torch && (
          <button className="btn" disabled={!live} onClick={() => onControl({ type: 'setTorch', on: true })}>
            Torch
          </button>
        )}
      </div>

      <div className="group">
        <label>Output</label>
        <button className={'btn' + (settings.mirror ? ' on' : '')} onClick={() => onSettings({ mirror: !settings.mirror })}>
          Mirror
        </button>
        <button
          className="btn"
          title="Rotate 90°"
          onClick={() => onSettings({ rotation: (((settings.rotation + 90) % 360) as AppSettings['rotation']) })}
        >
          Rotate {settings.rotation ? `${settings.rotation}°` : ''}
        </button>
        <select
          className="sel"
          value={settings.outputPreset}
          onChange={(e) => onSettings({ outputPreset: e.target.value as AppSettings['outputPreset'] })}
          title="Resolution presented to Discord/Zoom. Fixed while apps are using the camera."
        >
          <option value="720p">720p out</option>
          <option value="1080p">1080p out</option>
        </select>
        <select
          className="sel"
          value={settings.outputFps}
          onChange={(e) => onSettings({ outputFps: Number(e.target.value) as AppSettings['outputFps'] })}
        >
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>
      </div>
    </div>
  );
}
