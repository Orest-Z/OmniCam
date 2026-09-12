import { app, BrowserWindow, shell, nativeImage } from 'electron';
import { join } from 'node:path';
import { settings } from './settings';

let win: BrowserWindow | null = null;
let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

export function uiWindow(): BrowserWindow | null {
  return win;
}

export function iconPath(name: string): string {
  return join(app.getAppPath(), 'resources', 'icons', name);
}

export function createOrShowUiWindow(): BrowserWindow {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  win = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: 'OmniCam',
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(iconPath('icon.png')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    // Closing the window must not kill the camera: hide to tray instead.
    if (!quitting && settings.get().closeToTray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/renderer/index.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/renderer/index.html'));
  }
  return win;
}
