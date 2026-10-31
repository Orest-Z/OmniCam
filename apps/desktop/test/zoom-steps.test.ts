import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { zoomSteps } from '../../../packages/protocol/src/index.ts';

const range = (min: number, max: number) => ({ min, max, step: 0.1, current: 1 });

test('zoom buttons follow what the camera can do', () => {
  assert.deepEqual(zoomSteps(range(0.5, 10)), [0.5, 1, 2, 3]); // iPhone back camera
  assert.deepEqual(zoomSteps(range(0.6, 8)), [0.6, 1, 2, 3]); // an Android ultra-wide below 1
  assert.deepEqual(zoomSteps(range(1, 10)), [1, 2, 3]); // front camera: zoom in only
  assert.deepEqual(zoomSteps(range(1, 2.5)), [1, 2]);
  assert.deepEqual(zoomSteps(undefined), []);
});
