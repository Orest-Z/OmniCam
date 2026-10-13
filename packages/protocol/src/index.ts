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
  error: 'bad-token' | 'bad-request' | 'engine-unavailable' | 'timeout' | 'internal' | 'busy';
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
  /** Beta, Android only (offered in Settings): some Android browsers reach 60 fps at 1080p. */
  '1080p60': { width: 1920, height: 1080, frameRate: 60 },
  '4k': { width: 3840, height: 2160, frameRate: 30 },
};

/** Desktop -> phone */
export type DesktopToPhone =
  | { type: 'switchCamera'; facing?: Facing }
  | { type: 'setResolution'; preset: keyof typeof RESOLUTION_PRESETS }
  | { type: 'setTorch'; on: boolean }
  | { type: 'setMirror'; on: boolean }
  /** Turn the phone's microphone or camera on or off. The phone keeps at least one of them on. */
  | { type: 'setMic'; on: boolean }
  | { type: 'setCamera'; on: boolean }
  /** Nobody is watching on the desktop: encode at a low frame rate to save the phone's battery. */
  | { type: 'setIdle'; idle: boolean }
  /** The user pressed Disconnect: the pairing code is replaced, so the phone should stop, not retry. */
  | { type: 'disconnect' }
  | { type: 'ping'; t: number };

/** Phone -> desktop */
export type PhoneToDesktop =
  | { type: 'hello'; device: DeviceInfo; cameras: CameraDescriptor[] }
  | { type: 'trackInfo'; info: TrackInfo }
  | { type: 'capabilities'; caps: PhoneCapabilities }
  /** What the phone sends right now; on connect and after every change. */
  | { type: 'sources'; sources: MediaSources }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };

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
  zoom: boolean;
  facingModes: Facing[];
}
