/**
 * XDG Desktop Entry text for the Linux login item, per the Desktop Entry Specification. Pure (no
 * Electron), so node --test covers it.
 */

// Characters that force an Exec argument into double quotes ("Exec key" in the spec).
const RESERVED = /[\s"'\\><~|&;$*?#()`]/;

/**
 * One Exec argument. Quoted when it holds a reserved character; inside the quotes `"`, `` ` ``, `$` and
 * `\` take a backslash. A literal `%` would start a field code, so it is doubled.
 */
export function quoteExecArg(arg: string): string {
  const field = arg.replace(/%/g, '%%');
  if (!RESERVED.test(field) && field !== '') return field;
  return `"${field.replace(/["`$\\]/g, '\\$&')}"`;
}

/** A value of type string: backslash escapes are decoded before the Exec rules apply. */
function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
}

export function execLine(argv: string[]): string {
  return escapeString(argv.map(quoteExecArg).join(' '));
}

/** The autostart entry that starts OmniCam with `argv` at login. */
export function autostartEntry(argv: string[]): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=OmniCam',
    'Comment=Use your phone as a webcam',
    `Exec=${execLine(argv)}`,
    'Icon=omnicam',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** `$XDG_CONFIG_HOME/autostart/omnicam.desktop`; the spec says to ignore a relative XDG_CONFIG_HOME. */
export function autostartPath(xdgConfigHome: string | undefined, home: string): string {
  const base = xdgConfigHome && xdgConfigHome.startsWith('/') ? xdgConfigHome : `${home}/.config`;
  return `${base.replace(/\/+$/, '')}/autostart/omnicam.desktop`;
}
