import type { Server } from 'node:https';
import { API_LINK_PATH, LINK_HEADER_BYTES, MAX_CAMERAS } from '@omnicam/protocol';
import { WebSocket, WebSocketServer } from 'ws';
import { engine } from './engine-bridge';
import { AttemptBudget, cameraIndex } from './pairing-guard';
import { session } from './session';

/**
 * The server side of the media link (see API_LINK_PATH): checks who connects and passes messages between
 * the phone and the engine. One phone per camera; a new one takes that camera over, as it does on WebRTC.
 */
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const PING_EVERY_MS = 5000;
const MISSED_PINGS_ALLOWED = 3; // a hotspot that vanishes never closes the socket by itself
const budget = new AttemptBudget(20, 60_000);

/** The socket of each camera's phone. */
const current = new Array<WebSocket | null>(MAX_CAMERAS).fill(null);

engine.on('link-send', (camera: number, text: string | null) => {
  const ws = current[camera];
  if (text === null) ws?.close();
  else if (ws?.readyState === WebSocket.OPEN) ws.send(text);
});
// A restarted engine knows nothing about these phones: closing makes them connect again.
engine.on('restarted', () => current.forEach((ws) => ws?.close()));

function originMatches(origin: string | undefined, host: string | undefined): boolean {
  try {
    return Boolean(origin) && new URL(origin!).host === host;
  } catch {
    return false;
  }
}

function accept(ws: WebSocket, camera: number): void {
  current[camera]?.close();
  current[camera] = ws;
  engine.link(camera, 'open');

  let missed = 0;
  const pings = setInterval(() => {
    if (++missed > MISSED_PINGS_ALLOWED) ws.terminate();
    else ws.ping();
  }, PING_EVERY_MS);
  ws.on('pong', () => (missed = 0));

  ws.on('message', (data: Buffer, binary) => {
    missed = 0;
    if (ws !== current[camera]) return;
    if (binary) {
      if (data.length > LINK_HEADER_BYTES) engine.link(camera, data);
      return;
    }
    try {
      const msg: unknown = JSON.parse(data.toString('utf8'));
      if (typeof (msg as { type?: unknown } | null)?.type === 'string') engine.link(camera, msg as object);
    } catch {
      /* ignore malformed */
    }
  });
  ws.on('error', (err) => console.warn('link: socket error', String(err)));
  ws.on('close', (code) => {
    clearInterval(pings);
    console.log(`link: socket closed, code ${code}`);
    if (ws !== current[camera]) return;
    current[camera] = null;
    engine.link(camera, 'close');
  });
}

/** Before the server closes: its close() waits for open sockets, and an upgraded one never ends by itself. */
export function closeLink(): void {
  current.forEach((ws) => ws?.terminate());
}

export function attachLink(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'https://localhost');
    const from = req.socket.remoteAddress ?? '?';
    // The Origin check keeps other web pages the phone has open from opening this socket.
    const allowed =
      url.pathname === API_LINK_PATH &&
      originMatches(req.headers.origin, req.headers.host) &&
      session.validate(url.searchParams.get('t')) &&
      budget.allow(from);
    // Untrusted like the rest of the URL: a camera that is not on gets the same refusal.
    const camera = allowed ? cameraIndex(url.searchParams.get('cam'), engine.count > 1, MAX_CAMERAS) : null;
    if (camera === null) {
      console.warn(`link: refused ${from}`);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log(`link: socket from ${from} to ${req.socket.localAddress}${camera ? ` for camera ${camera + 1}` : ''}`);
      accept(ws, camera);
    });
  });
}
