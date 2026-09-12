import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  RESOLUTION_PRESETS,
  type AppSettings,
  type DesktopToPhone,
  type DeviceInfo,
  type PhoneToDesktop,
  type StreamStats,
  type VirtualCamStats,
} from '@omnicam/protocol';
import {
  ENGINE_ANSWER,
  ENGINE_APPLY_SETTINGS,
  ENGINE_CONTROL,
  ENGINE_DISCONNECT,
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
  type EngineAnswer,
  type EngineOffer,
  type EngineSettings,
  type PreviewFrame,
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

/** Location of the native addon + softcam DLLs (dev: packages/vcam-native/build; packaged: resources/native). */
export function nativePaths(): { addonPath: string; nativeDir: string } {
  const nativeDir = app.isPackaged
    ? join(process.resourcesPath, 'native')
    : join(app.getAppPath(), 'resources', 'native');
  return { addonPath: join(nativeDir, 'omnicam_vcam.node'), nativeDir };
}

export function toEngineSettings(s: AppSettings): EngineSettings {
  const preset = RESOLUTION_PRESETS[s.outputPreset] ?? RESOLUTION_PRESETS['720p'];
  return {
    outputWidth: preset.width,
    outputHeight: preset.height,
    outputFps: s.outputFps,
    mirror: s.mirror,
    rotation: s.rotation,
    holdLastFrame: s.holdLastFrame,
    ...nativePaths(),
  };
}

/**
 * Main-process handle on the hidden engine window. The engine hosts the RTCPeerConnection and
 * the native virtual-camera addon; this class is the only thing that talks to it.
 *
 * Events: 'stats' (StreamStats), 'vcam' (VirtualCamStats), 'preview' (Buffer jpeg),
 *         'phone' (PhoneToDesktop), 'ready'
 */
class EngineBridge extends EventEmitter {
  private win: BrowserWindow | null = null;
  private ready = false;
  private pending = new Map<string, { resolve: (a: EngineAnswer) => void; timer: NodeJS.Timeout }>();
  stats: StreamStats = { ...EMPTY_STREAM_STATS };
  vcam: VirtualCamStats = { ...EMPTY_VCAM_STATS };

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
      this.send(ENGINE_APPLY_SETTINGS, toEngineSettings(settings.get()));
      this.emit('ready');
    });
    ipcMain.on(ENGINE_ANSWER, (e, answer: EngineAnswer) => {
      if (e.sender !== win.webContents) return;
      const p = this.pending.get(answer.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(answer.id);
      p.resolve(answer);
    });
    ipcMain.on(ENGINE_STATS, (e, s: StreamStats) => {
      if (e.sender !== win.webContents) return;
      this.stats = s;
      this.emit('stats', s);
    });
    ipcMain.on(ENGINE_VCAM_STATS, (e, s: VirtualCamStats) => {
      if (e.sender !== win.webContents) return;
      this.vcam = s;
      this.emit('vcam', s);
    });
    ipcMain.on(ENGINE_PREVIEW_FRAME, (e, frame: PreviewFrame) => {
      if (e.sender !== win.webContents) return;
      this.emit('preview', frame);
    });
    ipcMain.on(ENGINE_PHONE_MESSAGE, (e, msg: PhoneToDesktop) => {
      if (e.sender !== win.webContents) return;
      this.emit('phone', msg);
    });
    ipcMain.on(ENGINE_VCAM_ERROR, (e, message: string) => {
      if (e.sender !== win.webContents) return;
      this.emit('vcam-error', message);
    });
    ipcMain.on(ENGINE_LOG, (e, level: 'log' | 'warn' | 'error', ...args: unknown[]) => {
      if (e.sender !== win.webContents) return;
      console[level]('[engine]', ...args);
    });

    win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/engine/index.html`);
    } else {
      void win.loadFile(join(__dirname, '../renderer/engine/index.html'), { query: { dbg: process.env.OMNICAM_DEBUG ?? '' } });
    }
  }

  private send(channel: string, ...args: unknown[]): void {
    this.win?.webContents.send(channel, ...args);
  }

  /** Hands the phone's offer to the engine and resolves with the complete answer SDP. */
  negotiate(sdp: string, device: DeviceInfo): Promise<{ sdp: string; sessionId: string }> {
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
      const offer: EngineOffer = { id, sdp, device };
      this.send(ENGINE_OFFER, offer);
    });
  }

  applySettings(s: AppSettings): void {
    this.send(ENGINE_APPLY_SETTINGS, toEngineSettings(s));
  }

  disconnect(): void {
    this.send(ENGINE_DISCONNECT);
  }

  control(msg: DesktopToPhone): void {
    this.send(ENGINE_CONTROL, msg);
  }

  setPreview(enabled: boolean): void {
    this.send(ENGINE_PREVIEW, enabled);
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
