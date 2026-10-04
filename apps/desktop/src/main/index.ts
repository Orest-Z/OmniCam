import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { cpus } from 'node:os';
import type { AppSettings, DesktopToPhone, PhoneToDesktop } from '@omnicam/protocol';
import {
  UI_CONTROL,
  UI_DISCONNECT,
  UI_GET_STATE,
  UI_OPEN_EXTERNAL,
  UI_OPEN_LOGS,
  UI_PREVIEW_FRAME,
  UI_ROTATE_TOKEN,
  UI_SET_PREVIEW,
  UI_SET_SETTINGS,
  UI_UPDATE_CHECK,
  UI_UPDATE_DOWNLOAD,
  UI_UPDATE_INSTALL,
  UI_VCAM_ERROR,
  type AppState,
  type PreviewFrame,
} from '../shared/ipc';
import { broadcast, disconnectPhone } from './actions';
import { loadOrCreateCert } from './cert';
import { engine } from './engine-bridge';
import { installFileLog, logDir } from './log';
import { migrateLegacyUserData } from './user-data';
import { phoneServer } from './server';
import { session } from './session';
import { settings } from './settings';
import { createTray, updateTray } from './tray';
import { applyTheme, createOrShowUiWindow, markQuitting, uiWindow } from './ui-window';
import { checkForUpdates, downloadUpdate, initUpdater, installUpdate, updateState } from './updater';
import { outputFpsFor } from '../shared/stream-format';

// --- Chromium switches: must be set before 'ready' -------------------------------------------
// The engine's ICE host candidate must be a real LAN IP, not an mDNS name: phones on networks
// that block mDNS could otherwise never complete connectivity checks.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
// Never throttle the hidden engine window.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// Software video decoding by default. Measured on Electron 44 / Win10: a hardware-decoded 1080p
// frame costs ~12 ms of GPU readback per VideoFrame.copyTo() and lands as NV12; a software-decoded
// one costs ~0.4 ms to copy and is already I420. The virtual camera is a CPU consumer, so the GPU
// round trip is pure overhead until 4K. (Settings must be read before app.whenReady.)
installFileLog();
migrateLegacyUserData();
settings.load();
if (!settings.get().hardwareDecode) app.commandLine.appendSwitch('disable-accelerated-video-decode');

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
    update: updateState(),
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

async function changeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const prev = settings.get();
  const next = settings.update(patch);
  if (next.port !== prev.port || next.preferredIp !== prev.preferredIp) {
    await startServer();
  }
  engine.applySettings(next);
  if (next.theme !== prev.theme) applyTheme(next.theme);
  if (next.launchAtLogin !== prev.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--hidden'] });
  }
  broadcast({ settings: next });
  return next;
}

function wireIpc(): void {
  ipcMain.handle(UI_GET_STATE, () => fullState());

  ipcMain.handle(UI_SET_SETTINGS, (_e, patch: Partial<AppSettings>) => changeSettings(patch));

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

  ipcMain.handle(UI_OPEN_LOGS, () => shell.openPath(logDir()));

  ipcMain.handle(UI_UPDATE_CHECK, () => checkForUpdates(true));
  ipcMain.handle(UI_UPDATE_DOWNLOAD, () => downloadUpdate());
  ipcMain.handle(UI_UPDATE_INSTALL, () => installUpdate());

  engine.on('stats', (s) => {
    updateTray(s);
    broadcast({ stats: s });
  });
  engine.on('vcam', (v) => broadcast({ vcam: v }));
  engine.on('preview', (frame: PreviewFrame) => uiWindow()?.webContents.send(UI_PREVIEW_FRAME, frame));
  engine.on('phone', (msg: PhoneToDesktop) => {
    if (msg.type === 'error') console.warn('[phone]', msg.message);
    // Apps get exactly the virtual camera's rate, so it follows the rate the phone's camera really
    // runs at, whichever side changed the resolution: 720p60 reaches Zoom at 60, and a phone that
    // only managed 30 doesn't get its frames doubled. Only on a change: it restarts the device.
    if (msg.type === 'trackInfo') {
      const fps = outputFpsFor(msg.info.frameRate);
      if (fps !== settings.get().outputFps) void changeSettings({ outputFps: fps });
    }
  });
  engine.on('vcam-error', (message: string) => {
    vcamError = message;
    uiWindow()?.webContents.send(UI_VCAM_ERROR, message);
  });
  engine.on('restarted', () => broadcast({ stats: engine.stats, vcam: engine.vcam }));
}

async function main(): Promise<void> {
  await app.whenReady();
  app.setAppUserModelId('com.omnicam.desktop');

  applyTheme(settings.get().theme);
  wireIpc();
  engine.create();
  createTray();
  if (!process.argv.includes('--hidden')) createOrShowUiWindow();
  if (!app.isPackaged) {
    setTimeout(() => console.log(`[pids] main=${process.pid} engine=${engine.osPid()} ui=${uiWindow()?.webContents.getOSProcessId()}`), 4000);
  }
  if (process.env.OMNICAM_DEBUG?.includes('cpu')) {
    // Dev: per-process CPU every 5 s, the same numbers Task Manager shows. Computed from cumulative
    // CPU seconds: percentCPUUsage read 0 for every process on Electron 44 / Win10.
    const cores = cpus().length;
    let prev = new Map<number, number>();
    let prevAt = performance.now();
    setInterval(() => {
      const now = performance.now();
      const secs = (now - prevAt) / 1000;
      const next = new Map<number, number>();
      const names: Record<number, string> = { [engine.osPid() ?? -1]: 'engine', [uiWindow()?.webContents.getOSProcessId() ?? -1]: 'ui' };
      const rows = app.getAppMetrics().map((m) => {
        const total = m.cpu.cumulativeCPUUsage ?? 0;
        next.set(m.pid, total);
        const pct = prev.has(m.pid) ? ((total - prev.get(m.pid)!) / secs / cores) * 100 : 0;
        return `${names[m.pid] ?? m.type + (m.name ? ':' + m.name : '')}=${pct.toFixed(1)}%`;
      });
      prev = next;
      prevAt = now;
      console.log('[cpu]', rows.join(' '));
    }, 5000);
  }

  try {
    await startServer();
  } catch (err) {
    console.error('server failed to start', err);
  }

  initUpdater();

  // Re-check LAN addresses periodically: laptops roam between networks.
  setInterval(async () => {
    const info = await session.pairingInfo().catch(() => null);
    if (info) broadcast({ pairing: info });
  }, 15_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOrShowUiWindow();
  });
  // A helper process (GPU, network, a renderer) went away. Renderers are restarted by their
  // owners (engine-bridge / ui-window); the rest is logged so a bug report has the reason.
  app.on('child-process-gone', (_e, d) => console.warn(`child process gone: ${d.type}${d.name ? ' ' + d.name : ''} reason=${d.reason} exitCode=${d.exitCode}`));
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
