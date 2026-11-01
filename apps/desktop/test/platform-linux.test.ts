import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { distroFrom } from '../src/platform/os-release.ts';
import { isRelevantEvent, LEVEL_ARGS, ownModules, pactlInstallCommand, parseDefaults, replacementSink, SINK_ARGS, SOURCE_ARGS } from '../src/platform/pactl.ts';
import { onlyRootCanChange, setupResult } from '../src/platform/setup-result.ts';

describe('ownModules', () => {
  // `pactl list short modules` on Fedora 44 (pipewire-pulse), with OmniCam's pair and someone else's.
  const LIST = [
    '536870912\tmodule-always-sink\t\t',
    '536870916\tmodule-null-sink\tsink_name=omnicam_feed sink_properties=device.description="OmniCam Feed"\t',
    '536870917\tmodule-remap-source\tsource_name=omnicam_mic master=omnicam_feed.monitor source_properties=device.description="OmniCam Microphone"\t',
    '536870918\tmodule-null-sink\tsink_name=omnicam_feed_other\t',
    '536870919\tmodule-remap-source\tsource_name=my_mic master=omnicam_feed.monitor\t',
    '',
  ].join('\n');

  test('finds the pair, source first so it is unloaded before the sink it reads', () => {
    assert.deepEqual(ownModules(LIST), [536870917, 536870916]);
  });

  test('leftovers from more than one crash', () => {
    const twice = `${LIST}\n7\tmodule-null-sink\tsink_name=omnicam_feed\t\n8\tmodule-remap-source\tsource_name=omnicam_mic master=omnicam_feed.monitor\t`;
    assert.deepEqual(ownModules(twice), [536870917, 8, 536870916, 7]);
  });

  test('nothing of ours', () => {
    assert.deepEqual(ownModules('1\tmodule-null-sink\tsink_name=other\t\n'), []);
    assert.deepEqual(ownModules(''), []);
  });
});

describe('module arguments', () => {
  test('descriptions are quoted the way pipewire-pulse keeps the space', () => {
    assert.ok(SINK_ARGS.includes(`sink_properties='device.description="OmniCam Feed" priority.session=0'`));
    assert.ok(SOURCE_ARGS.includes(`source_properties='device.description="OmniCam Microphone" priority.session=0'`));
    assert.ok(SOURCE_ARGS.includes('master=omnicam_feed.monitor'));
  });
});

describe('parseDefaults', () => {
  test('reads pactl info', () => {
    const info = 'Server Name: PulseAudio (on PipeWire 1.6.2)\nDefault Sink: alsa_output.speaker\nDefault Source: alsa_input.mic\nCookie: 1234\n';
    assert.deepEqual(parseDefaults(info), { sink: 'alsa_output.speaker', source: 'alsa_input.mic' });
  });

  test('missing fields are empty', () => {
    assert.deepEqual(parseDefaults('Server Name: x\n'), { sink: '', source: '' });
  });
});

describe('isRelevantEvent', () => {
  test('default changes and removals', () => {
    assert.equal(isRelevantEvent("Event 'change' on server #4294967295"), true);
    assert.equal(isRelevantEvent("Event 'remove' on sink #103"), true);
    assert.equal(isRelevantEvent("Event 'remove' on module #536870916"), true);
  });

  test('not the stream chatter', () => {
    assert.equal(isRelevantEvent("Event 'change' on sink-input #88"), false);
    assert.equal(isRelevantEvent("Event 'new' on source-output #12"), false);
    assert.equal(isRelevantEvent("Event 'change' on sink #103"), false);
  });
});

describe('distroFrom', () => {
  test('ID first, then ID_LIKE', () => {
    assert.equal(distroFrom('NAME="Fedora Linux"\nID=fedora\nVERSION_ID=44\n'), 'fedora');
    assert.equal(distroFrom('ID=ubuntu\nID_LIKE=debian\n'), 'debian');
    assert.equal(distroFrom('ID=linuxmint\nID_LIKE="ubuntu debian"\n'), 'debian');
    assert.equal(distroFrom('ID="nobara"\nID_LIKE="rhel centos fedora"\n'), 'fedora');
    assert.equal(distroFrom('ID=endeavouros\nID_LIKE=arch\n'), 'arch');
    assert.equal(distroFrom('ID=arch\n'), 'arch');
  });

  test('unknown or unreadable', () => {
    assert.equal(distroFrom('ID=opensuse-tumbleweed\nID_LIKE="opensuse suse"\n'), 'other');
    assert.equal(distroFrom(''), 'other');
  });

  test('pactl install command per family', () => {
    assert.equal(pactlInstallCommand('fedora'), 'sudo dnf install pulseaudio-utils');
    assert.equal(pactlInstallCommand('debian'), 'sudo apt install pulseaudio-utils');
    assert.equal(pactlInstallCommand('arch'), 'sudo pacman -S libpulse');
    assert.equal(pactlInstallCommand('other'), '');
  });
});

describe('setupResult', () => {
  test('success, and a dismissed or refused password prompt', () => {
    assert.deepEqual(setupResult(0, ''), { status: 'ok' });
    assert.deepEqual(setupResult(126, 'Error executing command as another user: Request dismissed'), { status: 'cancelled' });
    assert.deepEqual(setupResult(127, 'Error executing command as another user: Not authorized'), { status: 'cancelled' });
  });

  test("a failure carries the script's code and its last stderr line", () => {
    assert.deepEqual(setupResult(14, 'modprobe: ERROR: could not insert: Key was rejected by service\nSecure Boot rejected the v4l2loopback module.\n'), {
      status: 'failed',
      exitCode: 14,
      message: 'Secure Boot rejected the v4l2loopback module.',
    });
    assert.deepEqual(setupResult(11, ''), { status: 'failed', exitCode: 11 });
    assert.deepEqual(setupResult(null, 'killed'), { status: 'failed', message: 'killed' });
  });
});

describe('replacementSink', () => {
  const SINKS = [
    '58\talsa_output.pci.HDMI1__sink\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED',
    '59\talsa_output.pci.Speaker__sink\tPipeWire\ts32le 2ch 48000Hz\tRUNNING',
    '293\tomnicam_feed\tPipeWire\tfloat32le 2ch 48000Hz\tRUNNING',
    '',
  ].join('\n');

  test('back to the output before the feed', () => {
    assert.equal(replacementSink(SINKS, 'alsa_output.pci.Speaker__sink'), 'alsa_output.pci.Speaker__sink');
  });

  test('the first other output when that one is gone (headphones unplugged)', () => {
    assert.equal(replacementSink(SINKS, 'alsa_output.usb-HyperX'), 'alsa_output.pci.HDMI1__sink');
    assert.equal(replacementSink(SINKS, ''), 'alsa_output.pci.HDMI1__sink');
  });

  test('never the feed itself; nothing when it is alone', () => {
    assert.equal(replacementSink('293\tomnicam_feed\tPipeWire\tfloat32le 2ch 48000Hz\tRUNNING\n', 'omnicam_feed'), '');
  });
});

describe('levels', () => {
  test('both devices at full volume and unmuted', () => {
    assert.deepEqual(LEVEL_ARGS, [
      ['set-sink-volume', 'omnicam_feed', '100%'],
      ['set-sink-mute', 'omnicam_feed', '0'],
      ['set-source-volume', 'omnicam_mic', '100%'],
      ['set-source-mute', 'omnicam_mic', '0'],
    ]);
    assert.ok(SINK_ARGS.at(-1)!.includes('priority.session=0'));
    assert.ok(SOURCE_ARGS.at(-1)!.includes('priority.session=0'));
  });
});

describe('onlyRootCanChange', () => {
  test("an rpm or deb's script and folder", () => {
    assert.equal(onlyRootCanChange({ uid: 0, mode: 0o100644 }), true);
    assert.equal(onlyRootCanChange({ uid: 0, mode: 0o40755 }), true);
  });

  test('anything the user or a group could change', () => {
    assert.equal(onlyRootCanChange({ uid: 1000, mode: 0o100644 }), false);
    assert.equal(onlyRootCanChange({ uid: 0, mode: 0o100664 }), false);
    assert.equal(onlyRootCanChange({ uid: 0, mode: 0o100646 }), false);
    assert.equal(onlyRootCanChange({ uid: 0, mode: 0o41777 }), false);
  });
});

// The script runs only on Linux, through Linux's bash: the Linux CI job covers it.
describe('the setup script\'s kernel guard', { skip: process.platform !== 'linux' }, () => {
  // plans_kernel from the script itself, run on dry-run output.
  const script = new URL('../build/linux/omnicam-camera-setup.sh', import.meta.url).pathname;
  const plansKernel = (plan: string) => {
    try {
      execFileSync('bash', ['-c', `eval "$(sed -n '/^plans_kernel()/,/^}/p' "$0")"; plans_kernel "$1"`, script, plan]);
      return true;
    } catch {
      return false;
    }
  };

  test('dnf5: a new kernel-core in the plan stops it, kernel-devel alone does not', () => {
    const devel = 'Installing:\n akmod-v4l2loopback x86_64 0:0.15.4-1.fc44 rpmfusion-free 50 KiB\nInstalling dependencies:\n kernel-devel        x86_64 0:7.2.10-200.fc44 updates 80 MiB\n kernel-devel-matched x86_64 0:7.2.10-200.fc44 updates 0 B\n';
    assert.equal(plansKernel(devel), false);
    assert.equal(plansKernel(`${devel} kernel-core          x86_64 0:7.3.1-200.fc44 updates 70 MiB\n`), true);
    assert.equal(plansKernel(' kernel-modules-core x86_64 0:7.3.1-200.fc44 updates 40 MiB\n'), true);
    assert.equal(plansKernel('   replacing kernel-devel-matched x86_64 0:7.2.10-200.fc44 updates 0 B\n'), false);
  });

  test('apt-get -s: a linux-image or linux-modules line stops it', () => {
    assert.equal(plansKernel('Inst dkms (3.0.11-1ubuntu13 Ubuntu:24.04/noble)\nInst v4l2loopback-dkms (0.12.7-2ubuntu5 Ubuntu:24.04/noble)\n'), false);
    assert.equal(plansKernel('Inst linux-image-6.8.0-51-generic (6.8.0-51.52 Ubuntu:24.04/noble-updates)\n'), true);
    assert.equal(plansKernel('Inst linux-modules-6.8.0-51-generic (6.8.0-51.52 Ubuntu:24.04/noble-updates)\n'), true);
  });
});
