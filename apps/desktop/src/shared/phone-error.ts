import type { PhoneToDesktop } from '@omnicam/protocol';

type PhoneError = Extract<PhoneToDesktop, { type: 'error' }>;

/**
 * What the window says when the phone reports a problem: what happened and what to do on the phone.
 * The phone page shows its own hint too, but the user pressed the button here, so the answer belongs here.
 */
export function phoneErrorText(err: PhoneError, platform?: string): string {
  const phone = platform === 'iPhone' || platform === 'iPad' ? `The ${platform}` : platform === 'Android' ? 'The Android phone' : 'The phone';
  if (!err.source) return `${phone} reported a problem: ${err.message}`;
  const what = err.source === 'mic' ? 'microphone' : 'camera';
  switch (err.reason) {
    case 'NotAllowedError':
      return `${phone} didn't allow its ${what} for OmniCam. Allow it for the OmniCam page in the phone browser's site settings, then reload that page.`;
    case 'NotReadableError':
    case 'AbortError':
      return `${phone}'s ${what} is busy, probably in a call or another app. Close that app, then try again.`;
    case 'NotFoundError':
      return `${phone} has no ${what} the browser can use.`;
    default:
      return `${phone} couldn't turn its ${what} on (${err.reason ?? 'unknown error'}). Try again; the log has details.`;
  }
}
