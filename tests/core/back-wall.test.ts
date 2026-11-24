import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action } from '../../src/contracts.ts';
import { inspectPixel, makeFrame } from '../../src/core/frame.ts';
import { traceRay } from '../../src/core/index.ts';
import { WALL_COLORS, createPreset, initialControls } from '../../src/scene/preset.ts';
import { createStore } from '../../src/state/index.ts';
import { buildMathStory } from '../../src/ui/math-model.ts';
import { buildExplanation } from '../../src/ui/explain.ts';

const on = { maxRedirects: 4, viewMode: 'beauty' as const };
const wallOf = (scene: ReturnType<typeof createPreset>) => scene.materials[scene.objects.find(o => o.id === 'back-wall')!.materialIndex];

test('the back wall takes its paint and finish from the controls; the default is the original teal paint', () => {
  assert.deepEqual(wallOf(createPreset()), { mode: 'matte', albedo: [0.08, 0.3, 0.32] });
  const scene = createPreset({ ...initialControls(), wallColor: 2, wallMode: 'mirror' });
  assert.deepEqual(wallOf(scene), { mode: 'mirror', albedo: [...WALL_COLORS[2].albedo] });
});

test('wall actions change the scene, reject bad values, and reset restores the teal paint', () => {
  const store = createStore();
  store.dispatch({ type: 'wall-color', value: 3 });
  store.dispatch({ type: 'wall-mode', value: 'mirror' });
  assert.equal(wallOf(store.getSnapshot().scene).mode, 'mirror');
  assert.deepEqual(wallOf(store.getSnapshot().scene).albedo, [...WALL_COLORS[3].albedo]);
  const before = store.getSnapshot();
  for (const bad of [{ type: 'wall-color', value: WALL_COLORS.length }, { type: 'wall-color', value: 1.5 }, { type: 'wall-color', value: -1 }, { type: 'wall-mode', value: 'glass' }]) {
    assert.throws(() => store.dispatch(bad as Action));
    assert.equal(store.getSnapshot(), before);
  }
  store.dispatch({ type: 'reset' });
  assert.deepEqual(wallOf(store.getSnapshot().scene), { mode: 'matte', albedo: [0.08, 0.3, 0.32] });
});

test('a mirror wall reflects: a ray straight at it bounces back into the room', () => {
  const ray = { origin: [3, 2, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };
  const painted = traceRay(createPreset(), ray, on);
  const mirrored = traceRay(createPreset({ ...initialControls(), wallMode: 'mirror' }), ray, on);
  assert.deepEqual(painted.events.map(e => e.kind), ['hit', 'shadow', 'end']);
  assert.equal(mirrored.events[0].kind === 'hit' && mirrored.events[0].hit.objectId, 'back-wall');
  assert.equal(mirrored.events[1].kind, 'reflect');
  const out = mirrored.events[1].kind === 'reflect' ? mirrored.events[1].outgoing : null;
  assert.ok(out && Math.abs(out[2] + 1) < 1e-12, 'straight back toward -z');
});

test('with a mirror wall and mirror sphere, paths bounce between them; every story still explains its traced color', () => {
  const store = createStore();
  store.dispatch({ type: 'wall-mode', value: 'mirror' });
  const view = store.getSnapshot();
  const frame = makeFrame(view, 160, 90);
  let interReflections = 0;
  for (let y = 2; y < 90; y += 4) for (let x = 2; x < 160; x += 4) {
    const inspection = inspectPixel(frame, x, y);
    const ids = inspection.result.events.flatMap(e => e.kind === 'hit' ? [e.hit.objectId] : []);
    const i = ids.findIndex((id, k) => k > 0 && ((id === 'mirror' && ids[k - 1] === 'back-wall') || (id === 'back-wall' && ids[k - 1] === 'mirror')));
    if (i > 0) interReflections++;
    const result = buildMathStory({ ...view, inspection });
    if (result.kind === 'story' && result.story.shade?.colorError !== null && result.story.shade) {
      assert.ok(result.story.shade.colorError! < 1e-9, `pixel ${x},${y}`);
    }
    assert.ok(buildExplanation({ ...view, inspection }).answer.split(/\s+/).length < 50);
  }
  assert.ok(interReflections > 0, 'some paths go sphere ↔ wall');
});
