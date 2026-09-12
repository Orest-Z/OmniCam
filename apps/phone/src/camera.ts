import type { Facing, ResolutionPreset, PhoneCapabilities, TrackInfo, CameraDescriptor } from '@omnicam/protocol';

/**
 * Owns the local camera MediaStream. Handles facing switches, resolution changes,
 * torch and the "camera got killed while backgrounded" case that iOS loves.
 */
export class CameraController {
  private stream: MediaStream | null = null;
  private facing: Facing = 'user';
  private preset: ResolutionPreset = { width: 1920, height: 1080, frameRate: 30 };
  onTrackChanged: ((track: MediaStreamTrack) => void) | null = null;

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }
  get currentFacing(): Facing {
    return this.facing;
  }

  async start(facing: Facing = this.facing, preset = this.preset): Promise<MediaStreamTrack> {
    // Android generally refuses to open a second camera while one is open: stop first.
    this.stopTracks();
    this.facing = facing;
    this.preset = preset;

    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      },
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Fall back to "any camera" so the user at least gets a picture.
      if ((err as DOMException).name === 'OverconstrainedError') {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } else {
        throw err;
      }
    }
    const track = this.track!;
    // Hint the encoder that this is camera motion, not screen content.
    try { track.contentHint = 'motion'; } catch { /* older browsers */ }
    const settings = track.getSettings();
    if (settings.facingMode === 'user' || settings.facingMode === 'environment') {
      this.facing = settings.facingMode;
    }
    track.addEventListener('ended', () => this.onTrackChanged?.(track));
    this.onTrackChanged?.(track);
    return track;
  }

  async flip(): Promise<MediaStreamTrack> {
    const next: Facing = this.facing === 'user' ? 'environment' : 'user';
    try {
      return await this.start(next);
    } catch (err) {
      // Device may only have one camera; restore the previous one.
      await this.start(this.facing === next ? 'user' : this.facing);
      throw err;
    }
  }

  async setFacing(facing: Facing): Promise<MediaStreamTrack> {
    if (facing === this.facing && this.track?.readyState === 'live') return this.track;
    return this.start(facing);
  }

  async setResolution(preset: ResolutionPreset): Promise<void> {
    const track = this.track;
    this.preset = preset;
    if (!track) return;
    try {
      await track.applyConstraints({
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      });
      const s = track.getSettings();
      const close = (a = 0, b = 0) => Math.abs(a - b) < 64;
      if (close(s.width, preset.width) || close(s.height, preset.height)) return;
    } catch { /* fall through to a full restart */ }
    // Safari often ignores applyConstraints for resolution; reopen the camera.
    await this.start(this.facing, preset);
  }

  async setTorch(on: boolean): Promise<boolean> {
    const track = this.track;
    if (!track) return false;
    const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
    if (!caps?.torch) return false;
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  }

  /** Recover after iOS/Android killed the track while the page was hidden. */
  async recoverIfEnded(): Promise<MediaStreamTrack | null> {
    if (this.track && this.track.readyState === 'live') return null;
    return this.start(this.facing, this.preset);
  }

  capabilities(): PhoneCapabilities {
    const track = this.track;
    const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; zoom?: unknown };
    const facingModes = (caps.facingMode ?? []) as Facing[];
    return {
      torch: Boolean(caps.torch),
      zoom: caps.zoom !== undefined,
      facingModes: facingModes.length ? facingModes : ['user', 'environment'],
    };
  }

  trackInfo(): TrackInfo | null {
    const track = this.track;
    if (!track) return null;
    const s = track.getSettings();
    return {
      width: s.width ?? 0,
      height: s.height ?? 0,
      frameRate: s.frameRate ?? 0,
      facing: this.facing,
      deviceId: s.deviceId,
      label: track.label,
    };
  }

  async listCameras(): Promise<CameraDescriptor[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label,
          facing: /back|rear|environment/i.test(d.label)
            ? 'environment'
            : /front|user|face/i.test(d.label)
              ? 'user'
              : undefined,
        }));
    } catch {
      return [];
    }
  }

  stopTracks(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
