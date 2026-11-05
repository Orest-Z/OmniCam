/**
 * Wire protocol shared by the phone page, the desktop main process, the engine
 * window and the UI renderer. Keep this dependency-free: it is imported as TS
 * source by every bundle.
 */

// ---------------------------------------------------------------------------
// HTTP signaling  (phone -> desktop, one round trip, non-trickle ICE)
// ---------------------------------------------------------------------------

export const API_SESSION_PATH = '/api/session';
export const API_HEALTH_PATH = '/api/health';

/**
 * The media link: a WebSocket on the page's own HTTPS connection, for when WebRTC cannot reach the desktop.
 * On an iPhone's own hotspot Safari offers WebRTC only its mobile data address, while ordinary requests still
 * get through. Text messages are JSON (the control messages below); binary ones are one header byte (LINK_*),
 * a big-endian float64, then the payload. The float64 is the capture time in microseconds for video, and the
 * sample rate for audio, whose payload is 16-bit mono PCM.
 */
export const API_LINK_PATH = '/api/link';
export const LINK_VIDEO_DELTA = 0;
export const LINK_VIDEO_KEY = 1;
export const LINK_AUDIO = 2;
export const LINK_HEADER_BYTES = 9;

export const DEFAULT_PORT = 28441;

export interface SessionRequest {
  /** Pairing token embedded in the QR URL (`?t=`). */
  token: string;
  /** Complete SDP offer (ICE gathering finished) from the phone. */
  sdp: string;
  /** Free-form device description for the desktop UI. */
  device: DeviceInfo;
}

export interface SessionResponse {
  ok: true;
  sessionId: string;
  /** Complete SDP answer from the desktop. */
  sdp: string;
}

export interface SessionError {
  ok: false;
  /** 'use-link': the offer has no address WebRTC could use, so the phone should use the media link. */
  error: 'bad-token' | 'bad-request' | 'engine-unavailable' | 'timeout' | 'internal' | 'busy' | 'use-link';
  message?: string;
  /** For 'busy': how long the phone should wait before trying again. Mirrors the retry-after header. */
  retryAfterSeconds?: number;
}

export interface HealthResponse {
  ok: true;
  app: 'omnicam';
  version: string;
}

export interface DeviceInfo {
  userAgent: string;
  /** e.g. "iPhone", "Android" — best effort, derived on the phone. */
  platform: string;
  label?: string;
}

// ---------------------------------------------------------------------------
// DataChannel "control" messages (bidirectional, JSON)
// ---------------------------------------------------------------------------

export const CONTROL_CHANNEL_LABEL = 'omnicam-control';

export type Facing = 'user' | 'environment';

export interface ResolutionPreset {
  width: number;
  height: number;
  frameRate: number;
}

export const RESOLUTION_PRESETS: Record<string, ResolutionPreset> = {
  '720p': { width: 1280, height: 720, frameRate: 30 },
  '1080p': { width: 1920, height: 1080, frameRate: 30 },
  // Phone browsers (all of iOS) only offer 60 fps below 1080p, so the high-rate preset is 720p.
  '720p60': { width: 1280, height: 720, frameRate: 60 },
  '4k': { width: 3840, height: 2160, frameRate: 30 },
};

/** Desktop -> phone */
export type DesktopToPhone =
  | { type: 'switchCamera'; facing?: Facing }
  | { type: 'setResolution'; preset: keyof typeof RESOLUTION_PRESETS }
  | { type: 'setTorch'; on: boolean }
  /** Zoom level as the phone's camera app counts it: 1 is the main lens, 0.5 the ultra-wide where there is one. */
  | { type: 'setZoom'; level: number }
  | { type: 'setMirror'; on: boolean }
  /** Turn the phone's microphone or camera on or off. The phone keeps at least one of them on. */
  | { type: 'setMic'; on: boolean }
  | { type: 'setCamera'; on: boolean }
  /** Nobody is watching on the desktop: encode at a low frame rate to save the phone's battery. */
  | { type: 'setIdle'; idle: boolean }
  /** The user pressed Disconnect: the pairing code is replaced, so the phone should stop, not retry. */
  | { type: 'disconnect' }
  | { type: 'ping'; t: number }
  /** Media link only: the decoder lost its place and needs a new start. */
  | { type: 'requestKeyFrame' }
  /** Media link only: this frame (its capture time) was decoded, so the phone can measure the delay. */
  | { type: 'frameAck'; t: number };

/** Phone -> desktop */
export type PhoneToDesktop =
  | { type: 'hello'; device: DeviceInfo; cameras: CameraDescriptor[] }
  | { type: 'trackInfo'; info: TrackInfo }
  | { type: 'capabilities'; caps: PhoneCapabilities }
  /** What the phone sends right now; on connect and after every change. */
  | { type: 'sources'; sources: MediaSources }
  /** `source` and `reason` (the browser's error name) are set when switching a source on failed. */
  | { type: 'error'; message: string; source?: keyof MediaSources; reason?: string }
  | { type: 'pong'; t: number }
  /** Media link only: how to decode the frames that follow. */
  | { type: 'videoConfig'; codec: string; codedWidth: number; codedHeight: number; description?: number[] }
  /** Media link only: the phone's own counters and notes, for the desktop's log. */
  | { type: 'linkStats'; stats: Record<string, unknown> }
  | { type: 'linkLog'; message: string };

/** Camera and microphone are negotiated together and switched on and off without renegotiating. */
export interface MediaSources {
  camera: boolean;
  mic: boolean;
}

export interface CameraDescriptor {
  deviceId: string;
  label: string;
  facing?: Facing;
}

export interface TrackInfo {
  width: number;
  height: number;
  frameRate: number;
  facing?: Facing;
  deviceId?: string;
  label?: string;
}

export interface PhoneCapabilities {
  torch: boolean;
  /** Torch is lit right now (the desktop button toggles from this). */
  torchOn?: boolean;
  /** The open camera's zoom range and level, when the browser lets a page change it. */
  zoom?: ZoomRange;
  facingModes: Facing[];
}

export interface ZoomRange {
  min: number;
  max: number;
  step: number;
  current: number;
}

/**
 * Zoom buttons, as in a phone's camera app: the widest the camera goes when that is below 1
 * (the ultra-wide lens, 0.5 on an iPhone), then 1×, 2× and 3×, as far as the camera reaches.
 */
export function zoomSteps(z?: ZoomRange): number[] {
  // The range comes from the other side of the connection: anything but numbers means no buttons.
  if (!z || !Number.isFinite(z.min) || !Number.isFinite(z.max)) return [];
  return [...(z.min < 1 ? [z.min] : []), 1, 2, 3].filter((s) => s >= z.min && s <= z.max);
}
