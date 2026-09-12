import type { VirtualCamStats } from '@omnicam/protocol';

/** Pixel formats the addon accepts, mirroring WebCodecs `VideoPixelFormat` names. */
export type FrameFormat = 'I420' | 'I420A' | 'NV12' | 'RGBA' | 'BGRA' | 'RGBX' | 'BGRX';

export interface FrameLayout {
  offset: number;
  stride: number;
}

export interface PushFrameInfo {
  format: FrameFormat;
  width: number;
  height: number;
  layout: FrameLayout[];
}

export interface Transform {
  mirror: boolean;
  rotation: 0 | 90 | 180 | 270;
}

/**
 * JS surface of `omnicam_vcam.node` (packages/vcam-native). The native side owns a pacing
 * thread that repeats the most recent frame at the configured fps, so callers just deposit
 * frames whenever they arrive.
 */
export interface VcamAddon {
  /** Throws if the virtual camera driver is not registered / cannot start. */
  start(opts: { width: number; height: number; fps: number; nativeDir: string }): void;
  stop(): void;
  pushFrame(data: Uint8Array, info: PushFrameInfo): void;
  /** RGBA image shown whenever no live frame is available. */
  setPlaceholder(rgba: Uint8Array, width: number, height: number): void;
  showPlaceholder(): void;
  setHoldLastFrame(hold: boolean): void;
  setTransform(t: Transform): void;
  getStats(): VirtualCamStats;
  /** Cheap pre-flight: is the driver registered on this machine? */
  probe(nativeDir: string): { ok: boolean; reason?: string };
}

declare global {
  interface Window {
    require: NodeJS.Require;
  }
}

export class VcamUnavailable extends Error {}

/** Loads the addon from an absolute path. Returns null (with reason) when it is not built/present. */
export function loadVcam(addonPath: string): { addon: VcamAddon | null; reason?: string } {
  try {
    const addon = window.require(addonPath) as VcamAddon;
    return { addon };
  } catch (err) {
    return { addon: null, reason: `native addon not available: ${(err as Error).message}` };
  }
}

/** Placeholder frame rendered on a canvas, returned as tightly packed RGBA. */
export function renderPlaceholder(width: number, height: number, lines: string[]): Uint8Array {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a0a0b';
  ctx.fillRect(0, 0, width, height);

  // The OmniCam mark (same geometry as build/icons.mjs), ~14% of the frame height.
  const u = (height * 0.14) / 100;
  const ox = width / 2 - 44 * u;
  const oy = height * 0.36 - 56 * u;
  const arc = (r: number, w: number) => {
    ctx.beginPath();
    ctx.arc(ox + 44 * u, oy + 56 * u, r * u, (-66 * Math.PI) / 180, (-20 * Math.PI) / 180);
    ctx.lineWidth = w * u;
    ctx.stroke();
  };
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(ox + 44 * u, oy + 56 * u, 26 * u, 0, Math.PI * 2);
  ctx.lineWidth = 8.6 * u;
  ctx.stroke();
  arc(38.5, 6);
  arc(50.5, 6);
  ctx.beginPath();
  ctx.arc(ox + 44 * u, oy + 56 * u, 7.2 * u, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const base = Math.round(height * 0.05);
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? 600 : 400} ${i === 0 ? base : Math.round(base * 0.68)}px Geist, "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = i === 0 ? '#ededef' : '#8a8a94';
    ctx.fillText(line, width / 2, height * 0.6 + i * base * 1.4);
  });
  const img = ctx.getImageData(0, 0, width, height);
  return new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
}
