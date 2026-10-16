import { linux } from './linux';
import type { Platform } from './types';
import { windows } from './win';

export type { Platform } from './types';

/** Any other OS (macOS for now): nothing registered, nothing opened, a tray as Electron gives it. */
const fallback: Platform = {
  setLaunchAtLogin() {},
  syncLaunchAtLogin() {},
  hasTray: () => Promise.resolve(true),
  soundSettingsUrl: null,
};

export const platform: Platform = process.platform === 'win32' ? windows : process.platform === 'linux' ? linux : fallback;
