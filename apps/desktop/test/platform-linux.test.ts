import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { distroFrom, pactlInstallCommand } from '../src/platform/os-release.ts';
import { isRelevantEvent, ownModules, parseDefaults, SINK_ARGS, SOURCE_ARGS } from '../src/platform/pactl.ts';
import { setupResult } from '../src/platform/setup-result.ts';

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
    assert.ok(SINK_ARGS.includes(`sink_properties='device.description="OmniCam Feed"'`));
    assert.ok(SOURCE_ARGS.includes(`source_properties='device.description="OmniCam Microphone"'`));
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
