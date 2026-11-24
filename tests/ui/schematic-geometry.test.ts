import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vec3 } from '../../src/contracts.ts';
import { screenMapper } from '../../src/ui/explain.ts';
import { clipSegment, linearColumns, separateLabels, sphereOutline } from '../../src/ui/schematic-geometry.ts';

const map = screenMapper([[-3, 0, -1], [2, 2, 4], [0, 1, 1.5]], 880, 440, 48)!;

test('sphere outline is the exact projected ellipse: every surface point inside, silhouette on it', () => {
  const center: Vec3 = [0, 1, 1.5];
  const radius = 1;
  const e = sphereOutline(map, center, radius);
  const cos = Math.cos(e.angleDeg * Math.PI / 180), sin = Math.sin(e.angleDeg * Math.PI / 180);
  let maxQ = 0;
  for (let i = 0; i < 2000; i++) {
    // Uniform directions on the sphere (Fibonacci lattice).
    const z = 1 - 2 * (i + 0.5) / 2000, r = Math.sqrt(1 - z * z), phi = i * Math.PI * (3 - Math.sqrt(5));
    const p = map([center[0] + radius * r * Math.cos(phi), center[1] + radius * r * Math.sin(phi), center[2] + radius * z]);
    const dx = p.x - e.cx, dy = p.y - e.cy;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    maxQ = Math.max(maxQ, (u / e.rx) ** 2 + (v / e.ry) ** 2);
  }
  assert.ok(maxQ <= 1 + 1e-9, `a projected surface point lies outside the ellipse: ${maxQ}`);
  assert.ok(maxQ > 0.995, `the silhouette should touch the ellipse: ${maxQ}`);
  assert.ok(e.rx >= e.ry && e.ry > 0);
});

test('linear columns: x maps to the right, +y straight up, +z up and to the right', () => {
  const [cx, cy, cz] = linearColumns(map);
  assert.ok(cx.x > 0 && Math.abs(cx.x) > Math.abs(cx.y));
  assert.ok(cy.y < 0 && Math.abs(cy.x) < 1e-9, 'height is vertical');
  assert.ok(cz.y < 0 && cz.x > 0, 'depth recedes up and to the right');
});

test('the orthographic view draws a sphere as an exact circle', () => {
  const e = sphereOutline(map, [0, 1, 1.5], 1);
  assert.ok(Math.abs(e.rx - e.ry) < 1e-9, `outline is not a circle: ${e.rx} vs ${e.ry}`);
});

test('globeLines: latitude and longitude circles lie on the sphere, split into near and far halves', async () => {
  const { globeLines } = await import('../../src/ui/schematic-geometry.ts');
  const { VIEW_TOWARD_VIEWER } = await import('../../src/ui/explain.ts');
  const center: Vec3 = [-2.1, 0.65, -0.4], radius = 0.65;
  const runs = globeLines(center, radius, VIEW_TOWARD_VIEWER);
  assert.ok(runs.some(r => r.front) && runs.some(r => !r.front));
  for (const run of runs) {
    for (const q of run.points) {
      assert.ok(Math.abs(Math.hypot(q[0] - center[0], q[1] - center[1], q[2] - center[2]) - radius) < 1e-9, 'a point is off the sphere');
    }
    // Each run's interior points are on the side it claims (boundary samples are shared).
    for (const q of run.points.slice(1, -1)) {
      const facing = (q[0] - center[0]) * VIEW_TOWARD_VIEWER[0] + (q[1] - center[1]) * VIEW_TOWARD_VIEWER[1] + (q[2] - center[2]) * VIEW_TOWARD_VIEWER[2];
      assert.equal(facing >= 0, run.front);
    }
  }
});

test('clipSegment: inside, crossing, outside and parallel cases', () => {
  const r = { x0: 0, y0: 0, x1: 100, y1: 50 };
  assert.deepEqual(clipSegment({ x: 10, y: 10 }, { x: 90, y: 40 }, r), { a: { x: 10, y: 10 }, b: { x: 90, y: 40 }, clippedA: false, clippedB: false });
  const crossing = clipSegment({ x: -100, y: 25 }, { x: 50, y: 25 }, r)!;
  assert.deepEqual([crossing.a, crossing.clippedA, crossing.clippedB], [{ x: 0, y: 25 }, true, false]);
  assert.equal(clipSegment({ x: -10, y: -10 }, { x: -1, y: 60 }, r), null);
  assert.equal(clipSegment({ x: -5, y: 60 }, { x: 200, y: 60 }, r), null, 'parallel and outside');
});

test('separateLabels: overlapping labels are moved apart, clear ones stay put', () => {
  const bounds = { x0: 0, y0: 0, x1: 400, y1: 300 };
  const boxes = [
    { x: 100, y: 100, width: 60, height: 14, anchor: 'start' as const },
    { x: 110, y: 104, width: 60, height: 14, anchor: 'start' as const },
    { x: 300, y: 100, width: 40, height: 14, anchor: 'start' as const },
  ];
  const offsets = separateLabels(boxes, bounds);
  assert.equal(offsets[0], 0);
  assert.equal(offsets[2], 0);
  const y0 = boxes[0].y + offsets[0], y1 = boxes[1].y + offsets[1];
  assert.ok(Math.abs(y1 - y0) >= 14, `labels still overlap: ${y0} vs ${y1}`);
});

test('placeLabel avoids crossing lines, sphere outlines and earlier labels', async () => {
  const { placeLabel, aroundPoint } = await import('../../src/ui/schematic-geometry.ts');
  const bounds = { x0: 0, y0: 0, x1: 400, y1: 300 };
  // A vertical line just right of the point: right-hand candidates must lose.
  const obstacles = { segments: [[{ x: 210, y: 0 }, { x: 210, y: 300 }]] as Array<[{ x: number; y: number }, { x: number; y: number }]>, ellipses: [], boxes: [] };
  const chosen = placeLabel({ x: 200, y: 150 }, 40, 14, aroundPoint(14), obstacles, bounds);
  assert.equal(chosen.anchor, 'end', 'the label moves to the free left side');
  assert.equal(obstacles.boxes.length, 1, 'the chosen box becomes an obstacle');
  // A second label at the same point cannot take the same place.
  const second = placeLabel({ x: 200, y: 150 }, 40, 14, aroundPoint(14), obstacles, bounds);
  assert.ok(second.x !== chosen.x || second.y !== chosen.y);
  // A sphere outline under the preferred spot pushes the label off it.
  const ring = { segments: [], ellipses: [{ cx: 240, cy: 175, rx: 30, ry: 30, angleDeg: 0 }], boxes: [] };
  const off = placeLabel({ x: 200, y: 150 }, 40, 14, aroundPoint(14), ring, bounds);
  assert.ok(off.cost < 7, `label still straddles the outline (cost ${off.cost})`);
});

test('worldDeltaAlong converts a screen drag into world x through the projection', async () => {
  const { worldDeltaAlong, linearColumns } = await import('../../src/ui/schematic-geometry.ts');
  const [cx] = linearColumns(map);
  // Dragging exactly along the screen image of +x by 2.5 units moves 2.5 units.
  assert.ok(Math.abs(worldDeltaAlong({ x: cx.x * 2.5, y: cx.y * 2.5 }, cx) - 2.5) < 1e-12);
  // A drag perpendicular to it does not move the object along x.
  assert.ok(Math.abs(worldDeltaAlong({ x: -cx.y * 3, y: cx.x * 3 }, cx)) < 1e-12);
  assert.equal(worldDeltaAlong({ x: 5, y: 5 }, { x: 0, y: 0 }), 0);
});

test('screenToWorldRay: every point on the line maps back to the clicked screen point', async () => {
  const { screenToWorldRay } = await import('../../src/ui/schematic-geometry.ts');
  const { VIEW_TOWARD_VIEWER } = await import('../../src/ui/explain.ts');
  const target: Vec3 = [1.2, 0.7, -0.4];
  const screen = map(target);
  const ray = screenToWorldRay(map, screen, VIEW_TOWARD_VIEWER)!;
  for (const t of [0, 37, 100, 163]) {
    const p: Vec3 = [0, 1, 2].map(i => ray.origin[i] + ray.direction[i] * t) as Vec3;
    const back = map(p);
    assert.ok(Math.hypot(back.x - screen.x, back.y - screen.y) < 1e-6, `t=${t}: ${back.x},${back.y}`);
  }
  // The line passes through the original world point.
  const toTarget: Vec3 = [0, 1, 2].map(i => target[i] - ray.origin[i]) as Vec3;
  const along = toTarget[0] * ray.direction[0] + toTarget[1] * ray.direction[1] + toTarget[2] * ray.direction[2];
  const off = [0, 1, 2].map(i => toTarget[i] - ray.direction[i] * along);
  assert.ok(Math.hypot(...off) < 1e-6);
});

test('worldToPicture inverts the camera ray: a pixel’s ray lands back on that pixel', async () => {
  const { worldToPicture } = await import('../../src/ui/schematic-geometry.ts');
  const { makeCameraBasis, makeCameraRay } = await import('../../src/core/index.ts');
  const { createPreset } = await import('../../src/scene/preset.ts');
  const camera = makeCameraBasis(createPreset());
  for (const [x, y] of [[0, 0], [320, 180], [639, 359], [101, 277]]) {
    const ray = makeCameraRay(camera, x, y, 640, 360);
    const point: Vec3 = [0, 1, 2].map(i => ray.origin[i] + ray.direction[i] * 6.5) as Vec3;
    const uv = worldToPicture(camera, point, 640 / 360)!;
    assert.equal(Math.floor(uv.u * 640), x);
    assert.equal(Math.floor(uv.v * 360), y);
  }
  assert.equal(worldToPicture(camera, [0, 2.4, -20], 16 / 9), null, 'behind the camera');
});

test('worldDeltaPair splits a drag into two world axes exactly', async () => {
  const { worldDeltaPair } = await import('../../src/ui/schematic-geometry.ts');
  const [cx, cy] = linearColumns(map);
  const drag = { x: cx.x * 1.5 + cy.x * -0.75, y: cx.y * 1.5 + cy.y * -0.75 };
  const [a, b] = worldDeltaPair(drag, cx, cy);
  assert.ok(Math.abs(a - 1.5) < 1e-9 && Math.abs(b + 0.75) < 1e-9, `${a}, ${b}`);
});

test('the schematic view turns, wraps its yaw, clamps its pitch, and resets', async () => {
  const { setSchematicView, schematicView, towardViewer, DEFAULT_VIEW, VIEW_TOWARD_VIEWER, project } = await import('../../src/ui/explain.ts');
  try {
    setSchematicView(400, 200);
    assert.deepEqual(schematicView(), { yawDeg: 40, pitchDeg: 75 });
    setSchematicView(-10, -30);
    assert.deepEqual(schematicView(), { yawDeg: -10, pitchDeg: 5 });
    // Turned, +y is still straight up and the view stays a rotation.
    const o = project([0, 0, 0]), up = project([0, 1, 0]);
    assert.ok(Math.abs(up.x - o.x) < 1e-12 && up.y > o.y);
    assert.notDeepEqual(towardViewer(), VIEW_TOWARD_VIEWER);
  } finally {
    setSchematicView(DEFAULT_VIEW.yawDeg, DEFAULT_VIEW.pitchDeg);
  }
  assert.deepEqual(towardViewer(), VIEW_TOWARD_VIEWER);
});

test('clipSegment3D keeps the part inside the box and says which end was cut', async () => {
  const { clipSegment3D } = await import('../../src/ui/schematic-geometry.ts');
  const box = { x0: -1, x1: 1, y0: 0, y1: 2, z0: -1, z1: 1 };
  assert.deepEqual(clipSegment3D([0, 1, 0], [0.5, 1.5, 0.5], box), { a: [0, 1, 0], b: [0.5, 1.5, 0.5], clippedA: false, clippedB: false });
  const far = clipSegment3D([0, 1, 0], [0, 555, 0], box)!;
  assert.deepEqual([far.b, far.clippedA, far.clippedB], [[0, 2, 0], false, true]);
  assert.equal(clipSegment3D([5, 5, 5], [6, 6, 6], box), null);
});
