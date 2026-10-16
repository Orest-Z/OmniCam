import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { parseBooleanReply, STATUS_NOTIFIER_WATCHER } from './dbus';
import { setupCameraLinux } from './camera-setup-linux';
import { autostartEntry, autostartPath } from './desktop-entry';
import { distroFrom } from './os-release';
import type { Platform } from './types';
import { linuxVirtualMic } from './virtual-mic-linux';

const TRAY_CHECK_TIMEOUT_MS = 2000;

function readOsRelease(): string {
  for (const file of ['/etc/os-release', '/usr/lib/os-release']) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      /* try the next one */
    }
  }
  return '';
}

const distro = distroFrom(readOsRelease());

const autostartFile = () => autostartPath(process.env.XDG_CONFIG_HOME, homedir());

/** What the login item runs. */
function launchCommand(): string[] {
  // An AppImage runs from a temporary mount; $APPIMAGE is the file the user keeps.
  const exe = process.env.APPIMAGE || process.execPath;
  // In dev the executable is the bare Electron binary, which needs the app folder.
  return app.isPackaged ? [exe, '--hidden'] : [exe, app.getAppPath(), '--hidden'];
}

function writeAutostart(): void {
  const file = autostartFile();
  const text = autostartEntry(launchCommand());
  try {
    if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`autostart: wrote ${file}`);
  } catch (err) {
    console.warn('autostart: write failed', err);
  }
}

function removeAutostart(): void {
  const file = autostartFile();
  try {
    if (!existsSync(file)) return;
    unlinkSync(file);
    console.log(`autostart: removed ${file}`);
  } catch (err) {
    console.warn('autostart: remove failed', err);
  }
}

/** Linux desktops: XDG autostart, a tray only where a StatusNotifier host runs. */
// Writes the entry only when its text differs, so at startup it also follows an AppImage that moved.
const launchAtLogin = (on: boolean) => (on ? writeAutostart() : removeAutostart());

export const linux: Platform = {
  setLaunchAtLogin: launchAtLogin,
  syncLaunchAtLogin: launchAtLogin,
  hasTray: () =>
    new Promise((resolve) => {
      // Electron's tray is a StatusNotifierItem; with no watcher on the session bus nobody shows it.
      // Stock GNOME has none. Any failure (no gdbus, no session bus, a timeout) counts as no tray.
      execFile(
        'gdbus',
        ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', STATUS_NOTIFIER_WATCHER],
        { timeout: TRAY_CHECK_TIMEOUT_MS },
        (err, stdout) => {
          const has = !err && parseBooleanReply(stdout);
          console.log(`tray: ${has ? 'StatusNotifier host found' : 'no StatusNotifier host, closing the window minimises it'}`);
          resolve(has);
        },
      );
    }),
  soundSettingsUrl: null,
  distro,
  virtualMic: linuxVirtualMic(distro),
  setupCamera: setupCameraLinux,
  // electron-updater can only replace an AppImage; $APPIMAGE is set when running one.
  updates: () => (!app.isPackaged ? 'dev' : process.env.APPIMAGE ? 'supported' : 'package'),
};
