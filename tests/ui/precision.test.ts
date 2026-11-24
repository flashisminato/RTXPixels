import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Controls, ViewState } from '../../src/contracts.ts';
import { inspectPixel, makeFrame } from '../../src/core/frame.ts';
import { createPreset, initialControls } from '../../src/scene/preset.ts';
import { buildMathStory, type HitStep } from '../../src/ui/math-model.ts';
import { planeDigits, rootDigits, sphereDigits, substitutionDigits } from '../../src/ui/precision.ts';

/** What a reader gets by redoing the arithmetic from the printed numbers. */
const printed = (value: number, digits: number): number => Number(value.toFixed(digits));

/** Every intersection the panel would show, over a pixel grid and the control extremes. */
function allHits(): HitStep[] {
  const hits: HitStep[] = [];
  const variants: Array<Partial<Controls>> = [{}, { targetX: -2.8 }, { targetX: -1.6, cameraYawDeg: -15 }, { cameraYawDeg: 15, lightX: 4 }, { lightX: -4, mirrorMode: 'matte' }];
  for (const overrides of variants) {
    const controls = { ...initialControls(), ...overrides };
    const view: ViewState = { sceneVersion: 1, scene: createPreset(controls), controls, inspection: null, status: 'ready', message: '' };
    const frame = makeFrame(view, 640, 360);
    for (let y = 2; y < 360; y += 11) for (let x = 2; x < 640; x += 11) {
      const result = buildMathStory({ ...view, inspection: inspectPixel(frame, x, y) });
      if (result.kind === 'story') hits.push(...result.story.hits);
    }
  }
  return hits;
}

test('the reported case: Δ = h² − c from the printed h and c gives the printed Δ', () => {
  // Pixel (286, 180) of the default view printed h = −7.113, c = 49.960, Δ = 0.6412,
  // but 7.113² − 49.960 = 0.6348. The printed inputs must now reproduce 0.6412.
  const controls = initialControls();
  const view: ViewState = { sceneVersion: 1, scene: createPreset(controls), controls, inspection: null, status: 'ready', message: '' };
  const result = buildMathStory({ ...view, inspection: inspectPixel(makeFrame(view, 640, 360), 286, 180) });
  assert.equal(result.kind, 'story');
  const hit = (result as { kind: 'story'; story: { hits: HitStep[] } }).story.hits[0];
  assert.ok(hit.sphere, 'the first hit is the center sphere');
  const sp = hit.sphere!;
  assert.notEqual(printed(printed(sp.h, 3) ** 2 - printed(sp.c, 3), 4), printed(sp.delta, 4), 'the old 3-decimal inputs really were irreproducible');
  const { digits, exact } = sphereDigits(sp, hit.t);
  assert.deepEqual(exact, [true, true]);
  assert.equal(printed(printed(sp.h, digits) ** 2 - printed(sp.c, digits), 4), printed(sp.delta, 4));
});

test('every sphere and plane substitution reproduces its printed result from its printed inputs', () => {
  const hits = allHits();
  let spheres = 0, planes = 0, widest = 0;
  for (const hit of hits) {
    if (hit.sphere) {
      spheres++;
      const sp = hit.sphere;
      const { digits, exact } = sphereDigits(sp, hit.t);
      widest = Math.max(widest, digits);
      assert.deepEqual(exact, [true, true], `sphere at t=${hit.t}`);
      assert.equal(printed(printed(sp.h, digits) ** 2 - printed(sp.c, digits), 4), printed(sp.delta, 4));
      const root = printed(Math.sqrt(sp.delta), rootDigits(digits));
      assert.equal(printed(-printed(sp.h, digits) + (sp.root === 'near' ? -root : root), 3), printed(hit.t, 3));
    }
    if (hit.plane) {
      planes++;
      const { digits, exact } = planeDigits(hit.plane, hit.t);
      widest = Math.max(widest, digits);
      assert.deepEqual(exact, [true], `plane at t=${hit.t}`);
      assert.equal(printed(printed(hit.plane.numerator, digits) / printed(hit.plane.denominator, digits), 3), printed(hit.t, 3));
    }
  }
  assert.ok(spheres > 100 && planes > 1000, `grid covers both kinds (${spheres} spheres, ${planes} planes)`);
  assert.ok(widest <= 8, `never more than 8 decimals (widest ${widest})`);
});

test('a line that no precision reproduces is reported, so the panel prints ≈ instead of =', () => {
  const never = { evaluate: () => 1, result: 2, resultDigits: 3 };
  const always = { evaluate: () => 2, result: 2, resultDigits: 3 };
  assert.deepEqual(substitutionDigits([always, never], 3, 5), { digits: 5, exact: [true, false] });
  assert.deepEqual(substitutionDigits([always], 3, 5), { digits: 3, exact: [true] });
});
