import type { Vec3 } from '../contracts.ts';

/**
 * Pure geometry for the Figure 2.1 schematic (no DOM, unit-tested).
 *
 * The schematic draws world points through explain.ts's oblique projection and
 * screenMapper(). Both are affine, so a sphere's outline is exactly an ellipse;
 * it is computed here from the mapping itself rather than approximated.
 */

export type ScreenPoint = { x: number; y: number };
export type Mapper = (point: Vec3) => ScreenPoint;
export type Ellipse = { cx: number; cy: number; rx: number; ry: number; angleDeg: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Linear part of the world-to-screen map, as the images of the unit axes. */
export function linearColumns(map: Mapper): [ScreenPoint, ScreenPoint, ScreenPoint] {
  const o = map([0, 0, 0]);
  const column = (p: ScreenPoint): ScreenPoint => ({ x: p.x - o.x, y: p.y - o.y });
  return [column(map([1, 0, 0])), column(map([0, 1, 0])), column(map([0, 0, 1]))];
}

/**
 * Screen outline of a sphere. For a linear map L, the image of a ball of radius R
 * is the ellipse with shape matrix R^2 L L^T; its semi-axes are R sqrt(lambda) for
 * the eigenvalues lambda of L L^T, along the corresponding eigenvectors.
 */
export function sphereOutline(map: Mapper, center: Vec3, radius: number): Ellipse {
  const columns = linearColumns(map);
  let a = 0, b = 0, c = 0; // L L^T = [[a, b], [b, c]]
  for (const col of columns) { a += col.x * col.x; b += col.x * col.y; c += col.y * col.y; }
  const mean = (a + c) / 2;
  const spread = Math.hypot((a - c) / 2, b);
  const major = mean + spread;
  const minor = Math.max(mean - spread, 0);
  const centre = map(center);
  return {
    cx: centre.x, cy: centre.y,
    rx: radius * Math.sqrt(major), ry: radius * Math.sqrt(minor),
    angleDeg: 0.5 * Math.atan2(2 * b, a - c) * 180 / Math.PI,
  };
}

/** Liang-Barsky: the part of segment a-b inside the rectangle, or null. */
export function clipSegment(a: ScreenPoint, b: ScreenPoint, r: Rect): { a: ScreenPoint; b: ScreenPoint; clippedA: boolean; clippedB: boolean } | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const edges: Array<[number, number]> = [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return {
    a: { x: a.x + t0 * dx, y: a.y + t0 * dy },
    b: { x: a.x + t1 * dx, y: a.y + t1 * dy },
    clippedA: t0 > 0, clippedB: t1 < 1,
  };
}

export type LabelBox = { x: number; y: number; width: number; height: number; anchor: 'start' | 'middle' | 'end' };

/**
 * Greedy label separation: labels are placed in order; one that overlaps an
 * already placed label moves down (or up, near the bottom edge) until clear.
 * Returns the vertical offsets to apply.
 */
export function separateLabels(boxes: LabelBox[], bounds: Rect, gap = 3): number[] {
  const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  const extent = (box: LabelBox, dy: number) => {
    const x0 = box.anchor === 'start' ? box.x : box.anchor === 'end' ? box.x - box.width : box.x - box.width / 2;
    return { x0, x1: x0 + box.width, y0: box.y + dy - box.height / 2, y1: box.y + dy + box.height / 2 };
  };
  const overlaps = (e: { x0: number; x1: number; y0: number; y1: number }) =>
    placed.find(p => e.x0 < p.x1 + gap && e.x1 > p.x0 - gap && e.y0 < p.y1 + gap && e.y1 > p.y0 - gap);
  return boxes.map(box => {
    let dy = 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      const hit = overlaps(extent(box, dy));
      if (!hit) break;
      const down = extent(box, dy).y1 + (hit.y1 - extent(box, dy).y0) + gap <= bounds.y1;
      dy += down ? hit.y1 - extent(box, dy).y0 + gap : hit.y0 - extent(box, dy).y1 - gap;
    }
    placed.push(extent(box, dy));
    return dy;
  });
}

export type Candidate = { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' };
export type Obstacles = {
  segments: Array<[ScreenPoint, ScreenPoint]>;
  ellipses: Ellipse[];
  boxes: Rect[];
};

function boxAt(x: number, y: number, width: number, height: number, anchor: Candidate['anchor']): Rect {
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  return { x0, y0: y - height / 2, x1: x0 + width, y1: y + height / 2 };
}

function insideEllipse(p: ScreenPoint, e: Ellipse): boolean {
  const a = e.angleDeg * Math.PI / 180;
  const dx = p.x - e.cx, dy = p.y - e.cy;
  const u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a);
  return (u / e.rx) ** 2 + (v / Math.max(e.ry, 1e-9)) ** 2 <= 1;
}

/**
 * Choose the candidate position for a label that collides least with the
 * figure: crossing a line costs most, straddling a sphere outline next, sitting
 * on another label, leaving the plot. Earlier candidates win ties, so the
 * caller lists them in order of preference. Returns the chosen position and
 * registers its box as an obstacle for later labels.
 */
export function placeLabel(at: ScreenPoint, width: number, height: number, candidates: Candidate[], obstacles: Obstacles, bounds: Rect): { x: number; y: number; anchor: Candidate['anchor']; cost: number } {
  let best = { x: at.x, y: at.y, anchor: candidates[0]?.anchor ?? 'start' as Candidate['anchor'], cost: Infinity, box: null as Rect | null };
  candidates.forEach((c, index) => {
    const x = at.x + c.dx, y = at.y + c.dy;
    const box = boxAt(x, y, width, height, c.anchor);
    const pad = { x0: box.x0 - 2, y0: box.y0 - 2, x1: box.x1 + 2, y1: box.y1 + 2 };
    let cost = index * 0.25;
    for (const [a, b] of obstacles.segments) if (clipSegment(a, b, pad)) cost += 10;
    // A line between the point and its label makes the label ambiguous. The
    // leader starts 5 px off the point, so lines that pass through the point
    // itself (a ray ending at P) do not penalise every candidate equally.
    const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    const len = Math.hypot(centre.x - at.x, centre.y - at.y) || 1;
    const leaderStart = { x: at.x + (centre.x - at.x) / len * 5, y: at.y + (centre.y - at.y) / len * 5 };
    for (const [a, b] of obstacles.segments) if (segmentsCross(leaderStart, centre, a, b)) cost += 10;
    for (const e of obstacles.ellipses) {
      const samples: ScreenPoint[] = [
        { x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x0, y: box.y1 }, { x: box.x1, y: box.y1 },
        { x: (box.x0 + box.x1) / 2, y: box.y0 }, { x: (box.x0 + box.x1) / 2, y: box.y1 }, { x: box.x0, y: (box.y0 + box.y1) / 2 }, { x: box.x1, y: (box.y0 + box.y1) / 2 },
      ];
      const inside = samples.filter(p => insideEllipse(p, e)).length;
      if (inside > 0 && inside < samples.length) cost += 7;   // straddles the outline
      else if (inside === samples.length) cost += 3;           // sits on the sphere
    }
    // Two labels on top of each other are unreadable, so that costs more than crossing a few lines.
    for (const o of obstacles.boxes) if (box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0) cost += 40;
    if (box.x0 < bounds.x0 || box.x1 > bounds.x1 || box.y0 < bounds.y0 || box.y1 > bounds.y1) cost += 100;
    if (cost < best.cost) best = { x, y, anchor: c.anchor, cost, box };
  });
  if (best.box) obstacles.boxes.push(best.box);
  return { x: best.x, y: best.y, anchor: best.anchor, cost: best.cost };
}

/** Eight positions around a point at distance r, in a conventional order of preference. */
export function aroundPoint(r: number): Candidate[] {
  const d = r * 0.72;
  return [
    { dx: r, dy: d, anchor: 'start' }, { dx: r, dy: -d, anchor: 'start' }, { dx: -r, dy: d, anchor: 'end' }, { dx: -r, dy: -d, anchor: 'end' },
    { dx: r, dy: 0, anchor: 'start' }, { dx: -r, dy: 0, anchor: 'end' }, { dx: 0, dy: -r * 1.2, anchor: 'middle' }, { dx: 0, dy: r * 1.2, anchor: 'middle' },
  ];
}

/** Proper intersection of segments p1-p2 and q1-q2 (touching endpoints excluded). */
export function segmentsCross(p1: ScreenPoint, p2: ScreenPoint, q1: ScreenPoint, q2: ScreenPoint): boolean {
  const cross = (o: ScreenPoint, a: ScreenPoint, b: ScreenPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * World-space distance along an axis for a screen-space drag: the projection of
 * the drag onto the axis' screen image, divided by that image's squared length.
 */
export function worldDeltaAlong(drag: ScreenPoint, axis: ScreenPoint): number {
  const len2 = axis.x * axis.x + axis.y * axis.y;
  return len2 > 0 ? (drag.x * axis.x + drag.y * axis.y) / len2 : 0;
}

/** A polyline on a sphere's surface, split by whether it faces the viewer. */
export type GlobeRun = { points: Vec3[]; front: boolean };

/**
 * Latitude and longitude circles of a sphere (a wireframe globe), sampled in 3D
 * and split into runs on the near (front) and far (back) hemisphere as seen
 * along `towardViewer`. Latitudes are horizontal circles (constant y); longitudes
 * are great circles through the poles.
 */
export function globeLines(center: Vec3, radius: number, towardViewer: Vec3,
  latitudesDeg = [-60, -30, 0, 30, 60], meridians = 6, samples = 72): GlobeRun[] {
  const circles: Array<(t: number) => Vec3> = [];
  for (const lat of latitudesDeg) {
    const a = lat * Math.PI / 180;
    const r = radius * Math.cos(a), y = center[1] + radius * Math.sin(a);
    circles.push(t => [center[0] + r * Math.cos(t), y, center[2] + r * Math.sin(t)]);
  }
  for (let m = 0; m < meridians; m++) {
    const phi = m * Math.PI / meridians;
    const u: Vec3 = [Math.cos(phi), 0, Math.sin(phi)];
    circles.push(t => [center[0] + radius * (u[0] * Math.cos(t)), center[1] + radius * Math.sin(t), center[2] + radius * (u[2] * Math.cos(t))]);
  }
  const runs: GlobeRun[] = [];
  for (const circle of circles) {
    let current: GlobeRun | null = null;
    for (let i = 0; i <= samples; i++) {
      const q = circle(2 * Math.PI * i / samples);
      const front = (q[0] - center[0]) * towardViewer[0] + (q[1] - center[1]) * towardViewer[1] + (q[2] - center[2]) * towardViewer[2] >= 0;
      if (!current || current.front !== front) {
        // Runs share their boundary sample so the drawn circle has no gaps.
        const previous: Vec3[] = current ? [current.points[current.points.length - 1]] : [];
        current = { points: [...previous, q], front };
        runs.push(current);
      } else current.points.push(q);
    }
  }
  return runs;
}

/**
 * The world-space line under a screen point of the orthographic schematic. Every
 * world point on it maps to `screen`; it runs from the viewer into the scene.
 * `towardViewer` is the view's unit vector toward the viewer (explain.ts).
 */
export function screenToWorldRay(map: Mapper, screen: ScreenPoint, towardViewer: Vec3): { origin: Vec3; direction: Vec3 } | null {
  const [cx, cy, cz] = linearColumns(map);
  const o = map([0, 0, 0]);
  // Solve L p = screen - o for the point p perpendicular to the view direction:
  // L is 2x3, so add the constraint p . towardViewer = 0 and invert the 3x3 system.
  const m = [
    [cx.x, cy.x, cz.x],
    [cx.y, cy.y, cz.y],
    [towardViewer[0], towardViewer[1], towardViewer[2]],
  ];
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const b = [screen.x - o.x, screen.y - o.y, 0];
  const solve = (col: number): number => {
    const r = m.map((rowValues, i) => rowValues.map((v, j) => j === col ? b[i] : v));
    return (r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1])
      - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0])
      + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0])) / det;
  };
  const p: Vec3 = [solve(0), solve(1), solve(2)];
  const far = 100;
  return {
    origin: [p[0] + towardViewer[0] * far, p[1] + towardViewer[1] * far, p[2] + towardViewer[2] * far],
    direction: [-towardViewer[0], -towardViewer[1], -towardViewer[2]],
  };
}

/**
 * Where a world point appears in the camera's picture, as normalized top-left
 * coordinates (u, v) in [0, 1), or null when it is behind the camera or outside
 * the frame. The inverse of core makeCameraRay for a picture of the given aspect.
 */
export function worldToPicture(camera: { origin: Vec3; forward: Vec3; right: Vec3; up: Vec3; tanHalfFov: number }, point: Vec3, aspect: number): { u: number; v: number } | null {
  const d: Vec3 = [point[0] - camera.origin[0], point[1] - camera.origin[1], point[2] - camera.origin[2]];
  const dotv = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = dotv(d, camera.forward);
  if (!(z > 1e-9)) return null;
  const sx = dotv(d, camera.right) / (z * camera.tanHalfFov);
  const sy = dotv(d, camera.up) / (z * camera.tanHalfFov);
  const u = (sx / aspect + 1) / 2;
  const v = (1 - sy) / 2;
  return u >= 0 && u < 1 && v >= 0 && v < 1 ? { u, v } : null;
}

/**
 * Split a screen drag into two world axes at once: the amounts (a, b) with
 * a * axisA + b * axisB = drag, for axes given by their screen images.
 */
export function worldDeltaPair(drag: ScreenPoint, axisA: ScreenPoint, axisB: ScreenPoint): [number, number] {
  const det = axisA.x * axisB.y - axisA.y * axisB.x;
  if (Math.abs(det) < 1e-9) return [worldDeltaAlong(drag, axisA), 0];
  return [(drag.x * axisB.y - drag.y * axisB.x) / det, (axisA.x * drag.y - axisA.y * drag.x) / det];
}
