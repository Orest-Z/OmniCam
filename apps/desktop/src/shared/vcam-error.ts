import type { CameraSetupResult, Distro } from './ipc';

/**
 * What to tell the user about a camera problem. The addon (and the engine for a missing addon) starts
 * every reason with a code, "<code>: <sentence for the log>"; the UI turns the code into a title, one
 * line, commands to copy and, where OmniCam can fix it itself, the "Set up camera" button. Pure, so
 * node --test covers it, and shared by the banner and Settings.
 */

export const VCAM_ERROR_CODES = ['not-registered', 'busy', 'no-module', 'not-loaded', 'no-device', 'permission', 'format', 'io', 'no-addon'] as const;
export type VcamErrorCode = (typeof VCAM_ERROR_CODES)[number];

/** Problems the camera setup itself reports (its exit codes), beside the addon's codes. */
type SetupProblem = 'secure-boot' | 'config-conflict' | 'setup-failed';

export interface VcamError {
  /** Null for a reason without a known code (an engine crash, a pipeline check): shown as it is. */
  code: VcamErrorCode | null;
  /** The sentence after the code. */
  text: string;
}

export interface VcamHelp {
  title: string;
  line: string;
  /** Terminal commands, in order; each gets a copy button. */
  commands: string[];
  /** OmniCam can do it itself: the "Set up camera" button (one password prompt). */
  action?: 'setup';
}

// The engine puts this before the addon's reason when start() throws.
const ENGINE_PREFIX = /^virtual camera failed to start:\s*/;

export function parseVcamError(message: string): VcamError {
  const rest = message.replace(ENGINE_PREFIX, '');
  const m = rest.match(/^([a-z-]+):\s*(.*)$/s);
  const code = m && (VCAM_ERROR_CODES as readonly string[]).includes(m[1]) ? (m[1] as VcamErrorCode) : null;
  return code ? { code, text: m![2] } : { code: null, text: rest };
}

/**
 * The setup script's exit code (build/linux/omnicam-camera-setup.sh: 10 no module, 13 busy, 14 Secure
 * Boot, 15 another v4l2loopback config) as the problem to explain; null when there is nothing to say.
 */
export function setupProblem(result: CameraSetupResult): VcamErrorCode | SetupProblem | null {
  if (result.status !== 'failed') return null;
  switch (result.exitCode) {
    case 10:
      return 'no-module';
    case 13:
      return 'busy';
    case 14:
      return 'secure-boot';
    case 15:
      return 'config-conflict';
    default:
      return 'setup-failed';
  }
}

function installModule(distro: Distro): string[] {
  if (distro === 'fedora') {
    return [
      'sudo dnf install https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm',
      'sudo dnf install akmod-v4l2loopback',
    ];
  }
  if (distro === 'debian') return ['sudo apt install v4l2loopback-dkms'];
  if (distro === 'arch') return ['sudo pacman -S v4l2loopback-dkms linux-headers'];
  return [];
}

function enrollKey(distro: Distro): string[] {
  if (distro === 'fedora') return ['sudo kmodgenca -a', 'sudo mokutil --import /etc/pki/akmods/certs/public_key.der', 'systemctl reboot'];
  if (distro === 'debian') return ['sudo update-secureboot-policy --enroll-key', 'systemctl reboot'];
  if (distro === 'arch') return ['sudo mokutil --import /var/lib/dkms/mok.pub', 'systemctl reboot'];
  return [];
}

/**
 * Help for a camera problem on this platform. `detail`: the sentence that came with it (the addon's,
 * or the setup script's last line), used where it names something the user must find.
 */
export function describe(problem: VcamErrorCode | SetupProblem | null, platform: NodeJS.Platform, distro: Distro, detail = ''): VcamHelp {
  const linux = platform === 'linux';
  switch (problem) {
    case 'not-registered':
      return { title: 'Camera not registered', line: 'Run the OmniCam installer again to register it.', commands: [] };
    case 'no-addon':
      return {
        title: "OmniCam's camera part is missing",
        line: 'Install OmniCam again. From a source checkout, build it with npm run native:build.',
        commands: [],
      };
    case 'no-module': {
      const commands = installModule(distro);
      return {
        title: 'Install the camera driver',
        line:
          (commands.length
            ? "OmniCam's camera needs v4l2loopback, a small kernel module. Install it, then click Set up camera."
            : "OmniCam's camera needs v4l2loopback, a small kernel module. Install it with your package manager, then click Set up camera.") +
          (distro === 'fedora' ? ' If the install updates your kernel, restart first.' : ''),
        commands,
        action: 'setup',
      };
    }
    case 'not-loaded':
    case 'no-device':
      return {
        title: 'Set up the camera',
        line: 'One step, once: OmniCam asks for your password to add its camera, and it stays after restarts.',
        commands: [],
        action: 'setup',
      };
    case 'permission':
      return {
        title: 'Allow access to cameras',
        line: "Your account can't open the camera device. Try again in a moment; if it keeps failing, add yourself to the video group, then sign out and back in.",
        commands: ['sudo usermod -aG video $USER'],
      };
    case 'busy':
      return linux
        ? {
            title: 'The camera device is busy',
            line: "Another program holds it, so OmniCam can't start or resize it. Close the apps using a camera (OBS's virtual camera uses the same kind of device), then try again.",
            commands: [],
          }
        : { title: 'The camera is busy', line: 'Another OmniCam may be running. Quit it, then try again.', commands: [] };
    case 'format':
      return {
        title: 'The camera device refused the format',
        line: 'Close the apps using the camera and try again, or pick another output resolution.',
        commands: [],
      };
    case 'io':
      return { title: 'The camera device failed', line: detail || 'Try again; the log folder (Settings → About) has details.', commands: [] };
    case 'secure-boot':
      return {
        title: 'Secure Boot blocked the camera driver',
        line: 'Your computer only loads drivers signed with a key it trusts. Enroll the key once: run these, pick a one-time password, and after the restart choose Enroll MOK on the blue screen. Then click Set up camera again.',
        commands: enrollKey(distro),
        action: 'setup',
      };
    case 'config-conflict':
      return {
        title: 'Another camera setup is in the way',
        line: `${detail ? `${detail} ` : ''}Remove or rename that file, then click Set up camera again.`,
        commands: [],
        action: 'setup',
      };
    case 'setup-failed':
      return { title: "Camera setup didn't finish", line: detail || 'The log folder (Settings → About) has details.', commands: [], action: 'setup' };
    default:
      return { title: "The camera isn't available", line: detail, commands: [] };
  }
}
