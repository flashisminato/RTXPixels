import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Scene, TraceEvent } from '../../src/contracts.ts';
import { inspectPixel, makeFrame } from '../../src/core/frame.ts';
import { encodeDisplay, localShade, traceRay } from '../../src/core/index.ts';
import { createPreset } from '../../src/scene/preset.ts';
import { createStore } from '../../src/state/index.ts';
import { buildMathStory } from '../../src/ui/math-model.ts';
import { buildExplanation } from '../../src/ui/explain.ts';

const on = { maxRedirects: 4, viewMode: 'beauty' as const };
const off = { maxRedirects: 4, viewMode: 'raster' as const };
const kinds = (events: TraceEvent[]) => events.map(e => e.kind);

test('ray tracing off stops at the first surface: no bounce, no shadow ray', () => {
  const scene = createPreset();
  // Straight at the mirror sphere.
  const ray = { origin: [0, 1, -5] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };
  const traced = traceRay(scene, ray, on);
  const local = traceRay(scene, ray, off);
  assert.ok(kinds(traced.events).includes('reflect'), 'ray tracing on follows the mirror');
  assert.deepEqual(kinds(local.events), ['hit', 'end']);
  const end = local.events[1];
  assert.equal(end.kind === 'end' && end.reason, 'surface');
  // The mirror is lit like matte in its own tint.
  const hit = local.events[0].kind === 'hit' ? local.events[0].hit : null;
  const expected = localShade(scene, scene.materials[hit!.materialIndex].albedo, hit!.normal,
    hit!.point.map((c, i) => c + hit!.normal[i] * 1e-4) as [number, number, number]);
  assert.deepEqual(local.linearColor, expected);
});

test('ray tracing off ignores shadows: a blocked point keeps its direct light', () => {
  const base = createPreset();
  const scene: Scene = { ...base, light: { ...base.light, position: [0, 6, 1.5] } };
  // A floor point just beside the mirror's base, hidden from a light straight above the mirror.
  const ray = { origin: [0.95, 0.3, 1.5] as [number, number, number], direction: [0, -1, 0] as [number, number, number] };
  const traced = traceRay(scene, ray, on);
  const local = traceRay(scene, ray, off);
  const shadow = traced.events.find(e => e.kind === 'shadow');
  assert.ok(shadow && shadow.kind === 'shadow' && shadow.blocked, 'with ray tracing on this point is in shadow');
  assert.ok(local.linearColor[0] > traced.linearColor[0], 'with it off the blocked light still adds its term');
});

test('for a lit matte point with nothing in the way, on and off agree exactly', () => {
  const scene = createPreset();
  const ray = { origin: [3, 3, -3] as [number, number, number], direction: [0, -1, 0.2] as [number, number, number] };
  const traced = traceRay(scene, ray, on);
  assert.ok(traced.events.every(e => e.kind !== 'shadow' || !e.blocked));
  assert.deepEqual(traceRay(scene, ray, off).linearColor, traced.linearColor);
  assert.deepEqual(encodeDisplay([0.5, 0.5, 0.5], 'raster'), encodeDisplay([0.5, 0.5, 0.5], 'beauty'), 'both are tone mapped');
});

test('the store accepts ray tracing off, and the answer and chapter 3 explain it from the recorded color', () => {
  const store = createStore();
  store.dispatch({ type: 'light-add' });
  store.dispatch({ type: 'view-mode', value: 'raster' });
  const view = store.getSnapshot();
  const frame = makeFrame(view, 160, 90);
  let checked = 0;
  for (let y = 3; y < 90; y += 7) for (let x = 3; x < 160; x += 7) {
    const inspection = inspectPixel(frame, x, y);
    const { answer, heading } = buildExplanation({ ...view, inspection });
    assert.equal(heading, 'Why this pixel is that color');
    assert.ok(answer.split(/\s+/).length < 50, answer);
    const result = buildMathStory({ ...view, inspection });
    if (result.kind !== 'story' || !result.story.local) continue;
    assert.match(answer, /Ray tracing is off/);
    assert.equal(result.story.local.terms.length, 2);
    assert.deepEqual(result.story.local.color, inspection.result.linearColor, 'chapter 3 reproduces the traced color');
    checked++;
  }
  assert.ok(checked > 50, `checked ${checked}`);
});
