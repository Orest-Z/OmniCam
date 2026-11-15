import { app, Menu, Tray, nativeImage } from 'electron';
import type { StreamStats } from '../shared/ipc';
import { engine } from './engine-bridge';
import { createOrShowUiWindow, iconPath, markQuitting } from './ui-window';
import { disconnectPhone } from './actions';

let tray: Tray | null = null;
let liveIcon = false;

const STATE_LABEL: Record<StreamStats['state'], string> = {
  idle: 'Waiting for phone',
  connecting: 'Connecting…',
  connected: 'Live',
  stalled: 'Paused on phone',
  disconnected: 'Phone disconnected',
};

function icon(live: boolean) {
  // Windows: multi-size .ico so the glyph is crisp at every DPI. Elsewhere: png + @2x.
  const file = process.platform === 'win32' ? (live ? 'tray-live.ico' : 'tray.ico') : live ? 'tray-live.png' : 'tray.png';
  const img = nativeImage.createFromPath(iconPath(file));
  if (process.platform === 'darwin') img.setTemplateImage(!live);
  return img;
}

export function createTray(): Tray {
  if (tray) return tray;
  tray = new Tray(icon(false));
  tray.setToolTip('OmniCam');
  tray.on('click', () => createOrShowUiWindow());
  updateTray();
  return tray;
}

const isLive = (state: StreamStats['state']) => state === 'connected' || state === 'stalled';

/** Live when any camera is; the label and the menu are about the camera the window shows. */
export function updateTray(): void {
  if (!tray) return;
  const stats = engine.statsOf(engine.shown);
  const liveCameras = engine.states().filter(isLive).length;
  const live = liveCameras > 0;
  if (live !== liveIcon) {
    tray.setImage(icon(live));
    liveIcon = live;
  }
  const phone = stats.device?.platform;
  const label =
    engine.count > 1 && live
      ? `${liveCameras} of ${engine.count} cameras live`
      : STATE_LABEL[stats.state] + (live && phone ? ` · ${phone}` : '');
  tray.setToolTip(`OmniCam — ${label}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Open OmniCam', click: () => createOrShowUiWindow() },
      {
        label: 'Switch camera',
        enabled: isLive(stats.state) && stats.sources?.camera !== false,
        click: () => engine.control(engine.shown, { type: 'switchCamera' }),
      },
      {
        label: 'Disconnect phone',
        enabled: stats.state !== 'idle',
        click: () => void disconnectPhone(),
      },
      { type: 'separator' },
      {
        label: 'Quit OmniCam',
        click: () => {
          markQuitting();
          app.quit();
        },
      },
    ]),
  );
}
