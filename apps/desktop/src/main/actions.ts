import { engine } from './engine-bridge';
import { session } from './session';
import { uiWindow } from './ui-window';
import { UI_STATE, type StatePatch } from '../shared/ipc';

export function broadcast(patch: StatePatch): void {
  uiWindow()?.webContents.send(UI_STATE, patch);
}

/** Drops the phone and invalidates its QR so it cannot silently reconnect. */
export async function disconnectPhone(): Promise<void> {
  engine.disconnect();
  session.rotateToken();
  broadcast({ pairing: await session.pairingInfo() });
}
