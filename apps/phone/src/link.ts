import {
  API_LINK_PATH,
  LINK_AUDIO,
  LINK_HEADER_BYTES,
  LINK_VIDEO_DELTA,
  LINK_VIDEO_KEY,
  type PhoneToDesktop,
} from '@omnicam/protocol';

const KEY_FRAME_EVERY_MS = 2000;
const IDLE_FRAME_MS = 200; // 5 fps while nobody on the desktop is watching, as on WebRTC
const MAX_ENCODER_QUEUE = 2;
const MIN_BITRATE = 1_000_000;
const LOWER_EVERY_MS = 2000;
const RAISE_AFTER_MS = 5000;
const REPORT_EVERY_MS = 5000;
const MAX_AUDIO_BACKLOG_BYTES = 1024 * 1024;
const AUDIO_START_TIMEOUT_MS = 1000;

/** H.264 level for the size and rate. Baseline is what iPhones are known to encode over this path. */
function h264Level(width: number, height: number, fps: number): string {
  const rate = width * height * fps;
  return rate <= 1920 * 1080 * 30 ? '28' : rate <= 1920 * 1080 * 60 ? '2a' : '33';
}

export interface LinkOptions {
  token: string;
  /** Frames are read from what this element shows. */
  video: HTMLVideoElement;
  bitrateFor(width: number, height: number): number;
  frameRate(): number;
  onOpen(): void;
  onMessage(text: string): void;
  /** `wasOpen` is false when the socket never got through. */
  onClose(wasOpen: boolean): void;
  /** Something the user has to know or do: this browser can't encode, or the microphone waits for a tap. */
  onProblem(kind: 'no-encoder' | 'mic-needs-tap'): void;
}

/**
 * Video and audio over a WebSocket on the page's own connection, for when WebRTC can't reach the desktop
 * (see API_LINK_PATH). The phone does what WebRTC would do for it: encode, keep the delay from growing when
 * the connection is too slow, and carry the microphone.
 */
export class PhoneLink {
  /** What is being sent, for the phone's own screen. */
  width = 0;
  height = 0;
  fps = 0;

  private readonly o: LinkOptions;
  private readonly ws: WebSocket;
  private wasOpen = false;
  private closed = false;

  private videoOn = false;
  private idle = false;
  private frameCallback = 0;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx2d = this.canvas.getContext('2d', { alpha: false });
  private encoder: VideoEncoder | null = null;
  private config: VideoEncoderConfig | null = null;
  private choosing = false;
  private sentConfig = '';
  private forceKey = true;
  private lastKeyAt = 0;
  private lastFrameAt = 0;
  private targetBitrate = 0;
  private lastSkipAt = 0;
  private lastLowerAt = 0;
  private lastRaiseAt = 0;
  private reportedNoEncoder = false;

  private audioRun = 0; // a newer setAudio makes an older one still starting give up
  private audio: AudioContext | null = null;
  private audioTrack: MediaStreamTrack | null = null;

  private m = blankCounters();
  private readonly reports: ReturnType<typeof setInterval>;

  constructor(options: LinkOptions) {
    this.o = options;
    const { token } = options;
    this.ws = new WebSocket(`wss://${location.host}${API_LINK_PATH}?t=${encodeURIComponent(token)}`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      this.wasOpen = true;
      this.o.onOpen();
    };
    this.ws.onmessage = (ev) => this.o.onMessage(ev.data as string);
    this.ws.onclose = () => {
      if (this.closed) return;
      this.stop();
      this.o.onClose(this.wasOpen);
    };
    this.reports = setInterval(() => this.report(), REPORT_EVERY_MS);
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: PhoneToDesktop): void {
    if (this.isOpen) this.ws.send(JSON.stringify(msg));
  }

  private log(message: string): void {
    this.send({ type: 'linkLog', message });
  }

  close(): void {
    this.closed = true;
    this.stop();
    this.ws.close();
  }

  setIdle(idle: boolean): void {
    this.idle = idle;
  }

  requestKeyFrame(): void {
    this.forceKey = true;
  }

  /** A frame the desktop decoded, which gives the whole delay up to there. */
  onFrameAck(t: number): void {
    const ms = performance.now() - t / 1000;
    this.m.ackN++;
    this.m.ackMs += ms;
    this.m.ackMax = Math.max(this.m.ackMax, ms);
  }

  /** Whether the camera is on: frames come from the video element, whichever track it shows. */
  setVideo(on: boolean): void {
    this.videoOn = on;
    if (!on) {
      this.width = this.height = this.fps = 0;
      return;
    }
    if (typeof VideoEncoder === 'undefined') {
      if (!this.reportedNoEncoder) this.o.onProblem('no-encoder');
      this.reportedNoEncoder = true;
      return;
    }
    this.forceKey = true;
    this.o.video.cancelVideoFrameCallback(this.frameCallback);
    this.frameCallback = this.o.video.requestVideoFrameCallback(() => this.onFrame());
  }

  /** The microphone track, or null when it is off. */
  setAudio(track: MediaStreamTrack | null): void {
    if (track === this.audioTrack) return;
    this.audioTrack = track;
    this.stopAudio();
    if (track) void this.startAudio(track, ++this.audioRun);
  }

  private stop(): void {
    clearInterval(this.reports);
    this.videoOn = false;
    this.o.video.cancelVideoFrameCallback(this.frameCallback);
    this.audioTrack = null;
    this.stopAudio();
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    this.encoder = null;
  }

  private onFrame(): void {
    if (!this.videoOn || !this.isOpen) return;
    this.frameCallback = this.o.video.requestVideoFrameCallback(() => this.onFrame());
    this.m.captured++;
    try {
      this.encodeFrame();
    } catch (err) {
      this.m.errors++;
      if (!this.m.lastError) this.log(`frame failed: ${String(err)}`);
      this.m.lastError = String(err);
    }
  }

  private encodeFrame(): void {
    const { video } = this.o;
    const now = performance.now();
    if (this.idle && now - this.lastFrameAt < IDLE_FRAME_MS) return;
    // The element's size, because it is upright: the camera's own frames stay landscape however the phone is held.
    const width = video.videoWidth & ~1;
    const height = video.videoHeight & ~1;
    if (!width || !height || this.choosing || !this.ctx2d) return;
    if (this.encoder?.state !== 'configured' || !this.config || this.config.width !== width || this.config.height !== height) {
      this.choosing = true;
      void this.startEncoder(width, height).finally(() => (this.choosing = false));
      return;
    }
    this.adaptBitrate(now);
    if (this.m.backlogMax < this.ws.bufferedAmount) this.m.backlogMax = this.ws.bufferedAmount;
    this.m.encoderQueueMax = Math.max(this.m.encoderQueueMax, this.encoder.encodeQueueSize);
    // Skip before the encoder, never after it: a missing encoded frame would break the ones that follow it.
    if (this.encoder.encodeQueueSize > MAX_ENCODER_QUEUE) {
      this.m.skippedEncoder++;
      return;
    }
    if (this.ws.bufferedAmount > this.backlogBudget()) {
      this.m.skippedNetwork++;
      this.lastSkipAt = now;
      return;
    }
    this.lastFrameAt = now;
    this.width = width;
    this.height = height;
    // Drawn, not taken from the element directly: a canvas gets the picture the right way up.
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx2d.drawImage(video, 0, 0, width, height);
    const frame = new VideoFrame(this.canvas, { timestamp: Math.round(now * 1000), alpha: 'discard' });
    this.m.drawMs += performance.now() - now;
    const keyFrame = this.forceKey || now - this.lastKeyAt > KEY_FRAME_EVERY_MS;
    if (keyFrame) {
      this.forceKey = false;
      this.lastKeyAt = now;
    }
    this.encoder.encode(frame, { keyFrame });
    frame.close();
  }

  /** About an eighth of a second of video: past this, the delay would start to show. */
  private backlogBudget(): number {
    return Math.max(128 * 1024, (this.config?.bitrate ?? 0) / 8 / 8);
  }

  /** The connection is slower than the encoder: lower the bitrate. Raise it again once it keeps up. */
  private adaptBitrate(now: number): void {
    const config = this.config;
    if (!config?.bitrate || !this.encoder) return;
    let bitrate = config.bitrate;
    if (now - this.lastSkipAt < LOWER_EVERY_MS && now - this.lastLowerAt > LOWER_EVERY_MS && bitrate > MIN_BITRATE) {
      bitrate = Math.max(MIN_BITRATE, Math.round(bitrate * 0.7));
      this.lastLowerAt = now;
    } else if (
      bitrate < this.targetBitrate &&
      now - this.lastSkipAt > RAISE_AFTER_MS &&
      now - this.lastRaiseAt > RAISE_AFTER_MS &&
      this.ws.bufferedAmount < this.backlogBudget() / 4
    ) {
      bitrate = Math.min(this.targetBitrate, Math.round(bitrate * 1.15));
      this.lastRaiseAt = now;
    }
    if (bitrate === config.bitrate) return;
    this.log(`bitrate ${config.bitrate} -> ${bitrate}`);
    this.config = { ...config, bitrate };
    this.encoder.configure(this.config);
    this.forceKey = true;
  }

  private async startEncoder(width: number, height: number): Promise<void> {
    const framerate = this.o.frameRate();
    this.targetBitrate = this.o.bitrateFor(width, height);
    const config = await this.chooseConfig(width, height, framerate);
    if (!config || this.closed) {
      if (!config) this.o.onProblem('no-encoder');
      this.videoOn = false;
      return;
    }
    if (this.encoder?.state !== 'configured' && this.encoder?.state !== 'unconfigured') {
      this.encoder = new VideoEncoder({
        output: (chunk, meta) => this.onChunk(chunk, meta),
        error: (err) => {
          this.m.errors++;
          this.log(`encoder error: ${err.name} ${err.message}`);
          // Closed by the browser: the next frame starts a new one.
          this.config = null;
        },
      });
    }
    this.encoder.configure(config);
    this.config = config;
    this.forceKey = true;
    this.log(`encoder ${config.codec} ${config.hardwareAcceleration} ${width}x${height}@${framerate} ${config.bitrate} bps`);
  }

  private async chooseConfig(width: number, height: number, framerate: number): Promise<VideoEncoderConfig | null> {
    const bitrate = this.targetBitrate;
    for (const codec of [`avc1.4200${h264Level(width, height, framerate)}`, 'vp8']) {
      for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
        const config: VideoEncoderConfig = {
          codec, width, height, framerate, bitrate, latencyMode: 'realtime', hardwareAcceleration,
          ...(codec.startsWith('avc') ? { avc: { format: 'annexb' as const } } : {}),
        };
        const supported = await VideoEncoder.isConfigSupported(config).then((r) => r.supported === true, () => false);
        if (supported) return config;
      }
    }
    return null;
  }

  private onChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    this.m.encoded++;
    this.m.bytes += chunk.byteLength;
    this.m.encodeMs += performance.now() - chunk.timestamp / 1000;
    const dc = meta?.decoderConfig;
    if (dc || !this.sentConfig) {
      const description = dc?.description
        ? Array.from(
            ArrayBuffer.isView(dc.description)
              ? new Uint8Array(dc.description.buffer, dc.description.byteOffset, dc.description.byteLength)
              : new Uint8Array(dc.description),
          )
        : undefined;
      const next: PhoneToDesktop = {
        type: 'videoConfig',
        codec: dc?.codec ?? this.config!.codec,
        codedWidth: dc?.codedWidth ?? this.config!.width,
        codedHeight: dc?.codedHeight ?? this.config!.height,
        description,
      };
      const text = JSON.stringify(next);
      if (text !== this.sentConfig) {
        this.sentConfig = text;
        this.send(next);
      }
    }
    const bytes = new Uint8Array(LINK_HEADER_BYTES + chunk.byteLength);
    bytes[0] = chunk.type === 'key' ? LINK_VIDEO_KEY : LINK_VIDEO_DELTA;
    new DataView(bytes.buffer).setFloat64(1, chunk.timestamp);
    chunk.copyTo(bytes.subarray(LINK_HEADER_BYTES));
    if (this.isOpen) this.ws.send(bytes);
  }

  private async startAudio(track: MediaStreamTrack, run: number): Promise<void> {
    try {
      // At the microphone's own rate where the browser says: iOS can garble audio that has to be converted.
      const rate = track.getSettings().sampleRate;
      const ctx = new AudioContext(rate ? { sampleRate: rate } : {});
      this.audio = ctx;
      await ctx.audioWorklet.addModule('./link-audio-worklet.js');
      if (run !== this.audioRun) return;
      const node = new AudioWorkletNode(ctx, 'omnicam-pcm');
      node.port.onmessage = (ev) => this.sendAudio(ev.data as ArrayBuffer, ctx.sampleRate);
      // Silent, but a node that leads nowhere may not run on Safari.
      const silence = ctx.createGain();
      silence.gain.value = 0;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(node).connect(silence).connect(ctx.destination);
      await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, AUDIO_START_TIMEOUT_MS))]);
      if (run !== this.audioRun) return;
      this.log(`microphone: ${ctx.state} at ${ctx.sampleRate} Hz`);
      if (ctx.state !== 'running') {
        this.o.onProblem('mic-needs-tap');
        const retry = () => void ctx.resume().then(() => this.log(`microphone after a tap: ${ctx.state}`));
        document.addEventListener('pointerdown', retry, { once: true });
      }
      // iOS pauses audio for a phone call, and leaves it paused unless asked.
      ctx.onstatechange = () => {
        if (run !== this.audioRun) return;
        this.log(`microphone: ${ctx.state}`);
        if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume();
      };
    } catch (err) {
      this.m.errors++;
      this.log(`microphone failed: ${String(err)}`);
    }
  }

  private sendAudio(pcm: ArrayBuffer, rate: number): void {
    if (!this.isOpen) return;
    // A little behind is fine; seconds behind would be a stale microphone, so those are dropped.
    if (this.ws.bufferedAmount > MAX_AUDIO_BACKLOG_BYTES) {
      this.m.audioDropped++;
      return;
    }
    const bytes = new Uint8Array(LINK_HEADER_BYTES + pcm.byteLength);
    bytes[0] = LINK_AUDIO;
    new DataView(bytes.buffer).setFloat64(1, rate);
    bytes.set(new Uint8Array(pcm), LINK_HEADER_BYTES);
    this.m.audioChunks++;
    this.ws.send(bytes);
  }

  private stopAudio(): void {
    this.audioRun++;
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
  }

  private report(): void {
    const m = this.m;
    this.m = blankCounters();
    const seconds = REPORT_EVERY_MS / 1000;
    const avg = (sum: number, n: number) => (n ? Math.round(sum / n) : null);
    this.fps = Math.round(m.encoded / seconds);
    this.send({
      type: 'linkStats',
      stats: {
        size: `${this.width}x${this.height}`,
        capturedFps: Math.round(m.captured / seconds),
        encodedFps: this.fps,
        kbps: Math.round((m.bytes * 8) / seconds / 1000),
        bitrate: this.config?.bitrate,
        idle: this.idle,
        skippedNetwork: m.skippedNetwork,
        skippedEncoder: m.skippedEncoder,
        drawMs: avg(m.drawMs, m.encoded),
        encodeMs: avg(m.encodeMs, m.encoded),
        decodedDelayMs: avg(m.ackMs, m.ackN),
        decodedDelayMaxMs: Math.round(m.ackMax),
        backlogMaxBytes: m.backlogMax,
        encoderQueueMax: m.encoderQueueMax,
        audioChunksPerS: Math.round(m.audioChunks / seconds),
        audioDropped: m.audioDropped,
        audioState: this.audio?.state ?? 'off',
        errors: m.errors,
        lastError: m.lastError || undefined,
      },
    });
  }
}

function blankCounters() {
  return {
    captured: 0, encoded: 0, bytes: 0, errors: 0, lastError: '',
    skippedNetwork: 0, skippedEncoder: 0,
    drawMs: 0, encodeMs: 0, ackN: 0, ackMs: 0, ackMax: 0,
    backlogMax: 0, encoderQueueMax: 0, audioChunks: 0, audioDropped: 0,
  };
}
