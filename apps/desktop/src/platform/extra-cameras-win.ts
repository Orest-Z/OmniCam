/*
 * "OmniCam 2" to "OmniCam 4" on Windows: the camera driver (omnicam_vcam.dll, 64- and 32-bit) lists them
 * with `regsvr32 /n /i:extra` and unlists them with `/u /n /i:extra`. That writes to HKLM, so it needs
 * administrator rights: one PowerShell runs another elevated (one UAC prompt), which runs regsvr32 for both
 * DLLs. Pure text here, so node --test covers the quoting; win.ts runs it.
 */

/** Where the video input category lists camera 2 (64-bit view): there means Extra cameras is on. */
export const EXTRA_CAMERA_KEY =
  'HKCR\\CLSID\\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\\Instance\\{33C613FC-37A2-4F6E-933B-D1BB4B4386EF}';

/** The outer PowerShell's exit code when the UAC prompt was dismissed (ERROR_CANCELLED). */
export const UAC_CANCELLED = 1223;

/** A path as a PowerShell single-quoted string: nothing in it is expanded, and ' is doubled. */
const quoted = (path: string) => `'${path.replace(/'/g, "''")}'`;

/** What runs elevated: regsvr32 for the 64-bit DLL, then the 32-bit one if it is there. Exits with the last failure. */
export function elevatedScript(on: boolean, nativeDir: string, systemRoot: string): string {
  const flags = on ? '/s /n /i:extra' : '/s /u /n /i:extra';
  const targets = [
    [`${systemRoot}\\System32\\regsvr32.exe`, `${nativeDir}\\omnicam_vcam.dll`],
    [`${systemRoot}\\SysWOW64\\regsvr32.exe`, `${nativeDir}\\x86\\omnicam_vcam.dll`],
  ];
  return [
    '$code = 0',
    ...targets.map(
      ([regsvr, dll]) =>
        `if (Test-Path -LiteralPath ${quoted(dll)}) { $p = Start-Process -FilePath ${quoted(regsvr)} -ArgumentList ('${flags} "' + ${quoted(dll)} + '"') -Wait -PassThru; if ($p.ExitCode -ne 0) { $code = $p.ExitCode } }`,
    ),
    'exit $code',
  ].join('\n');
}

/** PowerShell's -EncodedCommand form: base64 of UTF-16LE, so no quoting survives to go wrong. */
export const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

/** What runs as the user: starts the elevated one, waits, and passes its exit code on. */
export function launcherScript(powershell: string, elevated: string): string {
  return [
    'try {',
    `  $p = Start-Process -FilePath ${quoted(powershell)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded(elevated)}'`,
    '  exit $p.ExitCode',
    `} catch { exit ${UAC_CANCELLED} }`,
  ].join('\n');
}
