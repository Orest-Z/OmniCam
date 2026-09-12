// Builds the native pieces and drops them where the desktop app expects them:
//   apps/desktop/resources/native/omnicam_vcam.node        (N-API addon, x64, Electron ABI)
//   apps/desktop/resources/native/omnicam_vcam.dll         (DirectShow filter, x64)
//   apps/desktop/resources/native/x86/omnicam_vcam.dll     (DirectShow filter, x86 for 32-bit apps)
//
// Usage: node scripts/build.mjs [--skip-x86] [--debug]
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const repoRoot = resolve(pkgDir, '..', '..');
const outDir = resolve(repoRoot, 'apps', 'desktop', 'resources', 'native');
const args = new Set(process.argv.slice(2));
const config = args.has('--debug') ? 'Debug' : 'Release';

function electronVersion() {
  for (const p of [
    join(repoRoot, 'node_modules', 'electron', 'package.json'),
    join(repoRoot, 'apps', 'desktop', 'node_modules', 'electron', 'package.json'),
  ]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).version;
  }
  throw new Error('electron is not installed; run npm install first');
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32', cwd: pkgDir, ...opts });
  if (r.status !== 0) {
    console.error(`\n${cmd} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

const electron = electronVersion();
console.log(`OmniCam native build — Electron ${electron}, ${config}`);

// 1) Addon + x64 filter DLL through cmake-js (fetches Electron headers, picks the VS generator).
run('npx', [
  'cmake-js', 'compile',
  '--runtime', 'electron', '--runtime-version', electron, '--arch', 'x64',
  ...(config === 'Debug' ? ['--debug'] : []),
  '--CDOMNICAM_BUILD_FILTER=ON',
]);

// 2) x86 filter DLL: plain CMake, separate build tree, addon disabled.
if (!args.has('--skip-x86')) {
  run('cmake', ['-S', '.', '-B', 'build-x86', '-A', 'Win32', '-DOMNICAM_BUILD_ADDON=OFF']);
  run('cmake', ['--build', 'build-x86', '--config', config, '--target', 'omnicam_vcam_filter']);
}

// 3) Collect outputs.
mkdirSync(join(outDir, 'x86'), { recursive: true });
const copies = [
  [join(pkgDir, 'build', config, 'omnicam_vcam.node'), join(outDir, 'omnicam_vcam.node')],
  [join(pkgDir, 'build', config, 'omnicam_vcam.dll'), join(outDir, 'omnicam_vcam.dll')],
];
if (!args.has('--skip-x86')) {
  copies.push([join(pkgDir, 'build-x86', config, 'omnicam_vcam.dll'), join(outDir, 'x86', 'omnicam_vcam.dll')]);
}
for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.error(`missing build output: ${from}`);
    process.exit(1);
  }
  copyFileSync(from, to);
  console.log(`copied ${to}`);
}
console.log('\nDone. Register the driver once (admin): npm run native:register');
