import { app } from 'electron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { ExtraCamerasResult } from '../shared/ipc';
import { elevatedScript, encoded, EXTRA_CAMERA_KEY, launcherScript, UAC_CANCELLED } from './extra-cameras-win';
import type { Platform } from './types';

const systemRoot = () => process.env.SystemRoot ?? 'C:\Windows';

/** Exit code of a system tool run with fixed arguments, never through a shell; -1 if it could not start. */
function run(file: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err) => resolve(err ? (typeof err.code === 'number' ? err.code : -1) : 0));
  });
}

const extrasRegistered = async () => (await run(join(systemRoot(), 'System32', 'reg.exe'), ['query', EXTRA_CAMERA_KEY])) === 0;

async function setExtraCameras(on: boolean, nativeDir: string): Promise<ExtraCamerasResult> {
  const powershell = join(systemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = launcherScript(powershell, elevatedScript(on, nativeDir, systemRoot()));
  const code = await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(script)]);
  if (code === UAC_CANCELLED) return { status: 'cancelled' };
  // The registry is the truth, whatever regsvr32 said.
  if ((await extrasRegistered()) === on) return { status: 'ok' };
  console.warn(`extra cameras: ${on ? 'adding' : 'removing'} them failed, exit code ${code}`);
  return { status: 'failed', message: `Windows could not ${on ? 'add' : 'remove'} the extra cameras (code ${code}). Running the OmniCam installer again repairs the camera driver.` };
}

/** Windows: what OmniCam did before the platform layer existed, unchanged. */
export const windows: Platform = {
  setLaunchAtLogin(on) {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  },
  // The Run key names the installed exe, which updates replace in place.
  syncLaunchAtLogin() {},
  hasTray: () => Promise.resolve(true),
  soundSettingsUrl: 'ms-settings:sound',
  distro: 'other',
  // The user installs VB-CABLE; Windows has no user-mode virtual microphone.
  virtualMic: null,
  // The installer registers the camera.
  setupCamera: null,
  extraCameras: { registered: extrasRegistered, set: setExtraCameras },
  updates: () => (app.isPackaged ? 'supported' : 'dev'),
};
