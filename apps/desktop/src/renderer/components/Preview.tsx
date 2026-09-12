import { useEffect, useRef } from 'react';
import type { StreamStats } from '@omnicam/protocol';

interface Props {
  stats: StreamStats;
  mirror: boolean;
}

/** Live preview fed by JPEG snapshots from the engine (only while this window is open). */
export function Preview({ stats, mirror }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = stats.state === 'connected' || stats.state === 'stalled';

  useEffect(() => {
    void window.omnicam.setPreview(true);
    let pending: Promise<void> | null = null;
    const off = window.omnicam.onPreviewFrame((buf) => {
      if (pending) return; // drop if we are behind
      const canvas = canvasRef.current;
      if (!canvas) return;
      pending = createImageBitmap(new Blob([buf], { type: 'image/jpeg' }))
        .then((bmp) => {
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width;
            canvas.height = bmp.height;
          }
          canvas.getContext('2d')?.drawImage(bmp, 0, 0);
          bmp.close();
        })
        .catch(() => undefined)
        .finally(() => {
          pending = null;
        });
    });
    const onVis = () => void window.omnicam.setPreview(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVis);
      void window.omnicam.setPreview(false);
    };
  }, []);

  return (
    <div className="preview">
      <canvas ref={canvasRef} style={{ transform: mirror ? 'scaleX(-1)' : undefined, opacity: live ? 1 : 0.15 }} />
      {!live && (
        <div className="empty">
          {stats.state === 'connecting'
            ? 'Connecting to phone…'
            : stats.state === 'disconnected'
              ? 'Phone disconnected — it will reconnect automatically when the page is open.'
              : 'No phone connected yet. Scan the QR code to start.'}
        </div>
      )}
      {live && (
        <div className="overlay">
          <span className="tag">
            {stats.width}×{stats.height}
          </span>
          <span className="tag">{stats.fps} fps</span>
          <span className="tag">{(stats.bitrateKbps / 1000).toFixed(1)} Mbps</span>
          <span className="tag">{stats.codec || '—'}</span>
          <span className="tag">{stats.rttMs} ms</span>
          {stats.packetsLost > 0 && <span className="tag">lost {stats.packetsLost}</span>}
          {stats.state === 'stalled' && <span className="tag">paused on phone</span>}
        </div>
      )}
    </div>
  );
}
