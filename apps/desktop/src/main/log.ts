import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';

/**
 * Plain-text log file next to the settings, so a user can send it with a bug report:
 *   %APPDATA%\OmniCam\logs\omnicam.log   (previous run kept as omnicam.1.log at rotation)
 *
 * Everything that goes through console.* in the main process lands here (the engine's logs are
 * relayed to main over IPC, so they do too). Nothing is uploaded anywhere.
 */
const MAX_BYTES = 2 * 1024 * 1024;

let dir = '';
let file = '';
let installed = false;

export function logDir(): string {
  return dir;
}

function rotateIfNeeded() {
  try {
    if (statSync(file).size < MAX_BYTES) return;
    const old = join(dir, 'omnicam.1.log');
    if (existsSync(old)) unlinkSync(old);
    renameSync(file, old);
  } catch {
    /* no file yet */
  }
}

function write(level: string, args: unknown[]) {
  if (!file) return;
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${format(...args)}\n`;
  try {
    appendFileSync(file, line);
  } catch {
    /* disk full or folder gone: never let logging crash the app */
  }
}

/** Mirrors console.log/warn/error into the log file. Idempotent. */
export function installFileLog(): void {
  if (installed) return;
  installed = true;
  dir = join(app.getPath('userData'), 'logs');
  file = join(dir, 'omnicam.log');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    file = '';
    return;
  }
  rotateIfNeeded();

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      write(level === 'log' ? 'info' : level, args);
    };
  }

  process.on('uncaughtException', (err) => console.error('uncaught exception', err));
  process.on('unhandledRejection', (reason) => console.error('unhandled rejection', reason));

  console.log(
    `--- OmniCam ${app.getVersion()} starting | ${process.platform} ${release()} | electron ${process.versions.electron} chrome ${process.versions.chrome} | packaged=${app.isPackaged} args=${process.argv.slice(1).join(' ')}`,
  );
}
