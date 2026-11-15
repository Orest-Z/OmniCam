import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { DEFAULT_PING_URL, pingBody, pingDue, pingUrl, rateBody, rateUrl, utcDay, utcMonth, validStars } from '../src/main/usage-ping.ts';

describe('usage ping', () => {
  const url = 'https://example.test/ping';

  test('only for someone who said yes, once a calendar month, and only with somewhere to send it', () => {
    assert.equal(pingDue({ usagePing: 'on', lastPingMonth: '2026-10' }, url, '2026-11'), true);
    assert.equal(pingDue({ usagePing: 'on', lastPingMonth: '2026-11' }, url, '2026-11'), false);
    assert.equal(pingDue({ usagePing: 'ask', lastPingMonth: '' }, url, '2026-11'), false);
    assert.equal(pingDue({ usagePing: 'off', lastPingMonth: '' }, url, '2026-11'), false);
    assert.equal(pingDue({ usagePing: 'on', lastPingMonth: '' }, '', '2026-11'), false);
  });

  test('says the version and the system, nothing else', () => {
    assert.deepEqual(JSON.parse(pingBody('2.5.0', 'win32')), { v: '2.5.0', os: 'win32' });
  });

  test('the day is the UTC date', () => {
    assert.equal(utcDay(new Date('2026-11-15T23:59:59Z')), '2026-11-15');
    assert.equal(utcMonth(new Date('2026-11-30T23:59:59Z')), '2026-11');
  });

  test('a dev build can point at a local counter', () => {
    assert.equal(pingUrl({ OMNICAM_PING_URL: 'http://localhost:8787/ping' }), 'http://localhost:8787/ping');
    assert.equal(pingUrl({}), DEFAULT_PING_URL);
  });

  test('a rating goes next to the ping, and is 1 to 5 whole stars', () => {
    assert.equal(rateUrl({ OMNICAM_PING_URL: 'https://counter.example.workers.dev/ping' }), 'https://counter.example.workers.dev/rate');
    assert.equal(rateUrl({}), DEFAULT_PING_URL ? new URL('rate', DEFAULT_PING_URL).href : '');
    assert.deepEqual(JSON.parse(rateBody('2.5.0', 'linux', 4)), { v: '2.5.0', os: 'linux', stars: 4 });
    for (const ok of [1, 5]) assert.equal(validStars(ok), true);
    for (const bad of [0, 6, 4.5, NaN, '5', null, undefined, {}]) assert.equal(validStars(bad), false, String(bad));
  });

  test('a build that pings says so in PRIVACY.md, and where to', () => {
    if (!DEFAULT_PING_URL) return; // no address: this build never asks and never pings
    const privacy = readFileSync(new URL('../../../PRIVACY.md', import.meta.url), 'utf8');
    assert.ok(privacy.includes(new URL(DEFAULT_PING_URL).host), 'PRIVACY.md must name where the usage ping goes');
    assert.equal(/no telemetry/i.test(privacy), false, 'PRIVACY.md still says "no telemetry"');
  });
});
