import { pickSink } from '../shared/audio-sink';

/**
 * Plays the phone's microphone into a loopback device, whose other side apps pick as their
 * microphone. A plain <audio> element does it: Chromium's WebRTC jitter buffer already absorbs network
 * jitter, the drift between the phone's clock and the device's, and the resampling, all in native
 * code. No Web Audio graph, no worklet.
 *
 * The track is attached only once the element points at a loopback, and detached as soon as there is
 * none, so the phone's microphone is never played out of the speakers. With nothing attached Chromium
 * doesn't decode the audio at all.
 */
export class MicOutput {
  private readonly el = new Audio();
  private readonly log: (...a: unknown[]) => void;
  private track: MediaStreamTrack | null = null;
  private preferred = '';
  private status = 'phone microphone off'; // last thing logged
  private queue = Promise.resolve();

  constructor(log: (...a: unknown[]) => void) {
    this.log = log;
    // A cable installed, removed or renamed while OmniCam runs.
    navigator.mediaDevices.addEventListener('devicechange', () => this.route());
  }

  /** The phone's audio track while its microphone is on, null otherwise. */
  setTrack(track: MediaStreamTrack | null): void {
    if (track === this.track) return;
    this.track = track;
    this.route();
  }

  /** The loopback chosen in Settings (its label); empty = the first one found. */
  setPreferred(label: string): void {
    if (label === this.preferred) return;
    this.preferred = label;
    this.route();
  }

  /** Queued, so an older decision never lands after a newer one. */
  private route(): void {
    this.queue = this.queue.then(() => this.apply()).catch((err: Error) => this.log('microphone output failed', err.message));
  }

  private async apply(): Promise<void> {
    // Every change queues another apply, so working on this snapshot is enough.
    const track = this.track;
    const sink = track && pickSink(await navigator.mediaDevices.enumerateDevices(), this.preferred);
    if (track && sink) {
      try {
        if (this.el.sinkId !== sink.deviceId) await this.el.setSinkId(sink.deviceId);
        if ((this.el.srcObject as MediaStream | null)?.getAudioTracks()[0] !== track) this.el.srcObject = new MediaStream([track]);
        await this.el.play();
      } catch (err) {
        this.detach();
        throw err;
      }
    } else {
      this.detach();
    }
    const status = sink ? `phone microphone plays into ${sink.label}` : track ? 'no loopback device for the phone microphone' : 'phone microphone off';
    if (status !== this.status) this.log((this.status = status));
  }

  private detach(): void {
    this.el.pause();
    this.el.srcObject = null;
  }
}
