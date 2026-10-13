import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { loopbackOutputs, micNameFor, pickSink } from '../src/shared/audio-sink.ts';

const out = (label: string, deviceId = label) => ({ kind: 'audiooutput', deviceId, label });

const SPEAKERS = out('Speakers (Realtek(R) Audio)');
const CABLE = out('CABLE Input (VB-Audio Virtual Cable)');
const CABLE_A = out('CABLE-A Input (VB-Audio Cable A)');
const VAC = out('Line 1 (Virtual Audio Cable)');

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

describe('micNameFor', () => {
  test('VB-CABLE pairs Input with Output', () => {
    assert.equal(micNameFor(CABLE.label), 'CABLE Output (VB-Audio Virtual Cable)');
    assert.equal(micNameFor(CABLE_A.label), 'CABLE-A Output (VB-Audio Cable A)');
  });

  test('Virtual Audio Cable uses one name for both sides', () => {
    assert.equal(micNameFor(VAC.label), VAC.label);
  });
});
