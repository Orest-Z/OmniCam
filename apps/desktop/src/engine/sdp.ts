/**
 * Small, targeted SDP adjustments on the answer we hand back to the phone.
 *
 * - `x-google-start-bitrate` / `x-google-min-bitrate`: Chromium-based phones read these from the
 *   remote description and start encoding at a high bitrate immediately instead of ramping up
 *   from ~300 kbps over several seconds. Safari ignores unknown fmtp params (harmless).
 * - `b=AS:` on the video section: an upper bound every browser honors, so a misbehaving bandwidth
 *   estimate cannot push the phone past what the LAN comfortably carries.
 */
const START_KBPS = 8000;
const MIN_KBPS = 1500;
const MAX_KBPS = 40000;

export function tuneAnswerSdp(sdp: string): string {
  const lines = sdp.split(/\r?\n/);
  const out: string[] = [];
  let inVideo = false;
  const videoPts = new Set<string>();

  for (const line of lines) {
    if (line.startsWith('m=')) {
      inVideo = line.startsWith('m=video');
      out.push(line);
      if (inVideo) {
        for (const pt of line.split(' ').slice(3)) videoPts.add(pt);
      }
      continue;
    }
    if (inVideo && line.startsWith('c=')) {
      out.push(line);
      out.push(`b=AS:${MAX_KBPS}`);
      continue;
    }
    if (inVideo && line.startsWith('b=')) continue; // replaced above
    out.push(line);
  }

  // Add start/min bitrate hints to every video codec's fmtp line (create one if missing).
  const hasFmtp = new Set<string>();
  const result = out.map((line) => {
    const m = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (!m || !videoPts.has(m[1])) return line;
    hasFmtp.add(m[1]);
    if (/x-google-start-bitrate/.test(m[2])) return line;
    if (/apt=/.test(m[2])) return line; // rtx payloads carry only apt=
    return `a=fmtp:${m[1]} ${m[2]};x-google-start-bitrate=${START_KBPS};x-google-min-bitrate=${MIN_KBPS}`;
  });

  // Codecs without any fmtp line (e.g. VP8): append one right after their rtpmap.
  const final: string[] = [];
  for (const line of result) {
    final.push(line);
    const m = /^a=rtpmap:(\d+) (VP8|VP9|AV1)\//i.exec(line);
    if (m && videoPts.has(m[1]) && !hasFmtp.has(m[1])) {
      final.push(`a=fmtp:${m[1]} x-google-start-bitrate=${START_KBPS};x-google-min-bitrate=${MIN_KBPS}`);
      hasFmtp.add(m[1]);
    }
  }
  return final.join('\r\n');
}
