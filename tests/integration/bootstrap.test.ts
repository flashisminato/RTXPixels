import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialView } from '../../src/state/index.ts';

test('bootstrap starts without a fabricated inspection', () => {
  const view = initialView();
  assert.equal(view.sceneVersion, 1);
  assert.equal(view.inspection, null);
  assert.equal(view.status, 'starting');
});
