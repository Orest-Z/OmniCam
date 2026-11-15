// OmniCam's counter: a Cloudflare Worker that counts usage pings and star ratings. No dependencies, no build.
//
//   POST /ping   { v, os }          one install was used this month (the app sends one a month)
//   POST /rate   { v, os, stars }   one rating, 1 to 5
//   GET  /stats                     the dashboard: a page with no numbers in it, which asks for the key (dashboard.mjs)
//   GET  /stats.json                the counts behind it, only with "Authorization: Bearer <STATS_KEY>"
//
// The key never travels in an address, so it is not in the browser's history, in a link someone forwards, or in
// any log of addresses. Only the key is secret: this code and schema.sql are meant to be public.
//
// It stores counts only: the day, the app version, the system, and for ratings the stars. No ID, no address,
// no time of day. The sender's address is used in passing to slow down someone flooding it (LIMIT), never stored.
//
// Run it on this PC (no Cloudflare account, no install):   node tools/counter/local.mjs
// Check it:                                               node --test tools/counter/worker.test.mjs
//
// Deploy (from tools/counter, once):
//   1. npx wrangler login
//   2. npx wrangler d1 create omnicam-counter        -> paste the database_id it prints into wrangler.jsonc
//   3. npx wrangler d1 execute omnicam-counter --remote --file=./schema.sql
//   4. npx wrangler secret put STATS_KEY             -> a long random password for /stats
//   5. npx wrangler deploy                           -> prints the address, https://omnicam-counter.<you>.workers.dev
// Then the app: DEFAULT_PING_URL in apps/desktop/src/main/usage-ping.ts becomes that address + /ping,
// after PRIVACY.md and the README say so.

import { page } from './dashboard.mjs';

const SYSTEMS = ['win32', 'linux', 'darwin'];
const MAX_BODY = 1024; // a ping is a few dozen bytes

const today = () => new Date().toISOString().slice(0, 10);

/** The request's JSON if it is a version, a known system and (for ratings) 1 to 5 stars; null for anything else. */
async function read(request, withStars) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body?.v !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(body.v) || !SYSTEMS.includes(body.os)) return null;
  if (withStars && !(Number.isInteger(body.stars) && body.stars >= 1 && body.stars <= 5)) return null;
  return body;
}

/** True when both strings are equal, taking the same time whatever they are. */
async function sameSecret(a, b) {
  const digest = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).run()).results;

/** The counts the dashboard draws: this month's breakdowns, a year of months, 30 days, and every rating. */
async function stats(db) {
  const day = today();
  const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
  const thisMonth = `${day.slice(0, 7)}-01`;
  const yearAgo = new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.parse(day) - 29 * 86_400_000).toISOString().slice(0, 10);
  const stars = await rows(db, 'SELECT stars, SUM(n) AS n FROM ratings GROUP BY stars ORDER BY stars DESC');
  const rated = stars.reduce((sum, r) => sum + r.n, 0);
  return {
    today: day,
    months: await rows(db, 'SELECT substr(day, 1, 7) AS month, SUM(n) AS n FROM pings WHERE day >= ? GROUP BY month ORDER BY month', yearAgo),
    days: await rows(db, 'SELECT day, SUM(n) AS n FROM pings WHERE day >= ? GROUP BY day ORDER BY day', monthAgo),
    versions: await rows(db, 'SELECT v, SUM(n) AS n FROM pings WHERE day >= ? GROUP BY v ORDER BY n DESC', thisMonth),
    systems: await rows(db, 'SELECT os, SUM(n) AS n FROM pings WHERE day >= ? GROUP BY os ORDER BY n DESC', thisMonth),
    stars,
    rated,
    average: rated ? stars.reduce((sum, r) => sum + r.stars * r.n, 0) / rated : null,
  };
}

// The page loads nothing from elsewhere and may only talk to this counter; the key in its address goes nowhere else.
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
  'referrer-policy': 'no-referrer',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // The page itself holds no numbers: it is the same for everyone, and useless without the key.
    if (request.method === 'GET' && url.pathname === '/stats') return new Response(page, { headers: PAGE_HEADERS });

    const counts = request.method === 'GET' && url.pathname === '/stats.json';
    const kind = request.method === 'POST' && { '/ping': 'ping', '/rate': 'rate' }[url.pathname];
    if (!counts && !kind) return new Response(null, { status: 404 });

    // Approximate and per Cloudflare location: enough to make flooding the counts, or guessing the key, tedious.
    // Absent when run locally.
    if (env.LIMIT && !(await env.LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' })).success) {
      return new Response(null, { status: 429 });
    }

    if (counts) {
      const given = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
      // No key set means nobody reads the counts, not everybody.
      if (!env.STATS_KEY || !(await sameSecret(given, env.STATS_KEY))) return new Response(null, { status: 401 });
      return Response.json(await stats(env.DB), { headers: { 'cache-control': 'no-store' } });
    }
    const body = await read(request, kind === 'rate');
    if (!body) return new Response(null, { status: 400 });

    if (kind === 'ping') {
      await env.DB.prepare('INSERT INTO pings (day, v, os, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, v, os) DO UPDATE SET n = n + 1')
        .bind(today(), body.v, body.os)
        .run();
    } else {
      await env.DB.prepare('INSERT INTO ratings (day, v, os, stars, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT (day, v, os, stars) DO UPDATE SET n = n + 1')
        .bind(today(), body.v, body.os, body.stars)
        .run();
    }
    return new Response(null, { status: 204 });
  },
};
