import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { AppSettings, DesktopToPhone, PhoneToDesktop } from '@omnicam/protocol';
import {
  UI_CONTROL,
  UI_DISCONNECT,
  UI_GET_STATE,
  UI_OPEN_EXTERNAL,
  UI_PREVIEW_FRAME,
  UI_ROTATE_TOKEN,
  UI_SET_PREVIEW,
  UI_SET_SETTINGS,
  UI_VCAM_ERROR,
  type AppState,
} from '../shared/ipc';
import { broadcast, disconnectPhone } from './actions';
import { loadOrCreateCert } from './cert';
import { engine } from './engine-bridge';
import { phoneServer } from './server';
import { session } from './session';
import { settings } from './settings';
import { createTray, updateTray } from './tray';
import { createOrShowUiWindow, markQuitting, uiWindow } from './ui-window';

// --- Chromium switches: must be set before 'ready' -------------------------------------------
// The engine's ICE host candidate must be a real LAN IP, not an mDNS name: phones on networks
// that block mDNS could otherwise never complete connectivity checks.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
// Never throttle the hidden engine window.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createOrShowUiWindow());
  void main();
}

let vcamError: string | null = null;

async function fullState(): Promise<AppState> {
  return {
    pairing: await session.pairingInfo().catch(() => null),
    settings: settings.get(),
    stats: engine.stats,
    vcam: engine.vcam,
    vcamError,
    version: app.getVersion(),
    platform: process.platform,
  };
}

async function startServer(): Promise<void> {
  const tls = await loadOrCreateCert();
  const port = await phoneServer.start(tls, settings.get().port);
  session.setPort(port);
  const info = await session.pairingInfo();
  // Dev convenience only: the token is a secret, never log it from a packaged build.
  console.log(app.isPackaged ? `OmniCam phone page on port ${port}` : `OmniCam phone page: ${info.url}`);
  broadcast({ pairing: info });
}

function wireIpc(): void {
  ipcMain.handle(UI_GET_STATE, () => fullState());

  ipcMain.handle(UI_SET_SETTINGS, async (_e, patch: Partial<AppSettings>) => {
    const prev = settings.get();
    const next = settings.update(patch);
    if (next.port !== prev.port || next.preferredIp !== prev.preferredIp) {
      await startServer();
    }
    engine.applySettings(next);
    if (next.launchAtLogin !== prev.launchAtLogin) {
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--hidden'] });
    }
    broadcast({ settings: next });
    return next;
  });

  ipcMain.handle(UI_CONTROL, (_e, msg: DesktopToPhone) => engine.control(msg));

  ipcMain.handle(UI_DISCONNECT, () => disconnectPhone());

  ipcMain.handle(UI_ROTATE_TOKEN, async () => {
    session.rotateToken();
    broadcast({ pairing: await session.pairingInfo() });
  });

  ipcMain.handle(UI_SET_PREVIEW, (_e, enabled: boolean) => engine.setPreview(enabled));

  ipcMain.handle(UI_OPEN_EXTERNAL, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  });

  engine.on('stats', (s) => {
    updateTray(s);
    broadcast({ stats: s });
  });
  engine.on('vcam', (v) => broadcast({ vcam: v }));
  engine.on('preview', (jpeg: Uint8Array) => uiWindow()?.webContents.send(UI_PREVIEW_FRAME, jpeg));
  engine.on('phone', (msg: PhoneToDesktop) => {
    if (msg.type === 'error') console.warn('[phone]', msg.message);
  });
  engine.on('vcam-error', (message: string) => {
    vcamError = message;
    uiWindow()?.webContents.send(UI_VCAM_ERROR, message);
  });
}

async function main(): Promise<void> {
  await app.whenReady();
  settings.load();
  app.setAppUserModelId('com.omnicam.desktop');

  wireIpc();
  engine.create();
  createTray();
  if (!process.argv.includes('--hidden')) createOrShowUiWindow();

  try {
    await startServer();
  } catch (err) {
    console.error('server failed to start', err);
  }

  // Re-check LAN addresses periodically: laptops roam between networks.
  setInterval(async () => {
    const info = await session.pairingInfo().catch(() => null);
    if (info) broadcast({ pairing: info });
  }, 15_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOrShowUiWindow();
  });
  app.on('before-quit', () => markQuitting());
  app.on('will-quit', () => {
    engine.shutdown();
    void phoneServer.stop();
  });
  // Keep running in the tray when the UI window is closed.
  app.on('window-all-closed', () => {
    /* intentionally empty */
  });
}
