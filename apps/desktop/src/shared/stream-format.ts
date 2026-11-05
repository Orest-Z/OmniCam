import type { TrackInfo } from '@omnicam/protocol';

export const WIFI_HELP = 'Connected the usual way (WebRTC), which is the most efficient.';
export const HOTSPOT_HELP =
  "On this network the phone can't send video the usual way (WebRTC), which usually means the phone is the hotspot. " +
  "OmniCam sends it over the page's own connection instead. That uses more CPU on this computer and more battery on the " +
  'phone, and can add a little delay. Connecting both to regular Wi-Fi avoids this.';

/**
 * The virtual camera's output rate for what the phone's camera really runs at. Apps get exactly
 * the output rate, so 60 only when the phone does deliver it (a phone asked for 60 that manages 30
 * would otherwise have every frame doubled).
 */
export function outputFpsFor(phoneFrameRate: number): 30 | 60 {
  return phoneFrameRate > 45 ? 60 : 30;
}

/**
 * The resolution button to light up for what the phone sends. Uses the short side, so a phone
 * held upright (1080×1920) still reads as 1080p.
 */
export function activePreset(info: Pick<TrackInfo, 'width' | 'height' | 'frameRate'> | undefined): '720p' | '720p60' | '1080p' | '4k' {
  const h = Math.min(info?.width ?? 0, info?.height ?? 0);
  if (h >= 2160) return '4k';
  if (h >= 1080) return '1080p';
  // Same threshold as the output rate, so the button and what apps get never disagree.
  return outputFpsFor(info?.frameRate ?? 0) === 60 ? '720p60' : '720p';
}

/** "720p", "1080p" or "4K" for a frame, by its short side (so a phone held upright reads the same). */
export function sizeLabel(width: number, height: number): string {
  const short = Math.min(width, height);
  return short >= 2160 ? '4K' : `${short}p`;
}

/**
 * Apps get a bigger picture than the phone sends: scaled up, so more CPU and no more detail. Not when
 * the phone runs at 60 fps: then 720p is all a phone browser films, and scaling it up is the deal.
 */
export function isUpscaled(phone: Pick<TrackInfo, 'width' | 'height' | 'frameRate'> | undefined, output: { width: number; height: number }): boolean {
  const sent = Math.min(phone?.width ?? 0, phone?.height ?? 0);
  if (!sent || outputFpsFor(phone?.frameRate ?? 0) === 60) return false;
  return Math.min(output.width, output.height) > sent * 1.1;
}
