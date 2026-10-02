import { timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

/*
 * The checks that stand between the LAN and the virtual camera, kept free of Electron so they can be
 * tested with plain `node --test` (apps/desktop/test). server.ts and session.ts wire them up.
 */

/**
 * Constant-time token comparison. Lengths are compared in bytes: a string of the right length in
 * UTF-16 units but with non-ASCII characters has more UTF-8 bytes, and timingSafeEqual throws on
 * buffers of different lengths (which used to turn a wrong token into a 500).
 */
export function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Maps a request path to a regular file inside `root`, or null. The containment check is on a path
 * boundary (`root` + separator), not a string prefix, so a sibling such as `phone-old` next to `phone`
 * can never match. Extension-less paths that are not files fall back to index.html so deep links work.
 */
export function resolvePhoneFile(root: string, urlPath: string): string | null {
  const base = normalize(root).replace(/[\\/]+$/, '');
  const rel = normalize(urlPath === '/' ? '/index.html' : urlPath);
  const file = join(base, rel);
  if (!file.startsWith(base + sep)) return null;
  if (isFile(file)) return file;
  if (extname(rel) === '') {
    const index = join(base, 'index.html');
    return isFile(index) ? index : null;
  }
  return null;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Sliding-window budget of `burst` attempts per `windowMs` per client. Clients whose attempts have all
 * aged out are dropped once more than `maxClients` are tracked, so the map cannot grow without bound;
 * evicting by age (not insertion order) means cycling through addresses cannot clear anyone else's budget.
 */
export class AttemptBudget {
  private attempts = new Map<string, number[]>();
  private readonly burst: number;
  private readonly windowMs: number;
  private readonly maxClients: number;

  // Plain fields, not parameter properties: node --test runs this file with type stripping only.
  constructor(burst: number, windowMs: number, maxClients = 64) {
    this.burst = burst;
    this.windowMs = windowMs;
    this.maxClients = maxClients;
  }

  /** Records an attempt and says whether it is within budget. A refused attempt is not recorded. */
  allow(client: string, now = Date.now()): boolean {
    const fresh = (list: number[]) => list.filter((t) => now - t < this.windowMs);
    if (this.attempts.size > this.maxClients) {
      for (const [key, list] of this.attempts) if (fresh(list).length === 0) this.attempts.delete(key);
    }
    const list = fresh(this.attempts.get(client) ?? []);
    if (list.length >= this.burst) return false;
    list.push(now);
    this.attempts.set(client, list);
    return true;
  }

  get trackedClients(): number {
    return this.attempts.size;
  }
}
