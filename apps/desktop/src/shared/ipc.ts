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
export const UI_STATE = 'ui:state';
export const UI_PREVIEW_FRAME = 'ui:preview-frame';
export const UI_VCAM_ERROR = 'ui:vcam-error';

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
  holdLastFrame: boolean;
  /** Absolute path to the native addon (.node), or empty to run without a virtual camera. */
  addonPath: string;
  /** Directory containing softcam.dll (Windows). */
  nativeDir: string;
}

export interface AppState {
  pairing: PairingInfo | null;
  settings: AppSettings;
  stats: StreamStats;
  vcam: VirtualCamStats;
  vcamError: string | null;
  version: string;
  platform: NodeJS.Platform;
}

export type StatePatch = Partial<AppState>;

export interface UiApi {
  getState(): Promise<AppState>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  control(msg: DesktopToPhone): Promise<void>;
  rotateToken(): Promise<void>;
  setPreview(enabled: boolean): Promise<void>;
  openExternal(url: string): Promise<void>;
  onState(cb: (patch: StatePatch) => void): () => void;
  onPreviewFrame(cb: (jpeg: ArrayBuffer) => void): () => void;
  onPhoneMessage(cb: (msg: PhoneToDesktop) => void): () => void;
}
