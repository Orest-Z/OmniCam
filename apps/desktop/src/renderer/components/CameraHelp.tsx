import { useEffect, useState } from 'react';
import { AlertTriangle, Download, RotateCcw, Wrench } from 'lucide-react';
import type { CameraSetupResult, Distro } from '../../shared/ipc';
import { describe, parseVcamError, setupProblem } from '../../shared/vcam-error';
import { Command } from './ui';

interface Props {
  vcamError: string;
  platform: NodeJS.Platform;
  distro: Distro;
}

/** Codes where the fix happens outside OmniCam and "Try again" is the next step. */
const RETRY = new Set([null, 'busy', 'format', 'io', 'permission']);

/**
 * A camera problem on Linux with its fix: a title, one line, commands to copy, and the "Set up camera"
 * or "Install camera driver" button where OmniCam can do it itself (one password prompt). Before an
 * install it lists what will change, with the commands folded away for doing it by hand. Used by the
 * pairing screen and Settings.
 */
const steps = (items: string[]) => items.map((s) => <li key={s}>{s}</li>);
const commands = (items: string[]) => items.map((c) => <Command key={c} text={c} />);

export function CameraHelp({ vcamError, platform, distro }: Props) {
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState<CameraSetupResult | null>(null);
  const error = parseVcamError(vcamError);
  // A new camera error replaces what the last setup said.
  useEffect(() => setFailed(null), [vcamError]);

  const help = failed ? describe(setupProblem(failed), platform, distro, failed.message) : describe(error.code, platform, distro, error.text);
  const driver = help.action === 'driver';
  const setup = async () => {
    setRunning(true);
    setFailed(null);
    const result = await window.omnicam.setupCamera(driver).catch((): CameraSetupResult => ({ status: 'failed' }));
    setRunning(false);
    // Success clears the error once the camera starts; a dismissed password prompt needs no comment.
    if (result.status === 'failed') setFailed(result);
  };

  return (
    <div className="notice bad camhelp" role="alert">
      <AlertTriangle />
      <div>
        <b>{help.title}</b>
        {help.line && <p>{help.line}</p>}
        {help.password && <p className="mokpass">{help.password}</p>}
        {help.steps && (help.password ? <ol>{steps(help.steps)}</ol> : <ul>{steps(help.steps)}</ul>)}
        {driver && help.steps ? (
          <details>
            <summary>Or do it yourself in a terminal</summary>
            {commands(help.commands)}
          </details>
        ) : (
          commands(help.commands)
        )}
        {help.action ? (
          <>
            <button className="btn primary sm" disabled={running} onClick={() => void setup()}>
              {driver ? <Download /> : <Wrench />}
              {driver ? (running ? 'Installing the driver…' : 'Install camera driver') : running ? 'Setting up…' : 'Set up camera'}
            </button>
            {running && driver && <p className="muted">Downloading and building the driver takes a few minutes. You can keep using your computer.</p>}
          </>
        ) : (
          RETRY.has(error.code) && (
            <button className="btn sm" onClick={() => void window.omnicam.retryCamera()}>
              <RotateCcw />
              Try again
            </button>
          )
        )}
      </div>
    </div>
  );
}
