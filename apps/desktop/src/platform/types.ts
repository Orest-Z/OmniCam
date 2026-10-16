/**
 * What the main process needs from the operating system. One implementation per OS (win.ts,
 * linux.ts, a no-op fallback), chosen once by index.ts, so main never branches on process.platform
 * for these. Platform code may use src/shared, never main: main calls platform, not the other way.
 *
 * Still to come here: the virtual microphone (Linux: a PipeWire sink and source while OmniCam runs)
 * and the one-time camera setup (Linux: v4l2loopback through pkexec).
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
}
