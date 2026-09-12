import type { IpcRenderer } from 'electron';
import {
  CONTROL_CHANNEL_LABEL,
  type ConnectionState,
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
  ENGINE_LOG,
  ENGINE_OFFER,
  ENGINE_PHONE_MESSAGE,
  ENGINE_PREVIEW,
  ENGINE_PREVIEW_FRAME,
  ENGINE_READY,
  ENGINE_SHUTDOWN,
  ENGINE_STATS,
  ENGINE_VCAM_ERROR,
  ENGINE_VCAM_STATS,
  type EngineAnswer,
  type EngineOffer,
  type EngineSettings,
} from '../shared/ipc';
import { loadVcam, renderPlaceholder, type FrameFormat, type VcamAddon } from './vcam';

// `window.require` bypasses Vite so Electron's module is resolved at runtime.
const { ipcRenderer } = window.require('electron') as { ipcRenderer: IpcRenderer };

const log = (...a: unknown[]) => ipcRenderer.send(ENGINE_LOG, 'log', ...a);
const warn = (...a: unknown[]) => ipcRenderer.send(ENGINE_LOG, 'warn', ...a);

const sink = document.getElementById('sink') as HTMLVideoElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let pc: RTCPeerConnection | null = null;
let control: RTCDataChannel | null = null;
let track: MediaStreamTrack | null = null;
let device: DeviceInfo | undefined;
let sessionId = '';
let engineSettings: EngineSettings | null = null;
let vcam: VcamAddon | null = null;
let vcamStarted = false;
let pumpAbort: AbortController | null = null;
let previewEnabled = false;
let lastFrameAt = 0;

const stats: StreamStats = {
  state: 'idle', width: 0, height: 0, fps: 0, bitrateKbps: 0, rttMs: 0, codec: '',
  packetsLost: 0, jitterMs: 0, framesDecoded: 0,
};

function setState(state: ConnectionState) {
  if (stats.state === state) return;
  stats.state = state;
  publishStats();
}

function publishStats() {
  ipcRenderer.send(ENGINE_STATS, { ...stats });
}

function publishVcamStats() {
  const s: VirtualCamStats = vcam && vcamStarted
    ? vcam.getStats()
    : { running: false, width: 0, height: 0, fps: 0, framesSent: 0, framesRepeated: 0, framesDropped: 0, consumers: 0 };
  ipcRenderer.send(ENGINE_VCAM_STATS, s);
}

// ---------------------------------------------------------------------------
// Virtual camera lifecycle
// ---------------------------------------------------------------------------
function applySettings(next: EngineSettings) {
  const prev = engineSettings;
  engineSettings = next;

  if (!vcam) {
    const loaded = loadVcam(next.addonPath);
    vcam = loaded.addon;
    if (!vcam) {
      ipcRenderer.send(ENGINE_VCAM_ERROR, loaded.reason ?? 'native addon missing');
      warn(loaded.reason);
    }
  }
  if (!vcam) return;

  const formatChanged =
    !prev || prev.outputWidth !== next.outputWidth || prev.outputHeight !== next.outputHeight || prev.outputFps !== next.outputFps;

  if (formatChanged) {
    try {
      if (vcamStarted) vcam.stop();
      vcam.start({ width: next.outputWidth, height: next.outputHeight, fps: next.outputFps, nativeDir: next.nativeDir });
      vcamStarted = true;
      vcam.setPlaceholder(
        renderPlaceholder(next.outputWidth, next.outputHeight, ['OmniCam', 'Scan the QR code in the OmniCam app on this computer']),
        next.outputWidth,
        next.outputHeight,
      );
      if (stats.state !== 'connected') vcam.showPlaceholder();
      ipcRenderer.send(ENGINE_VCAM_ERROR, null);
    } catch (err) {
      vcamStarted = false;
      const message = `virtual camera failed to start: ${(err as Error).message}`;
      ipcRenderer.send(ENGINE_VCAM_ERROR, message);
      warn(message);
    }
  }
  if (vcamStarted) {
    vcam.setHoldLastFrame(next.holdLastFrame);
    vcam.setTransform({ mirror: next.mirror, rotation: next.rotation });
  }
  publishVcamStats();
}

// ---------------------------------------------------------------------------
// Frame pump: decoded VideoFrames -> native double buffer
// ---------------------------------------------------------------------------
async function runPump(t: MediaStreamTrack, abort: AbortSignal) {
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    warn('MediaStreamTrackProcessor unavailable; virtual camera gets no frames');
    return;
  }
  const processor = new MediaStreamTrackProcessor({ track: t });
  const reader = processor.readable.getReader();
  let buffer = new Uint8Array(0);
  abort.addEventListener('abort', () => void reader.cancel().catch(() => undefined));

  try {
    while (!abort.aborted) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;
      try {
        lastFrameAt = performance.now();
        if (vcam && vcamStarted && frame.format) {
          const rect = frame.visibleRect ?? undefined;
          const size = frame.allocationSize({ rect });
          if (buffer.byteLength < size) buffer = new Uint8Array(size);
          const layout = await frame.copyTo(buffer, { rect });
          vcam.pushFrame(buffer.subarray(0, size), {
            format: frame.format as FrameFormat,
            width: rect?.width ?? frame.codedWidth,
            height: rect?.height ?? frame.codedHeight,
            layout: layout.map((l: PlaneLayout) => ({ offset: l.offset, stride: l.stride })),
          });
        }
      } finally {
        frame.close();
      }
    }
  } catch (err) {
    if (!abort.aborted) warn('frame pump ended', (err as Error).message);
  }
}

function startPump(t: MediaStreamTrack) {
  stopPump();
  pumpAbort = new AbortController();
  void runPump(t, pumpAbort.signal);
}

function stopPump() {
  pumpAbort?.abort();
  pumpAbort = null;
}

// ---------------------------------------------------------------------------
// Peer connection
// ---------------------------------------------------------------------------
function teardownPeer() {
  stopPump();
  control?.close();
  control = null;
  track = null;
  if (pc) {
    pc.onconnectionstatechange = null;
    pc.ontrack = null;
    pc.ondatachannel = null;
    pc.close();
    pc = null;
  }
  sink.srcObject = null;
  if (vcam && vcamStarted && !(engineSettings?.holdLastFrame)) vcam.showPlaceholder();
}

function preferReceiveCodecs(peer: RTCPeerConnection) {
  const caps = RTCRtpReceiver.getCapabilities?.('video');
  if (!caps) return;
  const rank = (c: RTCRtpCodec) => {
    const m = c.mimeType.toLowerCase();
    if (m === 'video/h264') return 0;
    if (m === 'video/vp9') return 1;
    if (m === 'video/vp8') return 2;
    if (m === 'video/av1') return 3;
    return 9;
  };
  for (const tr of peer.getTransceivers()) {
    if (tr.receiver.track.kind !== 'video' || !('setCodecPreferences' in tr)) continue;
    try {
      tr.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b)));
    } catch {
      /* ignore */
    }
  }
}

function waitForIceComplete(peer: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      peer.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => peer.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, timeoutMs);
    peer.addEventListener('icegatheringstatechange', check);
  });
}

async function handleOffer(offer: EngineOffer): Promise<EngineAnswer> {
  teardownPeer();
  device = offer.device;
  stats.device = device;
  stats.trackInfo = undefined;
  stats.caps = undefined;
  setState('connecting');

  const peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
  pc = peer;
  sessionId = crypto.randomUUID();

  peer.ontrack = (ev) => {
    if (ev.track.kind !== 'video') return;
    track = ev.track;
    sink.srcObject = new MediaStream([ev.track]);
    void sink.play().catch(() => undefined);
    ev.track.onmute = () => setState('stalled');
    ev.track.onunmute = () => setState('connected');
    ev.track.onended = () => setState('disconnected');
    startPump(ev.track);
  };
  peer.ondatachannel = (ev) => {
    if (ev.channel.label !== CONTROL_CHANNEL_LABEL) return;
    control = ev.channel;
    control.onmessage = (m) => {
      try {
        onPhoneMessage(JSON.parse(m.data) as PhoneToDesktop);
      } catch {
        /* ignore */
      }
    };
  };
  peer.onconnectionstatechange = () => {
    if (pc !== peer) return;
    switch (peer.connectionState) {
      case 'connected':
        setState('connected');
        break;
      case 'disconnected':
      case 'failed':
      case 'closed':
        setState('disconnected');
        if (vcam && vcamStarted && !(engineSettings?.holdLastFrame)) vcam.showPlaceholder();
        break;
    }
  };

  await peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
  preferReceiveCodecs(peer);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  await waitForIceComplete(peer);
  if (pc !== peer) return { id: offer.id, error: 'superseded' };
  return { id: offer.id, sdp: peer.localDescription!.sdp, sessionId };
}

function onPhoneMessage(msg: PhoneToDesktop) {
  switch (msg.type) {
    case 'hello':
      stats.device = msg.device;
      break;
    case 'trackInfo':
      stats.trackInfo = msg.info;
      break;
    case 'capabilities':
      stats.caps = msg.caps;
      break;
    case 'pong':
      stats.rttMs = Math.round(performance.now() - msg.t);
      break;
  }
  ipcRenderer.send(ENGINE_PHONE_MESSAGE, msg);
  publishStats();
}

function sendControl(msg: DesktopToPhone) {
  if (control?.readyState === 'open') control.send(JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// Stats (1 Hz) + stall detection
// ---------------------------------------------------------------------------
let lastBytes = 0;
let lastStatsAt = 0;

async function pollStats() {
  if (!pc) {
    if (stats.state !== 'idle' && stats.state !== 'disconnected') setState('idle');
    return;
  }
  const report = await pc.getStats().catch(() => null);
  if (!report) return;
  const now = performance.now();
  let inbound: RTCInboundRtpStreamStats | undefined;
  const codecs = new Map<string, string>();
  let rtt: number | undefined;
  report.forEach((r) => {
    if (r.type === 'inbound-rtp' && (r as RTCInboundRtpStreamStats).kind === 'video') inbound = r as RTCInboundRtpStreamStats;
    if (r.type === 'codec') codecs.set(r.id, (r as { mimeType?: string }).mimeType ?? '');
    if (r.type === 'candidate-pair' && (r as RTCIceCandidatePairStats).state === 'succeeded' && (r as RTCIceCandidatePairStats).nominated) {
      rtt = (r as RTCIceCandidatePairStats).currentRoundTripTime;
    }
  });
  if (inbound) {
    const dt = lastStatsAt ? (now - lastStatsAt) / 1000 : 1;
    const bytes = inbound.bytesReceived ?? 0;
    stats.bitrateKbps = lastBytes ? Math.round(((bytes - lastBytes) * 8) / dt / 1000) : 0;
    lastBytes = bytes;
    stats.width = inbound.frameWidth ?? 0;
    stats.height = inbound.frameHeight ?? 0;
    stats.fps = Math.round(inbound.framesPerSecond ?? 0);
    stats.framesDecoded = inbound.framesDecoded ?? 0;
    stats.packetsLost = inbound.packetsLost ?? 0;
    stats.jitterMs = Math.round((inbound.jitter ?? 0) * 1000);
    stats.codec = (codecs.get(inbound.codecId ?? '') ?? '').replace('video/', '');
  }
  if (rtt !== undefined) stats.rttMs = Math.round(rtt * 1000);
  lastStatsAt = now;

  if (pc.connectionState === 'connected') {
    const stalled = now - lastFrameAt > 2000;
    stats.state = stalled ? 'stalled' : 'connected';
  }
  publishStats();
  publishVcamStats();
}

setInterval(() => void pollStats(), 1000);
setInterval(() => sendControl({ type: 'ping', t: performance.now() }), 5000);

// ---------------------------------------------------------------------------
// Preview snapshots for the UI window (JPEG, ~15 fps while the UI is open)
// ---------------------------------------------------------------------------
const previewCanvas = new OffscreenCanvas(640, 360);
const previewCtx = previewCanvas.getContext('2d', { alpha: false })!;
let previewBusy = false;

async function previewTick() {
  if (!previewEnabled || previewBusy || !track || sink.readyState < 2) return;
  previewBusy = true;
  try {
    const vw = sink.videoWidth || 16;
    const vh = sink.videoHeight || 9;
    const scale = Math.min(previewCanvas.width / vw, previewCanvas.height / vh);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    if (previewCanvas.width !== w || previewCanvas.height !== h) {
      previewCanvas.width = w;
      previewCanvas.height = h;
    }
    previewCtx.drawImage(sink, 0, 0, w, h);
    const blob = await previewCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    ipcRenderer.send(ENGINE_PREVIEW_FRAME, buf);
  } catch {
    /* ignore transient draw errors */
  } finally {
    previewBusy = false;
  }
}
setInterval(() => void previewTick(), 66);

// ---------------------------------------------------------------------------
// IPC wiring
// ---------------------------------------------------------------------------
ipcRenderer.on(ENGINE_APPLY_SETTINGS, (_e, s: EngineSettings) => applySettings(s));
ipcRenderer.on(ENGINE_OFFER, (_e, offer: EngineOffer) => {
  handleOffer(offer)
    .then((a) => ipcRenderer.send(ENGINE_ANSWER, a))
    .catch((err: Error) => {
      warn('negotiation failed', err.message);
      ipcRenderer.send(ENGINE_ANSWER, { id: offer.id, error: err.message } satisfies EngineAnswer);
      teardownPeer();
      setState('idle');
    });
});
ipcRenderer.on(ENGINE_CONTROL, (_e, msg: DesktopToPhone) => sendControl(msg));
ipcRenderer.on(ENGINE_PREVIEW, (_e, enabled: boolean) => {
  previewEnabled = enabled;
});
ipcRenderer.on(ENGINE_SHUTDOWN, () => {
  teardownPeer();
  if (vcam && vcamStarted) vcam.stop();
  vcamStarted = false;
});

ipcRenderer.send(ENGINE_READY);
log('engine ready');
