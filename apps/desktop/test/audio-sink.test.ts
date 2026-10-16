import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { defaultIsLoopback, loopbackOutputs, micNameFor, pickSink } from '../src/shared/audio-sink.ts';

const out = (label: string, deviceId = label) => ({ kind: 'audiooutput', deviceId, label });

const SPEAKERS = out('Speakers (Realtek(R) Audio)');
const CABLE = out('CABLE Input (VB-Audio Virtual Cable)');
const CABLE_A = out('CABLE-A Input (VB-Audio Cable A)');
const VAC = out('Line 1 (Virtual Audio Cable)');
// What Chromium lists on Linux (Fedora 44, PipeWire): descriptions as labels, a bare "Default" entry.
const FEED = out('OmniCam Feed');
const LINUX_SPEAKERS = out('Tiger Lake-LP Smart Sound Technology Audio Controller Speaker');
const LINUX_DEFAULT = out('Default', 'default');

describe('loopbackOutputs', () => {
  test('finds VB-CABLE, its variants and Virtual Audio Cable', () => {
    const hifi = out('Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)');
    assert.deepEqual(loopbackOutputs([SPEAKERS, CABLE, CABLE_A, hifi, VAC]), [CABLE, CABLE_A, hifi, VAC]);
  });

  test('never a speaker, a capture device or a follow-the-default entry', () => {
    const capture = { kind: 'audioinput', deviceId: 'x', label: 'CABLE Output (VB-Audio Virtual Cable)' };
    const def = out('Default - CABLE Input (VB-Audio Virtual Cable)', 'default');
    const comms = out('Communications - CABLE Input (VB-Audio Virtual Cable)', 'communications');
    assert.deepEqual(loopbackOutputs([SPEAKERS, capture, def, comms]), []);
  });
});

describe('loopbackOutputs on Linux', () => {
  test("OmniCam's own feed, never the speakers or the default entry", () => {
    assert.deepEqual(loopbackOutputs([LINUX_DEFAULT, LINUX_SPEAKERS, FEED]), [FEED]);
  });

  test('only the exact name: a capture side or a look-alike is not the feed', () => {
    const mic = { kind: 'audioinput', deviceId: 'm', label: 'OmniCam Microphone' };
    assert.deepEqual(loopbackOutputs([mic, out('Monitor of OmniCam Feed'), out('OmniCam Feed 2')]), []);
  });

  test('picked like any loopback', () => {
    assert.equal(pickSink([LINUX_DEFAULT, LINUX_SPEAKERS, FEED], ''), FEED);
    assert.equal(pickSink([LINUX_DEFAULT, LINUX_SPEAKERS], ''), null);
  });
});

describe('pickSink', () => {
  test('the chosen loopback while it is installed', () => {
    assert.equal(pickSink([SPEAKERS, CABLE, CABLE_A], CABLE_A.label), CABLE_A);
  });

  test('the first loopback when nothing or something missing is chosen', () => {
    assert.equal(pickSink([SPEAKERS, CABLE, CABLE_A], ''), CABLE);
    assert.equal(pickSink([SPEAKERS, CABLE], CABLE_A.label), CABLE);
  });

  test('nowhere rather than the speakers', () => {
    assert.equal(pickSink([SPEAKERS], ''), null);
    assert.equal(pickSink([SPEAKERS], SPEAKERS.label), null);
  });
});

describe('defaultIsLoopback', () => {
  test('a cable as the Windows default or communications output', () => {
    assert.equal(defaultIsLoopback([SPEAKERS, CABLE, out('Default - CABLE Input (VB-Audio Virtual Cable)', 'default')]), true);
    assert.equal(defaultIsLoopback([SPEAKERS, CABLE, out('Communications - CABLE Input (VB-Audio Virtual Cable)', 'communications')]), true);
  });

  test('speakers as the default, cable installed beside them', () => {
    assert.equal(defaultIsLoopback([out('Default - Speakers (Realtek(R) Audio)', 'default'), SPEAKERS, CABLE]), false);
  });
});

describe('micNameFor', () => {
  test('VB-CABLE pairs Input with Output', () => {
    assert.equal(micNameFor(CABLE.label), 'CABLE Output (VB-Audio Virtual Cable)');
    assert.equal(micNameFor(CABLE_A.label), 'CABLE-A Output (VB-Audio Cable A)');
  });

  test("OmniCam's feed comes out of OmniCam Microphone", () => {
    assert.equal(micNameFor(FEED.label), 'OmniCam Microphone');
  });

  test('Virtual Audio Cable uses one name for both sides', () => {
    assert.equal(micNameFor(VAC.label), VAC.label);
  });
});
