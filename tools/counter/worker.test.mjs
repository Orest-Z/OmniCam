// node --test tools/counter/worker.test.mjs
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { d1 } from './local.mjs';
import worker from './worker.mjs';

const env = { DB: d1(':memory:'), STATS_KEY: 'secret' };
const post = (path, body, more = env) =>
  worker.fetch(new Request(`https://counter.test${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), more);
const get = async (path, key, more = env) => {
  const res = await worker.fetch(new Request(`https://counter.test${path}`, key === undefined ? {} : { headers: { authorization: `Bearer ${key}` } }), more);
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
};
const stats = (key) => get('/stats.json', key);

test('pings and ratings are counted, by day, version and system', async () => {
  assert.equal((await post('/ping', { v: '2.5.0', os: 'win32' })).status, 204);
  assert.equal((await post('/ping', { v: '2.5.0', os: 'win32' })).status, 204);
  assert.equal((await post('/ping', { v: '2.4.0', os: 'linux' })).status, 204);
  assert.equal((await post('/rate', { v: '2.5.0', os: 'win32', stars: 5 })).status, 204);
  assert.equal((await post('/rate', { v: '2.5.0', os: 'win32', stars: 4 })).status, 204);

  const { status, text } = await stats('secret');
  assert.equal(status, 200);
  const day = new Date().toISOString().slice(0, 10);
  assert.deepEqual(JSON.parse(text), {
    today: day,
    months: [{ month: day.slice(0, 7), n: 3 }],
    days: [{ day, n: 3 }],
    versions: [{ v: '2.5.0', n: 2 }, { v: '2.4.0', n: 1 }],
    systems: [{ os: 'win32', n: 2 }, { os: 'linux', n: 1 }],
    stars: [{ stars: 5, n: 1 }, { stars: 4, n: 1 }],
    rated: 2,
    average: 4.5,
  });
});

test('anything that is not a ping or a rating is refused and counts nothing', async () => {
  const bad = [
    ['/ping', { v: '<script>', os: 'win32' }],
    ['/ping', { v: '2.5.0', os: 'toaster' }],
    ['/ping', { os: 'win32' }],
    ['/ping', 'not json'],
    ['/ping', 'null'],
    ['/ping', { v: '2.5.0', os: 'win32', pad: 'x'.repeat(2000) }],
    ['/rate', { v: '2.5.0', os: 'win32' }],
    ['/rate', { v: '2.5.0', os: 'win32', stars: 6 }],
    ['/rate', { v: '2.5.0', os: 'win32', stars: 0 }],
    ['/rate', { v: '2.5.0', os: 'win32', stars: 4.5 }],
    ['/rate', { v: '2.5.0', os: 'win32', stars: '5' }],
  ];
  for (const [path, body] of bad) assert.equal((await post(path, body)).status, 400, JSON.stringify(body).slice(0, 60));
  assert.equal((await post('/other', { v: '2.5.0', os: 'win32' })).status, 404);
  assert.equal((await worker.fetch(new Request('https://counter.test/ping'), env)).status, 404, 'GET /ping');
  assert.equal(JSON.parse((await stats('secret')).text).rated, 2);
});

test('the counts are for whoever has the key, sent in a header and never in the address', async () => {
  assert.equal((await stats('wrong')).status, 401);
  assert.equal((await stats('')).status, 401);
  assert.equal((await stats(undefined)).status, 401, 'no header');
  assert.equal((await get('/stats.json?key=secret')).status, 401, 'the key in the address opens nothing');
  assert.equal((await get('/stats.json', 'secret', { DB: env.DB })).status, 401, 'no key set: closed, not open');
  assert.equal((await get('/stats.json', '', { DB: env.DB })).status, 401, 'no key set and none given: still closed');
  const guessing = { ...env, LIMIT: { limit: async () => ({ success: false }) } };
  assert.equal((await get('/stats.json', 'secret', guessing)).status, 429, 'guessing the key is slowed down like any flood');
});

test('the dashboard is one page that holds no numbers and loads nothing from anywhere else', async () => {
  const page = await get('/stats');
  assert.equal(page.status, 200, 'the page is the same for everyone: it asks for the key');
  assert.equal(page.text.includes('2.5.0') || page.text.includes('secret'), false, 'no counts and no key in the page');
  assert.match(page.type, /^text\/html/);
  assert.match(page.text, /<title>OmniCam counter<\/title>/);
  assert.equal(/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(page.text), false, 'no outside scripts, styles, fonts or links');
});

test('a flood from one address is turned away before anything is counted', async () => {
  const limited = { ...env, LIMIT: { limit: async () => ({ success: false }) } };
  assert.equal((await post('/ping', { v: '2.5.0', os: 'win32' }, limited)).status, 429);
});
