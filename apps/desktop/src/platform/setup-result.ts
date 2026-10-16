import type { CameraSetupResult } from '../shared/ipc';

/** pkexec's own exit codes: the password prompt was dismissed, or nobody could authorise it. */
const PKEXEC_DISMISSED = 126;
const PKEXEC_NOT_AUTHORISED = 127;

/**
 * How `pkexec /bin/bash omnicam-camera-setup.sh install` ended. The script's last stderr line is one
 * sentence for the user. Pure (no Electron), so node --test covers it.
 */
export function setupResult(exitCode: number | null, stderr: string): CameraSetupResult {
  if (exitCode === 0) return { status: 'ok' };
  if (exitCode === PKEXEC_DISMISSED || exitCode === PKEXEC_NOT_AUTHORISED) return { status: 'cancelled' };
  const message = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  return { status: 'failed', ...(exitCode !== null && { exitCode }), ...(message && { message }) };
}

/** Owned by root, and no group or other write bit: nobody but root can change it. */
export function onlyRootCanChange(stat: { uid: number; mode: number }): boolean {
  return stat.uid === 0 && (stat.mode & 0o022) === 0;
}
