import type { CameraSetupResult, Distro, VirtualMicState } from '../shared/ipc';

/**
 * What the main process needs from the operating system. One implementation per OS (win.ts,
 * linux.ts, a no-op fallback), chosen once by index.ts, so main never branches on process.platform
 * for these. Platform code may use src/shared, never main: main calls platform, not the other way.
 *
 */
export interface Platform {
  /** Start OmniCam with --hidden when the user signs in, or stop doing so. */
  setLaunchAtLogin(on: boolean): void;
  /**
   * At startup: make the login item match the setting. An AppImage that was moved or replaced by a
   * newer one would otherwise start from a path that no longer exists.
   */
  syncLaunchAtLogin(on: boolean): void;
  /**
   * Whether a tray icon would be visible. Without one OmniCam creates no tray, closing the window
   * minimises it and --hidden starts minimised, so the app is never out of reach.
   */
  hasTray(): Promise<boolean>;
  /** The OS's sound settings for the microphone guide, or null where no URL opens them. */
  soundSettingsUrl: string | null;
  /** Linux family for install commands; 'other' elsewhere. */
  distro: Distro;
  /** A microphone OmniCam creates itself, or null where the user installs one (Windows: VB-CABLE). */
  virtualMic: VirtualMic | null;
  /** The one-time camera setup OmniCam can run itself (Linux: v4l2loopback), or null (Windows: the installer). */
  setupCamera: (() => Promise<CameraSetupResult>) | null;
  /** Whether in-app updates can replace this install: not in dev, not an rpm/deb (their updates come from Releases). */
  updates(): 'supported' | 'dev' | 'package';
}

/** The phone's microphone as a device apps can pick, for as long as OmniCam runs. */
export interface VirtualMic {
  /** Creates the devices in the background; `onChange` hears every state from then on. */
  start(onChange: (state: VirtualMicState) => void): void;
  /** Removes them. Synchronous, because it runs while the app quits. */
  stop(): void;
  state(): VirtualMicState;
}
