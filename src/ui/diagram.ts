import type { Scene, Vec3 } from '../contracts.ts';
import { CANVAS_LABEL, VIEW_TOWARD_VIEWER, screenMapper, type DiagramPlan, type PlanSegment } from './explain.ts';
import { COLORS, Figure, plus, pt, times, unit, type Pt, type Run } from './math-figures.ts';
import { aroundPoint, clipSegment, globeLines, linearColumns, placeLabel, sphereOutline, worldDeltaAlong, type Candidate, type Obstacles, type Rect, type ScreenPoint } from './schematic-geometry.ts';

/**
 * Figure 2.1: the schematic of the computed path, as a textbook SVG figure.
 *
 * Drawn only from the DiagramPlan that explain.ts builds out of the recorded
 * trace events, through explain.ts's own orthographic 3D view (project /
 * screenMapper), on a textbook coordinate frame: grid planes on the floor and
 * the two back walls, numbered x, y and z axes, and dashed drops from key points
 * to the floor. The spheres are wireframe globes at their real centres and radii. Colour follows the document's fixed meanings:
 * signal red for the camera ray D and the hit points, science blue for the
 * reflected ray R and the shadow ray L, ink for geometry and normals.
 */

const W = 880;
const H = 600;
const PAD = 46;
const PLOT: Rect = { x0: 10, y0: 10, x1: W - 10, y1: H - 10 };
const SVG_NS = 'http://www.w3.org/2000/svg';


type Range = { min: number; max: number; step: number };
/** Current values and ranges of the two objects the figure lets you move. */
export type Handles = { targetX: number; lightX: number; ranges: { targetX: Range; lightX: Range } };
type HandleKind = 'target' | 'light';

/**
 * Figure 2.1 host. When `onAdjust` is supplied, the coloured sphere and the
 * light are direct-manipulation handles: drag them along x, or focus them and
 * use the arrow keys. Listeners and pointer capture live on the persistent host,
 * because the figure is rebuilt on every update.
 */
export function createDiagram(host: HTMLElement, onAdjust?: (kind: HandleKind, x: number) => void): {
  show(plan: DiagramPlan | null, message: string, scene?: Scene | null, handles?: Handles | null): void; dispose(): void;
} {
  let axisX: ScreenPoint | null = null;   // screen image of world +x in the current figure
  let handles: Handles | null = null;
  let drag: { kind: HandleKind; pointer: number; start: ScreenPoint; startX: number; axis: ScreenPoint } | null = null;
  const value = (kind: HandleKind) => kind === 'target' ? handles?.targetX : handles?.lightX;
  const range = (kind: HandleKind) => kind === 'target' ? handles?.ranges.targetX : handles?.ranges.lightX;

  const onDown = (e: PointerEvent) => {
    const el = e.target instanceof Element ? e.target.closest('[data-drag]') : null;
    const kind = el?.getAttribute('data-drag') as HandleKind | null;
    const startX = kind ? value(kind) : undefined;
    if (!onAdjust || !kind || startX === undefined || !axisX) return;
    // The figure refits its scale as objects move, so the drag keeps the scale it started with.
    drag = { kind, pointer: e.pointerId, start: { x: e.clientX, y: e.clientY }, startX, axis: { ...axisX } };
    host.setPointerCapture(e.pointerId);
    (el as SVGElement).focus({ preventScroll: true });
    host.classList.add('is-dragging');
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || drag.pointer !== e.pointerId || !onAdjust) return;
    const svgEl = host.querySelector('svg');
    const scale = svgEl ? svgEl.viewBox.baseVal.width / svgEl.getBoundingClientRect().width : 1; // CSS px -> viewBox units
    const delta = { x: (e.clientX - drag.start.x) * scale, y: (e.clientY - drag.start.y) * scale };
    onAdjust(drag.kind, drag.startX + worldDeltaAlong(delta, drag.axis));
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    drag = null;
    host.releasePointerCapture?.(e.pointerId);
    host.classList.remove('is-dragging');
  };
  const onKey = (e: KeyboardEvent) => {
    const kind = e.target instanceof Element ? e.target.getAttribute('data-drag') as HandleKind | null : null;
    const r = kind ? range(kind) : undefined;
    const now = kind ? value(kind) : undefined;
    if (!onAdjust || !kind || !r || now === undefined) return;
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? now - r.step
      : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? now + r.step
        : e.key === 'Home' ? r.min : e.key === 'End' ? r.max : null;
    if (next === null) return;
    e.preventDefault();
    onAdjust(kind, Math.min(r.max, Math.max(r.min, next)));
  };
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  host.addEventListener('keydown', onKey);

  return {
    show(plan, message, scene = null, next = null) {
      handles = next;
      // While dragging, the scene briefly has no inspection between frames: hold the last figure.
      if (drag && !plan) return;
      const focused = document.activeElement instanceof Element && host.contains(document.activeElement)
        ? document.activeElement.getAttribute('data-drag') : null;
      const result = render(plan, message, scene, onAdjust ? handles : null);
      axisX = result.axisX;
      host.replaceChildren(result.svg);
      if (focused) host.querySelector<SVGElement>(`[data-drag="${focused}"]`)?.focus({ preventScroll: true });
    },
    dispose() {
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
      host.removeEventListener('keydown', onKey);
      host.replaceChildren();
    },
  };
}

/** Make an SVG element an accessible slider handle for one of the two movable objects. */
function makeHandle(el: SVGElement, kind: HandleKind, label: string, x: number, r: Range): void {
  el.setAttribute('data-drag', kind);
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', `${label}: drag sideways or use the arrow keys`);
  el.setAttribute('aria-valuemin', String(r.min));
  el.setAttribute('aria-valuemax', String(r.max));
  el.setAttribute('aria-valuenow', x.toFixed(2));
  el.setAttribute('aria-valuetext', `x = ${x.toFixed(2)}`);
  el.classList.add('handle');
}

const B = (t: string, sub?: string): Run[] => sub ? [{ t, b: true }, { t: sub, sub: true }] : [{ t, b: true }];

function render(plan: DiagramPlan | null, message: string, scene: Scene | null, handles: Handles | null): { svg: SVGSVGElement; axisX: ScreenPoint | null } {
  const f = new Figure(W, H, `${plan?.canvasLabel ?? CANVAS_LABEL} ${message}`);
  if (!plan || (plan.segments.length === 0 && plan.marks.length === 0)) {
    f.words(pt(W / 2, H / 2), message, { anchor: 'middle', color: '#62666b', size: 15 });
    return { svg: f.root, axisX: null };
  }

  const spheres = (scene?.objects ?? []).filter((o): o is Extract<Scene['objects'][number], { kind: 'sphere' }> => o.kind === 'sphere');

  // The frame encloses everything the figure shows: the camera, the lights (so
  // shadow rays reach their light), the hit points and both spheres.
  const framed: Vec3[] = [
    ...plan.segments.flatMap(segment => [segment.from, segment.to]),
    ...plan.marks.map(m => m.at),
    ...spheres.flatMap(s => [0, 1, 2].flatMap(axis => [-1, 1].map(sign => {
      const p: Vec3 = [...s.center]; p[axis] += sign * s.radius; return p;
    }))),
  ].filter(p => p.every(Number.isFinite));
  if (framed.length === 0) {
    f.words(pt(W / 2, H / 2), message, { anchor: 'middle', color: '#62666b', size: 15 });
    return { svg: f.root, axisX: null };
  }
  const lo = [0, 1, 2].map(i => Math.min(...framed.map(p => p[i])));
  const hi = [0, 1, 2].map(i => Math.max(...framed.map(p => p[i])));
  const box = {
    x0: Math.floor(lo[0]), x1: Math.max(Math.ceil(hi[0]), Math.floor(lo[0]) + 1),
    y0: 0, y1: Math.max(Math.ceil(hi[1]), 1),
    z0: Math.floor(lo[2]), z1: Math.max(Math.ceil(hi[2]), Math.floor(lo[2]) + 1),
  };
  const corners: Vec3[] = [box.x0, box.x1].flatMap(x => [box.y0, box.y1].flatMap(y => [box.z0, box.z1].map(z => [x, y, z] as Vec3)));
  const map = screenMapper(corners, W, H, PAD);
  if (!map) {
    f.words(pt(W / 2, H / 2), message, { anchor: 'middle', color: '#62666b', size: 15 });
    return { svg: f.root, axisX: null };
  }
  const toScreen = (p: Vec3): Pt => map(p);
  const obstacles: Obstacles = { segments: [], ellipses: [], boxes: [] };
  type Pending = { at: Pt; runs: Run[]; color: string; size: number; candidates: Candidate[] };
  const pending: Pending[] = [];
  const polyline = (points: Vec3[]) => points.map((p, i) => { const q = toScreen(p); return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');

  // ---- Coordinate frame: grid planes on the floor (y = 0), the back wall (z = max)
  // and the left wall (x = min), then the three numbered axes along the frame edges.
  const span = Math.max(box.x1 - box.x0, box.y1 - box.y0, box.z1 - box.z0);
  const step = span > 12 ? 2 : 1;
  const ticks = (a: number, b: number) => { const out: number[] = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(v); return out; };
  const gridLine = (a: Vec3, b: Vec3) => f.line(toScreen(a), toScreen(b), { color: GRID, width: 0.8 });
  for (const x of ticks(box.x0, box.x1)) { gridLine([x, 0, box.z0], [x, 0, box.z1]); gridLine([x, 0, box.z1], [x, box.y1, box.z1]); }
  for (const z of ticks(box.z0, box.z1)) { gridLine([box.x0, 0, z], [box.x1, 0, z]); gridLine([box.x0, 0, z], [box.x0, box.y1, z]); }
  for (const y of ticks(box.y0, box.y1)) { gridLine([box.x0, y, box.z1], [box.x1, y, box.z1]); gridLine([box.x0, y, box.z0], [box.x0, y, box.z1]); }
  // Plane outlines, a shade darker than the grid.
  for (const [a, b] of [
    [[box.x0, 0, box.z0], [box.x1, 0, box.z0]], [[box.x1, 0, box.z0], [box.x1, 0, box.z1]],
    [[box.x0, box.y1, box.z1], [box.x1, box.y1, box.z1]], [[box.x1, 0, box.z1], [box.x1, box.y1, box.z1]],
    [[box.x0, box.y1, box.z0], [box.x0, box.y1, box.z1]], [[box.x0, 0, box.z1], [box.x0, box.y1, box.z1]],
  ] as Array<[Vec3, Vec3]>) f.line(toScreen(a), toScreen(b), { color: FRAME, width: 0.9 });

  // Axes: x along the front floor edge, z along the right floor edge, y up the
  // front-left corner. Each has an arrowhead at its + end and numbered ticks.
  const axes: Array<{ name: string; from: Vec3; to: Vec3; at: (v: number) => Vec3; values: number[]; out: Pt }> = [
    { name: 'x', from: [box.x0, 0, box.z0], to: [box.x1 + 0.6, 0, box.z0], at: v => [v, 0, box.z0], values: ticks(box.x0, box.x1), out: pt(0, 16) },
    // The z axis starts where the x axis ends, so its first tick is left unnumbered.
    { name: 'z', from: [box.x1, 0, box.z0], to: [box.x1, 0, box.z1 + 0.6], at: v => [box.x1, 0, v], values: ticks(box.z0 + step, box.z1), out: pt(16, 6) },
    { name: 'y', from: [box.x0, 0, box.z0], to: [box.x0, box.y1 + 0.6, box.z0], at: v => [box.x0, v, box.z0], values: ticks(box.y0, box.y1), out: pt(-14, 0) },
  ];
  for (const axis of axes) {
    const a = toScreen(axis.from), b = toScreen(axis.to);
    f.arrow(a, b, 'ink', 1.2);
    obstacles.segments.push([a, b]);
    const dir = unit(pt(b.x - a.x, b.y - a.y));
    f.math(plus(b, times(dir, 12)), [{ t: axis.name, i: true }], { anchor: 'middle', color: COLORS.ink, size: 16 });
    obstacles.boxes.push({ x0: b.x + dir.x * 12 - 8, y0: b.y + dir.y * 12 - 9, x1: b.x + dir.x * 12 + 8, y1: b.y + dir.y * 12 + 9 });
    for (const v of axis.values) {
      const q = toScreen(axis.at(v));
      f.line(q, plus(q, times(unit(axis.out), 4)), { color: COLORS.ink, width: 1 });
      const label = plus(q, axis.out);
      const anchor = axis.name === 'y' ? 'end' : axis.name === 'z' ? 'start' : 'middle';
      f.words(label, String(v), { anchor, color: '#62666b', size: 11 });
      const w = String(v).length * 6.5;
      const x0 = anchor === 'end' ? label.x - w : anchor === 'start' ? label.x : label.x - w / 2;
      obstacles.boxes.push({ x0, y0: label.y - 7, x1: x0 + w, y1: label.y + 7 });
    }
  }

  // ---- Drops to the floor from the lights, hit points and camera: a dashed
  // vertical to (x, 0, z) and a small foot mark, so each height can be read.
  const dropped = plan.marks.filter(m => (m.role === 'light' || m.role === 'hit' || m.role === 'camera') && m.at[1] > 0.02);
  for (const mark of dropped) {
    const top = toScreen(mark.at), foot = toScreen([mark.at[0], 0, mark.at[2]]);
    if (!clipSegment(top, foot, PLOT)) continue;
    f.line(top, foot, { color: COLORS.guide, width: 1, dash: '3 3' });
    f.circle(foot, 2.2, '#ffffff', COLORS.guide, 1);
  }

  // ---- Spheres as wireframe globes, at their real centres and radii. Under the
  // orthographic view each outline is an exact circle; latitude and longitude
  // circles on the near side are drawn in ink, the far side faint and dashed.
  const outlines = spheres.map(sphere => ({ sphere, e: sphereOutline(map, sphere.center, sphere.radius) }));
  for (const { sphere, e } of outlines) {
    const draw = () => {
      const albedo = scene?.materials[sphere.materialIndex]?.albedo;
      const matte = scene?.materials[sphere.materialIndex]?.mode === 'matte';
      const disc = document.createElementNS(SVG_NS, 'ellipse');
      const fill = matte && albedo ? cssColor(albedo) : f.sphereFill();
      for (const [k, v] of Object.entries({ cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, fill, 'fill-opacity': matte ? 0.28 : 0.75, stroke: 'none' })) disc.setAttribute(k, String(v));
      disc.setAttribute('transform', `rotate(${e.angleDeg.toFixed(2)} ${e.cx.toFixed(2)} ${e.cy.toFixed(2)})`);
      f.add(disc);
      const runs = globeLines(sphere.center, sphere.radius, VIEW_TOWARD_VIEWER);
      for (const run of runs.filter(r => !r.front)) f.path(polyline(run.points), { stroke: COLORS.guide, width: 0.6, dash: '2 3' });
      for (const run of runs.filter(r => r.front)) f.path(polyline(run.points), { stroke: COLORS.ink, width: 0.7 });
      const rim = document.createElementNS(SVG_NS, 'ellipse');
      for (const [k, v] of Object.entries({ cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, fill: 'transparent', stroke: COLORS.ink, 'stroke-width': 1.3 })) rim.setAttribute(k, String(v));
      f.add(rim);
    };
    const group = f.ref(`globe-${sphere.id}`, draw);
    if (handles && sphere.id === 'target') makeHandle(group, 'target', 'Colored object position', handles.targetX, handles.ranges.targetX);
    obstacles.ellipses.push(e);
  }

  const alongSides = (a: Pt, b: Pt, fractions = [0.55, 0.42, 0.68, 0.3, 0.8]): Candidate[] => {
    const d = unit(pt(b.x - a.x, b.y - a.y));
    const n = pt(-d.y, d.x);
    return fractions.flatMap(t => [1, -1].map(side => {
      const q = plus(a, times(pt(b.x - a.x, b.y - a.y), t));
      return { dx: q.x - a.x + n.x * 14 * side, dy: q.y - a.y + n.y * 14 * side, anchor: 'middle' as const };
    }));
  };

  // With several lights, each shadow ray L and bulb carries the light's number.
  const lightCount = new Set(plan.marks.filter(m => m.role === 'light').map(m => m.light ?? 0)).size;
  const shadowLabel = (segment: PlanSegment): Run[] => lightCount > 1 ? B('L', String((segment.light ?? 0) + 1)) : B('L');

  // Segments, back to front: miss, shadow rays, normals, then the path.
  const order: PlanSegment['role'][] = ['miss', 'shadow-open', 'shadow-blocked', 'normal', 'path'];
  const pathSegments = plan.segments.filter(s => s.role === 'path');
  let normalIndex = 0;
  let shadowIndex = 0;
  for (const role of order) {
    for (const segment of plan.segments.filter(s => s.role === role)) {
      const clip = clipSegment(toScreen(segment.from), toScreen(segment.to), PLOT);
      if (!clip) continue;
      obstacles.segments.push([clip.a, clip.b]);
      const dir = unit(pt(clip.b.x - clip.a.x, clip.b.y - clip.a.y));
      if (role === 'path') {
        const first = pathSegments.indexOf(segment) === 0;
        const color = first ? COLORS.ray : COLORS.science;
        f.line(clip.a, clip.b, { color, width: 1.9 });
        const mid = plus(clip.a, times(pt(clip.b.x - clip.a.x, clip.b.y - clip.a.y), 0.55));
        f.arrow(plus(mid, times(dir, -10)), plus(mid, times(dir, 10)), first ? 'ray' : 'science', 1.9);
        pending.push({ at: clip.a, runs: B(first ? 'D' : 'R'), color, size: 17, candidates: alongSides(clip.a, clip.b, [0.55, 0.42, 0.68, 0.3, 0.8, 0.2, 0.9]) });
        if (first && clip.clippedA) {
          const near = plus(clip.a, times(dir, 26));
          pending.push({ at: near, runs: ['from camera'], color: '#62666b', size: 13, candidates: [
            { dx: 10, dy: 0, anchor: 'start' }, { dx: -10, dy: 0, anchor: 'end' }, { dx: 10, dy: -14, anchor: 'start' }, { dx: -10, dy: -14, anchor: 'end' }] });
        }
      } else if (role === 'normal') {
        normalIndex++;
        f.arrow(clip.a, clip.b, 'ink', 1.4);
        pending.push({ at: clip.b, runs: B('N', String(normalIndex)), color: COLORS.ink, size: 16, candidates: [
          { dx: dir.x * 12, dy: dir.y * 12, anchor: 'middle' }, ...aroundPoint(10), ...aroundPoint(20)] });
      } else if (role === 'shadow-open' || role === 'shadow-blocked') {
        // A self-shadow check stops a hair from where it starts (t ~ 0.006): on
        // screen that is no segment at all, so only the blocker mark is drawn.
        if (role === 'shadow-blocked' && Math.hypot(clip.b.x - clip.a.x, clip.b.y - clip.a.y) < 8) continue;
        const open = role === 'shadow-open';
        f.line(clip.a, clip.b, { color: COLORS.science, width: 1.5, dash: open ? '6 4' : undefined, arrow: open && !clip.clippedB ? 'science' : undefined });
        if (open && clip.clippedB) {
          f.arrow(plus(clip.b, times(dir, -16)), clip.b, 'science', 1.5);
          pending.push({ at: clip.b, runs: ['to light'], color: '#62666b', size: 13, candidates: aroundPoint(12) });
        }
        // Stagger where each light's L sits along its ray, so labels that start
        // at the same hit point spread out instead of piling up next to it.
        const offset = (shadowIndex++ % 4) * 0.08;
        const fractions = [0.3, 0.45, 0.6, 0.22, 0.72, 0.15, 0.85].map(t => Math.min(0.9, t + offset));
        pending.push({ at: clip.a, runs: shadowLabel(segment), color: COLORS.science, size: 16, candidates: alongSides(clip.a, clip.b, fractions) });
      } else {
        f.line(clip.a, clip.b, { color: COLORS.guide, width: 1.3, dash: '5 4', arrow: 'guide' });
        if (segment.label) pending.push({ at: clip.b, runs: [segment.label], color: '#62666b', size: 13, candidates: aroundPoint(12) });
      }
    }
  }

  // Marks. Hits on a sphere are labelled P1, P2 ... (the sphere carries its name);
  // hits on a plane also name the plane.
  let hitIndex = 0;
  const onSphere = (q: Vec3) => spheres.find(s => Math.abs(Math.hypot(q[0] - s.center[0], q[1] - s.center[1], q[2] - s.center[2]) - s.radius) < 1e-3);
  const lightLabels: Pending[] = [];
  for (const mark of plan.marks) {
    const at = toScreen(mark.at);
    const inside = at.x >= PLOT.x0 && at.x <= PLOT.x1 && at.y >= PLOT.y0 && at.y <= PLOT.y1;
    if (!inside) continue;
    if (mark.role === 'hit') {
      hitIndex++;
      f.dot(at, COLORS.ray, 4);
      const sphere = onSphere(mark.at);
      pending.unshift({ at, runs: sphere ? B('P', String(hitIndex)) : [...B('P', String(hitIndex)), ` ${mark.label}`], color: COLORS.ray, size: 16, candidates: [...aroundPoint(13), ...aroundPoint(26)] });
    } else if (mark.role === 'blocker') {
      f.cross(at, 5);
      pending.push({ at, runs: [mark.label], color: '#62666b', size: 13, candidates: [...aroundPoint(12), ...aroundPoint(26), ...aroundPoint(40)] });
    } else if (mark.role === 'light') {
      // Only the main light is a drag handle; extra lights are labelled marks.
      const index = mark.light ?? 0;
      const bulb = f.ref(index === 0 ? 'light' : `light-${index + 1}`, () => { f.circle(at, 22, 'transparent', 'none'); f.bulb(at); });
      if (handles && index === 0) makeHandle(bulb, 'light', 'Light position', handles.lightX, handles.ranges.lightX);
      obstacles.boxes.push({ x0: at.x - 13, y0: at.y - 13, x1: at.x + 13, y1: at.y + 17 });
      // Lights are labelled right after the hit points, before the crowded ray labels.
      lightLabels.push({ at, runs: [lightCount > 1 ? `light ${index + 1}` : 'light'], color: '#62666b', size: 13, candidates: aroundPoint(22) });
    } else {
      f.dot(at, COLORS.ink, 4);
      pending.push({ at, runs: ['camera'], color: '#62666b', size: 13, candidates: aroundPoint(12) });
    }
  }
  const hits = pending.filter(p => p.color === COLORS.ray && p.runs.length > 0 && typeof p.runs[0] !== 'string' && p.runs[0].t === 'P');
  const rest = pending.filter(p => !hits.includes(p));

  // Sphere names, outside their outlines.
  for (const { sphere, e } of outlines) {
    const name = sphere.id === 'mirror' ? 'center sphere' : sphere.id === 'target' ? 'colored object' : sphere.id;
    const r = Math.max(e.rx, e.ry);
    rest.push({ at: pt(e.cx, e.cy), runs: [name], color: '#62666b', size: 13, candidates: [
      { dx: 0, dy: -r - 12, anchor: 'middle' }, { dx: r + 10, dy: -r * 0.55, anchor: 'start' }, { dx: -r - 10, dy: -r * 0.55, anchor: 'end' },
      { dx: 0, dy: r + 14, anchor: 'middle' }, { dx: r + 10, dy: r * 0.55, anchor: 'start' }, { dx: -r - 10, dy: r * 0.55, anchor: 'end' }] });
  }

  // Place labels in priority order (hit points, lights, then the rest), then draw them.
  for (const label of [...hits, ...lightLabels, ...rest]) {
    const width = label.runs.reduce((w, r) => w + (typeof r === 'string' ? r.length * 0.55 : r.t.length * (r.sub ? 0.45 : 0.7)), 0) * label.size;
    // Farther rings come last: used only when every nearby spot is taken, with a leader line.
    const chosen = placeLabel(label.at, width, label.size * 1.15, [...label.candidates, ...aroundPoint(38), ...aroundPoint(54)], obstacles, PLOT);
    const reach = Math.hypot(chosen.x - label.at.x, chosen.y - label.at.y);
    if (reach > 34) {
      const toward = unit(pt(chosen.x - label.at.x, chosen.y - label.at.y));
      f.line(plus(label.at, times(toward, 5)), plus(label.at, times(toward, reach - 12)), { color: COLORS.guide, width: 0.7 });
    }
    // A white halo keeps each label legible where it crosses grid or globe lines.
    const text = f.math(pt(chosen.x, chosen.y), label.runs, { anchor: chosen.anchor, color: label.color, size: label.size });
    text.setAttribute('paint-order', 'stroke');
    text.setAttribute('stroke', '#ffffff');
    text.setAttribute('stroke-width', '3');
    text.setAttribute('stroke-linejoin', 'round');
  }
  return { svg: f.root, axisX: linearColumns(map)[0] };
}

const GRID = '#e6e6e1';
const FRAME = '#c9c9c3';

/** Linear RGB to a CSS sRGB color, for tinting matte spheres with their own albedo. */
function cssColor(linear: Vec3): string {
  const encode = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
  return `rgb(${linear.map(encode).join(' ')})`;
}
