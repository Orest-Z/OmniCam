import type {
  AppSettings,
  DesktopToPhone,
  DeviceInfo,
  PairingInfo,
  PhoneToDesktop,
  StreamStats,
  VirtualCamStats,
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
  onPhoneMessage(cb: (msg: PhoneToDesktop) => void): () => void;
}
