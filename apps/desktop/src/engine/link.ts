import { LINK_AUDIO, LINK_HEADER_BYTES, LINK_VIDEO_KEY, type PhoneToDesktop } from '@omnicam/protocol';

type VideoConfig = Extract<PhoneToDesktop, { type: 'videoConfig' }>;

const MAX_DECODE_QUEUE = 8; // beyond this the decoder can't keep up: skip to the next key frame
// How far ahead audio is scheduled: enough to ride out the gaps a TCP stream has, little enough for a call.
const AUDIO_DELAY_S = 0.06;
const AUDIO_MAX_DELAY_S = 0.25;
// iPhones were measured delivering 2.6 % fewer samples than they claim. Playing a little slower when the
// buffer runs low, and a little faster when it grows, keeps it from draining into an audible gap.
const AUDIO_SLOW_SPEED = 0.96;
const AUDIO_FAST_SPEED = 1.03;

interface Callbacks {
  /** Takes over the frame. False means it was skipped because the last one is still being copied. */
  onFrame(frame: VideoFrame): boolean;
  onMicTrack(track: MediaStreamTrack): void;
  requestKeyFrame(): void;
  log(...a: unknown[]): void;
  warn(...a: unknown[]): void;
}

/** Decodes what arrives over the media link: frames for the frame pipeline, audio as an ordinary track. */
export class LinkReceiver {
  codec = '';
  /** Since the link opened, for the log. */
  readonly totals = { busyDrops: 0, skippedForKey: 0, decoderErrors: 0, audioUnderruns: 0, audioOverruns: 0 };
  private counts = { decoded: 0, bytes: 0, decodeMs: 0, queueMax: 0, audioChunks: 0, peakSquares: 0 };
  private readonly cb: Callbacks;
  private decoder: VideoDecoder | null = null;
  private config: VideoDecoderConfig | null = null;
  private needKey = true;
  private readonly arrivals = new Map<number, number>();
  private audio: AudioContext | null = null;
  private audioOut: MediaStreamAudioDestinationNode | null = null;
  private audioNext = 0;

  constructor(cb: Callbacks) {
    this.cb = cb;
  }

  configure(msg: VideoConfig): void {
    if (typeof msg.codec !== 'string' || !Number.isInteger(msg.codedWidth) || !Number.isInteger(msg.codedHeight)) return;
    this.config = {
      codec: msg.codec,
      codedWidth: msg.codedWidth,
      codedHeight: msg.codedHeight,
      description: Array.isArray(msg.description) ? new Uint8Array(msg.description) : undefined,
      hardwareAcceleration: 'prefer-software', // gives frames the pipeline can copy, as WebRTC's do
      optimizeForLatency: true,
    };
    this.codec = msg.codec;
    this.cb.log(`link: video ${msg.codec} ${msg.codedWidth}x${msg.codedHeight}`);
    this.startDecoder();
  }

  /** `bytes` is a whole binary message, at least a header and one byte of payload (main checks). */
  receive(bytes: Uint8Array): void {
    const stamp = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(1);
    const payload = bytes.subarray(LINK_HEADER_BYTES);
    if (bytes[0] === LINK_AUDIO) this.playAudio(payload, stamp);
    else this.decode(bytes[0] === LINK_VIDEO_KEY, stamp, payload);
  }

  takeCounts() {
    const c = this.counts;
    this.counts = { decoded: 0, bytes: 0, decodeMs: 0, queueMax: 0, audioChunks: 0, peakSquares: 0 };
    return {
      decoded: c.decoded,
      bytes: c.bytes,
      decodeMs: c.decoded ? c.decodeMs / c.decoded : 0,
      queueMax: c.queueMax,
      audioChunks: c.audioChunks,
      // The same measure as WebRTC's level: the root mean square of short-term peaks.
      level: c.audioChunks ? Math.round(Math.sqrt(c.peakSquares / c.audioChunks) * 1000) / 1000 : 0,
    };
  }

  close(): void {
    if (this.decoder?.state !== 'closed') this.decoder?.close();
    this.decoder = null;
    void this.audio?.close();
    this.audio = null;
    this.audioOut = null;
  }

  private startDecoder(): void {
    if (this.decoder?.state !== 'closed') this.decoder?.close();
    this.arrivals.clear();
    this.needKey = true;
    this.decoder = null;
    if (!this.config) return;
    try {
      const decoder = new VideoDecoder({
        output: (frame) => {
          this.counts.decoded++;
          const arrived = this.arrivals.get(frame.timestamp);
          if (arrived !== undefined) this.counts.decodeMs += performance.now() - arrived;
          this.arrivals.delete(frame.timestamp);
          if (!this.cb.onFrame(frame)) this.totals.busyDrops++;
        },
        error: (err) => {
          this.totals.decoderErrors++;
          this.cb.warn('link: decoder error', err.message);
          this.startDecoder();
          this.cb.requestKeyFrame();
        },
      });
      decoder.configure(this.config);
      this.decoder = decoder;
    } catch (err) {
      // Comes from the phone: a config the decoder refuses must not take the engine down.
      this.totals.decoderErrors++;
      this.cb.warn('link: decoder refused the config', String(err));
    }
  }

  private decode(key: boolean, timestamp: number, data: Uint8Array): void {
    this.counts.bytes += data.length;
    const decoder = this.decoder;
    if (decoder?.state !== 'configured') return;
    if (this.needKey && !key) {
      this.totals.skippedForKey++;
      return;
    }
    if (decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
      if (!this.needKey) this.cb.requestKeyFrame();
      this.needKey = true;
      this.totals.skippedForKey++;
      return;
    }
    this.needKey = false;
    if (this.arrivals.size > 300) this.arrivals.clear();
    this.arrivals.set(timestamp, performance.now());
    this.counts.queueMax = Math.max(this.counts.queueMax, decoder.decodeQueueSize);
    try {
      decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp, data }));
    } catch (err) {
      this.totals.decoderErrors++;
      this.cb.warn('link: frame refused', String(err));
      this.startDecoder();
      this.cb.requestKeyFrame();
    }
  }

  /** Each chunk is scheduled right after the last, so the samples join up without a worklet. */
  private playAudio(pcm: Uint8Array, rate: number): void {
    if (!(rate >= 8000 && rate <= 96000) || pcm.length % 2) return;
    if (!this.audio || this.audio.sampleRate !== rate) {
      void this.audio?.close();
      this.audio = new AudioContext({ sampleRate: rate, latencyHint: 'interactive' });
      this.audioOut = this.audio.createMediaStreamDestination();
      this.audioNext = 0;
      this.cb.log(`link: audio at ${rate} Hz`);
      this.cb.onMicTrack(this.audioOut.stream.getAudioTracks()[0]);
    }
    const ctx = this.audio;
    const now = ctx.currentTime;
    if (this.audioNext < now) {
      if (this.audioNext) this.totals.audioUnderruns++;
      this.audioNext = now + AUDIO_DELAY_S;
    } else if (this.audioNext > now + AUDIO_MAX_DELAY_S) {
      // Fell behind (the phone's clock runs faster, or a burst after a gap): catch up by dropping a chunk.
      this.totals.audioOverruns++;
      return;
    }
    const samples = new Int16Array(pcm.slice().buffer); // slice: the payload starts at an odd offset
    const buffer = ctx.createBuffer(1, samples.length, rate);
    const channel = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] / 32768;
      channel[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    this.counts.audioChunks++;
    this.counts.peakSquares += peak * peak;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const ahead = this.audioNext - now;
    const speed = ahead < AUDIO_DELAY_S ? AUDIO_SLOW_SPEED : ahead > AUDIO_DELAY_S * 2 ? AUDIO_FAST_SPEED : 1;
    source.playbackRate.value = speed;
    source.connect(this.audioOut!);
    source.start(this.audioNext);
    this.audioNext += buffer.duration / speed;
  }
}
