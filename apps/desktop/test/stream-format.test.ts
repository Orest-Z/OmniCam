import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { activePreset, outputFpsFor } from '../src/shared/stream-format.ts';

describe('outputFpsFor', () => {
  test('a phone really running at 60 gets a 60 fps camera', () => {
    assert.equal(outputFpsFor(60), 60);
    assert.equal(outputFpsFor(59.94), 60);
  });

  test('30 fps, a dim-light 24 and an unknown rate stay at 30', () => {
    assert.equal(outputFpsFor(30), 30);
    assert.equal(outputFpsFor(29.97), 30);
    assert.equal(outputFpsFor(24), 30);
    assert.equal(outputFpsFor(0), 30);
  });

  test('asked for 60 but only managing 30 is not doubled up to 60', () => {
    assert.equal(outputFpsFor(31), 30);
  });
});

describe('activePreset', () => {
  test('landscape sizes', () => {
    assert.equal(activePreset({ width: 1280, height: 720, frameRate: 30 }), '720p');
    assert.equal(activePreset({ width: 1920, height: 1080, frameRate: 30 }), '1080p');
    assert.equal(activePreset({ width: 3840, height: 2160, frameRate: 30 }), '4k');
  });

  test('a phone held upright reads by its short side', () => {
    assert.equal(activePreset({ width: 1080, height: 1920, frameRate: 30 }), '1080p');
    assert.equal(activePreset({ width: 720, height: 1280, frameRate: 60 }), '720p60');
    assert.equal(activePreset({ width: 2160, height: 3840, frameRate: 30 }), '4k');
  });

  test('720p60 only when the phone really delivers 60', () => {
    assert.equal(activePreset({ width: 1280, height: 720, frameRate: 60 }), '720p60');
    assert.equal(activePreset({ width: 1280, height: 720, frameRate: 30 }), '720p');
  });

  test('agrees with the output rate at the threshold', () => {
    for (const frameRate of [44, 45, 46, 48, 50]) {
      const sixty = activePreset({ width: 1280, height: 720, frameRate }) === '720p60';
      assert.equal(sixty, outputFpsFor(frameRate) === 60, `at ${frameRate} fps`);
    }
  });

  test('nothing known yet reads as 720p', () => {
    assert.equal(activePreset(undefined), '720p');
  });
});
