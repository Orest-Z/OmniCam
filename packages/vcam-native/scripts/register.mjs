// `npm run native:register` / `native:unregister`. Windows registers the DirectShow filter
// (scripts/register.ps1, admin); Linux has nothing to register: its camera is the v4l2loopback
// module, which the app sets up once.
//
// Usage: node scripts/register.mjs [-Unregister]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('Nothing to register here: OmniCam sets up its camera device from the app (Settings → Camera).');
  process.exit(0);
}

const script = join(dirname(fileURLToPath(import.meta.url)), 'register.ps1');
const r = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(r.status ?? 1);
