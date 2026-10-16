import { app } from 'electron';
import type { Platform } from './types';

/** Windows: what OmniCam did before the platform layer existed, unchanged. */
export const windows: Platform = {
  setLaunchAtLogin(on) {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  },
  // The Run key names the installed exe, which updates replace in place.
  syncLaunchAtLogin() {},
  hasTray: () => Promise.resolve(true),
  soundSettingsUrl: 'ms-settings:sound',
  distro: 'other',
  // The user installs VB-CABLE; Windows has no user-mode virtual microphone.
  virtualMic: null,
  // The installer registers the camera.
  setupCamera: null,
  updates: () => (app.isPackaged ? 'supported' : 'dev'),
};
