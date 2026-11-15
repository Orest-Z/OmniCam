import { engine } from './engine-bridge';
import { session } from './session';
import { uiWindow } from './ui-window';
import { UI_STATE, type StatePatch } from '../shared/ipc';

let broadcasts = 0;
if (process.env.OMNICAM_UI_DEBUG?.includes('ipc')) {
  setInterval(() => {
    console.log(`[ipc] UI_STATE broadcasts in last 5 s: ${broadcasts}`);
    broadcasts = 0;
  }, 5000);
}

export function broadcast(patch: StatePatch): void {
  broadcasts++;
  uiWindow()?.webContents.send(UI_STATE, patch);
}

/**
 * Drops the phone of the camera the window shows and invalidates its QR so it cannot silently reconnect.
 * The QR codes share one token, so it stays while another camera has a phone: that phone could never
 * come back after a Wi-Fi drop otherwise.
 */
export async function disconnectPhone(): Promise<void> {
  engine.disconnect(engine.shown);
  const othersConnected = engine.states().some((state, camera) => camera !== engine.shown && state !== 'idle');
  if (!othersConnected) session.rotateToken();
  broadcast({ pairing: await session.pairingInfo(engine.shown) });
}
