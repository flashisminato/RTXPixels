import type { Scene, Vec3 } from '../contracts.ts';
import { CANVAS_LABEL, screenMapper, type DiagramPlan, type PlanSegment } from './explain.ts';
import { COLORS, Figure, plus, pt, times, unit, type Pt, type Run } from './math-figures.ts';
import { aroundPoint, clipSegment, linearColumns, placeLabel, sphereOutline, worldDeltaAlong, type Candidate, type Obstacles, type Rect, type ScreenPoint } from './schematic-geometry.ts';

/**
 * Figure 2.1: the schematic of the computed path, as a textbook SVG figure.
 *
 * Drawn only from the DiagramPlan that explain.ts builds out of the recorded
 * trace events, through explain.ts's own oblique projection (project /
 * screenMapper). The scene's spheres are drawn from their real centres and radii
 * as exact projected ellipses. Colour follows the document's fixed meanings:
 * signal red for the camera ray D and the hit points, science blue for the
 * reflected ray R and the shadow ray L, ink for geometry and normals.
 */

const W = 880;
const H = 420;
const PAD = 54;
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

  // Spheres of the scene, drawn for context from their real geometry.
  const spheres = (scene?.objects ?? []).filter((o): o is Extract<Scene['objects'][number], { kind: 'sphere' }> => o.kind === 'sphere');

  // Fit the same points the original schematic fitted (camera and light stay far
  // away and are clipped at the edge), plus the spheres' extents.
  const points: Vec3[] = [
    ...plan.segments.flatMap(segment => {
      if (segment.role === 'shadow-open') return [segment.from];
      if (segment.role === 'path' && segment.label === '') return [segment.to];
      return [segment.from, segment.to];
    }),
    ...plan.marks.filter(m => m.role !== 'light' && m.role !== 'camera').map(m => m.at),
    ...spheres.flatMap(s => [0, 1, 2].flatMap(axis => [-1, 1].map(sign => {
      const p: Vec3 = [...s.center]; p[axis] += sign * s.radius; return p;
    }))),
  ];
  const map = screenMapper(points, W, H, PAD);
  if (!map) {
    f.words(pt(W / 2, H / 2), message, { anchor: 'middle', color: '#62666b', size: 15 });
    return { svg: f.root, axisX: null };
  }

  const toScreen = (p: Vec3): Pt => map(p);
  const obstacles: Obstacles = { segments: [], ellipses: [], boxes: [] };
  type Pending = { at: Pt; runs: Run[]; color: string; size: number; candidates: Candidate[] };
  const pending: Pending[] = [];

  // Spheres from real geometry: exact projected ellipses.
  const outlines = spheres.map(sphere => ({ sphere, e: sphereOutline(map, sphere.center, sphere.radius) }));
  for (const { sphere, e } of outlines) {
    const ellipse = document.createElementNS(SVG_NS, 'ellipse');
    for (const [k, v] of Object.entries({ cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, fill: f.sphereFill(), stroke: COLORS.ink, 'stroke-width': 1.1, 'fill-opacity': 0.9 })) {
      ellipse.setAttribute(k, String(v));
    }
    ellipse.setAttribute('transform', `rotate(${e.angleDeg.toFixed(2)} ${e.cx.toFixed(2)} ${e.cy.toFixed(2)})`);
    if (handles && sphere.id === 'target') makeHandle(ellipse, 'target', 'Colored object position', handles.targetX, handles.ranges.targetX);
    f.add(ellipse);
    obstacles.ellipses.push(e);
  }

  // Axis triad (bottom left), drawn from the same projection; its corner is kept clear.
  const [ax, ay, az] = linearColumns(map).map(c => unit(pt(c.x, c.y)));
  const origin = pt(PLOT.x0 + 26, PLOT.y1 - 22);
  ([[ax, 'x'], [ay, 'y'], [az, 'z']] as Array<[Pt, string]>).forEach(([d, name]) => {
    f.arrow(origin, plus(origin, times(d, 30)), 'guide', 1.1);
    f.math(plus(origin, times(d, 40)), [{ t: name, i: true }], { anchor: 'middle', color: '#62666b', size: 14 });
  });
  obstacles.boxes.push({ x0: PLOT.x0, y0: PLOT.y1 - 70, x1: PLOT.x0 + 80, y1: PLOT.y1 });

  const alongSides = (a: Pt, b: Pt, fractions = [0.55, 0.42, 0.68, 0.3, 0.8]): Candidate[] => {
    const d = unit(pt(b.x - a.x, b.y - a.y));
    const n = pt(-d.y, d.x);
    return fractions.flatMap(t => [1, -1].map(side => {
      const q = plus(a, times(pt(b.x - a.x, b.y - a.y), t));
      return { dx: q.x - a.x + n.x * 14 * side, dy: q.y - a.y + n.y * 14 * side, anchor: 'middle' as const };
    }));
  };

  // Segments, back to front: miss, shadow rays, normals, then the path.
  const order: PlanSegment['role'][] = ['miss', 'shadow-open', 'shadow-blocked', 'normal', 'path'];
  const pathSegments = plan.segments.filter(s => s.role === 'path');
  let normalIndex = 0;
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
        pending.push({ at: clip.a, runs: B(first ? 'D' : 'R'), color, size: 17, candidates: alongSides(clip.a, clip.b) });
        if (first && clip.clippedA) {
          const near = plus(clip.a, times(dir, 26));
          pending.push({ at: near, runs: ['from camera'], color: '#62666b', size: 13, candidates: [
            { dx: 10, dy: 0, anchor: 'start' }, { dx: -10, dy: 0, anchor: 'end' }, { dx: 10, dy: -14, anchor: 'start' }, { dx: -10, dy: -14, anchor: 'end' }] });
        }
      } else if (role === 'normal') {
        normalIndex++;
        f.arrow(clip.a, clip.b, 'ink', 1.4);
        pending.push({ at: clip.b, runs: B('N', String(normalIndex)), color: COLORS.ink, size: 16, candidates: [
          { dx: dir.x * 12, dy: dir.y * 12, anchor: 'middle' }, ...aroundPoint(10)] });
      } else if (role === 'shadow-open') {
        f.line(clip.a, clip.b, { color: COLORS.science, width: 1.5, dash: '6 4', arrow: clip.clippedB ? undefined : 'science' });
        if (clip.clippedB) {
          f.arrow(plus(clip.b, times(dir, -16)), clip.b, 'science', 1.5);
          pending.push({ at: clip.b, runs: ['to light'], color: '#62666b', size: 13, candidates: aroundPoint(12) });
        }
        pending.push({ at: clip.a, runs: B('L'), color: COLORS.science, size: 16, candidates: alongSides(clip.a, clip.b, [0.25, 0.4, 0.15, 0.55]) });
      } else if (role === 'shadow-blocked') {
        // A self-shadow check stops a hair from where it starts (t ~ 0.006): on
        // screen that is no segment at all, so only the blocker mark is drawn.
        if (Math.hypot(clip.b.x - clip.a.x, clip.b.y - clip.a.y) < 8) continue;
        f.line(clip.a, clip.b, { color: COLORS.science, width: 1.5 });
        pending.push({ at: clip.a, runs: B('L'), color: COLORS.science, size: 16, candidates: alongSides(clip.a, clip.b, [0.5, 0.3, 0.7]) });
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
  for (const mark of plan.marks) {
    const at = toScreen(mark.at);
    const inside = at.x >= PLOT.x0 && at.x <= PLOT.x1 && at.y >= PLOT.y0 && at.y <= PLOT.y1;
    if (!inside) continue;
    if (mark.role === 'hit') {
      hitIndex++;
      f.dot(at, COLORS.ray, 4);
      const sphere = onSphere(mark.at);
      pending.unshift({ at, runs: sphere ? B('P', String(hitIndex)) : [...B('P', String(hitIndex)), ` ${mark.label}`], color: COLORS.ray, size: 16, candidates: aroundPoint(13) });
    } else if (mark.role === 'blocker') {
      f.cross(at, 5);
      pending.push({ at, runs: [mark.label], color: '#62666b', size: 13, candidates: aroundPoint(12) });
    } else if (mark.role === 'light') {
      const bulb = f.ref('light', () => { f.circle(at, 22, 'transparent', 'none'); f.bulb(at); });
      if (handles) makeHandle(bulb, 'light', 'Light position', handles.lightX, handles.ranges.lightX);
      obstacles.boxes.push({ x0: at.x - 22, y0: at.y - 22, x1: at.x + 22, y1: at.y + 18 });
      pending.push({ at, runs: ['light'], color: '#62666b', size: 13, candidates: aroundPoint(26) });
    } else {
      f.dot(at, COLORS.ink, 4);
      pending.push({ at, runs: ['camera'], color: '#62666b', size: 13, candidates: aroundPoint(12) });
    }
  }

  // Sphere names, outside their outlines.
  for (const { sphere, e } of outlines) {
    const name = sphere.id === 'mirror' ? 'center sphere' : sphere.id === 'target' ? 'colored object' : sphere.id;
    const r = Math.max(e.rx, e.ry);
    pending.push({ at: pt(e.cx, e.cy), runs: [name], color: '#62666b', size: 13, candidates: [
      { dx: 0, dy: -r - 12, anchor: 'middle' }, { dx: r + 10, dy: -r * 0.55, anchor: 'start' }, { dx: -r - 10, dy: -r * 0.55, anchor: 'end' },
      { dx: 0, dy: r + 14, anchor: 'middle' }, { dx: r + 10, dy: r * 0.55, anchor: 'start' }, { dx: -r - 10, dy: r * 0.55, anchor: 'end' }] });
  }

  // Place labels in priority order (hit points first), then draw them.
  for (const label of pending) {
    const width = label.runs.reduce((w, r) => w + (typeof r === 'string' ? r.length * 0.5 : r.t.length * (r.sub ? 0.42 : 0.66)), 0) * label.size;
    const chosen = placeLabel(label.at, width, label.size * 1.1, label.candidates, obstacles, PLOT);
    f.math(pt(chosen.x, chosen.y), label.runs, { anchor: chosen.anchor, color: label.color, size: label.size });
  }
  return { svg: f.root, axisX: linearColumns(map)[0] };
}

