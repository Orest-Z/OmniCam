import { app } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { ReleaseNote, UpdateState } from '../shared/ipc';
import { broadcast } from './actions';
import { settings } from './settings';
import { markQuitting } from './ui-window';
import { platform } from '../platform';

/**
 * In-app updates from GitHub Releases (electron-updater + the NSIS installer on Windows, the AppImage on
 * Linux; an rpm or deb install gets new versions from Releases instead).
 *
 * Nothing is downloaded or installed without a click: OmniCam checks quietly at launch and once a
 * day, the UI shows a badge, and the user decides. The installer is verified against the sha512 in
 * the release's latest.yml before it runs. Releases must be published (not drafts) and carry
 * latest.yml next to the installer; CI uploads both.
 */

const FIRST_CHECK_DELAY_MS = 15_000; // let startup (server, engine, camera device) settle first
const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // the app can live in the tray for weeks
const PROGRESS_THROTTLE_MS = 250;

const support = platform.updates();
let state: UpdateState = support === 'supported' ? { status: 'idle', manual: false } : { status: 'unsupported', manual: false, unsupported: support };
let lastProgressAt = 0;

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  broadcast({ update: state });
}

export function updateState(): UpdateState {
  return state;
}

/** Turns electron-updater's errors (HTTP dumps, stack traces) into one sentence; the log keeps the rest. */
function describe(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|ETIMEDOUT|ERR_CONNECTION/i.test(msg)) {
    return 'No connection to GitHub. Check your internet connection.';
  }
  if (/\b404\b|latest\.yml|Cannot find latest|No published versions|Unable to find latest version/i.test(msg)) {
    return 'No published release was found.';
  }
  if (/sha512 checksum mismatch/i.test(msg)) return 'The download was corrupted. Try again.';
  if (/\b403\b|rate limit/i.test(msg)) return 'GitHub refused the request. Try again later.';
  return 'Something went wrong. The log folder (Settings) has details.';
}

/**
 * The notes of every version on offer, newest first (fullChangelog gives one per version). CI puts the
 * download and verification steps for GitHub visitors under a rule; the app needs none of that.
 */
function notesOf(info: UpdateInfo): ReleaseNote[] {
  const raw = info.releaseNotes;
  const list = Array.isArray(raw) ? raw : raw ? [{ version: info.version, note: raw }] : [];
  return list.map((n) => ({ version: n.version, html: (n.note ?? '').split(/<hr\b[^>]*>/i)[0].trim() })).filter((n) => n.html);
}

function busy(): boolean {
  return state.status === 'checking' || state.status === 'downloading' || state.status === 'downloaded';
}

export async function checkForUpdates(manual: boolean): Promise<void> {
  // The UI disables the button in these states; a quiet check simply skips.
  if (state.status === 'unsupported' || busy()) return;
  set({ status: 'checking', manual, error: undefined, failed: undefined });
  try {
    await autoUpdater.checkForUpdates();
    // The 'update-available' / 'update-not-available' handlers set the outcome.
  } catch (err) {
    console.warn('update: check failed', err);
    set({ status: 'error', error: describe(err), failed: 'check', checkedAt: Date.now() });
  }
}

export async function downloadUpdate(): Promise<void> {
  // A version on offer stays downloadable whichever step failed last: a check that failed after the
  // offer arrived (lost connection, say) must not strand the update with no way to retry it.
  if (!state.version || busy()) return;
  lastProgressAt = 0;
  set({ status: 'downloading', percent: 0, error: undefined, failed: undefined });
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    console.warn('update: download failed', err);
    set({ status: 'error', error: describe(err), failed: 'download' });
  }
}

export function installUpdate(): void {
  if (state.status !== 'downloaded') return;
  console.log(`update: installing ${state.version}`);
  // Closing the window normally hides it to the tray; this quit must really quit.
  markQuitting();
  // Silent install (the user already agreed in the UI), then start the new version.
  // Windows still asks for administrator rights: the installer is per-machine and registers the camera.
  autoUpdater.quitAndInstall(true, true);
}

export function initUpdater(): void {
  // Dev has no app-update.yml; an rpm or deb is updated by installing the new package.
  if (support !== 'supported') return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  // Notes for every version since the installed one, not just the latest: someone who skipped a release
  // still sees what it brought. They come with the release feed the check reads anyway.
  autoUpdater.fullChangelog = true;
  autoUpdater.logger = {
    info: (m: unknown) => console.log('[updater]', m),
    warn: (m: unknown) => console.warn('[updater]', m),
    error: (m: unknown) => console.error('[updater]', m),
    debug: () => {},
  };

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log(`update: ${info.version} available (running ${app.getVersion()})`);
    set({ status: 'available', version: info.version, notes: notesOf(info), checkedAt: Date.now() });
  });
  autoUpdater.on('update-not-available', () => {
    set({ status: 'not-available', version: undefined, notes: undefined, checkedAt: Date.now() });
  });
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
    lastProgressAt = now;
    set({ percent: Math.min(100, Math.round(p.percent)) });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log(`update: ${info.version} downloaded`);
    set({ status: 'downloaded', version: info.version, percent: 100 });
  });

  // Quiet checks follow the setting at the time they fire, so switching it on or off needs no rescheduling.
  setTimeout(() => {
    if (settings.get().autoUpdateCheck) void checkForUpdates(false);
  }, FIRST_CHECK_DELAY_MS);
  setInterval(() => {
    if (!settings.get().autoUpdateCheck) return;
    if (state.status === 'idle' || state.status === 'not-available' || (state.status === 'error' && state.failed === 'check')) {
      void checkForUpdates(false);
    }
  }, RECHECK_INTERVAL_MS);
}
