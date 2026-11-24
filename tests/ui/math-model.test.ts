import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Controls, ViewState } from '../../src/contracts.ts';
import { encodeDisplay } from '../../src/core/index.ts';
import { inspectPixel, makeFrame } from '../../src/core/frame.ts';
import { createPreset, initialControls } from '../../src/scene/preset.ts';
import { buildMathStory, type MathStory } from '../../src/ui/math-model.ts';

const W = 640;
const H = 359; // the buffer main.ts produces for the 16:9 host today

function view(overrides: Partial<Controls> = {}, pixel?: [number, number]): ViewState {
  const controls = { ...initialControls(), ...overrides };
  const base: ViewState = {
    sceneVersion: 3, scene: createPreset(controls), controls,
    inspection: null, status: 'ready', message: '',
  };
  if (!pixel) return base;
  return { ...base, inspection: inspectPixel(makeFrame(base, W, H), pixel[0], pixel[1]) };
}

function story(v: ViewState): MathStory {
  const result = buildMathStory(v);
  assert.equal(result.kind, 'story');
  return (result as { kind: 'story'; story: MathStory }).story;
}

/** First pixel on a coarse grid whose trace ends for `reason`. */
function findPixel(overrides: Partial<Controls>, accept: (s: MathStory) => boolean): [number, number] {
  for (let y = 4; y < H; y += 6) for (let x = 4; x < W; x += 6) {
    if (accept(story(view(overrides, [x, y])))) return [x, y];
  }
  throw new Error('no matching pixel on the search grid');
}

test('no selection and stale selections show no numbers', () => {
  assert.equal(buildMathStory(null).kind, 'empty');
  assert.equal(buildMathStory(view()).kind, 'empty');
  const fresh = view({}, [286, 179]);
  assert.equal(buildMathStory({ ...fresh, sceneVersion: fresh.sceneVersion + 1 }).kind, 'stale');
});

test('mirror pixel: every displayed number reproduces the recorded trace', () => {
  const s = story(view({}, [286, 179]));

  // Pixel -> ray: the formula on screen rebuilds the exact traced direction.
  assert.ok(s.pixel.directionError < 1e-12, `direction error ${s.pixel.directionError}`);
  assert.ok(Math.abs(s.pixel.k - Math.tan(48 * Math.PI / 360)) < 1e-15);

  // Path: camera -> mirror sphere -> colored object.
  assert.deepEqual(s.hits.map(h => h.objectId), ['mirror', 'target']);
  for (const hit of s.hits) {
    assert.ok(hit.sphere, 'both surfaces are spheres');
    assert.equal(hit.sphere!.root, 'near');
    assert.ok(hit.tError < 1e-9, `t error ${hit.tError}`);
    assert.ok(hit.sphere!.delta > 0);
  }

  // Mirror rule.
  assert.equal(s.reflects.length, 1);
  const r = s.reflects[0];
  assert.ok(r.outgoingError < 1e-12);
  assert.ok(Math.abs(r.thetaI - r.thetaR) < 1e-9);
  assert.ok(Math.abs(r.thetaI - 36.81) < 0.01, `incidence ${r.thetaI}`);
  assert.ok(r.dDotN < 0, 'the incoming ray travels against the facing normal');

  // Shading: this face of the target points away from the light.
  const shade = s.shade!;
  assert.ok(shade.rawNDotL <= 0);
  assert.equal(shade.nDotL, 0);
  assert.equal(shade.selfBlocked, true);
  assert.equal(shade.visibility, 0);
  assert.ok(shade.phiDeg >= 90);
  assert.ok(shade.colorError !== null && shade.colorError < 1e-12, `color error ${shade.colorError}`);
  assert.equal(s.end.reason, 'surface');

  // Display: bytes are exactly what the encoder produces.
  const expected = encodeDisplay(s.display.linear, 'beauty').map(v => Math.round(v * 255));
  assert.deepEqual(s.display.bytes, expected);
  assert.ok(s.display.toneMapped!.every((value, i) => Math.abs(value - s.display.linear[i] / (1 + s.display.linear[i])) < 1e-15));
});

test('plane hit and a lit surface: plane solve and shading match the trace', () => {
  const [x, y] = findPixel({}, s => s.hits.length === 1 && s.hits[0].objectId === 'floor' && s.shade?.visibility === 1);
  const s = story(view({}, [x, y]));
  const hit = s.hits[0];
  assert.ok(hit.plane);
  assert.ok(hit.tError < 1e-9);
  assert.ok(hit.plane!.denominator < 0, 'the ray travels down onto the floor');
  assert.ok(s.shade!.rawNDotL > 0 && s.shade!.blocked === false);
  assert.ok(s.shade!.colorError! < 1e-12);
});

test('sky ending: the gradient formula reproduces the recorded color', () => {
  const [x, y] = findPixel({}, s => s.end.reason === 'sky');
  const s = story(view({}, [x, y]));
  assert.equal(s.end.reason, 'sky');
  if (s.end.reason !== 'sky') return;
  const diff = Math.max(...s.end.color.map((c, i) => Math.abs(c - s.display.linear[i])));
  assert.ok(diff < 1e-12, `sky color error ${diff}`);
  assert.ok(s.end.ts >= 0 && s.end.ts <= 1);
});

test('bounce limit 0: the mirror ends the path on the budget, black', () => {
  const s = story(view({ maxRedirects: 0 }, [286, 179]));
  assert.equal(s.end.reason, 'budget');
  if (s.end.reason === 'budget') { assert.equal(s.end.limit, 0); assert.equal(s.end.used, 0); }
  assert.equal(s.reflects.length, 0);
  assert.deepEqual(s.display.bytes, [0, 0, 0]);
});

test('diagnostic views stop at the first surface', () => {
  const hit = story(view({ viewMode: 'hit' }, [286, 179]));
  assert.equal(hit.end.reason, 'diagnostic');
  assert.deepEqual(hit.display.bytes, [255, 255, 255]);
  assert.equal(hit.display.toneMapped, null);

  const albedo = story(view({ viewMode: 'albedo' }, [286, 179]));
  assert.equal(albedo.end.reason, 'diagnostic');
  if (albedo.end.reason === 'diagnostic') assert.deepEqual(albedo.end.color, [0.65, 0.75, 0.9]);
  assert.deepEqual(albedo.display.bytes, encodeDisplay([0.65, 0.75, 0.9], 'albedo').map(v => Math.round(v * 255)));
});
