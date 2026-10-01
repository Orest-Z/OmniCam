import { app } from 'electron';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  API_HEALTH_PATH,
  API_SESSION_PATH,
  type HealthResponse,
  type SessionError,
  type SessionRequest,
  type SessionResponse,
} from '@omnicam/protocol';
import type { TlsMaterial } from './cert';
import { session } from './session';
import { engine } from './engine-bridge';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/** Where the built phone page lives (dev: repo resources dir; packaged: extraResources). */
export function phoneRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'phone')
    : join(app.getAppPath(), 'resources', 'phone');
}

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readJson(req: IncomingMessage, limit = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function serveStatic(res: ServerResponse, urlPath: string) {
  const root = phoneRoot();
  const rel = normalize(urlPath === '/' ? '/index.html' : urlPath);
  const file = join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  let stat;
  try {
    stat = statSync(file);
  } catch {
    // Unknown extension-less path: fall back to the page so odd deep links still work.
    if (extname(rel) === '') return serveStatic(res, '/');
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}

// One negotiation at a time and a budget per client: a misbehaving device on the LAN cannot keep the
// engine busy renegotiating (each attempt tears down the current phone). The budget has to stay well
// clear of legitimate traffic — a phone whose Wi-Fi drops retries every 10 s at the end of its
// backoff, and several phones can share one address behind a router.
const SESSION_BURST = 20;
const SESSION_WINDOW_MS = 60_000;
const SESSION_RETRY_AFTER_S = 5;
const REJECT_LOG_INTERVAL_MS = 5_000;
const attempts = new Map<string, number[]>();
let negotiating = false;
let lastRejectLogAt = 0;

function sessionAllowed(ip: string): boolean {
  const now = Date.now();
  const fresh = (list: number[]) => list.filter((t) => now - t < SESSION_WINDOW_MS);
  // Drop clients whose attempts have all aged out, so the map cannot grow without bound. Evicting by
  // age (not by insertion order) means cycling through addresses cannot clear anyone else's budget.
  if (attempts.size > 64) {
    for (const [key, list] of attempts) if (fresh(list).length === 0) attempts.delete(key);
  }
  const list = fresh(attempts.get(ip) ?? []);
  if (list.length >= SESSION_BURST) return false;
  list.push(now);
  attempts.set(ip, list);
  return true;
}

/**
 * A rejected pairing attempt is otherwise invisible: the phone shows "Reconnecting…" and the log says
 * nothing, which makes it impossible to explain after the fact. Rate-limited, so a device that hammers
 * the endpoint cannot fill the log either.
 */
function logRejected(ip: string, reason: string) {
  const now = Date.now();
  if (now - lastRejectLogAt < REJECT_LOG_INTERVAL_MS) return;
  lastRejectLogAt = now;
  console.warn(`session: refused ${ip} (${reason}); the phone will retry`);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'https://localhost');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');

  if (req.method === 'GET' && url.pathname === API_HEALTH_PATH) {
    const body: HealthResponse = { ok: true, app: 'omnicam', version: app.getVersion() };
    return json(res, 200, body);
  }

  if (req.method === 'POST' && url.pathname === API_SESSION_PATH) {
    let body: SessionRequest;
    try {
      body = (await readJson(req)) as SessionRequest;
      if (typeof body.sdp !== 'string' || !body.sdp.startsWith('v=0')) throw new Error('bad sdp');
    } catch (err) {
      const e: SessionError = { ok: false, error: 'bad-request', message: String(err) };
      return json(res, 400, e);
    }
    if (!session.validate(body.token)) {
      const e: SessionError = { ok: false, error: 'bad-token' };
      return json(res, 403, e);
    }
    const ip = req.socket.remoteAddress ?? '?';
    if (negotiating || !sessionAllowed(ip)) {
      logRejected(ip, negotiating ? 'another phone is negotiating' : `more than ${SESSION_BURST} attempts a minute`);
      const e: SessionError = { ok: false, error: 'busy', retryAfterSeconds: SESSION_RETRY_AFTER_S };
      res.setHeader('retry-after', String(SESSION_RETRY_AFTER_S));
      return json(res, 429, e);
    }
    negotiating = true;
    try {
      console.log(`session: ${body.device.platform} from ${req.socket.remoteAddress}`);
      const result = await engine.negotiate(body.sdp, body.device);
      const ok: SessionResponse = { ok: true, ...result };
      return json(res, 200, ok);
    } catch (err) {
      const message = (err as Error).message;
      const error: SessionError['error'] = /timeout/i.test(message)
        ? 'timeout'
        : /engine/i.test(message)
          ? 'engine-unavailable'
          : 'internal';
      const e: SessionError = { ok: false, error, message };
      return json(res, 503, e);
    } finally {
      negotiating = false;
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, url.pathname);
  res.writeHead(405).end();
}

export class PhoneServer {
  private server: Server | null = null;

  async start(tls: TlsMaterial, preferredPort: number): Promise<number> {
    await this.stop();
    const server = createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, (req, res) => {
      handle(req, res).catch((err) => {
        console.error('server: unhandled', err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    server.keepAliveTimeout = 15_000;
    this.server = server;

    const listen = (port: number) =>
      new Promise<number>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve((server.address() as AddressInfo).port);
        };
        server.once('error', onError).once('listening', onListening);
        server.listen(port, '0.0.0.0');
      });

    try {
      return await listen(preferredPort);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      console.warn(`server: port ${preferredPort} busy, using a random one`);
      return listen(0);
    }
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      const s = this.server;
      this.server = null;
      if (!s) return resolve();
      s.close(() => resolve());
      s.closeAllConnections?.();
    });
  }
}

export const phoneServer = new PhoneServer();
