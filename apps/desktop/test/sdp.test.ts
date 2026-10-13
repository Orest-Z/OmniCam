import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { tuneAnswerSdp } from '../src/engine/sdp.ts';

// The shape of the engine's (Chromium's) answer to a phone offering video, audio and the DataChannel.
const ANSWER = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
].join('\r\n');

const lines = tuneAnswerSdp(ANSWER).split('\r\n');

describe('tuneAnswerSdp', () => {
  test('Opus: mono, 64 kbps, in-band FEC, other parameters kept', () => {
    assert.ok(lines.includes('a=fmtp:111 minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=64000'));
    assert.ok(lines.includes('a=fmtp:63 111/111'), 'RED is left alone');
  });

  test('the bandwidth cap is on the video section only', () => {
    assert.deepEqual(lines.filter((l) => l.startsWith('b=')), ['b=AS:40000']);
    assert.equal(lines[lines.indexOf('b=AS:40000') - 1], 'c=IN IP4 0.0.0.0');
    assert.ok(lines.indexOf('b=AS:40000') < lines.indexOf('m=audio 9 UDP/TLS/RTP/SAVPF 111 63'));
  });

  test('video codecs get start and minimum bitrates, rtx does not', () => {
    assert.ok(lines.includes('a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=8000;x-google-min-bitrate=1500'));
    assert.ok(lines.includes('a=fmtp:96 x-google-start-bitrate=8000;x-google-min-bitrate=1500'));
    assert.ok(lines.includes('a=fmtp:97 apt=96'));
  });
});
