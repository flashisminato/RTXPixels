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

test('linear columns: x maps to the right, +y and +z map up the screen', () => {
  const [cx, cy, cz] = linearColumns(map);
  assert.ok(cx.x > 0 && Math.abs(cx.y) < 1e-9);
  assert.ok(cy.y < 0, 'height tilts up the screen');
  assert.ok(cz.y < 0 && Math.abs(cz.x) < 1e-9, 'depth runs up the screen');
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
