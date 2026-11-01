import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { phoneErrorText } from '../src/shared/phone-error.ts';

const err = (source?: 'camera' | 'mic', reason?: string) => ({ type: 'error' as const, message: 'raw', source, reason });

test('a denied permission says where to allow it', () => {
  const text = phoneErrorText(err('mic', 'NotAllowedError'), 'iPhone');
  assert.match(text, /^The iPhone didn't allow its microphone/);
  assert.match(text, /site settings, then reload/);
});

test('a busy camera says to close the other app', () => {
  assert.match(phoneErrorText(err('camera', 'NotReadableError'), 'Android'), /^The Android phone's camera is busy/);
});

test('an unknown phone or an unknown error still reads as a sentence', () => {
  assert.equal(phoneErrorText(err('camera', 'TypeError'), 'Unknown'), "The phone couldn't turn its camera on (TypeError). Try again; the log has details.");
  assert.equal(phoneErrorText(err(), undefined), 'The phone reported a problem: raw');
});
