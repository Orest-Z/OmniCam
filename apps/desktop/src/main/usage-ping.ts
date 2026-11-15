import type { AppSettings } from '../shared/ipc';

/*
 * What OmniCam tells its counter (tools/counter), and when.
 *
 * The usage ping: so the developer can tell roughly how many installs are in use. Only for people who said
 * yes to the one-time question (Settings → About switches it later). At most once a calendar month (UTC), and
 * only in a month the app runs, it sends the
 * app version and the operating system, and nothing else: no install ID, no hardware or network details.
 * Whoever receives it sees the sender's IP address, as with any request; the counter must not store it.
 *
 * The star rating: only when the user clicks a star, once per install: the stars, the version and the system.
 *
 * Pure here (what, when, where to), so node --test covers it; main/index.ts sends it.
 */

/**
 * Where the ping goes: the counter in tools/counter, deployed as a Cloudflare Worker. Empty would mean OmniCam
 * never asks and never pings. PRIVACY.md, the README and the website name this host and say what is sent;
 * test/usage-ping.test.ts fails if PRIVACY.md stops naming it.
 */
export const DEFAULT_PING_URL = 'https://omnicam-counter.orest-zogju.workers.dev/ping';

/** OMNICAM_PING_URL points a dev build at the counter run locally (node tools/counter/local.mjs). */
export const pingUrl = (env: NodeJS.ProcessEnv = process.env): string => env.OMNICAM_PING_URL ?? DEFAULT_PING_URL;

export const utcDay = (now = new Date()): string => now.toISOString().slice(0, 10);
export const utcMonth = (now = new Date()): string => now.toISOString().slice(0, 7);

/**
 * One ping per calendar month, and only for someone who agreed, with somewhere to send it. A month is enough to
 * tell how many installs are in use, and the fewer requests, the less there is to trust the counter with.
 */
export function pingDue(s: Pick<AppSettings, 'usagePing' | 'lastPingMonth'>, url: string, month = utcMonth()): boolean {
  return Boolean(url) && s.usagePing === 'on' && s.lastPingMonth !== month;
}

/** Everything a ping says. */
export const pingBody = (version: string, os: string): string => JSON.stringify({ v: version, os });

/** Where a star rating goes: the counter's /rate, next to its /ping. Empty when there is no counter. */
export function rateUrl(env: NodeJS.ProcessEnv = process.env): string {
  const ping = pingUrl(env);
  return ping ? new URL('rate', ping).href : '';
}

/** The window is untrusted like any renderer: a rating is a whole number from 1 to 5. */
export const validStars = (stars: unknown): stars is number => typeof stars === 'number' && Number.isInteger(stars) && stars >= 1 && stars <= 5;

/** Everything a rating says. */
export const rateBody = (version: string, os: string, stars: number): string => JSON.stringify({ v: version, os, stars });
