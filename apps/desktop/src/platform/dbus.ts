/** Reading gdbus output. Pure (no Electron), so node --test covers it. */

/**
 * `gdbus call` prints a reply as a GVariant tuple: `(true,)` for NameHasOwner. Anything else (an
 * error, empty output, a changed format) reads as false.
 */
export function parseBooleanReply(stdout: string): boolean {
  return /^\(\s*true\s*,\s*\)$/.test(stdout.trim());
}

/** The tray host GNOME lacks without the AppIndicator extension; KDE, XFCE, Cinnamon… provide one. */
export const STATUS_NOTIFIER_WATCHER = 'org.kde.StatusNotifierWatcher';
