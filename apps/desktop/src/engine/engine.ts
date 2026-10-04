import type { IpcRenderer } from 'electron';
import {
  CONTROL_CHANNEL_LABEL,
  type ConnectionState,
  type DesktopToPhone,
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
  ENGINE_VCAM_ERROR,
  ENGINE_VCAM_STATS,
  type EngineAnswer,
  type EngineOffer,
  type EngineSettings,
} from '../shared/ipc';
import { loadVcam, renderPlaceholder, type FrameFormat, type VcamAddon } from './vcam';
import { installFonts } from '../renderer/fonts';
import { tuneAnswerSdp } from './sdp';

installFonts();

// `window.require` bypasses Vite so Electron's module is resolved at runtime.
const { ipcRenderer } = window.require('electron') as { ipcRenderer: IpcRenderer };

const log = (...a: unknown[]) => ipcRenderer.send(ENGINE_LOG, 'log', ...a);
const warn = (...a: unknown[]) => ipcRenderer.send(ENGINE_LOG, 'warn', ...a);

// Tunables --------------------------------------------------------------------
const PREVIEW_INTERVAL_MS = 100; // ~10 fps raw RGBA preview while the UI window is visible
const PREVIEW_MAX_WIDTH = 640;
const CONSUMER_POLL_MS = 250; // how fast we notice an app opening/closing the camera
const IDLE_AFTER_MS = 5000; // no consumer + no preview for this long -> ask the phone to relax
const STALL_AFTER_MS = 2000;
// Dev diagnostics, passed by main as ?dbg= : OMNICAM_DEBUG=timing | nocopy | nopreview
const DEBUG = new Set((new URLSearchParams(location.search).get('dbg') ?? '').split(',').filter(Boolean));
if (DEBUG.size) console.warn('engine debug switches:', [...DEBUG].join(','));

// State -----------------------------------------------------------------------
let pc: RTCPeerConnection | null = null;
let control: RTCDataChannel | null = null;
let sessionId = '';
let engineSettings: EngineSettings | null = null;
let vcam: VcamAddon | null = null;
let vcamStarted = false;
let pumpAbort: AbortController | null = null;
let previewEnabled = false;
let lastFrameAt = 0;
let loggedFormat = false;
let copyMs = 0;
let copyN = 0;
if (DEBUG.has('timing')) {
  setInterval(() => {
    const v = vcamStats() as VirtualCamStats & { convertUs?: number; convertN?: number };
    log(`state=${stats.state} fps=${stats.fps} kbps=${stats.bitrateKbps} idle=${phoneIdle} consumers=${consumersActive} preview=${previewEnabled} | timing: copyTo avg ${(copyN ? copyMs / copyN : 0).toFixed(2)} ms over ${copyN} frames; native convert avg ${((v.convertUs ?? 0) / Math.max(1, v.convertN ?? 0) / 1000).toFixed(2)} ms`);
    copyMs = 0;
    copyN = 0;
  }, 5000);
}
let consumersActive = false;
let lastDemandAt = performance.now(); // last time anything needed full-quality frames
let phoneIdle = false;

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

function vcamStats(): VirtualCamStats {
  return vcam && vcamStarted
    ? vcam.getStats()
    : { running: false, width: 0, height: 0, fps: 0, framesSent: 0, framesRepeated: 0, framesDropped: 0, consumers: 0 };
}

// Virtual camera lifecycle ------------------------------------------------------
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
      setPlaceholderFrame();
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
    vcam.setTransform({ mirror: next.mirror, rotation: next.rotation, fill: next.scaleMode === 'fill' });
    vcam.setPreview(previewEnabled, PREVIEW_MAX_WIDTH, PREVIEW_INTERVAL_MS);
  }
  ipcRenderer.send(ENGINE_VCAM_STATS, vcamStats());
}

function setPlaceholderFrame() {
  if (!vcam || !vcamStarted || !engineSettings) return;
  const { outputWidth: w, outputHeight: h } = engineSettings;
  vcam.setPlaceholder(renderPlaceholder(w, h, ['OmniCam', 'Scan the QR code in the OmniCam app on this computer']), w, h);
}
// Re-render once the bundled font is available (first render may fall back to a system font).
void document.fonts.ready.then(() => setPlaceholderFrame());

// Consumer awareness: nothing is converted or copied while no app reads the camera. ----------
setInterval(() => {
  const active = vcamStats().consumers > 0;
  if (active !== consumersActive) {
    consumersActive = active;
    log(active ? 'camera opened by an app' : 'camera closed by all apps');
  }
  if (active || previewEnabled) lastDemandAt = performance.now();
  const idle = performance.now() - lastDemandAt > IDLE_AFTER_MS;
  if (idle !== phoneIdle) {
    phoneIdle = idle;
    sendControl({ type: 'setIdle', idle });
  }
}, CONSUMER_POLL_MS);

// Frame pump: decoded VideoFrames -> preview snapshot + native double buffer ------------------
// Preview: the native pipeline hands back a downscaled RGBA snapshot of what the virtual camera
// outputs; it goes to the UI as raw pixels. (JPEG via canvas, <img> blob URLs and ImageBitmaps were
// all measured to leak GPU-process memory in Chromium; raw putImageData does not.)
function snapshotPreview() {
  if (!vcam || !vcamStarted) return;
  const p = vcam.takePreview();
  if (!p) return;
  ipcRenderer.send(ENGINE_PREVIEW_FRAME, { width: p.width, height: p.height, rgba: p.data });
}

async function runPump(t: MediaStreamTrack, abort: AbortSignal) {
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    warn('MediaStreamTrackProcessor unavailable; virtual camera gets no frames');
    return;
  }
  // maxBufferSize 1: if we ever fall behind, drop stale frames instead of queueing latency.
  const processor = new MediaStreamTrackProcessor({ track: t, maxBufferSize: 1 });
  const reader = processor.readable.getReader();
  let buffer = new Uint8Array(0);
  abort.addEventListener('abort', () => void reader.cancel().catch(() => undefined));

  try {
    while (!abort.aborted) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;
      try {
        lastFrameAt = performance.now();
        // Skip the GPU readback + conversion entirely while nothing needs frames.
        if (vcam && vcamStarted && (consumersActive || previewEnabled) && frame.format && !DEBUG.has('nocopy')) {
          const rect = frame.visibleRect ?? undefined;
          const size = frame.allocationSize({ rect });
          if (buffer.byteLength < size) buffer = new Uint8Array(size);
          const t0 = performance.now();
          const layout = await frame.copyTo(buffer, { rect });
          copyMs += performance.now() - t0;
          copyN++;
          if (!loggedFormat) {
            loggedFormat = true;
            log(`frame format ${frame.format} ${frame.codedWidth}x${frame.codedHeight} copyTo ${(performance.now() - t0).toFixed(1)} ms, planes ${layout.length}`);
          }
          const cs = frame.colorSpace;
          vcam.pushFrame(buffer.subarray(0, size), {
            format: frame.format as FrameFormat,
            width: rect?.width ?? frame.codedWidth,
            height: rect?.height ?? frame.codedHeight,
            layout: layout.map((l: PlaneLayout) => ({ offset: l.offset, stride: l.stride })),
            matrix: cs?.matrix === 'bt709' ? 'bt709' : 'bt601',
            fullRange: cs?.fullRange === true,
          });
          if (previewEnabled && !DEBUG.has('nopreview')) snapshotPreview();
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

// Peer connection -------------------------------------------------------------
function teardownPeer() {
  stopPump();
  control?.close();
  control = null;
  if (pc) {
    pc.onconnectionstatechange = null;
    pc.ontrack = null;
    pc.ondatachannel = null;
    pc.close();
    pc = null;
  }
  if (vcam && vcamStarted && !engineSettings?.holdLastFrame) vcam.showPlaceholder();
}

function preferReceiveCodecs(peer: RTCPeerConnection) {
  const caps = RTCRtpReceiver.getCapabilities?.('video');
  if (!caps) return;
  const rank = (c: RTCRtpCodec) => {
    const m = c.mimeType.toLowerCase();
    const fmtp = c.sdpFmtpLine ?? '';
    // H.264 High profile first (better quality per bit), then constrained baseline, then VP9/VP8.
    if (m === 'video/h264') return /profile-level-id=64/i.test(fmtp) ? 0 : 1;
    if (m === 'video/vp9') return 2;
    if (m === 'video/vp8') return 3;
    if (m === 'video/av1') return 4;
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
  stats.device = offer.device;
  stats.trackInfo = undefined;
  stats.caps = undefined;
  setState('connecting');

  const peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
  pc = peer;
  sessionId = crypto.randomUUID();
  phoneIdle = false;
  lastDemandAt = performance.now();

  peer.ontrack = (ev) => {
    if (ev.track.kind !== 'video') return;
    log('video track received', ev.track.id);
    // LAN: do not spend a jitter buffer's worth of latency. Chromium honors this receiver hint.
    try {
      (ev.receiver as RTCRtpReceiver & { jitterBufferTarget?: number }).jitterBufferTarget = 0;
    } catch {
      /* not supported */
    }
    // Closing the peer (Disconnect, or a new phone taking over) ends this track too: only the
    // current peer's track may change the state, or Disconnect lands on "Reconnecting".
    ev.track.onmute = () => pc === peer && setState('stalled');
    ev.track.onunmute = () => pc === peer && setState('connected');
    ev.track.onended = () => pc === peer && setState('disconnected');
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
    log('peer connection', peer.connectionState);
    switch (peer.connectionState) {
      case 'connected':
        setState('connected');
        break;
      case 'disconnected':
      case 'failed':
      case 'closed':
        setState('disconnected');
        if (vcam && vcamStarted && !engineSettings?.holdLastFrame) vcam.showPlaceholder();
        break;
    }
  };

  await peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
  preferReceiveCodecs(peer);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription({ type: 'answer', sdp: tuneAnswerSdp(answer.sdp!) });
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

// Stats (1 Hz) + stall detection -----------------------------------------------------
let lastBytes = 0;
let lastStatsAt = 0;
let loggedDecoder = '';

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
    const dec = inbound as { decoderImplementation?: string; powerEfficientDecoder?: boolean };
    if (dec.decoderImplementation && dec.decoderImplementation !== loggedDecoder) {
      loggedDecoder = dec.decoderImplementation;
      log(`decoder: ${dec.decoderImplementation} (power efficient: ${dec.powerEfficientDecoder ?? 'unknown'})`);
    }
  }
  if (rtt !== undefined) stats.rttMs = Math.round(rtt * 1000);
  lastStatsAt = now;

  if (pc.connectionState === 'connected') {
    stats.state = now - lastFrameAt > STALL_AFTER_MS ? 'stalled' : 'connected';
  }
  publishStats();
  ipcRenderer.send(ENGINE_VCAM_STATS, vcamStats());
}

setInterval(() => void pollStats(), 1000);
setInterval(() => sendControl({ type: 'ping', t: performance.now() }), 5000);

// IPC wiring -------------------------------------------------------------------------
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
ipcRenderer.on(ENGINE_DISCONNECT, () => {
  teardownPeer();
  setState('idle');
});
ipcRenderer.on(ENGINE_PREVIEW, (_e, enabled: boolean) => {
  previewEnabled = enabled;
  if (enabled) lastDemandAt = performance.now();
  if (vcam && vcamStarted) vcam.setPreview(enabled, PREVIEW_MAX_WIDTH, PREVIEW_INTERVAL_MS);
});
ipcRenderer.on(ENGINE_SHUTDOWN, () => {
  teardownPeer();
  if (vcam && vcamStarted) vcam.stop();
  vcamStarted = false;
});

ipcRenderer.send(ENGINE_READY);
log('engine ready');
