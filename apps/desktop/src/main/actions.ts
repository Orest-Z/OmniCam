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

/** Drops the phone and invalidates its QR so it cannot silently reconnect. */
export async function disconnectPhone(): Promise<void> {
  engine.disconnect();
  session.rotateToken();
  broadcast({ pairing: await session.pairingInfo() });
}
