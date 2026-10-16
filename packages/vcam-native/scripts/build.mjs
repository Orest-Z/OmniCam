// Builds the native pieces and drops them where the desktop app expects them:
//   apps/desktop/resources/native/omnicam_vcam.node        (N-API addon, x64, Electron ABI)
//   apps/desktop/resources/native/omnicam_vcam.dll         (Windows: DirectShow filter, x64)
//   apps/desktop/resources/native/x86/omnicam_vcam.dll     (Windows: DirectShow filter, x86 for 32-bit apps)
// Linux builds the addon only; its camera is the v4l2loopback kernel module, set up by the app.
//
// Usage: node scripts/build.mjs [--skip-x86] [--debug]
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const repoRoot = resolve(pkgDir, '..', '..');
const outDir = resolve(repoRoot, 'apps', 'desktop', 'resources', 'native');
const args = new Set(process.argv.slice(2));
const config = args.has('--debug') ? 'Debug' : 'Release';
const isWin = process.platform === 'win32';
// No 32-bit consumers to serve outside Windows.
const buildX86 = isWin && !args.has('--skip-x86');

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
  console.log(`
> ${cmd} ${cmdArgs.join(' ')}`);
  // npm-installed CLIs are .cmd shims on Windows; run them via cmd.exe without shell interpolation
  // of our own arguments (they contain no user input, but keep the deprecation warning away).
  const exe = isWin && cmd === 'npx' ? 'npx.cmd' : cmd;
  const r = spawnSync(exe, cmdArgs, { stdio: 'inherit', cwd: pkgDir, shell: isWin && cmd === 'npx', ...opts });
  if (r.status !== 0) {
    console.error(`
${cmd} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

const electron = electronVersion();
console.log(`OmniCam native build — Electron ${electron}, ${config}`);

// 1) Addon (+ x64 filter DLL on Windows) through cmake-js: fetches Electron headers, picks the VS
//    generator on Windows and Makefiles or Ninja elsewhere.
run('npx', [
  'cmake-js', 'compile',
  '--runtime', 'electron', '--runtime-version', electron, '--arch', 'x64',
  ...(config === 'Debug' ? ['--debug'] : []),
  ...(isWin ? ['--CDOMNICAM_BUILD_FILTER=ON'] : []),
]);

// 2) x86 filter DLL: plain CMake, separate build tree, addon disabled.
if (buildX86) {
  run('cmake', ['-S', '.', '-B', 'build-x86', '-A', 'Win32', '-DOMNICAM_BUILD_ADDON=OFF']);
  run('cmake', ['--build', 'build-x86', '--config', config, '--target', 'omnicam_vcam_filter']);
}

// 3) Collect outputs. cmake-js puts them in build/<config> with every generator: the VS generator's
//    per-config folder on Windows, CMAKE_LIBRARY_OUTPUT_DIRECTORY with a single-config one.
mkdirSync(isWin ? join(outDir, 'x86') : outDir, { recursive: true });
const copies = [[join(pkgDir, 'build', config, 'omnicam_vcam.node'), join(outDir, 'omnicam_vcam.node')]];
if (isWin) copies.push([join(pkgDir, 'build', config, 'omnicam_vcam.dll'), join(outDir, 'omnicam_vcam.dll')]);
if (buildX86) {
  copies.push([join(pkgDir, 'build-x86', config, 'omnicam_vcam.dll'), join(outDir, 'x86', 'omnicam_vcam.dll')]);
}
const locked = [];
for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.error(`missing build output: ${from}`);
    process.exit(1);
  }
  if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) {
    console.log(`unchanged ${to}`);
    continue;
  }
  try {
    if (isWin) {
      copyFileSync(from, to);
    } else {
      // A running OmniCam has the old .node mapped: overwriting it in place would crash that app,
      // replacing the directory entry leaves its copy intact.
      copyFileSync(from, `${to}.tmp`);
      renameSync(`${to}.tmp`, to);
    }
    console.log(`copied ${to}`);
  } catch (err) {
    if (err.code === 'EBUSY') {
      // The registered filter DLL is mapped into every process that enumerated cameras. Its
      // sources rarely change, so keep the existing file and say so loudly instead of failing.
      locked.push(to);
      continue;
    }
    throw err;
  }
}
if (locked.length) {
  console.warn(`\nWARNING: kept the existing file, it is in use by a running app that has the camera loaded:\n  ${locked.join('\n  ')}\nClose those apps and re-run if the filter sources changed.`);
}
console.log(
  isWin
    ? '\nDone. Register the driver once (admin): npm run native:register'
    : '\nDone. The camera device is set up by the app (Settings → Camera).',
);
