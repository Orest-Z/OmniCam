import { app } from 'electron';
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 1.0.0 derived the user-data folder from the package name ("@omnicam/desktop"), so settings
 * and the TLS certificate ended up in %APPDATA%\@omnicam\desktop. Later versions use
 * %APPDATA%\OmniCam. Carry the two things worth keeping over once; the phone keeps its
 * certificate exception that way. Must run before anything reads settings.
 */
export function migrateLegacyUserData(): void {
  const current = app.getPath('userData');
  const legacy = join(app.getPath('appData'), '@omnicam', 'desktop');
  if (legacy === current || !existsSync(legacy)) return;
  if (existsSync(join(current, 'settings.json'))) return; // already migrated (or fresh settings exist)
  try {
    for (const entry of ['settings.json', 'tls']) {
      const from = join(legacy, entry);
      if (existsSync(from)) cpSync(from, join(current, entry), { recursive: true });
    }
    console.log(`migrated user data from ${legacy} (${readdirSync(current).join(', ')})`);
  } catch (err) {
    console.warn('user data migration failed', err);
  }
}
