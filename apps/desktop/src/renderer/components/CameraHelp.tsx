import { useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw, Wrench } from 'lucide-react';
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
 * button where OmniCam can do it itself (one password prompt). Used by the pairing screen and Settings.
 */
export function CameraHelp({ vcamError, platform, distro }: Props) {
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState<CameraSetupResult | null>(null);
  const error = parseVcamError(vcamError);
  // A new camera error replaces what the last setup said.
  useEffect(() => setFailed(null), [vcamError]);

  const help = failed ? describe(setupProblem(failed), platform, distro, failed.message) : describe(error.code, platform, distro, error.text);
  const setup = async () => {
    setRunning(true);
    setFailed(null);
    const result = await window.omnicam.setupCamera().catch((): CameraSetupResult => ({ status: 'failed' }));
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
        {help.commands.map((c) => (
          <Command key={c} text={c} />
        ))}
        {help.action === 'setup' ? (
          <button className="btn primary sm" disabled={running} onClick={() => void setup()}>
            <Wrench />
            {running ? 'Setting up…' : 'Set up camera'}
          </button>
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
