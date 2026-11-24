import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LIGHTS } from '../../src/contracts.ts';
import type { Action, Scene, TraceEvent } from '../../src/contracts.ts';
import { makeFrame, inspectPixel } from '../../src/core/frame.ts';
import { traceRay } from '../../src/core/index.ts';
import { CONTROL_RANGES, createPreset, initialControls } from '../../src/scene/preset.ts';
import { createStore, validateScene } from '../../src/state/index.ts';
import { buildMathStory } from '../../src/ui/math-model.ts';

const beauty = { maxRedirects: 4, viewMode: 'beauty' as const };
const down = { origin: [0, 3, -1] as [number, number, number], direction: [0, -1, 0] as [number, number, number] };
const shadows = (events: TraceEvent[]) => events.filter((e): e is Extract<TraceEvent, { kind: 'shadow' }> => e.kind === 'shadow');

test('light actions add, move, re-strength and remove lights, up to MAX_LIGHTS', () => {
  const store = createStore();
  for (let i = 1; i < MAX_LIGHTS; i++) store.dispatch({ type: 'light-add' });
  const full = store.getSnapshot();
  assert.equal(full.controls.extraLights.length, MAX_LIGHTS - 1);
  assert.equal(full.scene.extraLights?.length, MAX_LIGHTS - 1);
  assert.deepEqual(new Set(full.controls.extraLights.map(l => l.tint)).size, MAX_LIGHTS - 1, 'each extra light has its own color');
  assert.throws(() => store.dispatch({ type: 'light-add' }));
  assert.equal(store.getSnapshot(), full, 'a rejected add leaves the snapshot alone');

  store.dispatch({ type: 'light-move', index: 0, axis: 'y', value: 6 });
  store.dispatch({ type: 'light-move', index: 0, axis: 'z', value: 1 });
  store.dispatch({ type: 'light-intensity', index: 0, value: 80 });
  store.dispatch({ type: 'light-move', index: 2, axis: 'x', value: -1 });
  store.dispatch({ type: 'light-intensity', index: 3, value: 0 });
  let scene = store.getSnapshot().scene;
  assert.deepEqual(scene.light.position, [-3, 6, 1]);
  assert.equal(scene.light.intensity, 80);
  assert.equal(scene.extraLights![1].position[0], -1);
  assert.equal(scene.extraLights![2].intensity, 0);

  const removedTint = store.getSnapshot().controls.extraLights[0].tint;
  store.dispatch({ type: 'light-remove', index: 1 });
  assert.equal(store.getSnapshot().controls.extraLights.length, MAX_LIGHTS - 2);
  store.dispatch({ type: 'light-add' });
  assert.equal(store.getSnapshot().controls.extraLights.at(-1)!.tint, removedTint, 'a freed color is reused');

  store.dispatch({ type: 'reset' });
  scene = store.getSnapshot().scene;
  assert.deepEqual(store.getSnapshot().controls, initialControls());
  assert.equal(scene.extraLights?.length, 0);
});

test('light actions reject bad indexes, axes and out-of-range values without changing state', () => {
  const store = createStore();
  store.dispatch({ type: 'light-add' });
  const before = store.getSnapshot();
  const invalid: unknown[] = [
    { type: 'light-remove', index: 0 }, { type: 'light-remove', index: 2 }, { type: 'light-remove', index: 1.5 },
    { type: 'light-move', index: 2, axis: 'x', value: 0 }, { type: 'light-move', index: 0, axis: 'w', value: 0 },
    { type: 'light-move', index: 1, axis: 'y', value: CONTROL_RANGES.lightY.min - 1 },
    { type: 'light-move', index: 0, axis: 'z', value: NaN },
    { type: 'light-intensity', index: 1, value: CONTROL_RANGES.lightIntensity.max + 1 },
    { type: 'light-intensity', index: -1, value: 10 },
  ];
  for (const action of invalid) {
    assert.throws(() => store.dispatch(action as Action), /./, JSON.stringify(action));
    assert.equal(store.getSnapshot(), before);
  }
});

test('scene boundary validates extra lights', () => {
  const bad: ((s: Scene) => void)[] = [
    s => { s.extraLights = Array.from({ length: MAX_LIGHTS }, () => ({ ...s.light })); },
    s => { s.extraLights = [{ ...s.light, intensity: NaN }]; },
    s => { s.extraLights = [{ ...s.light, position: [0, 99, 0] }]; },
    s => { (s as { extraLights: unknown }).extraLights = 'none'; },
  ];
  for (const corrupt of bad) {
    const scene = createPreset();
    corrupt(scene);
    assert.throws(() => validateScene(scene));
  }
  const old = createPreset();
  delete old.extraLights;
  assert.doesNotThrow(() => validateScene(old), 'a scene without extraLights is still valid');
});

test('each light adds its own shadow-checked term; the sum matches separate one-light traces', () => {
  const base = createPreset();
  const extra = { position: [2, 4, 0] as [number, number, number], color: [0.3, 0.55, 1] as [number, number, number], intensity: 60 };
  const two: Scene = { ...base, extraLights: [extra] };
  const onlyMain = traceRay(base, down, beauty);
  const onlyExtra = traceRay({ ...base, light: extra, extraLights: [] }, down, beauty);
  const both = traceRay(two, down, beauty);
  const albedo = base.materials[2].albedo;
  both.linearColor.forEach((c, i) => {
    // Ambient is counted once: main + extra - ambient.
    const expected = onlyMain.linearColor[i] + onlyExtra.linearColor[i] - base.ambient * albedo[i];
    assert.ok(Math.abs(c - expected) < 1e-12, `channel ${i}: ${c} vs ${expected}`);
  });
  const events = shadows(both.events);
  assert.equal(events.length, 2);
  assert.equal(events[0].lightIndex, undefined, 'the main light keeps the original event shape');
  assert.equal(events[1].lightIndex, 1);
});

test('an extra light behind an object leaves that light shadowed while the main light still reaches', () => {
  const base = createPreset();
  // Directly above the center sphere; the floor point just beside its base is hidden from it.
  const hidden: Scene = { ...base, extraLights: [{ position: [0, 6, 1.5], color: [1, 1, 1], intensity: 100 }] };
  const underMirror = { origin: [0.95, 0.3, 1.5] as [number, number, number], direction: [0, -1, 0] as [number, number, number] };
  const events = shadows(traceRay(hidden, underMirror, beauty).events);
  assert.equal(events[1].blocked, true);
  assert.equal(events[1].blockerId, 'mirror');
  const withHidden = traceRay(hidden, underMirror, beauty).linearColor;
  const without = traceRay(base, underMirror, beauty).linearColor;
  withHidden.forEach((c, i) => assert.equal(c, without[i], 'a fully shadowed light adds nothing'));
});

test('the math chapter reproduces the traced color with several lights', () => {
  const store = createStore();
  store.dispatch({ type: 'light-add' });
  store.dispatch({ type: 'light-add' });
  const view = store.getSnapshot();
  const frame = makeFrame(view, 320, 180);
  let checked = 0;
  for (let y = 3; y < 180; y += 17) for (let x = 3; x < 320; x += 17) {
    const result = buildMathStory({ ...view, inspection: inspectPixel(frame, x, y) });
    if (result.kind !== 'story' || !result.story.shade) continue;
    assert.equal(result.story.shade.extraLights.length, 2);
    if (result.story.shade.colorError !== null) {
      assert.ok(result.story.shade.colorError < 1e-9, `pixel ${x},${y}: ${result.story.shade.colorError}`);
      checked++;
    }
  }
  assert.ok(checked > 20, `checked ${checked} shaded pixels`);
});
