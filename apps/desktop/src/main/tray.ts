import { app, Menu, Tray, nativeImage } from 'electron';
import type { ConnectionState } from '@omnicam/protocol';
import { createOrShowUiWindow, iconPath, markQuitting } from './ui-window';

let tray: Tray | null = null;

const STATE_LABEL: Record<ConnectionState, string> = {
  idle: 'Waiting for phone',
  connecting: 'Connecting…',
  connected: 'Live',
  stalled: 'Paused (phone in background)',
  disconnected: 'Phone disconnected',
};

export function createTray(): Tray {
  if (tray) return tray;
  const image = nativeImage.createFromPath(iconPath('tray.png'));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('OmniCam');
  tray.on('click', () => createOrShowUiWindow());
  updateTray('idle');
  return tray;
}

export function updateTray(state: ConnectionState): void {
  if (!tray) return;
  tray.setToolTip(`OmniCam — ${STATE_LABEL[state]}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `OmniCam — ${STATE_LABEL[state]}`, enabled: false },
      { type: 'separator' },
      { label: 'Open OmniCam', click: () => createOrShowUiWindow() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          markQuitting();
          app.quit();
        },
      },
    ]),
  );
}
