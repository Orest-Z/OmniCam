import { app, Menu, Tray, nativeImage } from 'electron';
import type { StreamStats } from '@omnicam/protocol';
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
  updateTray(engine.stats);
  return tray;
}

export function updateTray(stats: StreamStats): void {
  if (!tray) return;
  const live = stats.state === 'connected' || stats.state === 'stalled';
  if (live !== liveIcon) {
    tray.setImage(icon(live));
    liveIcon = live;
  }
  const phone = stats.device?.platform;
  const label = STATE_LABEL[stats.state] + (live && phone ? ` · ${phone}` : '');
  tray.setToolTip(`OmniCam — ${label}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Open OmniCam', click: () => createOrShowUiWindow() },
      {
        label: 'Switch camera',
        enabled: live,
        click: () => engine.control({ type: 'switchCamera' }),
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
