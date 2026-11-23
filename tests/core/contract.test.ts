import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_VERSION, EPS, FAR, MAX_REDIRECTS } from '../../src/contracts.ts';
import { createPreset } from '../../src/scene/preset.ts';

test('shared v1 limits and independent preset values', () => {
  assert.equal(CONTRACT_VERSION, 1);
  assert.equal(EPS, 0.0001);
  assert.equal(FAR, 1000);
  assert.equal(MAX_REDIRECTS, 4);
  const first = createPreset();
  const second = createPreset();
  assert.deepEqual(first, second);
  first.objects.reverse();
  assert.equal(second.objects[0].id, 'mirror');
  assert.ok(second.objects.some(object => object.id === 'target'));
});
