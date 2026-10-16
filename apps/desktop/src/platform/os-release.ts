import type { Distro } from '../shared/ipc';

/**
 * Which family a Linux distribution belongs to, from /etc/os-release (ID, then ID_LIKE), for the
 * install commands OmniCam shows. Pure (no Electron), so node --test covers it.
 */
export function distroFrom(osRelease: string): Distro {
  const value = (key: string) =>
    (osRelease.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? '')
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')
      .toLowerCase();
  const ids = [value('ID'), ...value('ID_LIKE').split(/\s+/)].filter(Boolean);
  for (const id of ids) {
    if (id === 'fedora' || id === 'rhel' || id === 'centos') return 'fedora';
    if (id === 'debian' || id === 'ubuntu') return 'debian';
    if (id === 'arch') return 'arch';
  }
  return 'other';
}
