import { app } from 'electron';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CameraSetupResult } from '../shared/ipc';
import { setupResult } from './setup-result';

/** Long enough for someone to type a password; the script itself takes seconds. */
const SETUP_TIMEOUT_MS = 5 * 60 * 1000;
const UDEV_SETTLE_S = 5;

function scriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'linux', 'omnicam-camera-setup.sh')
    : join(app.getAppPath(), 'build', 'linux', 'omnicam-camera-setup.sh');
}

/**
 * The one-time camera setup: makes v4l2loopback load at boot with OmniCam's device and loads it now.
 * Root only here, through polkit's password prompt, never at launch. The script runs from a private
 * copy: root can't read files inside an AppImage's FUSE mount.
 */
export function setupCameraLinux(): Promise<CameraSetupResult> {
  const source = scriptPath();
  if (!existsSync(source)) {
    console.warn(`camera setup: ${source} is missing`);
    return Promise.resolve({ status: 'failed', message: 'This build of OmniCam has no camera setup script.' });
  }
  const copy = join(process.env.XDG_RUNTIME_DIR || tmpdir(), `omnicam-camera-setup-${randomBytes(6).toString('hex')}.sh`);
  try {
    // Created 0700 in one step ('wx' also refuses a file or link someone placed there first).
    writeFileSync(copy, readFileSync(source), { mode: 0o700, flag: 'wx' });
  } catch (err) {
    console.warn('camera setup: copy failed', err);
    return Promise.resolve({ status: 'failed', message: 'OmniCam could not prepare the camera setup.' });
  }
  return new Promise((resolve) => {
    console.log('camera setup: asking for permission');
    execFile('pkexec', ['/bin/bash', copy, 'install'], { timeout: SETUP_TIMEOUT_MS }, (err, _stdout, stderr) => {
      try {
        unlinkSync(copy);
      } catch {
        /* already gone */
      }
      const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
      const result =
        err && (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? { status: 'failed' as const, message: 'pkexec is missing, so OmniCam cannot ask for permission. Install polkit.' }
          : setupResult(code, String(stderr));
      console.log(`camera setup: ${result.status}${result.exitCode !== undefined ? ` (exit ${result.exitCode})` : ''}${result.message ? `: ${result.message}` : ''}`);
      if (result.status !== 'ok') return resolve(result);
      // A new device node is root's until udev gives the signed-in user access (the uaccess ACL);
      // opening it before then fails with EACCES (seen on Fedora 44). Wait for udev to finish first.
      execFile('udevadm', ['settle', `--timeout=${UDEV_SETTLE_S}`], { timeout: (UDEV_SETTLE_S + 1) * 1000 }, () => resolve(result));
    });
  });
}
