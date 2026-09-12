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
  error: 'bad-token' | 'bad-request' | 'engine-unavailable' | 'timeout' | 'internal';
  message?: string;
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
  '1080p60': { width: 1920, height: 1080, frameRate: 60 },
  '4k': { width: 3840, height: 2160, frameRate: 30 },
};

/** Desktop -> phone */
export type DesktopToPhone =
  | { type: 'switchCamera'; facing?: Facing }
  | { type: 'setResolution'; preset: keyof typeof RESOLUTION_PRESETS }
  | { type: 'setTorch'; on: boolean }
  | { type: 'setMirror'; on: boolean }
  | { type: 'ping'; t: number };

/** Phone -> desktop */
export type PhoneToDesktop =
  | { type: 'hello'; device: DeviceInfo; cameras: CameraDescriptor[] }
  | { type: 'trackInfo'; info: TrackInfo }
  | { type: 'capabilities'; caps: PhoneCapabilities }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };

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
  zoom: boolean;
  facingModes: Facing[];
}

// ---------------------------------------------------------------------------
// Desktop-internal state (main <-> engine <-> UI), also JSON
// ---------------------------------------------------------------------------

export type ConnectionState =
  | 'idle'          // no phone paired yet
  | 'connecting'    // offer received, ICE in progress
  | 'connected'     // receiving frames
  | 'stalled'       // connected but no frames (phone backgrounded / muted)
  | 'disconnected'; // was connected, waiting for reconnect

export interface StreamStats {
  state: ConnectionState;
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  rttMs: number;
  codec: string;
  packetsLost: number;
  jitterMs: number;
  framesDecoded: number;
  device?: DeviceInfo;
  trackInfo?: TrackInfo;
  caps?: PhoneCapabilities;
}

export interface VirtualCamStats {
  running: boolean;
  width: number;
  height: number;
  fps: number;
  framesSent: number;
  framesRepeated: number;
  framesDropped: number;
  consumers: number;
}

export interface PairingInfo {
  url: string;
  token: string;
  port: number;
  ip: string;
  /** All candidate LAN IPs; the user can pick a different one in settings. */
  addresses: NetworkAddress[];
  qrDataUrl: string;
}

export interface NetworkAddress {
  ip: string;
  interfaceName: string;
  /** Heuristic: looks like a Wi-Fi adapter. */
  wifi: boolean;
}

export interface AppSettings {
  port: number;
  /** Preferred LAN IP for the QR; empty = auto. */
  preferredIp: string;
  /** Fixed output format of the virtual camera. */
  outputPreset: '720p' | '1080p';
  outputFps: 30 | 60;
  mirror: boolean;
  rotation: 0 | 90 | 180 | 270;
  /** When the phone stalls, hold the last frame instead of showing the placeholder. */
  holdLastFrame: boolean;
  closeToTray: boolean;
  launchAtLogin: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  port: DEFAULT_PORT,
  preferredIp: '',
  outputPreset: '720p',
  outputFps: 30,
  mirror: false,
  rotation: 0,
  holdLastFrame: true,
  closeToTray: true,
  launchAtLogin: false,
};
