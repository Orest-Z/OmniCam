import { useEffect, useRef, useState } from 'react';
import type { StreamStats } from '@omnicam/protocol';

interface Props {
  stats: StreamStats;
  mirror: boolean;
  rotation: 0 | 90 | 180 | 270;
}

const CHIP: Record<StreamStats['state'], { text: string; cls: string } | null> = {
  idle: null,
  connecting: { text: 'CONNECTING', cls: 'warn' },
  connected: { text: 'LIVE', cls: '' },
  stalled: { text: 'PAUSED ON PHONE', cls: 'warn' },
  disconnected: { text: 'RECONNECTING', cls: 'bad' },
};

/**
 * Live preview: raw RGBA snapshots from the native pipeline (only while this window is visible),
 * blitted with putImageData on a software canvas. Deliberately no ImageBitmap / blob <img> /
 * accelerated canvas: each of those was measured to grow Chromium's GPU process without bound.
 */
export function Preview({ stats, mirror, rotation }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showStats, setShowStats] = useState(true);
  const live = stats.state === 'connected' || stats.state === 'stalled';

  // Stats are visible for a few seconds after (re)connecting, then only on hover.
  useEffect(() => {
    if (stats.state !== 'connected') return;
    setShowStats(true);
    const t = setTimeout(() => setShowStats(false), 5000);
    return () => clearTimeout(t);
  }, [stats.state]);

  useEffect(() => {
    void window.omnicam.setPreview(true);
    let ctx: CanvasRenderingContext2D | null = null;
    const off = window.omnicam.onPreviewFrame((frame) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
        ctx = null;
      }
      ctx ??= canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!ctx) return;
      const rgba = frame.rgba;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), frame.width, frame.height), 0, 0);
    });
    const onVis = () => void window.omnicam.setPreview(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVis);
      void window.omnicam.setPreview(false);
    };
  }, []);

  const chip = CHIP[stats.state];
  const res = stats.height >= 2160 ? '4K' : stats.height >= 1080 ? '1080p' : stats.height >= 720 ? '720p' : `${stats.height}p`;

  return (
    <div className="preview">
      <canvas
        ref={canvasRef}
        style={{
          // Mirror the native pipeline: rotate, then mirror; 90/270 must shrink to fit the 16:9 box.
          transform: `rotate(${rotation}deg) scaleX(${mirror ? -1 : 1})${rotation % 180 ? ' scale(0.5625)' : ''}`,
          opacity: live ? 1 : 0.2,
        }}
      />
      {chip && (
        <span className={`chip ${chip.cls}`}>
          <i />
          {chip.text}
        </span>
      )}
      {!live && (
        <div className="empty">
          {stats.state === 'connecting' ? 'Connecting to phone…' : 'Phone disconnected — it reconnects automatically while the page is open.'}
        </div>
      )}
      {live && stats.width > 0 && (
        <span className={'stats' + (showStats ? ' show' : '')}>
          {res} · {stats.fps} fps · {(stats.bitrateKbps / 1000).toFixed(1)} Mbps · {stats.codec || '—'} · {stats.rttMs} ms
          {stats.packetsLost > 0 ? ` · ${stats.packetsLost} lost` : ''}
        </span>
      )}
    </div>
  );
}
