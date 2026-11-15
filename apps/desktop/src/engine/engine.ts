import type { IpcRenderer } from 'electron';
import { CONTROL_CHANNEL_LABEL, MAX_CAMERAS, type DesktopToPhone, type PhoneToDesktop } from '@omnicam/protocol';
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
  ENGINE_VCAM_ERROR,
  ENGINE_VCAM_STATS,
  NEUTRAL_PICTURE,
  type ConnectionState,
  type EngineAnswer,
  type EngineOffer,
  type EngineSettings,
  type StreamStats,
  type VirtualCamStats,
} from '../shared/ipc';
import { loadVcam, renderPlaceholder, type FrameFormat, type VcamAddon, type VcamModule } from './vcam';
import { installFonts } from '../shared/fonts';
import { tuneAnswerSdp } from './sdp';
import { MicOutput } from './mic';
import { LinkReceiver } from './link';

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
// Linux: the device keeps its size while an app reads it. Try a new size again this often until it lets go.
const BUSY_RETRY_MS = 3000;
const LINK_LOG_EVERY_S = 30;
const LINK_PHONE_STATS_EVERY = 6; // the phone reports every 5 s; this keeps its line to one every 30 s too
const LINK_ACK_EVERY_FRAMES = 15;
// Dev diagnostics, passed by main as ?dbg= : OMNICAM_DEBUG=timing | nocopy | nopreview
const DEBUG = new Set((new URLSearchParams(location.search).get('dbg') ?? '').split(',').filter(Boolean));
if (DEBUG.size) console.warn('engine debug switches:', [...DEBUG].join(','));

// Shared by every camera ----------------------------------------------------------
let engineSettings: EngineSettings | null = null;
let vcamModule: VcamModule | null = null;
/**
 * The window shows a live preview: someone is setting the cameras up, so no phone goes to standby, whichever
 * tab is up. Only that tab's camera is converted for the preview; the others just keep their phones at full rate.
 */
let watching = false;
/** One virtual cable, so one microphone: camera 1's phone. */
const micOut = new MicOutput(log);

const STOPPED: VirtualCamStats = { running: false, width: 0, height: 0, fps: 0, framesSent: 0, framesRepeated: 0, framesDropped: 0, consumers: 0 };

/**
 * One virtual camera and the phone that feeds it: the peer connection (or media link), the frame pump
 * and the native pipeline. Cameras share nothing but the settings and the microphone output, so one
 * phone coming or going never touches another.
 */
class Camera {
  private readonly index: number;
  /** "OmniCam", "OmniCam 2"…: what apps list, and what the placeholder says. */
  private readonly name: string;
  private readonly tag: string;

  private pc: RTCPeerConnection | null = null;
  private control: RTCDataChannel | null = null;
  private sessionId = '';
  private vcam: VcamAddon | null = null;
  private vcamStarted = false;
  private busyRetry: ReturnType<typeof setTimeout> | undefined;
  private lastStartError = '';
  private pumpAbort: AbortController | null = null;
  private previewEnabled = false;
  private lastFrameAt = 0;
  private lastAudioAt = 0;
  private lastAudio = { energy: 0, duration: 0, packets: 0 }; // inbound audio counters at the previous stats poll
  /** The phone's audio track; it reaches the loopback device only while the phone says its microphone is on. */
  private micTrack: MediaStreamTrack | null = null;
  private loggedFormat = false;
  private copyMs = 0;
  private copyN = 0;
  private consumersActive = false;
  private lastDemandAt = performance.now(); // last time anything needed full-quality frames
  private phoneIdle = false;
  private frameBuffer = new Uint8Array(0);
  private lastBytes = 0;
  private lastStatsAt = 0;
  private loggedDecoder = '';
  // Media link: video and audio over the page's own connection, when WebRTC can't reach the desktop
  private link: LinkReceiver | null = null;
  private linkDelivering = false;
  private linkPolls = 0;
  private linkStatsSeen = 0;

  private readonly stats: StreamStats = {
    state: 'idle', width: 0, height: 0, fps: 0, bitrateKbps: 0, rttMs: 0, codec: '',
    packetsLost: 0, jitterMs: 0, framesDecoded: 0,
  };

  // Plain fields, not parameter properties, like the rest of the codebase.
  constructor(index: number) {
    this.index = index;
    this.name = index === 0 ? 'OmniCam' : `OmniCam ${index + 1}`;
    this.tag = index === 0 ? '' : `[camera ${index + 1}]`;
    if (DEBUG.has('timing')) this.logTiming();
  }

  // Camera 1's lines read as they always did; the others say which camera they are about.
  private log(...a: unknown[]) {
    if (this.tag) log(this.tag, ...a);
    else log(...a);
  }

  private warn(...a: unknown[]) {
    if (this.tag) warn(this.tag, ...a);
    else warn(...a);
  }

  private send(channel: string, ...args: unknown[]) {
    ipcRenderer.send(channel, this.index, ...args);
  }

  private logTiming() {
    // The native counters are totals since start: report each interval on its own, so a change shows.
    let lastUs = 0;
    let lastN = 0;
    setInterval(() => {
      if (!this.vcamStarted) return;
      const v = this.vcamStats() as VirtualCamStats & { convertUs?: number; convertN?: number };
      if ((v.convertN ?? 0) < lastN) lastUs = lastN = 0; // the camera restarted: its counters did too
      const us = (v.convertUs ?? 0) - lastUs;
      const n = (v.convertN ?? 0) - lastN;
      lastUs = v.convertUs ?? 0;
      lastN = v.convertN ?? 0;
      const p = engineSettings?.picture;
      const { stats } = this;
      this.log(`state=${stats.state} fps=${stats.fps} kbps=${stats.bitrateKbps} idle=${this.phoneIdle} consumers=${this.consumersActive} preview=${this.previewEnabled} | timing: copyTo avg ${(this.copyN ? this.copyMs / this.copyN : 0).toFixed(2)} ms over ${this.copyN} frames; native convert avg ${(us / Math.max(1, n) / 1000).toFixed(2)} ms over ${n}; sent ${v.framesSent} repeated ${v.framesRepeated} dropped ${v.framesDropped} | picture ${p ? `${p.brightness},${p.contrast},${p.saturation},${p.warmth}` : '-'}`);
      this.copyMs = 0;
      this.copyN = 0;
    }, 5000);
  }

  /** The phone's camera is on, or the phone hasn't said yet (until then, video is what counts). */
  private cameraOn() {
    return this.stats.sources?.camera !== false;
  }

  private setState(state: ConnectionState) {
    if (this.stats.state === state) return;
    this.stats.state = state;
    this.publishStats();
  }

  private publishStats() {
    this.send(ENGINE_STATS, { ...this.stats });
  }

  private vcamStats(): VirtualCamStats {
    return this.vcam && this.vcamStarted ? this.vcam.getStats() : STOPPED;
  }

  // Virtual camera lifecycle ------------------------------------------------------
  /** `prev`: the settings before this change, or null to start the camera whatever they were. */
  applySettings(next: EngineSettings, prev: EngineSettings | null) {
    if (!vcamModule) return;
    if (this.index >= next.cameras) return this.stop();
    this.vcam ??= vcamModule.camera(this.index);
    const { vcam } = this;

    const formatChanged =
      !prev || prev.outputWidth !== next.outputWidth || prev.outputHeight !== next.outputHeight || prev.outputFps !== next.outputFps;

    // A camera that failed to start gets another try with any settings: after the Linux setup, or once the
    // app that held the device has closed.
    if (formatChanged || !this.vcamStarted) {
      clearTimeout(this.busyRetry);
      try {
        if (this.vcamStarted) vcam.stop();
        vcam.start({ width: next.outputWidth, height: next.outputHeight, fps: next.outputFps, nativeDir: next.nativeDir });
        this.vcamStarted = true;
        this.lastStartError = '';
        this.setPlaceholderFrame();
        if (this.stats.state !== 'connected') vcam.showPlaceholder();
        this.send(ENGINE_VCAM_ERROR, null);
      } catch (err) {
        this.vcamStarted = false;
        const message = `virtual camera failed to start: ${(err as Error).message}`;
        // Retries repeat the same failure: log it once.
        if (message !== this.lastStartError) {
          this.lastStartError = message;
          this.send(ENGINE_VCAM_ERROR, message);
          this.warn(message);
        }
        if (process.platform === 'linux' && (err as Error).message.startsWith('busy:')) {
          this.busyRetry = setTimeout(() => engineSettings && this.applySettings(engineSettings, engineSettings), BUSY_RETRY_MS);
        }
      }
    }
    if (this.vcamStarted) {
      vcam.setHoldLastFrame(next.holdLastFrame);
      vcam.setTransform({ mirror: next.mirror, rotation: next.rotations[this.index] ?? 0, fill: next.scaleMode === 'fill', ...NEUTRAL_PICTURE, ...next.picture });
      vcam.setPreview(this.previewEnabled, PREVIEW_MAX_WIDTH, PREVIEW_INTERVAL_MS);
    }
    this.send(ENGINE_VCAM_STATS, this.vcamStats());
  }

  /**
   * Closes the device and drops the phone. `tellPhone`: Extra cameras was switched off, so the phone
   * should stop instead of trying to come back; at shutdown it is left to reconnect to the next launch.
   */
  stop(tellPhone = true) {
    clearTimeout(this.busyRetry);
    if (tellPhone && (this.pc || this.link)) {
      this.sendControl({ type: 'disconnect' });
      if (this.link) this.send(ENGINE_LINK_SEND, null);
    }
    this.teardownPeer();
    this.setState('idle');
    if (this.vcam && this.vcamStarted) {
      this.vcam.stop();
      this.send(ENGINE_VCAM_STATS, STOPPED);
    }
    this.vcamStarted = false;
  }

  setPlaceholderFrame() {
    if (!this.vcam || !this.vcamStarted || !engineSettings) return;
    const { outputWidth: w, outputHeight: h } = engineSettings;
    const scan = this.index === 0 ? 'Scan the QR code in the OmniCam app on this computer' : `Scan the QR code of camera ${this.index + 1} in the OmniCam app on this computer`;
    const hint = this.cameraOn() ? scan : 'The camera is off on the phone';
    this.vcam.setPlaceholder(renderPlaceholder(w, h, [this.name, hint]), w, h);
  }

  // Consumer awareness: nothing is converted or copied while no app reads the camera. ----------
  pollConsumers() {
    const active = this.vcamStats().consumers > 0;
    if (active !== this.consumersActive) {
      this.consumersActive = active;
      this.log(active ? 'camera opened by an app' : 'camera closed by all apps');
    }
    if (active || watching) this.lastDemandAt = performance.now();
    const idle = performance.now() - this.lastDemandAt > IDLE_AFTER_MS;
    if (idle !== this.phoneIdle) {
      this.phoneIdle = idle;
      this.sendControl({ type: 'setIdle', idle });
    }
  }

  setPreview(enabled: boolean) {
    this.previewEnabled = enabled;
    if (enabled) this.lastDemandAt = performance.now();
    if (this.vcam && this.vcamStarted) this.vcam.setPreview(enabled, PREVIEW_MAX_WIDTH, PREVIEW_INTERVAL_MS);
  }

  // Frame pump: decoded VideoFrames -> preview snapshot + native double buffer ------------------
  // Preview: the native pipeline hands back a downscaled RGBA snapshot of what the virtual camera
  // outputs; it goes to the UI as raw pixels. (JPEG via canvas, <img> blob URLs and ImageBitmaps were
  // all measured to leak GPU-process memory in Chromium; raw putImageData does not.)
  private snapshotPreview() {
    if (!this.vcam || !this.vcamStarted) return;
    const p = this.vcam.takePreview();
    if (!p) return;
    this.send(ENGINE_PREVIEW_FRAME, { width: p.width, height: p.height, rgba: p.data });
  }

  /** Hands one frame to the virtual camera and the preview. Awaits one at a time: the buffer is shared. */
  private async deliverFrame(frame: VideoFrame) {
    this.lastFrameAt = performance.now();
    // Skip the GPU readback + conversion entirely while nothing needs frames.
    if (this.vcam && this.vcamStarted && (this.consumersActive || this.previewEnabled) && frame.format && !DEBUG.has('nocopy')) {
      const rect = frame.visibleRect ?? undefined;
      const size = frame.allocationSize({ rect });
      if (this.frameBuffer.byteLength < size) this.frameBuffer = new Uint8Array(size);
      const t0 = performance.now();
      const layout = await frame.copyTo(this.frameBuffer, { rect });
      this.copyMs += performance.now() - t0;
      this.copyN++;
      if (!this.loggedFormat) {
        this.loggedFormat = true;
        this.log(`frame format ${frame.format} ${frame.codedWidth}x${frame.codedHeight} copyTo ${(performance.now() - t0).toFixed(1)} ms, planes ${layout.length}`);
      }
      const cs = frame.colorSpace;
      // The await above let other things run: the camera may have been stopped meanwhile.
      if (!this.vcamStarted) return;
      this.vcam.pushFrame(this.frameBuffer.subarray(0, size), {
        format: frame.format as FrameFormat,
        width: rect?.width ?? frame.codedWidth,
        height: rect?.height ?? frame.codedHeight,
        layout: layout.map((l: PlaneLayout) => ({ offset: l.offset, stride: l.stride })),
        matrix: cs?.matrix === 'bt709' ? 'bt709' : 'bt601',
        fullRange: cs?.fullRange === true,
      });
      if (this.previewEnabled && !DEBUG.has('nopreview')) this.snapshotPreview();
    }
  }

  private async runPump(t: MediaStreamTrack, abort: AbortSignal) {
    if (typeof MediaStreamTrackProcessor === 'undefined') {
      this.warn('MediaStreamTrackProcessor unavailable; virtual camera gets no frames');
      return;
    }
    // maxBufferSize 1: if we ever fall behind, drop stale frames instead of queueing latency.
    const processor = new MediaStreamTrackProcessor({ track: t, maxBufferSize: 1 });
    const reader = processor.readable.getReader();
    abort.addEventListener('abort', () => void reader.cancel().catch(() => undefined));

    try {
      while (!abort.aborted) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        try {
          await this.deliverFrame(frame);
        } finally {
          frame.close();
        }
      }
    } catch (err) {
      if (!abort.aborted) this.warn('frame pump ended', (err as Error).message);
    }
  }

  private startPump(t: MediaStreamTrack) {
    this.stopPump();
    this.pumpAbort = new AbortController();
    void this.runPump(t, this.pumpAbort.signal);
  }

  private stopPump() {
    this.pumpAbort?.abort();
    this.pumpAbort = null;
  }

  /** Only camera 1's phone has a microphone here: one virtual cable takes one phone. */
  private playMic() {
    if (this.index === 0) micOut.setTrack(this.stats.sources?.mic ? this.micTrack : null);
  }

  // Peer connection -------------------------------------------------------------
  /** `closeAfterMs` lets a last control message reach the phone before the connection goes. */
  private teardownPeer(closeAfterMs = 0) {
    this.stopPump();
    this.link?.close();
    this.link = null;
    const channel = this.control;
    const peer = this.pc;
    this.control = null;
    this.pc = null;
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.ontrack = null;
      peer.ondatachannel = null;
    }
    const close = () => {
      channel?.close();
      peer?.close();
    };
    if (closeAfterMs) setTimeout(close, closeAfterMs);
    else close();
    this.micTrack = null;
    this.stats.micLevel = 0;
    const cameraWasOff = !this.cameraOn();
    this.stats.sources = undefined;
    this.playMic();
    if (cameraWasOff) this.setPlaceholderFrame(); // back to "scan the QR code"
    if (this.vcam && this.vcamStarted && !engineSettings?.holdLastFrame) this.vcam.showPlaceholder();
  }

  async handleOffer(offer: EngineOffer): Promise<EngineAnswer> {
    if (!engineSettings || this.index >= engineSettings.cameras) return { id: offer.id, error: 'this camera is off' };
    if (this.link) this.send(ENGINE_LINK_SEND, null); // a phone on WebRTC replaces the one on the link
    this.teardownPeer();
    const { stats } = this;
    stats.device = offer.device;
    stats.transport = 'webrtc';
    stats.trackInfo = undefined;
    stats.caps = undefined;
    this.setState('connecting');

    const peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    this.pc = peer;
    this.sessionId = crypto.randomUUID();
    this.phoneIdle = false;
    this.lastDemandAt = performance.now();
    // Give the new connection the stall timeout to deliver its first frame or audio packet.
    this.lastFrameAt = this.lastAudioAt = performance.now();
    this.lastAudio = { energy: 0, duration: 0, packets: 0 };
    this.lastBytes = 0;

    peer.ontrack = (ev) => {
      if (ev.track.kind === 'audio') {
        // The phone always negotiates audio; it plays only once the phone says its microphone is on.
        this.micTrack = ev.track;
        this.playMic();
        return;
      }
      if (ev.track.kind !== 'video') return;
      this.log('video track received', ev.track.id);
      // LAN: do not spend a jitter buffer's worth of latency. Chromium honors this receiver hint.
      try {
        (ev.receiver as RTCRtpReceiver & { jitterBufferTarget?: number }).jitterBufferTarget = 0;
      } catch {
        /* not supported */
      }
      // Closing the peer (Disconnect, or a new phone taking over) ends this track too: only the
      // current peer's track may change the state, or Disconnect lands on "Reconnecting".
      // With the camera off the video track is muted on purpose; that is not a stall.
      ev.track.onmute = () => this.pc === peer && this.cameraOn() && this.setState('stalled');
      ev.track.onunmute = () => this.pc === peer && this.setState('connected');
      ev.track.onended = () => this.pc === peer && this.setState('disconnected');
      this.startPump(ev.track);
    };
    peer.ondatachannel = (ev) => {
      if (ev.channel.label !== CONTROL_CHANNEL_LABEL) return;
      this.control = ev.channel;
      this.control.onmessage = (m) => {
        try {
          this.onPhoneMessage(JSON.parse(m.data) as PhoneToDesktop);
        } catch {
          /* ignore */
        }
      };
    };
    peer.onconnectionstatechange = () => {
      if (this.pc !== peer) return;
      this.log('peer connection', peer.connectionState);
      switch (peer.connectionState) {
        case 'connected':
          this.setState('connected');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          this.setState('disconnected');
          if (this.vcam && this.vcamStarted && !engineSettings?.holdLastFrame) this.vcam.showPlaceholder();
          break;
      }
    };

    await peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    preferReceiveCodecs(peer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription({ type: 'answer', sdp: tuneAnswerSdp(answer.sdp!) });
    await waitForIceComplete(peer);
    if (this.pc !== peer) return { id: offer.id, error: 'superseded' };
    return { id: offer.id, sdp: peer.localDescription!.sdp, sessionId: this.sessionId };
  }

  /** The negotiation threw: back to waiting for a phone. */
  offerFailed() {
    this.teardownPeer();
    this.setState('idle');
  }

  onPhoneMessage(msg: PhoneToDesktop) {
    const { stats } = this;
    switch (msg.type) {
      case 'videoConfig':
        this.link?.configure(msg);
        return;
      // JSON: this is the phone's text, and a newline in it would forge a log line.
      case 'linkStats':
        if (++this.linkStatsSeen % LINK_PHONE_STATS_EVERY === 0) this.log('link phone:', JSON.stringify(msg.stats));
        return;
      case 'linkLog':
        this.log('phone:', JSON.stringify(msg.message));
        return;
      case 'hello':
        stats.device = msg.device;
        this.log('phone cameras:', JSON.stringify(msg.cameras));
        break;
      case 'trackInfo':
        stats.trackInfo = msg.info;
        break;
      case 'capabilities':
        stats.caps = msg.caps;
        // JSON: the label is the phone's text, and a newline in it would forge a log line.
        this.log(`camera ${JSON.stringify(stats.trackInfo?.label ?? '?')} zoom:`, msg.caps.zoom ? JSON.stringify(msg.caps.zoom) : 'not adjustable');
        break;
      case 'sources': {
        const cameraWasOn = this.cameraOn();
        stats.sources = msg.sources;
        this.playMic();
        // Camera switched off: apps get a placeholder that says so, never a frozen frame of whoever
        // turned it off (whatever "When the phone pauses" is set to).
        if (this.cameraOn() !== cameraWasOn) {
          this.setPlaceholderFrame();
          if (!this.cameraOn() && this.vcam && this.vcamStarted) this.vcam.showPlaceholder();
        }
        break;
      }
      case 'pong':
        stats.rttMs = Math.round(performance.now() - msg.t);
        break;
    }
    this.send(ENGINE_PHONE_MESSAGE, msg);
    this.publishStats();
  }

  sendControl(msg: DesktopToPhone) {
    if (this.link) this.send(ENGINE_LINK_SEND, JSON.stringify(msg));
    else if (this.control?.readyState === 'open') this.control.send(JSON.stringify(msg));
  }

  /** Disconnect from the window or the tray. */
  disconnect() {
    // Tell the phone first: it stops its camera and explains, instead of timing out into retries.
    this.sendControl({ type: 'disconnect' });
    if (this.link) setTimeout(() => this.send(ENGINE_LINK_SEND, null), 300);
    this.teardownPeer(300);
    this.setState('idle');
  }

  // Stats (1 Hz) + stall detection -----------------------------------------------------
  async pollStats() {
    if (this.link) return this.pollLink(this.link);
    const { pc, stats } = this;
    if (!pc) {
      if (stats.state !== 'idle' && stats.state !== 'disconnected') this.setState('idle');
      return;
    }
    const report = await pc.getStats().catch(() => null);
    if (!report || this.pc !== pc) return;
    const now = performance.now();
    let inbound: RTCInboundRtpStreamStats | undefined;
    let audio: RTCInboundRtpStreamStats | undefined;
    const codecs = new Map<string, string>();
    let rtt: number | undefined;
    report.forEach((r) => {
      if (r.type === 'inbound-rtp' && (r as RTCInboundRtpStreamStats).kind === 'video') inbound = r as RTCInboundRtpStreamStats;
      if (r.type === 'inbound-rtp' && (r as RTCInboundRtpStreamStats).kind === 'audio') audio = r as RTCInboundRtpStreamStats;
      if (r.type === 'codec') codecs.set(r.id, (r as { mimeType?: string }).mimeType ?? '');
      if (r.type === 'candidate-pair' && (r as RTCIceCandidatePairStats).state === 'succeeded' && (r as RTCIceCandidatePairStats).nominated) {
        rtt = (r as RTCIceCandidatePairStats).currentRoundTripTime;
      }
    });
    if (inbound) {
      const dt = this.lastStatsAt ? (now - this.lastStatsAt) / 1000 : 1;
      const bytes = inbound.bytesReceived ?? 0;
      stats.bitrateKbps = this.lastBytes ? Math.round(((bytes - this.lastBytes) * 8) / dt / 1000) : 0;
      this.lastBytes = bytes;
      stats.width = inbound.frameWidth ?? 0;
      stats.height = inbound.frameHeight ?? 0;
      stats.fps = Math.round(inbound.framesPerSecond ?? 0);
      stats.framesDecoded = inbound.framesDecoded ?? 0;
      stats.packetsLost = inbound.packetsLost ?? 0;
      stats.jitterMs = Math.round((inbound.jitter ?? 0) * 1000);
      stats.codec = (codecs.get(inbound.codecId ?? '') ?? '').replace('video/', '');
      const dec = inbound as { decoderImplementation?: string; powerEfficientDecoder?: boolean };
      if (dec.decoderImplementation && dec.decoderImplementation !== this.loggedDecoder) {
        this.loggedDecoder = dec.decoderImplementation;
        this.log(`decoder: ${dec.decoderImplementation} (power efficient: ${dec.powerEfficientDecoder ?? 'unknown'})`);
      }
    }
    if (audio) {
      const energy = audio.totalAudioEnergy ?? 0;
      const duration = audio.totalSamplesDuration ?? 0;
      const packets = audio.packetsReceived ?? 0;
      // Level over the last second from the energy the receiver adds up while it plays (squared 10 ms
      // peaks, after the element's volume): no audio graph, no extra timer. 0 while nothing plays it.
      const played = duration - this.lastAudio.duration;
      stats.micLevel = played > 0 ? Math.round(Math.sqrt(Math.max(0, energy - this.lastAudio.energy) / played) * 1000) / 1000 : 0;
      if (packets > this.lastAudio.packets) this.lastAudioAt = now;
      this.lastAudio = { energy, duration, packets };
    }
    if (rtt !== undefined) stats.rttMs = Math.round(rtt * 1000);
    this.lastStatsAt = now;

    if (pc.connectionState === 'connected') {
      // Paused on the phone: no frames for a while, or with the camera off, no audio.
      stats.state = now - (this.cameraOn() ? this.lastFrameAt : this.lastAudioAt) > STALL_AFTER_MS ? 'stalled' : 'connected';
    }
    this.publishStats();
    this.send(ENGINE_VCAM_STATS, this.vcamStats());
  }

  // Media link ----------------------------------------------------------------------------
  private startLink() {
    this.link = null; // the socket it belonged to is already gone
    this.teardownPeer();
    const { stats } = this;
    stats.transport = 'link';
    stats.trackInfo = undefined;
    stats.caps = undefined;
    this.sessionId = crypto.randomUUID();
    this.phoneIdle = false;
    this.lastDemandAt = this.lastFrameAt = this.lastAudioAt = this.lastStatsAt = performance.now();
    stats.framesDecoded = this.linkPolls = 0;
    stats.packetsLost = stats.jitterMs = 0;
    let decoded = 0;
    this.link = new LinkReceiver({
      onFrame: (frame) => {
        this.lastFrameAt = performance.now();
        stats.width = frame.displayWidth;
        stats.height = frame.displayHeight;
        if (++decoded % LINK_ACK_EVERY_FRAMES === 0) this.sendControl({ type: 'frameAck', t: frame.timestamp });
        // Like the pump's maxBufferSize of 1: if the copy falls behind, skip frames instead of queueing delay.
        if (this.linkDelivering) {
          frame.close();
          return false;
        }
        this.linkDelivering = true;
        void this.deliverFrame(frame)
          .catch((err: Error) => this.warn('link: deliver failed', err.message))
          .finally(() => {
            frame.close();
            this.linkDelivering = false;
          });
        return true;
      },
      onMicTrack: (track) => {
        this.micTrack = track;
        this.playMic();
      },
      requestKeyFrame: () => this.sendControl({ type: 'requestKeyFrame' }),
      log: (...a: unknown[]) => this.log(...a),
      warn: (...a: unknown[]) => this.warn(...a),
    });
    this.log('link: open');
    this.setState('connected');
  }

  private pollLink(l: LinkReceiver) {
    const { stats } = this;
    const now = performance.now();
    const c = l.takeCounts();
    const seconds = Math.max(0.001, (now - this.lastStatsAt) / 1000);
    this.lastStatsAt = now;
    stats.fps = Math.round(c.decoded / seconds);
    stats.bitrateKbps = Math.round((c.bytes * 8) / seconds / 1000);
    stats.framesDecoded += c.decoded;
    stats.micLevel = c.level;
    stats.codec = l.codec;
    if (c.audioChunks) this.lastAudioAt = now;
    // Paused on the phone: no frames for a while, or with the camera off, no audio.
    stats.state = now - (this.cameraOn() ? this.lastFrameAt : this.lastAudioAt) > STALL_AFTER_MS ? 'stalled' : 'connected';
    this.publishStats();
    this.send(ENGINE_VCAM_STATS, this.vcamStats());
    if (++this.linkPolls % LINK_LOG_EVERY_S === 0) {
      this.log(
        `link: ${stats.fps} fps ${stats.bitrateKbps} kbps ${stats.width}x${stats.height} ${l.codec}, decode ${c.decodeMs.toFixed(1)} ms, queue max ${c.queueMax}, ` +
          `rtt ${stats.rttMs} ms, mic level ${c.level}, ${c.audioChunks} audio chunks/s, totals ${JSON.stringify(l.totals)}`,
      );
    }
  }

  onLinkEvent(event: 'open' | 'close' | Uint8Array | PhoneToDesktop) {
    if (event === 'open') {
      if (engineSettings && this.index < engineSettings.cameras) this.startLink();
      else this.send(ENGINE_LINK_SEND, null);
    } else if (event === 'close') {
      if (!this.link) return;
      this.log('link: closed');
      this.teardownPeer();
      this.setState('disconnected');
    } else if (event instanceof Uint8Array) {
      this.link?.receive(event);
    } else {
      this.onPhoneMessage(event);
    }
  }
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

// The cameras and their timers ---------------------------------------------------------------
const cameras = Array.from({ length: MAX_CAMERAS }, (_, i) => new Camera(i));
/** The camera an IPC message is for; anything else than a known index is dropped. */
const cameraAt = (index: unknown): Camera | undefined => (typeof index === 'number' ? cameras[index] : undefined);

function applySettings(next: EngineSettings) {
  const prev = engineSettings;
  engineSettings = next;
  // Before the addon checks: the microphone needs no virtual camera.
  micOut.setPreferred(next.micOutput);

  if (!vcamModule) {
    const loaded = loadVcam(next.addonPath);
    vcamModule = loaded.addon;
    if (!vcamModule) {
      ipcRenderer.send(ENGINE_VCAM_ERROR, 0, loaded.reason ?? 'no-addon: native addon missing');
      warn(loaded.reason);
    }
  }
  for (const camera of cameras) camera.applySettings(next, prev);
}

// Re-render once the bundled font is available (first render may fall back to a system font).
void document.fonts.ready.then(() => cameras.forEach((c) => c.setPlaceholderFrame()));

setInterval(() => cameras.forEach((c) => c.pollConsumers()), CONSUMER_POLL_MS);
setInterval(() => cameras.forEach((c) => void c.pollStats()), 1000);
setInterval(() => cameras.forEach((c) => c.sendControl({ type: 'ping', t: performance.now() })), 5000);

// IPC wiring -------------------------------------------------------------------------
ipcRenderer.on(ENGINE_APPLY_SETTINGS, (_e, s: EngineSettings) => applySettings(s));
ipcRenderer.on(ENGINE_OFFER, (_e, offer: EngineOffer) => {
  const camera = cameraAt(offer.camera);
  if (!camera) return ipcRenderer.send(ENGINE_ANSWER, { id: offer.id, error: 'no such camera' } satisfies EngineAnswer);
  camera
    .handleOffer(offer)
    .then((a) => ipcRenderer.send(ENGINE_ANSWER, a))
    .catch((err: Error) => {
      warn('negotiation failed', err.message);
      ipcRenderer.send(ENGINE_ANSWER, { id: offer.id, error: err.message } satisfies EngineAnswer);
      camera.offerFailed();
    });
});
ipcRenderer.on(ENGINE_LINK, (_e, index: number, event: 'open' | 'close' | Uint8Array | PhoneToDesktop) => cameraAt(index)?.onLinkEvent(event));
ipcRenderer.on(ENGINE_CONTROL, (_e, index: number, msg: DesktopToPhone) => cameraAt(index)?.sendControl(msg));
ipcRenderer.on(ENGINE_DISCONNECT, (_e, index: number) => cameraAt(index)?.disconnect());
// The window shows one camera: its preview runs, the others' don't.
ipcRenderer.on(ENGINE_PREVIEW, (_e, index: number, enabled: boolean) => {
  watching = enabled;
  cameras.forEach((c, i) => c.setPreview(enabled && i === index));
});
ipcRenderer.on(ENGINE_SHUTDOWN, () => cameras.forEach((c) => c.stop(false)));

ipcRenderer.send(ENGINE_READY);
log('engine ready');
