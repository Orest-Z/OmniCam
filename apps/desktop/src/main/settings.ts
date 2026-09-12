import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings } from '@omnicam/protocol';

/** Tiny JSON-file settings store. Deliberately dependency-free (electron-store is ESM-only). */
class SettingsStore {
  private file = join(app.getPath('userData'), 'settings.json');
  private data: AppSettings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<(s: AppSettings, prev: AppSettings) => void>();

  load(): AppSettings {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AppSettings>;
      this.data = { ...DEFAULT_SETTINGS, ...raw };
    } catch {
      this.data = { ...DEFAULT_SETTINGS };
    }
    return this.data;
  }

  get(): AppSettings {
    return this.data;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const prev = this.data;
    this.data = { ...prev, ...patch };
    try {
      mkdirSync(app.getPath('userData'), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('settings: write failed', err);
    }
    for (const l of this.listeners) l(this.data, prev);
    return this.data;
  }

  onChange(listener: (s: AppSettings, prev: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const settings = new SettingsStore();
