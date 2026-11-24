import { EPS, FAR } from '../contracts.ts';
import type { LightAxis, Scene, Vec3 } from '../contracts.ts';
import { makeCameraBasis, nearestHit, sceneLights } from '../core/index.ts';
import {
  CANVAS_LABEL, DEFAULT_VIEW, schematicView, screenMapper, setSchematicView, towardViewer,
  type DiagramPlan, type PlanSegment,
} from './explain.ts';
import { COLORS, Figure, plus, pt, times, unit, type Pt, type Run } from './math-figures.ts';
import {
  aroundPoint, clipSegment, clipSegment3D, globeLines, insideBox, linearColumns, placeLabel, screenToWorldRay, sphereOutline, worldDeltaAlong,
  worldDeltaPair, worldToPicture, type Candidate, type Mapper, type Obstacles, type Rect, type ScreenPoint,
} from './schematic-geometry.ts';

/**
 * Figure 2.1: the schematic of the computed path, as a textbook SVG figure.
 *
 * Drawn from the DiagramPlan that explain.ts builds out of the recorded trace
 * events and from the scene itself, through explain.ts's orthographic 3D view
 * (project / screenMapper), on a coordinate frame: grid planes on the floor and
 * the two walls away from the viewer, numbered x, y and z axes, and dashed drops
 * from key points to the floor. The spheres are wireframe globes at their real
 * centres and radii. Colour follows the document's fixed meanings: signal red for
 * the camera ray D and the hit points, science blue for the reflected ray R and
 * the shadow rays L, ink for geometry and normals.
 *
 * It is also an instrument. The camera, every light and the colored object are
 * handles; clicking a surface follows the pixel that looks at it; dragging empty
 * space turns the view. A newly selected path plays in order (camera ray, hit,
 * bounce, shadow rays) unless the reader prefers reduced motion.
 */

const W = 880;
const H = 600;
const PAD = 46;
const PLOT: Rect = { x0: 10, y0: 10, x1: W - 10, y1: H - 10 };
const SVG_NS = 'http://www.w3.org/2000/svg';
/** A pointer that moves less than this (viewBox units) between down and up is a click. */
const CLICK_SLOP = 5;

type Range = { min: number; max: number; step: number };

/** What the figure lets the reader move, with current values and ranges. */
export type FigureControls = {
  target: { x: number; range: Range };
  camera: { yawDeg: number; range: Range };
  /** Index 0 is the main light. */
  lights: Array<{ x: number; y: number; z: number }>;
  lightRanges: Record<LightAxis, Range>;
};

/** What the figure asks the page to do. Values are raw; the page snaps and validates them. */
export type FigureActions = {
  moveTarget(x: number): void;
  moveCamera(yawDeg: number): void;
  moveLight(index: number, axis: LightAxis, value: number): void;
  /** Follow the pixel at normalized top-left picture coordinates. */
  pickPicture(u: number, v: number): void;
};

export type ShowOptions = {
  /** Play the path in order (a newly selected pixel). Ignored under reduced motion. */
  animate?: boolean;
  /** Width / height of the picture, to find the pixel behind a clicked surface. */
  aspect?: number;
};

type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
/**
 * The frame never grows past the room: the floor and back wall are infinite
 * planes, so a bounce can land hundreds of units away. Such a ray is drawn to the
 * frame's edge and labelled with where it continues, instead of shrinking the
 * whole figure to fit it.
 */
const ROOM_LIMIT: Box = { x0: -7, x1: 7, y0: 0, y1: 8, z0: -7, z1: 6 };
type Handle = { kind: 'target' } | { kind: 'camera' } | { kind: 'light'; index: number };
type AnimItem = { el: SVGElement; step: number; grow?: { a: Pt; b: Pt }; tip?: string };
type Rendered = { svg: SVGSVGElement; map: Mapper | null; box: Box | null; anim: AnimItem[] };

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Figure 2.1 host. Listeners and pointer capture live on the persistent host,
 * because the figure is rebuilt whenever what it shows changes.
 */
export function createDiagram(host: HTMLElement, actions?: FigureActions): {
  show(plan: DiagramPlan | null, message: string, scene?: Scene | null, controls?: FigureControls | null, options?: ShowOptions): void;
  replay(): void;
  resetView(): void;
  dispose(): void;
} {
  let args: { plan: DiagramPlan | null; message: string; scene: Scene | null; controls: FigureControls | null; aspect: number } =
    { plan: null, message: '', scene: null, controls: null, aspect: 16 / 9 };
  let current: Rendered | null = null;
  let signature = '';
  let lockedBox: Box | null = null;
  let frame = 0;
  type Gesture = {
    pointer: number; startClient: ScreenPoint; startSvg: ScreenPoint; moved: boolean;
    handle: Handle | null; startValues: { x: number; y: number; z: number; yaw: number };
    columns: [ScreenPoint, ScreenPoint, ScreenPoint]; tangent: ScreenPoint | null;
    startView: { yawDeg: number; pitchDeg: number };
  };
  let gesture: Gesture | null = null;

  host.tabIndex = 0;
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Figure 2.1, interactive. Drag the camera, a light or the colored object; click a surface to follow its pixel; drag empty space or use the arrow keys to turn the view; press R to reset the view.');

  const toSvg = (clientX: number, clientY: number): ScreenPoint | null => {
    const svgEl = host.querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: (clientX - rect.left) * (W / rect.width), y: (clientY - rect.top) * (H / rect.height) };
  };
  const handleOf = (target: EventTarget | null): Handle | null => {
    const el = target instanceof Element ? target.closest('[data-drag]') : null;
    const kind = el?.getAttribute('data-drag');
    if (kind === 'target' || kind === 'camera') return { kind };
    if (kind?.startsWith('light-')) return { kind: 'light', index: Number(kind.slice(6)) };
    return null;
  };

  function redraw(animate = false): void {
    cancelAnimationFrame(frame);
    const focused = document.activeElement instanceof Element && host.contains(document.activeElement)
      ? document.activeElement.getAttribute('data-drag') : null;
    current = render(args.plan, args.message, args.scene, actions ? args.controls : null, lockedBox);
    host.replaceChildren(current.svg);
    if (focused) host.querySelector<SVGElement>(`[data-drag="${focused}"]`)?.focus({ preventScroll: true });
    if (animate && !reducedMotion()) play(current.anim);
  }

  /** Grow each path segment in event order, with a light dot at its tip; reveal the rest at each step's end. */
  function play(items: AnimItem[]): void {
    if (items.length === 0) return;
    const steps = [...new Set(items.map(i => i.step))].sort((a, b) => a - b);
    const schedule = new Map<number, { start: number; duration: number }>();
    let t = 120;
    for (const step of steps) {
      const grows = items.some(i => i.step === step && i.grow);
      const duration = grows ? 620 : 260;
      schedule.set(step, { start: t, duration });
      t += duration;
    }
    const total = t + 260;
    const svgEl = current?.svg;
    if (!svgEl) return;
    const photons = new Map<AnimItem, SVGCircleElement>();
    for (const item of items) {
      if (item.grow) {
        item.el.setAttribute('x2', String(item.grow.a.x));
        item.el.setAttribute('y2', String(item.grow.a.y));
        if (item.tip) {
          const dot = document.createElementNS(SVG_NS, 'circle');
          for (const [k, v] of Object.entries({ r: 4.5, fill: item.tip, opacity: 0, class: 'photon' })) dot.setAttribute(k, String(v));
          svgEl.append(dot);
          photons.set(item, dot);
        }
      } else item.el.style.opacity = '0';
    }
    const ease = (x: number) => x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = now - started;
      for (const item of items) {
        const s = schedule.get(item.step)!;
        if (item.grow) {
          const p = ease(Math.min(1, Math.max(0, (elapsed - s.start) / s.duration)));
          const x = item.grow.a.x + (item.grow.b.x - item.grow.a.x) * p;
          const y = item.grow.a.y + (item.grow.b.y - item.grow.a.y) * p;
          item.el.setAttribute('x2', x.toFixed(2));
          item.el.setAttribute('y2', y.toFixed(2));
          const dot = photons.get(item);
          if (dot) {
            dot.setAttribute('cx', x.toFixed(2));
            dot.setAttribute('cy', y.toFixed(2));
            dot.setAttribute('opacity', p > 0 && p < 1 ? '0.9' : '0');
          }
        } else {
          const appear = s.start + (items.some(i => i.step === item.step && i.grow) ? s.duration : 0);
          item.el.style.opacity = String(Math.min(1, Math.max(0, (elapsed - appear) / 220)));
        }
      }
      if (elapsed < total) frame = requestAnimationFrame(tick);
      else finish();
    };
    const finish = () => {
      for (const item of items) {
        if (item.grow) { item.el.setAttribute('x2', String(item.grow.b.x)); item.el.setAttribute('y2', String(item.grow.b.y)); }
        else item.el.style.opacity = '';
      }
      for (const dot of photons.values()) dot.remove();
    };
    frame = requestAnimationFrame(tick);
  }

  const onDown = (e: PointerEvent) => {
    if (!actions || e.button > 0) return;
    const start = toSvg(e.clientX, e.clientY);
    if (!start || !current?.map) return;
    const handle = handleOf(e.target);
    const controls = args.controls;
    const light = handle?.kind === 'light' ? controls?.lights[handle.index] : undefined;
    const camera = args.scene?.camera;
    // The camera orbits its target: the screen image of d(position)/d(yaw), per degree.
    let tangent: ScreenPoint | null = null;
    if (handle?.kind === 'camera' && camera) {
      const [cx, , cz] = linearColumns(current.map);
      const k = Math.PI / 180;
      const tx = -(camera.position[2] - camera.target[2]) * k, tz = (camera.position[0] - camera.target[0]) * k;
      tangent = { x: cx.x * tx + cz.x * tz, y: cx.y * tx + cz.y * tz };
    }
    gesture = {
      pointer: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, startSvg: start, moved: false, handle,
      startValues: {
        x: handle?.kind === 'target' ? controls?.target.x ?? 0 : light?.x ?? 0,
        y: light?.y ?? 0, z: light?.z ?? 0, yaw: controls?.camera.yawDeg ?? 0,
      },
      columns: linearColumns(current.map), tangent, startView: schematicView(),
    };
    // Keep the frame still while something moves, so the drag maps 1:1.
    lockedBox = current.box;
    host.setPointerCapture(e.pointerId);
    if (handle) (e.target instanceof Element ? e.target.closest<SVGElement>('[data-drag]') : null)?.focus({ preventScroll: true });
    host.classList.add('is-dragging');
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    if (!gesture || gesture.pointer !== e.pointerId || !actions) return;
    const now = toSvg(e.clientX, e.clientY);
    if (!now) return;
    const delta = { x: now.x - gesture.startSvg.x, y: now.y - gesture.startSvg.y };
    if (!gesture.moved && Math.hypot(delta.x, delta.y) < CLICK_SLOP) return;
    gesture.moved = true;
    const h = gesture.handle;
    const [cx, cy, cz] = gesture.columns;
    if (!h) {
      // Turn the view: sideways spins it around the vertical, up and down tilts it.
      setSchematicView(gesture.startView.yawDeg - delta.x * 0.2, gesture.startView.pitchDeg + delta.y * 0.15);
      redraw();
    } else if (h.kind === 'target') {
      actions.moveTarget(gesture.startValues.x + worldDeltaAlong(delta, cx));
    } else if (h.kind === 'camera' && gesture.tangent) {
      actions.moveCamera(gesture.startValues.yaw + worldDeltaAlong(delta, gesture.tangent));
    } else if (h.kind === 'light') {
      if (e.shiftKey) actions.moveLight(h.index, 'z', gesture.startValues.z + worldDeltaAlong(delta, cz));
      else {
        const [dx, dy] = worldDeltaPair(delta, cx, cy);
        actions.moveLight(h.index, 'x', gesture.startValues.x + dx);
        actions.moveLight(h.index, 'y', gesture.startValues.y + dy);
      }
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!gesture || gesture.pointer !== e.pointerId) return;
    const g = gesture;
    gesture = null;
    lockedBox = null;
    host.releasePointerCapture?.(e.pointerId);
    host.classList.remove('is-dragging');
    if (!g.moved && e.type === 'pointerup') pick(g.startSvg);
    else redraw();
  };

  /** Follow the pixel whose camera ray looks toward the surface point under the click. */
  function pick(at: ScreenPoint): void {
    const scene = args.scene;
    if (!actions || !scene || !current?.map) return;
    const ray = screenToWorldRay(current.map, at, towardViewer());
    if (!ray) return;
    const hit = nearestHit(scene, ray, EPS, FAR);
    if (!hit) return;
    const uv = worldToPicture(makeCameraBasis(scene), hit.point, args.aspect);
    if (uv) actions.pickPicture(uv.u, uv.v);
  }

  const onKey = (e: KeyboardEvent) => {
    if (!actions || e.metaKey || e.ctrlKey || e.altKey) return;
    const h = handleOf(e.target);
    const controls = args.controls;
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
    if (!h) {
      if (e.target !== host) return;
      const view = schematicView();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setSchematicView(view.yawDeg + (e.key === 'ArrowLeft' ? 5 : -5), view.pitchDeg);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') setSchematicView(view.yawDeg, view.pitchDeg + (e.key === 'ArrowDown' ? 5 : -5));
      else if (e.key === 'r' || e.key === 'R' || e.key === 'Home') setSchematicView(DEFAULT_VIEW.yawDeg, DEFAULT_VIEW.pitchDeg);
      else return;
      e.preventDefault();
      redraw();
      return;
    }
    if (!controls) return;
    if (h.kind === 'target' || h.kind === 'camera') {
      const r = h.kind === 'target' ? controls.target.range : controls.camera.range;
      const now = h.kind === 'target' ? controls.target.x : controls.camera.yawDeg;
      const next = dir ? now + dir * r.step : e.key === 'Home' ? r.min : e.key === 'End' ? r.max : null;
      if (next === null) return;
      e.preventDefault();
      const clamped = Math.min(r.max, Math.max(r.min, next));
      if (h.kind === 'target') actions.moveTarget(clamped); else actions.moveCamera(clamped);
      return;
    }
    const light = controls.lights[h.index];
    if (!light) return;
    const axis: LightAxis | null = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? 'x'
      : e.key === 'ArrowUp' || e.key === 'ArrowDown' ? 'y' : e.key === 'PageUp' || e.key === 'PageDown' ? 'z' : null;
    if (!axis) return;
    e.preventDefault();
    const r = controls.lightRanges[axis];
    const sign = e.key === 'PageDown' ? -1 : e.key === 'PageUp' ? 1 : dir;
    actions.moveLight(h.index, axis, Math.min(r.max, Math.max(r.min, light[axis] + sign * r.step)));
  };

  const onDouble = (e: MouseEvent) => {
    if (handleOf(e.target)) return;
    setSchematicView(DEFAULT_VIEW.yawDeg, DEFAULT_VIEW.pitchDeg);
    redraw();
  };

  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  host.addEventListener('keydown', onKey);
  host.addEventListener('dblclick', onDouble);

  return {
    show(plan, message, scene = null, controls = null, options = {}) {
      // While something is being dragged, the scene briefly has no inspection
      // between frames: keep the last path on screen instead of flashing it away.
      const keptPlan = gesture?.moved && !plan ? args.plan : plan;
      args = { plan: keptPlan, message, scene, controls, aspect: options.aspect ?? args.aspect };
      // Skip identical redraws, so status-only updates never cut a playing path short.
      const next = JSON.stringify([keptPlan, message, scene, controls, schematicView()]);
      if (next === signature && !options.animate) return;
      signature = next;
      redraw(options.animate === true);
    },
    replay() { redraw(true); },
    resetView() { setSchematicView(DEFAULT_VIEW.yawDeg, DEFAULT_VIEW.pitchDeg); redraw(); },
    dispose() {
      cancelAnimationFrame(frame);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
      host.removeEventListener('keydown', onKey);
      host.removeEventListener('dblclick', onDouble);
      host.replaceChildren();
    },
  };
}

/** Make an SVG element an accessible handle. */
function makeHandle(el: SVGElement, drag: string, label: string, valueText: string): void {
  el.setAttribute('data-drag', drag);
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuetext', valueText);
  el.classList.add('handle');
}

/** A native tooltip with a point's exact coordinates. */
function titled(el: Element, text: string): void {
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = text;
  el.append(title);
}

const B = (t: string, sub?: string): Run[] => sub ? [{ t, b: true }, { t: sub, sub: true }] : [{ t, b: true }];
const fmt = (p: Vec3): string => `(${p.map(c => c.toFixed(2)).join(', ')})`;

function render(plan: DiagramPlan | null, message: string, scene: Scene | null, controls: FigureControls | null, lockedBox: Box | null): Rendered {
  const f = new Figure(W, H, `${plan?.canvasLabel ?? CANVAS_LABEL} ${message}`);
  const layer = f.root.lastElementChild as SVGGElement;
  const empty = (): Rendered => {
    f.words(pt(W / 2, H / 2), message, { anchor: 'middle', color: '#62666b', size: 15 });
    return { svg: f.root, map: null, box: null, anim: [] };
  };
  if (!scene && !plan) return empty();
  const segments = plan?.segments ?? [];
  const marks = plan?.marks ?? [];

  const spheres = (scene?.objects ?? []).filter((o): o is Extract<Scene['objects'][number], { kind: 'sphere' }> => o.kind === 'sphere');
  const lights = scene ? sceneLights(scene) : [];
  const camera = scene?.camera.position ?? marks.find(m => m.role === 'camera')?.at ?? null;

  // The frame encloses the camera, every light, both spheres and the parts of
  // the path that lie inside the room limit.
  const framed: Vec3[] = [
    ...[...segments.flatMap(segment => [segment.from, segment.to]), ...marks.map(m => m.at)].filter(p => insideBox(p, ROOM_LIMIT)),
    ...lights.map(l => l.position),
    ...(camera ? [camera] : []),
    ...spheres.flatMap(s => [0, 1, 2].flatMap(axis => [-1, 1].map(sign => {
      const p: Vec3 = [...s.center]; p[axis] += sign * s.radius; return p;
    }))),
  ].filter(p => p.every(Number.isFinite));
  if (framed.length === 0) return empty();
  const lo = [0, 1, 2].map(i => Math.min(...framed.map(p => p[i])));
  const hi = [0, 1, 2].map(i => Math.max(...framed.map(p => p[i])));
  const box: Box = lockedBox ?? {
    x0: Math.max(ROOM_LIMIT.x0, Math.floor(lo[0])), x1: Math.min(ROOM_LIMIT.x1, Math.max(Math.ceil(hi[0]), Math.floor(lo[0]) + 1)),
    y0: 0, y1: Math.min(ROOM_LIMIT.y1, Math.max(Math.ceil(hi[1]), 1)),
    z0: Math.max(ROOM_LIMIT.z0, Math.floor(lo[2])), z1: Math.min(ROOM_LIMIT.z1, Math.max(Math.ceil(hi[2]), Math.floor(lo[2]) + 1)),
  };
  // Path pieces are cut to the frame (with a little room to spare).
  const reach: Box = { x0: box.x0 - 0.6, x1: box.x1 + 0.6, y0: -0.01, y1: box.y1 + 0.6, z0: box.z0 - 0.6, z1: box.z1 + 0.6 };
  const corners: Vec3[] = [box.x0, box.x1].flatMap(x => [box.y0, box.y1].flatMap(y => [box.z0, box.z1].map(z => [x, y, z] as Vec3)));
  const map = screenMapper(corners, W, H, PAD);
  if (!map) return empty();
  const toScreen = (p: Vec3): Pt => map(p);
  const obstacles: Obstacles = { segments: [], ellipses: [], boxes: [] };
  type Pending = { at: Pt; runs: Run[]; color: string; size: number; candidates: Candidate[]; step?: number };
  const pending: Pending[] = [];
  const anim: AnimItem[] = [];
  const polyline = (points: Vec3[]) => points.map((p, i) => { const q = toScreen(p); return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');
  /** Run `draw` and register what it added to the top layer as revealed at `step`. */
  const atStep = (step: number | undefined, draw: () => void): void => {
    const before = layer.childElementCount;
    draw();
    if (step === undefined) return;
    for (let i = before; i < layer.childElementCount; i++) anim.push({ el: layer.children[i] as SVGElement, step });
  };

  // ---- Coordinate frame. The grid walls are the two away from the viewer, so
  // they never cover the scene however the view is turned.
  const toward = towardViewer();
  const xBack = toward[0] > 0 ? box.x0 : box.x1, xFront = toward[0] > 0 ? box.x1 : box.x0;
  const zBack = toward[2] < 0 ? box.z1 : box.z0, zFront = toward[2] < 0 ? box.z0 : box.z1;
  const span = Math.max(box.x1 - box.x0, box.y1 - box.y0, box.z1 - box.z0);
  const tickStep = span > 12 ? 2 : 1;
  const ticks = (a: number, b: number) => { const out: number[] = []; for (let v = Math.ceil(a / tickStep) * tickStep; v <= b + 1e-9; v += tickStep) out.push(v); return out; };
  const gridLine = (a: Vec3, b: Vec3) => f.line(toScreen(a), toScreen(b), { color: GRID, width: 0.8 });
  for (const x of ticks(box.x0, box.x1)) { gridLine([x, 0, box.z0], [x, 0, box.z1]); gridLine([x, 0, zBack], [x, box.y1, zBack]); }
  for (const z of ticks(box.z0, box.z1)) { gridLine([box.x0, 0, z], [box.x1, 0, z]); gridLine([xBack, 0, z], [xBack, box.y1, z]); }
  for (const y of ticks(box.y0, box.y1)) { gridLine([box.x0, y, zBack], [box.x1, y, zBack]); gridLine([xBack, y, box.z0], [xBack, y, box.z1]); }
  for (const [a, b] of [
    [[box.x0, 0, zFront], [box.x1, 0, zFront]], [[xFront, 0, box.z0], [xFront, 0, box.z1]],
    [[box.x0, box.y1, zBack], [box.x1, box.y1, zBack]], [[xFront, 0, zBack], [xFront, box.y1, zBack]],
    [[xBack, box.y1, box.z0], [xBack, box.y1, box.z1]], [[xBack, 0, zFront], [xBack, box.y1, zFront]],
  ] as Array<[Vec3, Vec3]>) f.line(toScreen(a), toScreen(b), { color: FRAME, width: 0.9 });

  // Axes along the near frame edges: x along the front floor edge, z along the
  // near side edge, y up the front corner of the back side wall. Tick numbers sit
  // on the side away from the frame's centre.
  const centre = toScreen([(box.x0 + box.x1) / 2, box.y1 / 2, (box.z0 + box.z1) / 2]);
  const axes: Array<{ name: string; from: Vec3; to: Vec3; at: (v: number) => Vec3; values: number[] }> = [
    { name: 'x', from: [box.x0, 0, zFront], to: [box.x1 + 0.6, 0, zFront], at: v => [v, 0, zFront], values: ticks(box.x0, box.x1) },
    { name: 'z', from: [xFront, 0, box.z0], to: [xFront, 0, box.z1 + 0.6], at: v => [xFront, 0, v], values: ticks(box.z0, box.z1) },
    { name: 'y', from: [xBack, 0, zFront], to: [xBack, box.y1 + 0.6, zFront], at: v => [xBack, v, zFront], values: ticks(box.y0, box.y1) },
  ];
  const labelled: Pt[] = [];
  for (const axis of axes) {
    const a = toScreen(axis.from), b = toScreen(axis.to);
    f.arrow(a, b, 'ink', 1.2);
    obstacles.segments.push([a, b]);
    const dir = unit(pt(b.x - a.x, b.y - a.y));
    f.math(plus(b, times(dir, 12)), [{ t: axis.name, i: true }], { anchor: 'middle', color: COLORS.ink, size: 16 });
    obstacles.boxes.push({ x0: b.x + dir.x * 12 - 8, y0: b.y + dir.y * 12 - 9, x1: b.x + dir.x * 12 + 8, y1: b.y + dir.y * 12 + 9 });
    const mid = toScreen(axis.at((axis.values[0] + axis.values[axis.values.length - 1]) / 2));
    let out = unit(pt(-dir.y, dir.x));
    if ((mid.x - centre.x) * out.x + (mid.y - centre.y) * out.y < 0) out = times(out, -1);
    for (const v of axis.values) {
      const q = toScreen(axis.at(v));
      const label = plus(q, times(out, 14));
      // Two axes can share a corner tick: number it once.
      if (labelled.some(p => Math.hypot(p.x - label.x, p.y - label.y) < 14)) continue;
      labelled.push(label);
      f.line(q, plus(q, times(out, 4)), { color: COLORS.ink, width: 1 });
      const anchor = Math.abs(out.x) < 0.35 ? 'middle' : out.x > 0 ? 'start' : 'end';
      f.words(label, String(v), { anchor, color: '#62666b', size: 11 });
      const w = String(v).length * 6.5;
      const x0 = anchor === 'end' ? label.x - w : anchor === 'start' ? label.x : label.x - w / 2;
      obstacles.boxes.push({ x0, y0: label.y - 7, x1: x0 + w, y1: label.y + 7 });
    }
  }

  // ---- Drops to the floor from the lights, the camera and the hit points.
  const drop = (at: Vec3, step?: number) => {
    if (!(at[1] > 0.02)) return;
    const top = toScreen(at), foot = toScreen([at[0], 0, at[2]]);
    if (!clipSegment(top, foot, PLOT)) return;
    atStep(step, () => {
      f.line(top, foot, { color: COLORS.guide, width: 1, dash: '3 3' });
      f.circle(foot, 2.2, '#ffffff', COLORS.guide, 1);
    });
  };
  for (const light of lights) drop(light.position);
  if (camera) drop(camera);
  for (const mark of marks) if (mark.role === 'hit' && insideBox(mark.at, reach)) drop(mark.at, mark.step);

  // ---- Spheres as wireframe globes, at their real centres and radii. The near
  // half of each latitude and longitude circle is ink; the far half faint and dashed.
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
      const runs = globeLines(sphere.center, sphere.radius, toward);
      for (const run of runs.filter(r => !r.front)) f.path(polyline(run.points), { stroke: COLORS.guide, width: 0.6, dash: '2 3' });
      for (const run of runs.filter(r => r.front)) f.path(polyline(run.points), { stroke: COLORS.ink, width: 0.7 });
      const rim = document.createElementNS(SVG_NS, 'ellipse');
      for (const [k, v] of Object.entries({ cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, fill: 'transparent', stroke: COLORS.ink, 'stroke-width': 1.3 })) rim.setAttribute(k, String(v));
      f.add(rim);
    };
    const group = f.ref(`globe-${sphere.id}`, draw);
    titled(group, `${sphere.id === 'mirror' ? 'center sphere' : sphere.id === 'target' ? 'colored object' : sphere.id}: center ${fmt(sphere.center)}, radius ${sphere.radius.toFixed(2)}`);
    if (controls && sphere.id === 'target') {
      makeHandle(group, 'target', 'Colored object: drag sideways or use the arrow keys', `x = ${controls.target.x.toFixed(2)}`);
    }
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
  const lightCount = lights.length;
  const shadowLabel = (segment: PlanSegment): Run[] => lightCount > 1 ? B('L', String((segment.light ?? 0) + 1)) : B('L');

  // Segments, back to front: miss, shadow rays, normals, then the path.
  const order: PlanSegment['role'][] = ['miss', 'shadow-open', 'shadow-blocked', 'normal', 'path'];
  const pathSegments = segments.filter(s => s.role === 'path');
  let normalIndex = 0;
  let shadowIndex = 0;
  for (const role of order) {
    for (const segment of segments.filter(s => s.role === role)) {
      const inRoom = clipSegment3D(segment.from, segment.to, reach);
      if (!inRoom) continue;
      const screenClip = clipSegment(toScreen(inRoom.a), toScreen(inRoom.b), PLOT);
      if (!screenClip) continue;
      // A piece cut at the frame counts as clipped at that end, like one cut at the plot edge.
      const clip = { ...screenClip, clippedA: screenClip.clippedA || inRoom.clippedA, clippedB: screenClip.clippedB || inRoom.clippedB };
      obstacles.segments.push([clip.a, clip.b]);
      const dir = unit(pt(clip.b.x - clip.a.x, clip.b.y - clip.a.y));
      const step = segment.step;
      const grow = (el: SVGLineElement, tip?: string) => { if (step !== undefined) anim.push({ el, step, grow: { a: clip.a, b: clip.b }, tip }); };
      if (role === 'path') {
        const first = pathSegments.indexOf(segment) === 0;
        const color = first ? COLORS.ray : COLORS.science;
        grow(f.line(clip.a, clip.b, { color, width: 1.9 }), color);
        const mid = plus(clip.a, times(pt(clip.b.x - clip.a.x, clip.b.y - clip.a.y), 0.55));
        atStep(step, () => f.arrow(plus(mid, times(dir, -10)), plus(mid, times(dir, 10)), first ? 'ray' : 'science', 1.9));
        pending.push({ at: clip.a, runs: B(first ? 'D' : 'R'), color, size: 17, step, candidates: alongSides(clip.a, clip.b, [0.55, 0.42, 0.68, 0.3, 0.8, 0.2, 0.9]) });
        if (clip.clippedB) {
          // The ray leaves the frame: an arrowhead at the edge, and where it lands.
          atStep(step, () => f.arrow(plus(clip.b, times(dir, -14)), clip.b, first ? 'ray' : 'science', 1.9));
          pending.push({ at: clip.b, runs: [`continues to ${fmt(segment.to)}`], color: '#62666b', size: 12, step, candidates: aroundPoint(12) });
        }
        if (first && clip.clippedA) {
          const near = plus(clip.a, times(dir, 26));
          pending.push({ at: near, runs: ['from camera'], color: '#62666b', size: 13, step, candidates: [
            { dx: 10, dy: 0, anchor: 'start' }, { dx: -10, dy: 0, anchor: 'end' }, { dx: 10, dy: -14, anchor: 'start' }, { dx: -10, dy: -14, anchor: 'end' }] });
        }
      } else if (role === 'normal') {
        normalIndex++;
        atStep(step, () => f.arrow(clip.a, clip.b, 'ink', 1.4));
        pending.push({ at: clip.b, runs: B('N', String(normalIndex)), color: COLORS.ink, size: 16, step, candidates: [
          { dx: dir.x * 12, dy: dir.y * 12, anchor: 'middle' }, ...aroundPoint(10), ...aroundPoint(20)] });
      } else if (role === 'shadow-open' || role === 'shadow-blocked') {
        // A self-shadow check stops a hair from where it starts (t ~ 0.006): on
        // screen that is no segment at all, so only the blocker mark is drawn.
        if (role === 'shadow-blocked' && Math.hypot(clip.b.x - clip.a.x, clip.b.y - clip.a.y) < 8) continue;
        const open = role === 'shadow-open';
        grow(f.line(clip.a, clip.b, { color: COLORS.science, width: 1.5, dash: open ? '6 4' : undefined, arrow: open && !clip.clippedB ? 'science' : undefined }), COLORS.science);
        if (open && clip.clippedB) {
          atStep(step, () => f.arrow(plus(clip.b, times(dir, -16)), clip.b, 'science', 1.5));
          pending.push({ at: clip.b, runs: ['to light'], color: '#62666b', size: 13, step, candidates: aroundPoint(12) });
        }
        // Stagger where each light's L sits along its ray, so labels that start
        // at the same hit point spread out instead of piling up next to it.
        const offset = (shadowIndex++ % 4) * 0.08;
        const fractions = [0.3, 0.45, 0.6, 0.22, 0.72, 0.15, 0.85].map(t => Math.min(0.9, t + offset));
        pending.push({ at: clip.a, runs: shadowLabel(segment), color: COLORS.science, size: 16, step, candidates: alongSides(clip.a, clip.b, fractions) });
      } else {
        grow(f.line(clip.a, clip.b, { color: COLORS.guide, width: 1.3, dash: '5 4', arrow: 'guide' }));
        if (segment.label) pending.push({ at: clip.b, runs: [segment.label], color: '#62666b', size: 13, step, candidates: aroundPoint(12) });
      }
    }
  }

  // ---- The room's fixed points: every light and the camera, always drawn and
  // always draggable, whether or not a pixel is selected.
  const inside = (at: Pt) => at.x >= PLOT.x0 && at.x <= PLOT.x1 && at.y >= PLOT.y0 && at.y <= PLOT.y1;
  const lightLabels: Pending[] = [];
  lights.forEach((light, index) => {
    const at = toScreen(light.position);
    if (!inside(at)) return;
    const bulb = f.ref(index === 0 ? 'light' : `light-${index + 1}`, () => { f.circle(at, 22, 'transparent', 'none'); f.bulb(at); });
    const name = lightCount > 1 ? `light ${index + 1}` : 'light';
    titled(bulb, `${name} ${fmt(light.position)}, intensity ${light.intensity}`);
    if (controls?.lights[index]) {
      makeHandle(bulb, `light-${index}`, `${name}: drag to move it sideways and up or down, Shift + drag for depth; arrow keys and Page Up or Page Down`, fmt(light.position));
    }
    obstacles.boxes.push({ x0: at.x - 13, y0: at.y - 13, x1: at.x + 13, y1: at.y + 17 });
    lightLabels.push({ at, runs: [name], color: '#62666b', size: 13, candidates: aroundPoint(22) });
  });
  if (camera) {
    const at = toScreen(camera);
    if (inside(at)) {
      const handle = f.ref('camera', () => {
        f.circle(at, 14, 'transparent', 'none');
        f.circle(at, 6, '#ffffff', COLORS.ink, 1.6);
        f.dot(at, COLORS.ink, 2.6);
      });
      titled(handle, `camera ${fmt(camera)}`);
      if (controls) makeHandle(handle, 'camera', 'Camera: drag around the scene or use the arrow keys', `${controls.camera.yawDeg.toFixed(0)}°`);
      obstacles.boxes.push({ x0: at.x - 8, y0: at.y - 8, x1: at.x + 8, y1: at.y + 8 });
      lightLabels.push({ at, runs: ['camera'], color: '#62666b', size: 13, candidates: aroundPoint(14) });
    }
  }

  // Path marks. Hits on a sphere are labelled P1, P2 ... (the sphere carries its
  // name); hits on a plane also name the plane.
  let hitIndex = 0;
  const onSphere = (q: Vec3) => spheres.find(s => Math.abs(Math.hypot(q[0] - s.center[0], q[1] - s.center[1], q[2] - s.center[2]) - s.radius) < 1e-3);
  for (const mark of marks) {
    const at = toScreen(mark.at);
    if (mark.role === 'hit') hitIndex++;
    // Points beyond the frame are named by their ray's "continues to" label instead.
    if (!inside(at) || !insideBox(mark.at, reach)) continue;
    if (mark.role === 'hit') {
      const label = `P${hitIndex}`;
      atStep(mark.step, () => titled(f.dot(at, COLORS.ray, 4), `${label} ${fmt(mark.at)}`));
      const sphere = onSphere(mark.at);
      pending.unshift({ at, runs: sphere ? B('P', String(hitIndex)) : [...B('P', String(hitIndex)), ` ${mark.label}`], color: COLORS.ray, size: 16, step: mark.step, candidates: [...aroundPoint(13), ...aroundPoint(26)] });
    } else if (mark.role === 'blocker') {
      atStep(mark.step, () => f.cross(at, 5));
      pending.push({ at, runs: [mark.label], color: '#62666b', size: 13, step: mark.step, candidates: [...aroundPoint(12), ...aroundPoint(26), ...aroundPoint(40)] });
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

  // Place labels in priority order (hit points, lights and camera, then the rest), then draw them.
  for (const label of [...hits, ...lightLabels, ...rest]) {
    const width = label.runs.reduce((w, r) => w + (typeof r === 'string' ? r.length * 0.55 : r.t.length * (r.sub ? 0.45 : 0.7)), 0) * label.size;
    // Farther rings come last: used only when every nearby spot is taken, with a leader line.
    const chosen = placeLabel(label.at, width, label.size * 1.15, [...label.candidates, ...aroundPoint(38), ...aroundPoint(54)], obstacles, PLOT);
    const reach = Math.hypot(chosen.x - label.at.x, chosen.y - label.at.y);
    atStep(label.step, () => {
      if (reach > 34) {
        const toward2 = unit(pt(chosen.x - label.at.x, chosen.y - label.at.y));
        f.line(plus(label.at, times(toward2, 5)), plus(label.at, times(toward2, reach - 12)), { color: COLORS.guide, width: 0.7 });
      }
      // A white halo keeps each label legible where it crosses grid or globe lines.
      const text = f.math(pt(chosen.x, chosen.y), label.runs, { anchor: chosen.anchor, color: label.color, size: label.size });
      text.setAttribute('paint-order', 'stroke');
      text.setAttribute('stroke', '#ffffff');
      text.setAttribute('stroke-width', '3');
      text.setAttribute('stroke-linejoin', 'round');
    });
  }

  // Before a pixel is chosen, say so in the corner; the room is already there to play with.
  if (!plan) f.words(pt(PLOT.x0 + 8, PLOT.y0 + 14), message, { anchor: 'start', color: '#62666b', size: 14 });
  return { svg: f.root, map, box, anim };
}

const GRID = '#e6e6e1';
const FRAME = '#c9c9c3';

/** Linear RGB to a CSS sRGB color, for tinting matte spheres with their own albedo. */
function cssColor(linear: Vec3): string {
  const encode = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
  return `rgb(${linear.map(encode).join(' ')})`;
}
