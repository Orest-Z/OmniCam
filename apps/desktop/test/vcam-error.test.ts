import { strict as assert } from 'node:assert';
import { describe as group, test } from 'node:test';
import { describe, parseVcamError, setupProblem, VCAM_ERROR_CODES } from '../src/shared/vcam-error.ts';
import { firewallSteps } from '../src/shared/firewall.ts';

const DISTROS = ['fedora', 'debian', 'arch', 'other'] as const;

group('parseVcamError', () => {
  test('a code from the addon, with or without the engine prefix', () => {
    assert.deepEqual(parseVcamError('not-loaded: the v4l2loopback module is installed but not loaded'), {
      code: 'not-loaded',
      text: 'the v4l2loopback module is installed but not loaded',
    });
    assert.deepEqual(parseVcamError('virtual camera failed to start: busy: /dev/video63 is in use'), { code: 'busy', text: '/dev/video63 is in use' });
    assert.deepEqual(parseVcamError("no-addon: native addon not available: Cannot find module '/x/omnicam_vcam.node'"), {
      code: 'no-addon',
      text: "native addon not available: Cannot find module '/x/omnicam_vcam.node'",
    });
  });

  test('Windows codes', () => {
    assert.equal(parseVcamError('virtual camera failed to start: not-registered: OmniCam camera driver is not registered').code, 'not-registered');
  });

  test('no code, or an unknown one, is a generic error shown as it is', () => {
    assert.deepEqual(parseVcamError('virtual camera failed to start: output size must be positive and a multiple of 4'), {
      code: null,
      text: 'output size must be positive and a multiple of 4',
    });
    assert.equal(parseVcamError('weird: something').code, null);
    assert.equal(parseVcamError('The camera engine crashed repeatedly.').code, null);
  });
});

group('setupProblem', () => {
  test('the setup exit codes', () => {
    assert.equal(setupProblem({ status: 'failed', exitCode: 10 }), 'no-module');
    assert.equal(setupProblem({ status: 'failed', exitCode: 11 }), 'setup-failed');
    assert.equal(setupProblem({ status: 'failed', exitCode: 12 }), 'setup-failed');
    assert.equal(setupProblem({ status: 'failed', exitCode: 13 }), 'busy');
    assert.equal(setupProblem({ status: 'failed', exitCode: 14 }), 'secure-boot');
    assert.equal(setupProblem({ status: 'failed', exitCode: 15 }), 'config-conflict');
    assert.equal(setupProblem({ status: 'failed' }), 'setup-failed');
  });

  test('nothing to explain when it worked or was cancelled', () => {
    assert.equal(setupProblem({ status: 'ok' }), null);
    assert.equal(setupProblem({ status: 'cancelled' }), null);
  });
});

group('describe', () => {
  test('every code on every distro has a title and a line', () => {
    for (const code of [...VCAM_ERROR_CODES, 'secure-boot', 'config-conflict', 'setup-failed'] as const) {
      for (const distro of DISTROS) {
        const help = describe(code, 'linux', distro, 'detail');
        assert.ok(help.title, `${code}/${distro} title`);
        assert.ok(help.line, `${code}/${distro} line`);
        for (const c of help.commands) assert.ok(!c.includes('undefined'), c);
      }
    }
  });

  test('no-module: the package for each distro, then Set up', () => {
    const fedora = describe('no-module', 'linux', 'fedora');
    assert.deepEqual(fedora.commands.at(-1), 'sudo dnf install akmod-v4l2loopback');
    assert.match(fedora.commands[0], /rpmfusion-free-release/);
    assert.equal(fedora.action, 'setup');
    assert.deepEqual(describe('no-module', 'linux', 'debian').commands, ['sudo apt install v4l2loopback-dkms']);
    assert.deepEqual(describe('no-module', 'linux', 'arch').commands, ['sudo pacman -S v4l2loopback-dkms linux-headers']);
    assert.deepEqual(describe('no-module', 'linux', 'other').commands, []);
    assert.match(describe('no-module', 'linux', 'other').line, /package manager/);
  });

  test('not-loaded and no-device: only the button', () => {
    for (const code of ['not-loaded', 'no-device'] as const) {
      for (const distro of DISTROS) {
        const help = describe(code, 'linux', distro);
        assert.equal(help.action, 'setup');
        assert.deepEqual(help.commands, []);
      }
    }
  });

  test('Secure Boot: enroll the key for each distro', () => {
    assert.deepEqual(describe('secure-boot', 'linux', 'fedora').commands, [
      'sudo kmodgenca -a',
      'sudo mokutil --import /etc/pki/akmods/certs/public_key.der',
      'systemctl reboot',
    ]);
    assert.deepEqual(describe('secure-boot', 'linux', 'debian').commands, ['sudo update-secureboot-policy --enroll-key', 'systemctl reboot']);
    assert.equal(describe('secure-boot', 'linux', 'arch').commands.length, 2);
    assert.match(describe('secure-boot', 'linux', 'fedora').line, /Enroll MOK/);
  });

  test('permission: the video group', () => {
    for (const distro of DISTROS) assert.deepEqual(describe('permission', 'linux', distro).commands, ['sudo usermod -aG video $USER']);
  });

  test('busy and format: close the other apps, no button', () => {
    assert.match(describe('busy', 'linux', 'fedora').line, /OBS/);
    assert.equal(describe('busy', 'linux', 'fedora').action, undefined);
    assert.match(describe('format', 'linux', 'debian').line, /Close the apps/);
  });

  test('a conflicting config names the file the script found', () => {
    const help = describe('config-conflict', 'linux', 'fedora', '/etc/modprobe.d/v4l2loopback.conf already sets options for v4l2loopback.');
    assert.match(help.line, /^\/etc\/modprobe\.d\/v4l2loopback\.conf already sets/);
    assert.equal(help.action, 'setup');
  });

  test('the sentence itself for io, a failed setup and unknown errors', () => {
    assert.equal(describe('io', 'linux', 'fedora', 'cannot open /dev/video63 (No such device)').line, 'cannot open /dev/video63 (No such device)');
    assert.equal(describe('setup-failed', 'linux', 'fedora', 'modprobe failed.').line, 'modprobe failed.');
    assert.equal(describe(null, 'linux', 'fedora', 'fps out of range').line, 'fps out of range');
  });

  test('Windows keeps its own wording', () => {
    assert.match(describe('not-registered', 'win32', 'other').line, /installer/);
    assert.match(describe('busy', 'win32', 'other').line, /Another OmniCam/);
  });
});

group('firewallSteps', () => {
  test('the configured port, per distro', () => {
    assert.deepEqual(
      firewallSteps('fedora', 28441).map((s) => s.command),
      ['sudo firewall-cmd --permanent --add-port=28441/tcp && sudo firewall-cmd --reload'],
    );
    assert.deepEqual(
      firewallSteps('debian', 31000).map((s) => s.command),
      ['sudo ufw allow 31000/tcp'],
    );
    assert.equal(firewallSteps('arch', 28441).length, 2);
    assert.equal(firewallSteps('other', 28441).length, 2);
  });
});
