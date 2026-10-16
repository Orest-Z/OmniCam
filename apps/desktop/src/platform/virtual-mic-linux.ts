import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Distro, VirtualMicState } from '../shared/ipc';
import { pactlInstallCommand } from './os-release';
import { isRelevantEvent, ownModules, parseDefaults, SINK_ARGS, SINK_NAME, SOURCE_ARGS, SOURCE_NAME } from './pactl';
import type { VirtualMic } from './types';

// English output whatever the desktop's language: parseDefaults reads pactl info's labels.
const ENV = { ...process.env, LC_ALL: 'C' };
const PACTL_TIMEOUT_MS = 5000;
/** WirePlumber picks defaults shortly after a device appears; look once it has had the chance. */
const SETTLE_MS = 500;
/** pipewire-pulse restarted or went away: try again this often. */
const RETRY_MS = 5000;

type PactlError = Error & { code?: string | number; stderr?: string };

function pactl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('pactl', args, { env: ENV, timeout: PACTL_TIMEOUT_MS }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr: String(stderr).trim() })) : resolve(stdout),
    ),
  );
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "OmniCam Feed" and "OmniCam Microphone" while OmniCam runs, through pactl: no root, nothing installed,
 * works on PipeWire (pipewire-pulse) and PulseAudio alike. Removed on quit; a crash's leftovers are
 * removed at the next start. Creating them never changes the user's default output or input.
 */
export function linuxVirtualMic(distro: Distro): VirtualMic {
  let state: VirtualMicState = { status: 'starting' };
  let onChange: (s: VirtualMicState) => void = () => {};
  /** Our module ids, source first: the order they must be unloaded in. */
  let modules: number[] = [];
  let watcher: ChildProcess | null = null;
  let stopped = false;
  let retryTimer: NodeJS.Timeout | undefined;
  let checkTimer: NodeJS.Timeout | undefined;
  // One thing at a time: a check never runs halfway through creating the devices.
  let queue = Promise.resolve();
  const run = (job: () => Promise<void>) => {
    queue = queue.then(() => (stopped ? undefined : job())).catch((err: Error) => console.warn('virtual mic:', err.message));
  };

  function set(next: VirtualMicState): void {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    if (next.status !== 'ready') console.log(`virtual mic: ${next.status}${next.reason ? ` (${next.reason})` : ''}`);
    onChange(state);
  }

  function retryLater(): void {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => run(create), RETRY_MS);
  }

  async function unload(ids: number[]): Promise<void> {
    for (const id of ids) await pactl(['unload-module', String(id)]).catch(() => {});
  }

  async function create(): Promise<void> {
    let info: string;
    try {
      info = await pactl(['info']);
    } catch (err) {
      if ((err as PactlError).code === 'ENOENT') {
        const fix = pactlInstallCommand(distro);
        set({ status: 'unavailable', reason: fix ? 'OmniCam needs pactl to add its microphone.' : 'OmniCam needs pactl (in pulseaudio-utils or libpulse) to add its microphone.', ...(fix && { fix }) });
        return;
      }
      set({ status: 'unavailable', reason: 'No PipeWire or PulseAudio sound server answered.' });
      retryLater();
      return;
    }
    const before = parseDefaults(info);
    // A crash (or kill -9) leaves the devices behind; never make a second pair.
    await unload(ownModules(await pactl(['list', 'short', 'modules'])));
    modules = [];
    try {
      modules.unshift(Number((await pactl(SINK_ARGS)).trim()));
      modules.unshift(Number((await pactl(SOURCE_ARGS)).trim()));
    } catch (err) {
      await unload(modules);
      modules = [];
      const e = err as PactlError;
      set({ status: 'error', reason: `The sound server did not accept OmniCam's microphone: ${e.stderr || e.message}` });
      return;
    }
    console.log(`virtual mic: ${SINK_NAME} and ${SOURCE_NAME} ready (modules ${modules.join(', ')})`);
    await delay(SETTLE_MS);
    await restoreDefaults(before);
    watch();
    await check();
  }

  /** If the new devices just became the defaults, the user didn't choose that: put the old ones back. */
  async function restoreDefaults(before: { sink: string; source: string }): Promise<void> {
    const now = parseDefaults(await pactl(['info']));
    if (now.sink === SINK_NAME && before.sink && before.sink !== SINK_NAME) {
      await pactl(['set-default-sink', before.sink]);
      console.log(`virtual mic: default output moved to ${SINK_NAME}, restored ${before.sink}`);
    }
    const ours = (s: string) => s === SOURCE_NAME || s === `${SINK_NAME}.monitor`;
    if (ours(now.source) && before.source && !ours(before.source)) {
      await pactl(['set-default-source', before.source]);
      console.log(`virtual mic: default input moved to ${now.source}, restored ${before.source}`);
    }
  }

  /** Still there? Is the feed the default output? */
  async function check(): Promise<void> {
    // Refused once already: don't ask again on every device event.
    if (state.status === 'error') return;
    const present = ownModules(await pactl(['list', 'short', 'modules']));
    if (modules.length === 0 || modules.some((id) => !present.includes(id))) {
      // Unloaded behind our back, or the server restarted: make them again.
      console.warn('virtual mic: devices gone, creating them again');
      return create();
    }
    const { sink } = parseDefaults(await pactl(['info']));
    set({ status: 'ready', feedIsDefault: sink === SINK_NAME });
  }

  /** Follows default changes and removals as they happen, without polling. */
  function watch(): void {
    if (watcher) return;
    const child = spawn('pactl', ['subscribe'], { env: ENV, stdio: ['ignore', 'pipe', 'ignore'] });
    watcher = child;
    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (!isRelevantEvent(line)) return;
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => run(check), 300);
    });
    child.on('error', () => {});
    child.on('exit', () => {
      if (watcher === child) watcher = null;
      if (stopped) return;
      // The sound server went away, and our devices with it.
      modules = [];
      set({ status: 'unavailable', reason: 'The sound server stopped. OmniCam will add its microphone again when it is back.' });
      retryLater();
    });
  }

  return {
    start(listener) {
      onChange = listener;
      run(create);
    },
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(checkTimer);
      watcher?.kill();
      watcher = null;
      // Synchronous: this runs while the app quits, and nothing async finishes then.
      for (const id of modules) {
        try {
          execFileSync('pactl', ['unload-module', String(id)], { env: ENV, timeout: 2000, stdio: 'ignore' });
        } catch {
          /* already gone */
        }
      }
      if (modules.length) console.log(`virtual mic: removed ${SINK_NAME} and ${SOURCE_NAME}`);
      modules = [];
    },
    state: () => state,
  };
}
