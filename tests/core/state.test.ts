import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Inspection, Scene, Vec3 } from '../../src/contracts.ts';
import { createStore, validateControls } from '../../src/state/index.ts';
import { CONTROL_RANGES, createPreset, initialControls } from '../../src/scene/preset.ts';

test('store rejects invalid actions without changing the snapshot/version', () => {
  const store = createStore();
  const initial = store.getSnapshot();
  const invalid: unknown[] = [
    null, {}, { type: 'glass' },
    ...[NaN, Infinity, -Infinity, '0', 9].map(value => ({ type: 'target-x', value })),
    { type: 'light-x', value: 5 }, { type: 'camera-yaw', value: 90 },
    ...[-1, 5, 1.5, NaN].map(value => ({ type: 'redirects', value })),
    { type: 'mirror-mode', value: 'glass' }, { type: 'view-mode', value: 'normal' },
    { type: 'view-mode', value: { toString: () => 'beauty' } },
  ];
  for (const action of invalid) {
    assert.throws(() => store.dispatch(action as Action));
    assert.equal(store.getSnapshot(), initial);
  }
  assert.throws(() => validateControls({ ...initialControls(), lightX: NaN }));
});

test('scene boundary rejects invalid counts, indexes, geometry, modes and nonfinite values', () => {
  const corruptions: ((s: Scene) => void)[] = [
    s => { s.objects = Array.from({ length: 9 }, (_, i) => ({ ...s.objects[0], id: `${i}` })); },
    s => { s.materials = Array.from({ length: 9 }, () => s.materials[0]); },
    s => { s.objects[0].materialIndex = -1; },
    s => { s.objects[0].materialIndex = 4; },
    s => { s.objects[0].materialIndex = 0.5; },
    s => { s.objects[0].materialIndex = NaN; },
    s => { s.objects[1].id = s.objects[0].id; },
    s => { if (s.objects[0].kind === 'sphere') s.objects[0].radius = 0.09; },
    s => { if (s.objects[0].kind === 'sphere') s.objects[0].radius = 1.51; },
    s => { if (s.objects[0].kind === 'sphere') s.objects[0].center[0] = Infinity; },
    s => { s.camera.fovYDeg = 19; }, s => { s.camera.fovYDeg = 101; },
    s => { s.camera.fovYDeg = NaN; }, s => { s.camera.target = [...s.camera.position]; },
    s => { s.camera.position = [0, 0] as unknown as Vec3; },
    s => { s.camera.position = new Array(3) as Vec3; },
    s => { s.materials[0].mode = 'glass' as 'mirror'; },
    s => { s.materials[0].albedo[0] = -1; }, s => { s.light.intensity = Infinity; },
    s => { if (s.objects[2].kind === 'plane') s.objects[2].normal = [0, 0, 0]; },
  ];
  for (const corrupt of corruptions) {
    const s = createPreset(); corrupt(s);
    assert.throws(() => createStore(s));
  }
  const empty = createPreset(); empty.objects = []; empty.materials = [];
  assert.doesNotThrow(() => createStore(empty));
});

test('reset reconstructs original preset, increments version, and drops old inspections', () => {
  const store = createStore();
  const first = store.getSnapshot();
  store.dispatch({ type: 'target-x', value: -2.8 });
  store.dispatch({ type: 'view-mode', value: 'hit' });
  store.dispatch({ type: 'reset' });
  const reset = store.getSnapshot();
  assert.deepEqual(reset.scene, first.scene);
  assert.deepEqual(reset.controls, first.controls);
  assert.equal(reset.sceneVersion, 4);
  const stale = { sceneVersion: 1 } as Inspection;
  assert.equal(store.setInspection(stale), false);
  assert.equal(store.getSnapshot().inspection, null);
  store.dispatch({ type: 'reset' });
  assert.equal(store.getSnapshot().sceneVersion, 5);
});

test('snapshots cannot mutate the store and subscribers can unsubscribe', () => {
  const source = createPreset();
  const store = createStore(source);
  source.camera.position[0] = 10;
  assert.equal(store.getSnapshot().scene.camera.position[0], 0);
  assert.throws(() => { store.getSnapshot().scene.camera.position[0] = 5; }, TypeError);
  let calls = 0;
  const stop = store.subscribe(() => { calls++; });
  store.setStatus('fallback', 'Actual CPU output.');
  assert.equal(store.getSnapshot().sceneVersion, 1);
  stop();
  store.dispatch({ type: 'reset' });
  assert.equal(calls, 1);
});

test('control extrema and intermediate positions keep spheres separate and camera outside geometry', () => {
  for (let targetX = CONTROL_RANGES.targetX.min; targetX <= CONTROL_RANGES.targetX.max; targetX += 0.05) {
    for (const cameraYawDeg of [-15, 0, 15]) {
      const s = createPreset({ ...initialControls(), targetX, cameraYawDeg });
      const spheres = s.objects.filter(object => object.kind === 'sphere');
      const [a, b] = spheres;
      assert.ok(Math.hypot(...a.center.map((c, i) => c - b.center[i])) > a.radius + b.radius);
      for (const sphere of spheres) {
        assert.ok(Math.hypot(...sphere.center.map((c, i) => c - s.camera.position[i])) > sphere.radius);
        assert.ok(sphere.center[1] >= sphere.radius);
        assert.ok(sphere.center[2] + sphere.radius < 5);
      }
      assert.ok(s.camera.position[1] > 0 && s.camera.position[2] < 5);
    }
  }
});
