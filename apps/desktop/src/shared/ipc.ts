import {
  DEFAULT_PORT,
  type DesktopToPhone,
  type DeviceInfo,
  type MediaSources,
  type PhoneCapabilities,
  type TrackInfo,
} from '@omnicam/protocol';

/**
 * Electron IPC channel names + payload types. Three parties:
 *   main    — https server, tray, settings
 *   engine  — hidden renderer: WebRTC receiver + native virtual camera
 *   ui      — visible renderer (sandboxed, talks through the preload bridge)
 */

// main -> engine
export const ENGINE_OFFER = 'engine:offer';
export const ENGINE_APPLY_SETTINGS = 'engine:apply-settings';
export const ENGINE_CONTROL = 'engine:control';
export const ENGINE_PREVIEW = 'engine:preview';
export const ENGINE_SHUTDOWN = 'engine:shutdown';
export const ENGINE_DISCONNECT = 'engine:disconnect';

// engine -> main
export const ENGINE_READY = 'engine:ready';
export const ENGINE_ANSWER = 'engine:answer';
export const ENGINE_STATS = 'engine:stats';
export const ENGINE_VCAM_STATS = 'engine:vcam-stats';
export const ENGINE_PREVIEW_FRAME = 'engine:preview-frame';
export const ENGINE_PHONE_MESSAGE = 'engine:phone-message';
export const ENGINE_LOG = 'engine:log';
export const ENGINE_VCAM_ERROR = 'engine:vcam-error';

// ui <-> main (through preload)
export const UI_GET_STATE = 'ui:get-state';
export const UI_SET_SETTINGS = 'ui:set-settings';
export const UI_CONTROL = 'ui:control';
export const UI_ROTATE_TOKEN = 'ui:rotate-token';
export const UI_SET_PREVIEW = 'ui:set-preview';
export const UI_OPEN_EXTERNAL = 'ui:open-external';
export const UI_OPEN_LOGS = 'ui:open-logs';
export const UI_DISCONNECT = 'ui:disconnect';
export const UI_STATE = 'ui:state';
export const UI_PREVIEW_FRAME = 'ui:preview-frame';
export const UI_VCAM_ERROR = 'ui:vcam-error';
export const UI_UPDATE_CHECK = 'ui:update-check';
export const UI_UPDATE_DOWNLOAD = 'ui:update-download';
export const UI_UPDATE_INSTALL = 'ui:update-install';

// Desktop state shared by main, engine and UI (the phone never sees these)
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
  /** What the phone sends; unknown until it says, which reads as the camera only. */
  sources?: MediaSources;
  /**
   * Loudness of the phone's microphone over the last second, 0–1: the RMS of WebRTC's 10 ms peak levels,
   * so about 3 dB above true RMS for speech. 0 while nothing plays it.
   */
  micLevel?: number;
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
  /** Port the server actually listens on. */
  port: number;
  /** Port from settings. Differs from `port` when that one was taken and OmniCam fell back. */
  requestedPort: number;
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
  outputPreset: '720p' | '1080p' | '4k';
  outputFps: 30 | 60;
  mirror: boolean;
  rotation: 0 | 90 | 180 | 270;
  /** fit = letterbox/pillarbox (never crops); fill = crop to fill the output like a webcam. */
  scaleMode: 'fit' | 'fill';
  /** When the phone stalls, hold the last frame instead of showing the placeholder. */
  holdLastFrame: boolean;
  /** Loopback output (its label) the phone's microphone is played into; empty = the first one found. */
  micOutput: string;
  /** Stream numbers over the preview: always, or only while hovered. */
  streamDetails: 'always' | 'hover';
  /** Desktop app colours; 'system' follows the Windows light/dark setting. */
  theme: 'dark' | 'light' | 'system';
  closeToTray: boolean;
  launchAtLogin: boolean;
  /**
   * Decode the phone's video on the GPU. Off by default: the virtual camera needs frames in
   * system memory anyway, and the GPU readback costs more than software decoding up to 1080p.
   * Takes effect after a restart (Chromium command-line switch).
   */
  hardwareDecode: boolean;
  /**
   * Ask GitHub for a newer release at launch and once a day. Off = only when the user clicks
   * "Check for updates". The only connection OmniCam makes beyond the local network.
   */
  autoUpdateCheck: boolean;
  /** Last window geometry; restored on launch. */
  windowBounds?: { x: number; y: number; width: number; height: number };
}

export const DEFAULT_SETTINGS: AppSettings = {
  port: DEFAULT_PORT,
  preferredIp: '',
  outputPreset: '720p',
  outputFps: 30,
  mirror: false,
  rotation: 0,
  scaleMode: 'fill',
  holdLastFrame: true,
  micOutput: '',
  streamDetails: 'always',
  theme: 'dark',
  closeToTray: true,
  launchAtLogin: false,
  hardwareDecode: false,
  autoUpdateCheck: true,
};

export interface EngineOffer {
  id: string;
  sdp: string;
  device: DeviceInfo;
}

export type EngineAnswer = { id: string; sdp: string; sessionId: string } | { id: string; error: string };

export interface EngineSettings {
  outputWidth: number;
  outputHeight: number;
  outputFps: number;
  mirror: boolean;
  rotation: 0 | 90 | 180 | 270;
  scaleMode: 'fit' | 'fill';
  holdLastFrame: boolean;
  micOutput: string;
  /** Absolute path to the native addon (.node), or empty to run without a virtual camera. */
  addonPath: string;
  /** Directory containing softcam.dll (Windows). */
  nativeDir: string;
}

/**
 * Where the updater is. `unsupported` = not an installed build (dev, or a platform without an
 * installer); `manual` = the current check was started from the UI, so its result deserves feedback.
 */
export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  manual: boolean;
  /** Version on offer (set from 'available' on). */
  version?: string;
  /** Download progress, 0–100. */
  percent?: number;
  /** Short, user-facing reason; the full error goes to the log. */
  error?: string;
  /** Which step failed, so the UI knows what "Try again" should do. */
  failed?: 'check' | 'download';
  /** Epoch ms of the last finished check. */
  checkedAt?: number;
}

export interface AppState {
  pairing: PairingInfo | null;
  settings: AppSettings;
  stats: StreamStats;
  vcam: VirtualCamStats;
  vcamError: string | null;
  update: UpdateState;
  version: string;
  platform: NodeJS.Platform;
}

export type StatePatch = Partial<AppState>;

/** Raw RGBA snapshot for the UI preview (~12 fps while the window is visible). */
export interface PreviewFrame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface UiApi {
  getState(): Promise<AppState>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  control(msg: DesktopToPhone): Promise<void>;
  rotateToken(): Promise<void>;
  /** Drops the current phone and invalidates its QR code. */
  disconnect(): Promise<void>;
  setPreview(enabled: boolean): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Opens the folder holding omnicam.log in the file manager. */
  openLogs(): Promise<void>;
  /** Looks for a newer release; the result arrives as an `update` state patch. */
  checkForUpdates(): Promise<void>;
  /** Downloads the release found by the last check. */
  downloadUpdate(): Promise<void>;
  /** Quits, runs the downloaded installer and starts the new version. */
  installUpdate(): Promise<void>;
  onState(cb: (patch: StatePatch) => void): () => void;
  onPreviewFrame(cb: (frame: PreviewFrame) => void): () => void;
}
