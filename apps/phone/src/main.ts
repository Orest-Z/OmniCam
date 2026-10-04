import {
  CONTROL_CHANNEL_LABEL,
  RESOLUTION_PRESETS,
  type DesktopToPhone,
  type PhoneToDesktop,
} from '@omnicam/protocol';
import { CameraController } from './camera';
import { installFonts } from './fonts';

installFonts();
import { exchangeSdp, waitForIceComplete, describeDevice, SignalingError } from './signaling';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  preview: $<HTMLVideoElement>('preview'),
  overlay: $<HTMLDivElement>('overlay'),
  overlayMsg: $<HTMLParagraphElement>('overlay-msg'),
  start: $<HTMLButtonElement>('start'),
  hud: $<HTMLDivElement>('hud'),
  status: $<HTMLSpanElement>('status'),
  statusText: $<HTMLSpanElement>('status-text'),
  livebar: $<HTMLDivElement>('livebar'),
  trackinfo: $<HTMLSpanElement>('trackinfo'),
  flip: $<HTMLButtonElement>('flip'),
  stop: $<HTMLButtonElement>('stop'),
  torch: $<HTMLButtonElement>('torch'),
  res: $<HTMLSelectElement>('res'),
};

const token = new URLSearchParams(location.search).get('t') ?? '';
const camera = new CameraController();
const device = describeDevice();

type UiState = 'idle' | 'starting' | 'connecting' | 'live' | 'reconnecting' | 'error';
const STATUS_LABEL: Record<UiState, string> = {
  idle: 'idle',
  starting: 'Starting camera…',
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  error: 'error',
};
const STATUS_CLASS: Partial<Record<UiState, string>> = { live: 'live', reconnecting: 'warn', error: 'bad' };

let pc: RTCPeerConnection | null = null;
let control: RTCDataChannel | null = null;
let sender: RTCRtpSender | null = null;
let wantConnected = false;
let reconnectAttempt = 0;
let reconnectTimer: number | undefined;
let wakeLock: WakeLockSentinel | null = null;
let torchOn = false;

function setStatus(state: UiState, text?: string) {
  els.statusText.textContent = text ?? STATUS_LABEL[state];
  els.status.className = 'pill ' + (STATUS_CLASS[state] ?? '');
  els.livebar.classList.toggle('on', state === 'live');
}

function showOverlay(msg = '', isError = false) {
  els.overlay.hidden = false;
  els.hud.hidden = true;
  els.overlayMsg.textContent = msg;
  els.overlayMsg.className = 'msg' + (isError ? ' error' : '');
}

function showHud() {
  els.overlay.hidden = true;
  els.hud.hidden = false;
}

function refreshTrackInfo() {
  const info = camera.trackInfo();
  if (!info) return;
  els.trackinfo.textContent = `${info.width}×${info.height} @ ${Math.round(info.frameRate)}`;
  els.preview.classList.toggle('mirror', info.facing === 'user');
  els.torch.hidden = !camera.capabilities().torch;
  send({ type: 'trackInfo', info });
  send({ type: 'capabilities', caps: camera.capabilities() });
}

// ---------------------------------------------------------------------------
// Control channel
// ---------------------------------------------------------------------------
function send(msg: PhoneToDesktop) {
  if (control?.readyState === 'open') control.send(JSON.stringify(msg));
}

async function handleControl(msg: DesktopToPhone) {
  switch (msg.type) {
    case 'switchCamera':
      await (msg.facing ? camera.setFacing(msg.facing) : camera.flip());
      break;
    case 'setResolution': {
      const preset = RESOLUTION_PRESETS[msg.preset];
      if (preset) {
        els.res.value = msg.preset;
        await camera.setResolution(preset);
        refreshTrackInfo();
        if (sender) void tuneSender(sender);
      }
      break;
    }
    case 'setTorch':
      torchOn = (await camera.setTorch(msg.on)) && msg.on;
      els.torch.classList.toggle('on', torchOn);
      break;
    case 'setMirror':
      // Mirroring is applied on the desktop side; nothing to do on the phone.
      break;
    case 'setIdle':
      idleMode = msg.idle;
      if (sender) void tuneSender(sender);
      break;
    case 'ping':
      send({ type: 'pong', t: msg.t });
      break;
  }
}

// ---------------------------------------------------------------------------
// WebRTC session
// ---------------------------------------------------------------------------
function preferCodecs(transceiver: RTCRtpTransceiver) {
  if (!('setCodecPreferences' in transceiver) || !RTCRtpSender.getCapabilities) return;
  const codecs = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
  const rank = (c: RTCRtpCodec) => {
    const m = c.mimeType.toLowerCase();
    // H.264 is hardware-encoded on every phone. High profile (64xxxx) gives better quality per bit
    // than constrained baseline (42e0xx); packetization-mode=1 avoids fragment-size limits.
    if (m === 'video/h264') {
      const f = c.sdpFmtpLine ?? '';
      const high = /profile-level-id=64/i.test(f);
      // High profile only where the encoder is known to be hardware (iOS/iPadOS Safari); Chrome's
      // software OpenH264 fallback advertises High but stalls on it after a few seconds.
      const preferHigh = new URLSearchParams(location.search).get('h264') === 'high' || /iPhone|iPad|Macintosh/.test(navigator.userAgent);
      return (high ? (preferHigh ? 0 : 2) : preferHigh ? 2 : 0) + (/packetization-mode=1/.test(f) ? 0 : 1);
    }
    if (m === 'video/vp9') return 4;
    if (m === 'video/vp8') return 5;
    if (m === 'video/av1') return 6;
    return 9; // rtx / red / ulpfec stay last
  };
  try {
    transceiver.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b)));
  } catch {
    /* not supported on this browser */
  }
}

let idleMode = false;

/** Bitrate budget for the current capture size: enough for near-lossless motion on a LAN. */
function bitrateFor(width: number, height: number, fps: number): number {
  const px = width * height;
  const base = px >= 3840 * 2160 ? 35_000_000 : px >= 1920 * 1080 ? 12_000_000 : px >= 1280 * 720 ? 6_000_000 : 3_000_000;
  return fps > 40 ? Math.round(base * 1.5) : base;
}

async function tuneSender(s: RTCRtpSender) {
  try {
    const params = s.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    const info = camera.trackInfo();
    const enc = params.encodings[0];
    enc.maxBitrate = bitrateFor(info?.width ?? 1920, info?.height ?? 1080, info?.frameRate ?? 30);
    // Idle: nothing on the desktop is consuming frames — trickle at 5 fps to save battery/heat,
    // keep the resolution so the first frame is sharp when an app opens the camera.
    enc.maxFramerate = idleMode ? 5 : 60;
    (enc as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = 'high';
    (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
      'maintain-resolution';
    await s.setParameters(params);
  } catch {
    /* Safari rejects some fields; defaults are fine */
  }
}

/**
 * Replaces the requested size/fps on screen with what is actually being sent: browsers report the
 * constraints they accepted, and a phone asked for 60 fps may still deliver 30.
 */
async function showMeasuredRate() {
  if (!sender || !wantConnected) return;
  const stats = await sender.getStats().catch(() => null);
  stats?.forEach((r) => {
    if (r.type !== 'outbound-rtp' || r.kind !== 'video' || !r.frameWidth) return;
    const fps = Math.round(r.framesPerSecond ?? 0);
    // Short of the preset's rate: show what the camera itself runs at and allows, so it's clear
    // whether the camera or the encoder is holding it back.
    let why = '';
    if (camera.track && fps < camera.wantedFrameRate - 5) {
      const max = (camera.track.getCapabilities?.() as MediaTrackCapabilities | undefined)?.frameRate?.max;
      why = ` (camera ${Math.round(camera.track.getSettings().frameRate ?? 0)}${max ? `, max ${Math.round(max)}` : ''}${camera.fpsNote ? ',' + camera.fpsNote : ''})`;
    }
    els.trackinfo.textContent = idleMode
      ? `${r.frameWidth}×${r.frameHeight} · standby`
      : `${r.frameWidth}×${r.frameHeight} · ${fps} fps${why}`;
  });
}
setInterval(() => void showMeasuredRate(), 2000);

async function connect() {
  teardownPeer();
  const track = camera.track;
  if (!track) throw new Error('camera not started');
  setStatus(reconnectAttempt ? 'reconnecting' : 'connecting');

  const peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
  pc = peer;

  const transceiver = peer.addTransceiver(track, { direction: 'sendonly' });
  sender = transceiver.sender;
  preferCodecs(transceiver);

  const ch = peer.createDataChannel(CONTROL_CHANNEL_LABEL, { ordered: true });
  control = ch;
  ch.onopen = async () => {
    send({ type: 'hello', device, cameras: await camera.listCameras() });
    refreshTrackInfo();
  };
  ch.onmessage = (ev) => {
    try {
      void handleControl(JSON.parse(ev.data) as DesktopToPhone);
    } catch {
      /* ignore malformed */
    }
  };

  peer.onconnectionstatechange = () => {
    if (pc !== peer) return;
    switch (peer.connectionState) {
      case 'connected':
        reconnectAttempt = 0;
        setStatus('live');
        void tuneSender(sender!);
        break;
      case 'disconnected':
        setStatus('reconnecting', 'Connection lost…');
        scheduleReconnect(3000);
        break;
      case 'failed':
      case 'closed':
        scheduleReconnect();
        break;
    }
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await waitForIceComplete(peer);
  if (pc !== peer) return; // superseded by a newer attempt

  const answer = await exchangeSdp(token, peer.localDescription!.sdp, device);
  if (pc !== peer) return;
  await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
}

function teardownPeer() {
  control?.close();
  control = null;
  sender = null;
  if (pc) {
    pc.onconnectionstatechange = null;
    pc.close();
    pc = null;
  }
}

function scheduleReconnect(minDelay = 0) {
  if (!wantConnected || reconnectTimer !== undefined) return;
  reconnectAttempt++;
  const delay = Math.max(minDelay, Math.min(10_000, 500 * 2 ** Math.min(reconnectAttempt, 5)));
  setStatus('reconnecting');
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    void connect().catch(onConnectError);
  }, delay);
}

function onConnectError(err: unknown) {
  if (err instanceof SignalingError && err.code === 'bad-token') {
    stopSession('This QR code has expired. Scan the new one on your computer.', true);
    return;
  }
  console.warn('connect failed', err);
  // 'busy' means the desktop is negotiating with another phone or we have tried too often; waiting the
  // time it asked for recovers sooner than retrying into another refusal.
  scheduleReconnect(err instanceof SignalingError ? err.retryAfterMs : 0);
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
const NO_TOKEN_MSG = 'Open this page by scanning the QR code in OmniCam on your computer.';

async function startSession() {
  if (!token) {
    showOverlay(NO_TOKEN_MSG, true);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showOverlay('This browser cannot access the camera. Make sure the address starts with https://', true);
    return;
  }
  els.start.disabled = true;
  showOverlay('Waiting for camera permission…');
  try {
    await camera.start('user', RESOLUTION_PRESETS[els.res.value] ?? RESOLUTION_PRESETS['1080p']);
  } catch (err) {
    const name = (err as DOMException).name;
    showOverlay(
      name === 'NotAllowedError'
        ? 'Camera permission denied. Allow camera access for this site and tap Start again.'
        : `Could not start the camera (${name}).`,
      true,
    );
    els.start.disabled = false;
    return;
  }
  wantConnected = true;
  reconnectAttempt = 0;
  showHud();
  await requestWakeLock();
  refreshTrackInfo();
  void connect().catch(onConnectError);
}

function stopSession(message = 'Camera stopped.', isError = false) {
  wantConnected = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  teardownPeer();
  camera.stopTracks();
  els.preview.srcObject = null;
  void wakeLock?.release();
  wakeLock = null;
  els.start.disabled = false;
  showOverlay(message, isError);
}

async function requestWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    /* unsupported or denied — fine */
  }
}

camera.onTrackChanged = (track) => {
  if (track.readyState !== 'live') {
    // Track died (page was backgrounded). Recover once we are visible again.
    if (document.visibilityState === 'visible') void recover();
    return;
  }
  els.preview.srcObject = new MediaStream([track]);
  if (sender && sender.track !== track) void sender.replaceTrack(track).then(() => sender && tuneSender(sender));
  refreshTrackInfo();
};

async function recover() {
  if (!wantConnected) return;
  try {
    await camera.recoverIfEnded();
  } catch (err) {
    console.warn('camera recovery failed', err);
  }
  if (pc && pc.connectionState !== 'connected') scheduleReconnect();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void requestWakeLock();
    void recover();
  }
});

// ---------------------------------------------------------------------------
// UI events
// ---------------------------------------------------------------------------
els.start.addEventListener('click', () => void startSession());
els.stop.addEventListener('click', () => stopSession());
els.flip.addEventListener('click', async () => {
  els.flip.disabled = true;
  try {
    await camera.flip();
  } catch (err) {
    console.warn(err);
  }
  els.flip.disabled = false;
});
els.torch.addEventListener('click', async () => {
  torchOn = (await camera.setTorch(!torchOn)) && !torchOn;
  els.torch.classList.toggle('on', torchOn);
});
els.res.addEventListener('change', () => {
  const preset = RESOLUTION_PRESETS[els.res.value];
  if (preset) {
    void camera.setResolution(preset).then(() => {
      refreshTrackInfo();
      if (sender) void tuneSender(sender);
    });
  }
});
window.addEventListener('beforeunload', () => teardownPeer());

showOverlay(token ? '' : NO_TOKEN_MSG, !token);
// `auto=1` skips the Start button (automated tests, reconnect deep links). Browsers may still
// require a gesture for some features (wake lock), which is why the button is the default.
if (token && new URLSearchParams(location.search).get('auto') === '1') void startSession();
