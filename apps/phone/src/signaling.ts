import { API_SESSION_PATH } from '@omnicam/protocol';
import type { SessionRequest, SessionResponse, SessionError, DeviceInfo } from '@omnicam/protocol';

export class SignalingError extends Error {
  constructor(
    public code: SessionError['error'] | 'network',
    message: string,
    /** How long the desktop asked us to wait, in ms (sent with 'busy'). */
    public retryAfterMs = 0,
  ) {
    super(message);
  }
}

/** One-shot signaling: POST the complete offer, get the complete answer back. */
export async function exchangeSdp(token: string, sdp: string, device: DeviceInfo): Promise<SessionResponse> {
  const body: SessionRequest = { token, sdp, device };
  let res: Response;
  try {
    res = await fetch(API_SESSION_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (err) {
    throw new SignalingError('network', `Cannot reach the desktop app (${(err as Error).message})`);
  }
  const json = (await res.json()) as SessionResponse | SessionError;
  if (!json.ok) {
    const retryAfter = json.retryAfterSeconds ?? (Number(res.headers.get('retry-after')) || 0);
    throw new SignalingError(json.error, json.message ?? json.error, retryAfter * 1000);
  }
  return json;
}

/** Waits until ICE gathering is complete (fast on a LAN with no STUN), with a safety timeout. */
export function waitForIceComplete(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export function describeDevice(): DeviceInfo {
  const ua = navigator.userAgent;
  const platform = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac/.test(ua) ? 'Mac'
    : 'Unknown';
  return { userAgent: ua, platform };
}
