import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EPS, FAR } from '../../src/contracts.ts';
import type { Ray, Scene, SceneObject, TraceOptions, Vec3 } from '../../src/contracts.ts';
import { encodeDisplay, makeCameraBasis, makeCameraRay, nearestHit, traceColor, traceRay } from '../../src/core/index.ts';
import { normalize, reflect } from '../../src/core/vector.ts';

function close(actual: number, expected: number, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}
function vectorClose(actual: Vec3, expected: Vec3) { actual.forEach((c, i) => close(c, expected[i])); }
function scene(objects: SceneObject[] = []): Scene {
  return { objects, materials: [{ mode: 'matte', albedo: [0.6, 0.3, 0.1] }, { mode: 'mirror', albedo: [0.1, 0.1, 0.1] }],
    camera: { position: [0, 0, 0], target: [0, 0, 1], fovYDeg: 90 },
    light: { position: [0, 2, 0], color: [1, 1, 1], intensity: 4 },
    ambient: 0.2, skyBottom: [0.2, 0.4, 0.6], skyTop: [0.6, 0.8, 1] };
}
const sphere: SceneObject = { kind: 'sphere', id: 'sphere', materialIndex: 0, center: [0, 0, 0], radius: 1 };
const floor: SceneObject = { kind: 'plane', id: 'floor', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] };
const options: TraceOptions = { maxRedirects: 4, viewMode: 'beauty' };
const ray = (origin: Vec3, direction: Vec3): Ray => ({ origin, direction });

test('sphere near root, interior far root, tangent and miss use independent fixtures', () => {
  const s = scene([sphere]);
  const outside = nearestHit(s, ray([0, 0, -3], [0, 0, 1]), EPS, FAR)!;
  close(outside.t, 2);
  assert.equal(outside.frontFace, true);
  vectorClose(outside.normal, [0, 0, -1]);
  const inside = nearestHit(s, ray([0, 0, 0], [0, 0, 1]), EPS, FAR)!;
  close(inside.t, 1);
  assert.equal(inside.frontFace, false);
  vectorClose(inside.outwardNormal, [0, 0, 1]);
  vectorClose(inside.normal, [0, 0, -1]);
  close(nearestHit(s, ray([1, 0, -3], [0, 0, 1]), EPS, FAR)!.t, 3);
  assert.equal(nearestHit(s, ray([2, 0, -3], [0, 0, 1]), EPS, FAR), null);
  assert.equal(nearestHit(s, ray([1 + 1e-8, 0, -3], [0, 0, 1]), EPS, FAR), null);
});

test('non-unit directions still use world-distance bounds and t', () => {
  const s = scene([sphere]);
  const r = ray([0, 0, -3], [0, 0, 2]);
  close(nearestHit(s, r, EPS, FAR)!.t, 2);
  assert.equal(nearestHit(s, r, EPS, 1.5), null);
  close(nearestHit(scene([floor]), ray([0, 1, 0], [0, -3, 0]), EPS, FAR)!.t, 1);
  vectorClose(normalize([Number.MIN_VALUE, 0, 0]), [1, 0, 0]);
  const tiny = scene([{ ...floor, normal: [0, Number.MIN_VALUE, 0] }]);
  close(nearestHit(tiny, ray([0, 1, 0], [0, -1, 0]), EPS, FAR)!.t, 1);
  tiny.camera.target = [Number.MIN_VALUE, 0, 0];
  vectorClose(makeCameraBasis(tiny).forward, [1, 0, 0]);
});

test('strict t bounds exclude exact roots and objects behind origin', () => {
  const s = scene([sphere]);
  const r = ray([0, 0, -3], [0, 0, 1]);
  assert.equal(nearestHit(s, r, EPS, 2), null);
  close(nearestHit(s, r, 2, FAR)!.t, 4);
  assert.equal(nearestHit(s, r, 2, 4), null);
  assert.equal(nearestHit(s, ray([0, 0, 3], [0, 0, 1]), EPS, FAR), null);
});

test('plane downward hit, parallel miss and back-face orientation', () => {
  close(nearestHit(scene([floor]), ray([0, 1, 0], [0, -1, 0]), EPS, FAR)!.t, 1);
  assert.equal(nearestHit(scene([floor]), ray([0, 1, 0], [1, 0, 0]), EPS, FAR), null);
  const back = nearestHit(scene([floor]), ray([0, -1, 0], [0, 1, 0]), EPS, FAR)!;
  assert.equal(back.frontFace, false);
  vectorClose(back.normal, [0, -1, 0]);
});

test('parallel threshold and FAR use strict contract boundaries', () => {
  const plane: SceneObject = { kind: 'plane', id: 'tiny-offset', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] };
  assert.equal(nearestHit(scene([plane]), ray([0, 0.0001, 0], [Math.sqrt(1 - (0.999e-6) ** 2), -0.999e-6, 0]), EPS, FAR), null);
  close(nearestHit(scene([plane]), ray([0, 0.0001, 0], [Math.sqrt(1 - 1e-12), -1e-6, 0]), EPS, FAR)!.t, 100);
  const farSphere: SceneObject = { ...sphere, center: [0, 0, FAR + 1] };
  assert.equal(nearestHit(scene([farSphere]), ray([0, 0, 0], [0, 0, 1]), EPS, FAR), null);
});

test('reflection follows the analytic 45-degree fixture', () => {
  const h = 1 / Math.sqrt(2);
  vectorClose(reflect([h, -h, 0], [0, 1, 0]), [h, h, 0]);
});

test('nearest geometry is order independent except for exact ties', () => {
  const near = { ...sphere, id: 'near' };
  const far: SceneObject = { ...sphere, id: 'far', center: [0, 0, 4] };
  const r = ray([0, 0, -3], [0, 0, 1]);
  for (const objects of [[near, far], [far, near]]) assert.equal(nearestHit(scene(objects), r, EPS, FAR)!.objectId, 'near');
  const tie = { ...sphere, id: 'tie' };
  assert.equal(nearestHit(scene([near, tie]), r, EPS, FAR)!.objectId, 'near');
  assert.equal(nearestHit(scene([tie, near]), r, EPS, FAR)!.objectId, 'tie');
});

test('camera center/corners and resized aspect match independent expected vectors', () => {
  const basis = makeCameraBasis(scene());
  vectorClose(basis.forward, [0, 0, 1]);
  vectorClose(basis.right, [1, 0, 0]);
  vectorClose(basis.up, [0, 1, 0]);
  vectorClose(makeCameraRay(basis, 1, 1, 3, 3).direction, [0, 0, 1]);
  const n = Math.sqrt(17);
  vectorClose(makeCameraRay(basis, 0, 0, 3, 3).direction, [-2 / n, 2 / n, 3 / n]);
  vectorClose(makeCameraRay(basis, 2, 2, 3, 3).direction, [2 / n, -2 / n, 3 / n]);
  const w = Math.sqrt(14);
  vectorClose(makeCameraRay(basis, 0, 0, 4, 2).direction, [-3 / w, 1 / w, 2 / w]);
  for (const sign of [-1, 1]) {
    const vertical = scene(); vertical.camera.target = [0, sign, 0];
    const pole = makeCameraBasis(vertical);
    vectorClose(pole.right, [1, 0, 0]);
    close(Math.hypot(...pole.forward), 1);
    close(Math.hypot(...pole.up), 1);
    close(pole.forward.reduce((sum, c, i) => sum + c * pole.up[i], 0), 0);
    assert.ok(pole.forward[2] > 0 && Math.sign(pole.forward[1]) === sign);
  }
});

test('shadow blocks only before light; matte matches inverse-square Lambertian formula', () => {
  const r = ray([0, 0.5, 0], [0, -1, 0]);
  const blocker = (y: number): SceneObject => ({ kind: 'sphere', id: 'blocker', materialIndex: 1, center: [0, y, 0], radius: 0.2 });
  const clear = traceRay(scene([floor, blocker(3)]), r, options);
  const shadow = clear.events.find(e => e.kind === 'shadow')!;
  assert.equal(shadow.blocked, false);
  close(shadow.nDotL, 1);
  const expected = [0.6, 0.3, 0.1].map(c => 0.2 * c + c / Math.PI * 4 / (2 - EPS) ** 2) as Vec3;
  vectorClose(clear.linearColor, expected);
  const blocked = traceRay(scene([floor, blocker(1)]), r, options);
  const event = blocked.events.find(e => e.kind === 'shadow')!;
  assert.equal(event.blocked, true);
  assert.equal(event.blockerId, 'blocker');
  close(event.blockerPoint![1], 0.8);
  vectorClose(blocked.linearColor, [0.12, 0.06, 0.02]);
  const atLight: SceneObject = { kind: 'plane', id: 'at-light', materialIndex: 0, point: [0, 2, 0], normal: [0, 1, 0] };
  assert.equal(traceRay(scene([floor, atLight]), r, options).events.find(e => e.kind === 'shadow')!.blocked, false);
});

test('matte light attenuation clamps distance squared below 0.01', () => {
  const s = scene([floor]);
  s.light.position = [0, 0.05, 0];
  const result = traceRay(s, ray([0, 0.5, 0], [0, -1, 0]), options);
  vectorClose(result.linearColor, [0.6, 0.3, 0.1].map(c => c * 0.2 + c / Math.PI * 4 / 0.01) as Vec3);
});

test('empty scene returns sky without reading materials', () => {
  const s = scene(); s.materials = [];
  const result = traceRay(s, ray([0, 0, 0], [0, 0, 1]), options);
  vectorClose(result.linearColor, [0.4, 0.6, 0.8]);
  assert.deepEqual(result.events.map(e => e.kind), ['end']);
  assert.equal(result.events[0].kind === 'end' && result.events[0].reason, 'sky');
});

function corridor(endZ?: number): Scene {
  const walls: SceneObject[] = [-1, 1].map(x => ({ kind: 'plane', id: `wall-${x}`, materialIndex: 1, point: [x, 0, 0], normal: [-x, 0, 0] }));
  if (endZ !== undefined) walls.push({ kind: 'plane', id: 'matte-end', materialIndex: 0, point: [0, 0, endZ], normal: [0, 0, -1] });
  return scene(walls);
}

test('a matte hit after four redirects shades; a fifth redirect exhausts the budget', () => {
  const r = ray([0, 0, 0], normalize([1, 0, 1]));
  const matte = traceRay(corridor(8), r, options);
  assert.equal(matte.events.filter(e => e.kind === 'reflect').length, 4);
  assert.equal(matte.events.at(-1)?.kind === 'end' && (matte.events.at(-1) as { reason: string }).reason, 'surface');
  assert.ok(matte.linearColor[0] >= 0.12);
  for (const s of [corridor(10), corridor()]) {
    const budget = traceRay(s, r, options);
    assert.equal(budget.events.filter(e => e.kind === 'reflect').length, 4);
    assert.equal(budget.events.filter(e => e.kind === 'hit').length, 5);
    vectorClose(budget.linearColor, [0, 0, 0]);
    assert.deepEqual(budget.events.at(-1)?.kind === 'end' && (budget.events.at(-1) as { reason: string }).reason, 'budget');
  }
});

test('zero redirects still shades matte, and mirror is untinted with no local matte term', () => {
  assert.ok(traceRay(scene([floor]), ray([0, 1, 0], [0, -1, 0]), { ...options, maxRedirects: 0 }).linearColor[0] > 0);
  const s = scene([{ ...sphere, materialIndex: 1 }]);
  vectorClose(traceRay(s, ray([0, 0, -3], [0, 0, 1]), options).linearColor, [0.4, 0.6, 0.8]);
  const noRedirect = traceRay(s, ray([0, 0, -3], [0, 0, 1]), { ...options, maxRedirects: 0 });
  vectorClose(noRedirect.linearColor, [0, 0, 0]);
  assert.equal(noRedirect.events.some(e => e.kind === 'reflect'), false);
});

test('diagnostics inspect only the first hit and suppress reflections/shadows', () => {
  const s = scene([{ ...sphere, materialIndex: 1 }]);
  const r = ray([0, 0, -3], [0, 0, 1]);
  for (const viewMode of ['hit', 'albedo'] as const) {
    const result = traceRay(s, r, { ...options, viewMode });
    vectorClose(result.linearColor, viewMode === 'hit' ? [1, 1, 1] : [0.1, 0.1, 0.1]);
    assert.deepEqual(result.events.map(e => e.kind), ['hit', 'end']);
    assert.equal(result.events[1].kind === 'end' && result.events[1].reason, 'diagnostic');
    vectorClose(traceRay(scene(), r, { ...options, viewMode }).linearColor, [0, 0, 0]);
  }
});

test('display conversion has correct thresholds, tone mapping and diagnostic bypass', () => {
  vectorClose(encodeDisplay([0, 1, 3], 'beauty'), [0, 0.735356983, 0.880825021]);
  vectorClose(encodeDisplay([0.0031308, 0.5, 1], 'albedo'), [0.040449936, 0.735356983, 1]);
  vectorClose(encodeDisplay([0, 1, 0], 'hit'), [0, 1, 0]);
});

test('bulk path equals inspector colors without collecting event arrays', () => {
  for (const s of [scene(), scene([floor]), corridor(), corridor(8)]) {
    for (const viewMode of ['beauty', 'hit', 'albedo'] as const) {
      const r = ray([0, 0.5, 0], normalize([1, -0.2, 1]));
      assert.deepEqual(traceColor(s, r, { ...options, viewMode }), traceRay(s, r, { ...options, viewMode }).linearColor);
    }
  }
});
