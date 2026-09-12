import { app, BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';
import { restartBudget } from './engine-bridge';
import { settings } from './settings';

let win: BrowserWindow | null = null;
let quitting = false;
const restarts: number[] = [];

// Must match the CSS tokens in renderer/styles.css.
export const THEME = { bg: '#0a0a0d', symbol: '#9d99ab', titlebarHeight: 40 };

export function markQuitting(): void {
  quitting = true;
}

export function uiWindow(): BrowserWindow | null {
  return win;
}

export function iconPath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, 'icons', name) : join(app.getAppPath(), 'resources', 'icons', name);
}

/** Restores saved bounds only if they are still (mostly) on a connected display. */
function restoredBounds() {
  const b = settings.get().windowBounds;
  if (!b) return {};
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + b.width > a.x + 40 && b.x < a.x + a.width - 40 && b.y >= a.y - 8 && b.y < a.y + a.height - 40;
  });
  return visible ? b : { width: b.width, height: b.height };
}

export function createOrShowUiWindow(): BrowserWindow {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  const work = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1060, work.width - 40),
    height: Math.min(700, work.height - 40),
    minWidth: 860,
    minHeight: 560,
    ...restoredBounds(),
    show: false,
    title: 'OmniCam',
    backgroundColor: THEME.bg,
    autoHideMenuBar: true,
    icon: iconPath('icon.ico'),
    // Native caption buttons drawn over our own header (see renderer .titlebar).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: THEME.bg, symbolColor: THEME.symbol, height: THEME.titlebarHeight },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win?.show());
  // Renderer warnings/errors go to the log file; in dev everything does.
  win.webContents.on('console-message', (e) => {
    if (!app.isPackaged || e.level === 'warning' || e.level === 'error') console.log(`[ui:${e.level}]`, e.message);
  });
  if (!app.isPackaged) {
    if ((process.env.OMNICAM_UI_DEBUG ?? '').includes('metrics')) {
      // Renderer layout/style/paint counters via the DevTools protocol, logged every 3 s.
      const dbg = win.webContents.debugger;
      dbg.attach('1.3');
      void dbg.sendCommand('Performance.enable');
      let prev: Record<string, number> = {};
      setInterval(async () => {
        const { metrics } = (await dbg.sendCommand('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
        const m: Record<string, number> = {};
        for (const x of metrics) m[x.name] = x.value;
        const d = (k: string) => Math.round((m[k] ?? 0) - (prev[k] ?? 0));
        console.log(`[ui-metrics] layouts=${d('LayoutCount')} styleRecalcs=${d('RecalcStyleCount')} layoutMs=${(((m.LayoutDuration ?? 0) - (prev.LayoutDuration ?? 0)) * 1000).toFixed(0)} scriptMs=${(((m.ScriptDuration ?? 0) - (prev.ScriptDuration ?? 0)) * 1000).toFixed(0)} taskMs=${(((m.TaskDuration ?? 0) - (prev.TaskDuration ?? 0)) * 1000).toFixed(0)} nodes=${m.Nodes} jsHeapMB=${Math.round((m.JSHeapUsedSize ?? 0) / 1048576)}`);
        prev = m;
      }, 3000);
    }
  }
  // A dead renderer leaves an empty black window; reload it (the page re-fetches all state).
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error(`ui renderer gone: ${d.reason} (exit code ${d.exitCode})`);
    if (restartBudget(restarts)) setTimeout(() => win?.webContents.reload(), 500);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  let saveTimer: NodeJS.Timeout | undefined;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win && !win.isMinimized() && !win.isMaximized()) settings.update({ windowBounds: win.getBounds() });
    }, 400);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

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
