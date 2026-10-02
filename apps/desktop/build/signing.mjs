// Helpers for the signed release build in CI (.github/workflows/build.yml, "Signed installer").
//
// The signed build packages in two passes around SignPath: the app directory is signed first, then
// the NSIS installer is built from it with --prepackaged and signed in turn. Two things electron-builder
// would normally do have to be redone by hand:
//
//   node build/signing.mjs app-update-yml <appDir>
//     Writes resources/app-update.yml (where the installed app looks for updates). electron-builder
//     writes it after packing, and a prepackaged build skips packing.
//
//   node build/signing.mjs refresh-latest <releaseDir>
//     Recomputes latest.yml and the .blockmap from the signed installer. electron-builder wrote both
//     for the unsigned file; signing changes its bytes, so every in-app update would fail the sha512
//     check against a stale latest.yml.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function appUpdateYml(appDir) {
  const yaml = require('js-yaml');
  const config = yaml.load(readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
  const { provider, owner, repo } = config.publish;
  // Same name electron-builder derives (AppInfo.updaterCacheDirName): the download cache folder.
  const updaterCacheDirName = `${pkg.name.replace(/[/\\]/g, '').toLowerCase()}-updater`;
  const out = join(appDir, 'resources', 'app-update.yml');
  writeFileSync(out, yaml.dump({ owner, repo, provider, updaterCacheDirName }));
  console.log(`wrote ${out}`);
}

async function refreshLatest(releaseDir) {
  const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');
  const latestFile = join(releaseDir, 'latest.yml');
  const latest = readFileSync(latestFile, 'utf8');
  const installer = latest.match(/^path:\s*(.+)$/m)?.[1].trim();
  if (!installer || !readdirSync(releaseDir).includes(installer)) {
    throw new Error(`latest.yml names "${installer}", which is not in ${releaseDir}`);
  }

  // Same call electron-builder makes for an NSIS target: gzip blockmap next to the file.
  const file = join(releaseDir, installer);
  const { sha512, size } = await buildBlockMap(file, 'gzip', `${file}.blockmap`);

  const updated = latest
    .replace(/^(\s*sha512:\s*).+$/gm, `$1${sha512}`)
    .replace(/^(\s*size:\s*).+$/gm, `$1${size}`);
  writeFileSync(latestFile, updated);
  console.log(`latest.yml and ${installer}.blockmap now describe the signed installer (${size} bytes)`);
}

const [command, dir] = process.argv.slice(2);
if (command === 'app-update-yml' && dir) appUpdateYml(resolve(dir));
else if (command === 'refresh-latest' && dir) await refreshLatest(resolve(dir));
else {
  console.error('usage: node build/signing.mjs app-update-yml <appDir> | refresh-latest <releaseDir>');
  process.exit(2);
}
