import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  MAX_CAMERAS,
  RESOLUTION_PRESETS,
  type DesktopToPhone,
  type DeviceInfo,
  type PhoneToDesktop,
} from '@omnicam/protocol';
import {
  ENGINE_ANSWER,
  ENGINE_APPLY_SETTINGS,
  ENGINE_CONTROL,
  ENGINE_DISCONNECT,
  ENGINE_LINK,
  ENGINE_LINK_SEND,
  ENGINE_LOG,
  ENGINE_OFFER,
  ENGINE_PHONE_MESSAGE,
  ENGINE_PREVIEW,
  ENGINE_PREVIEW_FRAME,
  ENGINE_READY,
  ENGINE_SHUTDOWN,
  ENGINE_STATS,
  ENGINE_VCAM_STATS,
  ENGINE_VCAM_ERROR,
  rotationOf,
  type AppSettings,
  type EngineAnswer,
  type EngineOffer,
  type EngineSettings,
  type PreviewFrame,
  type StreamStats,
  type VirtualCamStats,
} from '../shared/ipc';
import { settings } from './settings';

export const EMPTY_STREAM_STATS: StreamStats = {
  state: 'idle', width: 0, height: 0, fps: 0, bitrateKbps: 0, rttMs: 0, codec: '',
  packetsLost: 0, jitterMs: 0, framesDecoded: 0,
};
export const EMPTY_VCAM_STATS: VirtualCamStats = {
  running: false, width: 0, height: 0, fps: 0, framesSent: 0, framesRepeated: 0, framesDropped: 0, consumers: 0,
};

const NEGOTIATE_TIMEOUT_MS = 10_000;
// A renderer that keeps dying is not going to be fixed by another reload.
const RESTART_WINDOW_MS = 60_000;
const RESTART_LIMIT = 3;

/** True if another restart is allowed; keeps a sliding window of recent restart times. */
export function restartBudget(times: number[]): boolean {
  const now = Date.now();
  while (times.length && now - times[0] > RESTART_WINDOW_MS) times.shift();
  if (times.length >= RESTART_LIMIT) return false;
  times.push(now);
  return true;
}

/** Location of the native addon + softcam DLLs (dev: packages/vcam-native/build; packaged: resources/native). */
export function nativePaths(): { addonPath: string; nativeDir: string } {
  const nativeDir = app.isPackaged
    ? join(process.resourcesPath, 'native')
    : join(app.getAppPath(), 'resources', 'native');
  return { addonPath: join(nativeDir, 'omnicam_vcam.node'), nativeDir };
}

export function toEngineSettings(s: AppSettings, cameras: number): EngineSettings {
  const preset = RESOLUTION_PRESETS[s.outputPreset] ?? RESOLUTION_PRESETS['720p'];
  return {
    outputWidth: s.outputShape === 'portrait' ? preset.height : preset.width,
    outputHeight: s.outputShape === 'portrait' ? preset.width : preset.height,
    outputFps: s.outputFps,
    mirror: s.mirror,
    rotations: Array.from({ length: MAX_CAMERAS }, (_, camera) => rotationOf(s, camera)),
    scaleMode: s.scaleMode,
    picture: s.picture,
    holdLastFrame: s.holdLastFrame,
    micOutput: s.micOutput,
    cameras,
    ...nativePaths(),
  };
}

/**
 * Main-process handle on the hidden engine window. The engine hosts the RTCPeerConnection and
 * the native virtual-camera addon; this class is the only thing that talks to it.
 *
 * Events, each with the camera's index first: 'stats' (StreamStats), 'vcam' (VirtualCamStats),
 *         'preview' (PreviewFrame), 'phone' (PhoneToDesktop), 'vcam-error' (string | null),
 *         'link-send' (string | null); and 'ready', 'restarted' (after a renderer crash + reload)
 */
class EngineBridge extends EventEmitter {
  private win: BrowserWindow | null = null;
  private ready = false;
  private restarts: number[] = [];
  private crashed = false;
  private pending = new Map<string, { resolve: (a: EngineAnswer) => void; timer: NodeJS.Timeout }>();
  private streams: StreamStats[] = Array.from({ length: MAX_CAMERAS }, () => ({ ...EMPTY_STREAM_STATS }));
  private vcams: VirtualCamStats[] = Array.from({ length: MAX_CAMERAS }, () => ({ ...EMPTY_VCAM_STATS }));
  private errors: (string | null)[] = Array.from({ length: MAX_CAMERAS }, () => null);
  private previewOn = false;
  /** Cameras that run: 1, or MAX_CAMERAS while Extra cameras is on. */
  count = 1;
  /** The camera the window shows: its preview runs, and its state is the window's. */
  shown = 0;

  statsOf(camera: number): StreamStats {
    return this.streams[camera] ?? EMPTY_STREAM_STATS;
  }

  vcamOf(camera: number): VirtualCamStats {
    return this.vcams[camera] ?? EMPTY_VCAM_STATS;
  }

  errorOf(camera: number): string | null {
    return this.errors[camera] ?? null;
  }

  /** Connection state of every running camera. */
  states(): StreamStats['state'][] {
    return this.streams.slice(0, this.count).map((s) => s.state);
  }

  private known(camera: unknown): camera is number {
    return typeof camera === 'number' && Number.isInteger(camera) && camera >= 0 && camera < MAX_CAMERAS;
  }

  create(): void {
    if (this.win) return;
    const win = new BrowserWindow({
      show: false,
      width: 640,
      height: 360,
      webPreferences: {
        // The engine loads a native addon and streams frames into it: it needs Node.
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    this.win = win;

    ipcMain.on(ENGINE_READY, (e) => {
      if (e.sender !== win.webContents) return;
      this.ready = true;
      this.send(ENGINE_APPLY_SETTINGS, toEngineSettings(settings.get(), this.count));
      this.send(ENGINE_PREVIEW, this.shown, this.previewOn);
      this.emit('ready');
      if (this.crashed) {
        this.crashed = false;
        console.log('engine restarted');
        this.emit('restarted');
      }
    });
    ipcMain.on(ENGINE_ANSWER, (e, answer: EngineAnswer) => {
      if (e.sender !== win.webContents) return;
      const p = this.pending.get(answer.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(answer.id);
      p.resolve(answer);
    });
    ipcMain.on(ENGINE_STATS, (e, camera: number, s: StreamStats) => {
      if (e.sender !== win.webContents || !this.known(camera)) return;
      this.streams[camera] = s;
      this.emit('stats', camera, s);
    });
    ipcMain.on(ENGINE_VCAM_STATS, (e, camera: number, s: VirtualCamStats) => {
      if (e.sender !== win.webContents || !this.known(camera)) return;
      this.vcams[camera] = s;
      this.emit('vcam', camera, s);
    });
    ipcMain.on(ENGINE_PREVIEW_FRAME, (e, camera: number, frame: PreviewFrame) => {
      if (e.sender !== win.webContents || !this.known(camera)) return;
      this.emit('preview', camera, frame);
    });
    ipcMain.on(ENGINE_PHONE_MESSAGE, (e, camera: number, msg: PhoneToDesktop) => {
      if (e.sender !== win.webContents || !this.known(camera)) return;
      this.emit('phone', camera, msg);
    });
    ipcMain.on(ENGINE_VCAM_ERROR, (e, camera: number, message: string | null) => {
      if (e.sender !== win.webContents || !this.known(camera)) return;
      this.errors[camera] = message;
      this.emit('vcam-error', camera, message);
    });
    ipcMain.on(ENGINE_LINK_SEND, (e, camera: number, text: string | null) => {
      if (e.sender !== win.webContents || !this.known(camera)) return;
      this.emit('link-send', camera, text);
    });
    ipcMain.on(ENGINE_LOG, (e, level: 'log' | 'warn' | 'error', ...args: unknown[]) => {
      if (e.sender !== win.webContents) return;
      console[level]('[engine]', ...args);
    });

    // The engine renderer died (GPU driver, OOM, killed from Task Manager…). Without this the
    // camera silently stops forever: reload the page so it reconnects the addon and waits for a
    // phone again. The phone's own reconnect loop brings the stream back.
    win.webContents.on('render-process-gone', (_e, d) => {
      console.error(`engine renderer gone: ${d.reason} (exit code ${d.exitCode})`);
      this.ready = false;
      this.crashed = true;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.resolve({ id, error: 'engine restarted' });
      }
      for (let camera = 0; camera < MAX_CAMERAS; camera++) {
        this.streams[camera] = { ...EMPTY_STREAM_STATS };
        this.vcams[camera] = { ...EMPTY_VCAM_STATS };
        this.emit('stats', camera, this.streams[camera]);
        this.emit('vcam', camera, this.vcams[camera]);
      }
      if (!restartBudget(this.restarts)) {
        const message = 'The camera engine crashed repeatedly. Quit OmniCam from the tray and start it again; the log folder (Settings) has details.';
        this.errors.fill(message);
        this.emit('vcam-error', this.shown, message);
        return;
      }
      setTimeout(() => this.win?.webContents.reload(), 500);
    });

    win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/engine/index.html?dbg=${encodeURIComponent(process.env.OMNICAM_DEBUG ?? '')}`);
    } else {
      void win.loadFile(join(__dirname, '../renderer/engine/index.html'), { query: { dbg: process.env.OMNICAM_DEBUG ?? '' } });
    }
  }

  private send(channel: string, ...args: unknown[]): void {
    this.win?.webContents.send(channel, ...args);
  }

  /** Hands the phone's offer to the engine and resolves with the complete answer SDP. */
  negotiate(camera: number, sdp: string, device: DeviceInfo): Promise<{ sdp: string; sessionId: string }> {
    if (!this.win || !this.ready) return Promise.reject(new Error('engine not ready'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('engine timeout'));
      }, NEGOTIATE_TIMEOUT_MS);
      this.pending.set(id, {
        timer,
        resolve: (a) => ('error' in a ? reject(new Error(a.error)) : resolve({ sdp: a.sdp, sessionId: a.sessionId })),
      });
      const offer: EngineOffer = { id, camera, sdp, device };
      this.send(ENGINE_OFFER, offer);
    });
  }

  applySettings(s: AppSettings): void {
    this.send(ENGINE_APPLY_SETTINGS, toEngineSettings(s, this.count));
  }

  /** Runs one camera, or all of them (Extra cameras). A camera that stops lets go of its phone. */
  setCount(count: number): void {
    if (count === this.count) return;
    this.count = count;
    if (this.shown >= count) this.show(0);
    this.applySettings(settings.get());
  }

  /** Makes `camera` the one the window shows; the preview moves with it. */
  show(camera: number): void {
    this.shown = camera;
    this.send(ENGINE_PREVIEW, camera, this.previewOn);
  }

  disconnect(camera: number): void {
    this.send(ENGINE_DISCONNECT, camera);
  }

  control(camera: number, msg: DesktopToPhone): void {
    this.send(ENGINE_CONTROL, camera, msg);
  }

  /** The media link's events for the engine: 'open', 'close', a binary message or a parsed text one. */
  link(camera: number, event: 'open' | 'close' | Uint8Array | object): void {
    this.send(ENGINE_LINK, camera, event);
  }

  /** The preview of the camera the window shows. */
  setPreview(enabled: boolean): void {
    this.previewOn = enabled;
    this.send(ENGINE_PREVIEW, this.shown, enabled);
  }

  osPid(): number | undefined {
    return this.win?.webContents.getOSProcessId();
  }

  openDevTools(): void {
    this.win?.webContents.openDevTools({ mode: 'detach' });
  }

  shutdown(): void {
    this.send(ENGINE_SHUTDOWN);
    this.win?.destroy();
    this.win = null;
  }
}

export const engine = new EngineBridge();
