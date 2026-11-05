import { useState } from 'react';
import { Flashlight, FlipHorizontal2, Mic, MicOff, QrCode, RotateCw, SlidersHorizontal, Unplug, Video, VideoOff } from 'lucide-react';
import { zoomSteps, type DesktopToPhone } from '@omnicam/protocol';
import type { AppSettings, StreamStats, VirtualCamStats, VirtualMicState } from '../../shared/ipc';
import { micNameFor, pickSink } from '../../shared/audio-sink';
import { activePreset, HOTSPOT_HELP, isUpscaled, sizeLabel, WIFI_HELP } from '../../shared/stream-format';
import { useLoopbacks } from '../useLoopbacks';
import { PicturePanel, pictureChanged } from './PicturePanel';
import { Preview } from './Preview';
import { IconButton, Segmented } from './ui';

interface Props {
  stats: StreamStats;
  vcam: VirtualCamStats;
  settings: AppSettings;
  /** Linux: OmniCam's own microphone; null on Windows (VB-CABLE). */
  virtualMic: VirtualMicState | null;
  onSettings: (patch: Partial<AppSettings>) => void;
  onControl: (msg: DesktopToPhone) => void;
  onShowQr: () => void;
  onOpenMicGuide: () => void;
  onOpenSettings: () => void;
}

/**
 * Level above about -34 dBFS (see micLevel): someone is talking, not just room noise on a raw phone mic.
 * A starting point, not measured on phones yet: tune it if the glow lights for silence or misses speech.
 */
export const SPEAKING_LEVEL = 0.02;

export function LiveView({ stats, vcam, settings, virtualMic, onSettings, onControl, onShowQr, onOpenMicGuide, onOpenSettings }: Props) {
  const live = stats.state === 'connected' || stats.state === 'stalled';
  const facing = stats.trackInfo?.facing ?? 'user';
  const preset = activePreset(stats.trackInfo);
  const zoom = stats.caps?.zoom;
  const zooms = zoomSteps(zoom);
  // Lights the button the phone is at; a level between buttons lights none.
  const zoomAt = zooms.find((z) => Math.abs(z - (zoom?.current ?? 1)) < 0.05) ?? -1;
  const phone = stats.device?.platform ?? 'Phone';
  const camera = stats.sources?.camera !== false;
  const mic = stats.sources?.mic === true;
  const speaking = mic && (stats.micLevel ?? 0) > SPEAKING_LEVEL;
  const loopbacks = useLoopbacks(mic);
  const sink = loopbacks && pickSink(loopbacks.outputs, settings.micOutput);
  // The phone's sound has nowhere to go: say so where the microphone is switched on.
  const noCable = mic && loopbacks !== null && !sink;
  const [pictureOpen, setPictureOpen] = useState(false);
  // What apps get, which is set in Settings and not by the phone's buttons: say so where both are seen.
  const output = vcam.running ? `${sizeLabel(vcam.width, vcam.height)} ${vcam.fps} fps` : '';
  const upscaled = vcam.running && isUpscaled(stats.trackInfo, vcam);

  return (
    <div className="live">
      <div className="stage">
        {camera ? (
          <Preview stats={stats} alwaysShowStats={settings.streamDetails === 'always'}>
            {noCable && (
              <button className="overhint" onClick={onOpenMicGuide}>
                {virtualMic ? "OmniCam Microphone isn't ready: see why" : "The phone's microphone needs a virtual cable: set it up"}
              </button>
            )}
          </Preview>
        ) : (
          <div className="preview micstage">
            <span className={'micglyph' + (speaking ? ' speaking' : '')}>
              <Mic />
            </span>
            <p>Microphone only</p>
            {sink ? (
              <small>
                Apps hear this phone as <b>{micNameFor(sink.label)}</b>
              </small>
            ) : (
              loopbacks && (
                <button className="link" onClick={onOpenMicGuide}>
                  {virtualMic ? "OmniCam Microphone isn't ready: see why" : 'Set up the microphone: it needs a virtual cable'}
                </button>
              )
            )}
          </div>
        )}
        {camera && pictureOpen && (
          <PicturePanel picture={settings.picture} onChange={(picture) => onSettings({ picture })} onClose={() => setPictureOpen(false)} />
        )}
      </div>

      <div className="bar">
        <div className="group">
          {/* The phone keeps one of the two on, so the last one can't be switched off. */}
          <IconButton
            title={camera ? 'Turn the phone camera off' : 'Turn the phone camera on'}
            disabled={!live || (camera && !mic)}
            onClick={() => onControl({ type: 'setCamera', on: !camera })}
          >
            {camera ? <Video /> : <VideoOff />}
          </IconButton>
          <IconButton
            title={mic ? 'Turn the phone microphone off' : 'Use the phone as a microphone'}
            on={mic}
            className={speaking ? 'speaking' : ''}
            disabled={!live || (mic && !camera)}
            onClick={() => onControl({ type: 'setMic', on: !mic })}
          >
            {mic ? <Mic /> : <MicOff />}
          </IconButton>
        </div>

        {camera && (
          <>
            <span className="divider" />

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
              {zooms.length > 1 && (
                <Segmented
                  value={zoomAt}
                  disabled={!live}
                  options={zooms.map((z) => ({ value: z, label: `${+z.toFixed(1)}×`, title: z < 1 ? 'Ultra-wide' : `Zoom ${+z.toFixed(1)}×` }))}
                  onChange={(level) => onControl({ type: 'setZoom', level })}
                />
              )}
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
              <IconButton
                title={pictureChanged(settings.picture) ? 'Picture (adjusted)' : 'Picture: brightness, contrast, colour'}
                on={pictureOpen || pictureChanged(settings.picture)}
                onClick={() => setPictureOpen(!pictureOpen)}
              >
                <SlidersHorizontal />
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
          </>
        )}

        <span className="spacer" />

        {camera && (
          <>
            <span className={'inuse' + (vcam.consumers > 0 ? ' on' : '')} title="Apps currently reading the OmniCam camera, and what they get (Settings → Output resolution)">
              <i />
              {vcam.consumers > 0 ? `In use by ${vcam.consumers} app${vcam.consumers > 1 ? 's' : ''}` : 'No app is using the camera yet'}
              {output && <span className="muted"> · apps get {output}</span>}
            </span>
            {upscaled && (
              <button
                className="upscaled"
                title={`The phone sends ${sizeLabel(stats.trackInfo!.width, stats.trackInfo!.height)}, apps get ${sizeLabel(vcam.width, vcam.height)}: the picture is scaled up, which costs CPU and adds no detail. Lower the output in Settings, or film at a higher resolution on the phone.`}
                onClick={onOpenSettings}
              >
                Scaled up
              </button>
            )}

            <span className="divider" />
          </>
        )}

        {stats.transport === 'link' && (
          <button className="upscaled" title={`${HOTSPOT_HELP} Click for details.`} onClick={onOpenSettings}>
            Hotspot mode
          </button>
        )}
        <span className="muted" style={{ fontSize: 12.5 }}>
          {stats.transport === 'webrtc' && <span title={WIFI_HELP}>Wi-Fi · </span>}
          {phone}
          {!camera ? ' · microphone only' : stats.trackInfo?.label ? ` · ${facing === 'user' ? 'front' : 'back'} camera` : ''}
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
