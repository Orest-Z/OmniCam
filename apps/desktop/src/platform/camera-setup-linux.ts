import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CameraSetupResult } from '../shared/ipc';
import { onlyRootCanChange, setupResult } from './setup-result';

/** Long enough for someone to type a password; the setup itself takes seconds. */
const SETUP_TIMEOUT_MS = 5 * 60 * 1000;
/** Installing the driver downloads packages and builds a kernel module: minutes on a slow machine. */
const DRIVER_TIMEOUT_MS = 30 * 60 * 1000;
/** dnf and apt print their progress to stdout; past execFile's 1 MB default the script would be killed. */
const MAX_OUTPUT = 32 * 1024 * 1024;
const UDEV_SETTLE_S = 5;

function scriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'linux', 'omnicam-camera-setup.sh')
    : join(app.getAppPath(), 'build', 'linux', 'omnicam-camera-setup.sh');
}

/** The script and its folder belong to root and nobody else may change them (an rpm or deb install). */
function installedByRoot(script: string): boolean {
  try {
    const file = lstatSync(script);
    const dir = lstatSync(dirname(script));
    return file.isFile() && dir.isDirectory() && onlyRootCanChange(file) && onlyRootCanChange(dir);
  } catch {
    return false;
  }
}

/**
 * pkexec's arguments. Root must run exactly the script OmniCam ships, so it never runs a file the user
 * could change between OmniCam writing it and bash reading it: an rpm or deb's script is root's own and
 * runs in place; otherwise (an AppImage, whose FUSE mount root can't read, or a dev build) the text
 * itself is the argument to `bash -c`.
 */
function pkexecArgs(script: string, command: string[]): string[] {
  if (app.isPackaged && !process.env.APPIMAGE && installedByRoot(script)) return ['/bin/bash', script, ...command];
  return ['/bin/bash', '-c', readFileSync(script, 'utf8'), 'omnicam-camera-setup', ...command];
}

// One at a time: the pairing screen and Settings each have the button, and two package installs
// would fight over the package manager's lock.
let running: Promise<CameraSetupResult> | null = null;

/**
 * The one-time camera setup: makes v4l2loopback load at boot with OmniCam's device and loads it now;
 * `driver` installs v4l2loopback first. Root only here, through polkit's password prompt, never at
 * launch. Secure Boot's key is queued for enrollment when it rejects the module (exit 16).
 */
export function setupCameraLinux(driver: boolean): Promise<CameraSetupResult> {
  running ??= runSetup(driver).finally(() => (running = null));
  return running;
}

function runSetup(driver: boolean): Promise<CameraSetupResult> {
  const script = scriptPath();
  if (!existsSync(script)) {
    console.warn(`camera setup: ${script} is missing`);
    return Promise.resolve({ status: 'failed', message: 'This build of OmniCam has no camera setup script.' });
  }
  let args: string[];
  try {
    args = pkexecArgs(script, driver ? ['driver'] : ['install', '--enroll']);
  } catch (err) {
    console.warn('camera setup: cannot read the script', err);
    return Promise.resolve({ status: 'failed', message: 'OmniCam could not read its camera setup.' });
  }
  return new Promise((resolve) => {
    console.log(`camera setup: asking for permission (${args[1] === '-c' ? 'script text' : args[1]})`);
    const timeout = driver ? DRIVER_TIMEOUT_MS : SETUP_TIMEOUT_MS;
    execFile('pkexec', args, { timeout, maxBuffer: MAX_OUTPUT }, (err, stdout, stderr) => {
      if (driver) console.log(`camera setup: package manager output\n${String(stdout).slice(-8000)}`);
      const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
      const result =
        err && (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? { status: 'failed' as const, message: 'pkexec is missing, so OmniCam cannot ask for permission. Install polkit.' }
          : setupResult(code, String(stderr));
      // Exit 16's message is the Secure Boot password: never in the log.
      const said = result.message && result.exitCode !== 16 ? `: ${result.message}` : '';
      console.log(`camera setup: ${result.status}${result.exitCode !== undefined ? ` (exit ${result.exitCode})` : ''}${said}`);
      if (result.status !== 'ok') return resolve(result);
      // A new device node is root's until udev gives the signed-in user access (the uaccess ACL);
      // opening it before then fails with EACCES (seen on Fedora 44). Wait for udev to finish first.
      execFile('udevadm', ['settle', `--timeout=${UDEV_SETTLE_S}`], { timeout: (UDEV_SETTLE_S + 1) * 1000 }, () => resolve(result));
    });
  });
}
