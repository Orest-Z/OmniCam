/**
 * A raw microphone, like a USB mic. Discord, Zoom and Teams run their own echo cancellation, noise
 * suppression and gain control, and they work best on unprocessed input. The phone plays none of the
 * call's audio, so its own echo canceller would have nothing to cancel. These are preferences, not
 * requirements: a browser that can't switch processing off still opens the microphone.
 */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

/**
 * Owns the microphone track. It lives outside the camera's stream, so flipping or resizing the camera
 * never interrupts the audio.
 */
export class MicController {
  private current: MediaStreamTrack | null = null;
  onTrackChanged: ((track: MediaStreamTrack) => void) | null = null;

  get track(): MediaStreamTrack | null {
    return this.current;
  }

  /** Opens the microphone, or keeps the one that is already live. */
  async start(): Promise<MediaStreamTrack> {
    if (this.current?.readyState === 'live') return this.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS, video: false });
    const track = stream.getAudioTracks()[0];
    this.adopt(track);
    return track;
  }

  /** Takes over a track that was opened together with the camera. */
  adopt(track: MediaStreamTrack): void {
    this.stop();
    this.current = track;
    track.addEventListener('ended', () => this.onTrackChanged?.(track));
    this.onTrackChanged?.(track);
  }

  stop(): void {
    this.current?.stop();
    this.current = null;
  }
}
