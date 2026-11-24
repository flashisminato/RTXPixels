import type { Scene, TraceEvent, Vec3, ViewState } from '../contracts.ts';

/**
 * Orthographic 3D schematic, like a textbook coordinate frame: +Y is straight up,
 * +X runs to the right (slightly toward the viewer) and +Z recedes up and to the
 * right. The view is a pure rotation, so lengths along one direction share one
 * scale and a sphere's outline is an exact circle.
 * Screen angles are not measurements. Incidence and reflection use the 3D vectors.
 */
const VIEW_YAW_DEG = 40;
const VIEW_PITCH_DEG = 20;
const NORMAL_LENGTH = 0.55;
const MISS_LENGTH = 1.35;

const yaw = VIEW_YAW_DEG * Math.PI / 180;
const pitch = VIEW_PITCH_DEG * Math.PI / 180;
/** Unit vector from the scene toward the viewer (front-right, above). */
export const VIEW_TOWARD_VIEWER: Vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
const SCREEN_RIGHT: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
const SCREEN_UP: Vec3 = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];

export const SCHEMATIC_NOTE = 'Schematic: a 3D view of the computed points on a coordinate frame.';
export const CANVAS_LABEL = '3D schematic on a coordinate frame, not a second camera. +X sideways, +Y up, +Z depth.';

export type PlanSegment = {
  from: Vec3;
  to: Vec3;
  role: 'path' | 'normal' | 'shadow-open' | 'shadow-blocked' | 'miss';
  label: string;
  /** For shadow checks: which light (0 is the main light). */
  light?: number;
};

export type PlanMark = {
  at: Vec3;
  role: 'camera' | 'hit' | 'blocker' | 'light';
  label: string;
  /** For light marks: which light (0 is the main light). */
  light?: number;
};

export type DiagramPlan = {
  segments: PlanSegment[];
  marks: PlanMark[];
  canvasLabel: string;
};

export type Explanation = {
  heading: string;
  /** The direct answer shown under the heading: one plain paragraph, under 50 words. */
  answer: string;
  modeNote: string;
  summary: string;
  pixelLine: string;
  items: { kind: TraceEvent['kind']; title: string; detail: string }[];
  math: string[];
  diagram: DiagramPlan | null;
  stale: boolean;
};

export function objectName(id: string | null): string {
  if (id === 'mirror') return 'center sphere';
  if (id === 'target') return 'colored object';
  if (id === 'floor') return 'floor';
  if (id === 'back-wall') return 'back wall';
  if (!id) return 'an object';
  return id;
}

export function project(point: Vec3): { x: number; y: number } {
  return {
    x: point[0] * SCREEN_RIGHT[0] + point[1] * SCREEN_RIGHT[1] + point[2] * SCREEN_RIGHT[2],
    y: point[0] * SCREEN_UP[0] + point[1] * SCREEN_UP[1] + point[2] * SCREEN_UP[2],
  };
}

/** Map world points into a CSS-pixel plot. Canvas Y grows downward, so world +Y moves up the screen. */
export function screenMapper(
  points: Vec3[],
  width: number,
  height: number,
  padding: number,
): ((point: Vec3) => { x: number; y: number }) | null {
  if (!(width >= 2) || !(height >= 2) || points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const projected = project(point);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return null;
    minX = Math.min(minX, projected.x);
    minY = Math.min(minY, projected.y);
    maxX = Math.max(maxX, projected.x);
    maxY = Math.max(maxY, projected.y);
  }
  if (maxX - minX < 1e-6) { minX -= 0.5; maxX += 0.5; }
  if (maxY - minY < 1e-6) { minY -= 0.5; maxY += 0.5; }
  const pad = Math.max(0, Math.min(padding, width / 4, height / 4));
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  if (innerW <= 0 || innerH <= 0) return null;
  const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY));
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const offsetX = pad + (innerW - (maxX - minX) * scale) / 2;
  const offsetY = pad + (innerH - (maxY - minY) * scale) / 2;
  return (point: Vec3) => {
    const projected = project(point);
    return {
      x: offsetX + (projected.x - minX) * scale,
      y: offsetY + (maxY - projected.y) * scale,
    };
  };
}

export function incidenceDegrees(incoming: Vec3, normal: Vec3): number | null {
  return angleBetween([-incoming[0], -incoming[1], -incoming[2]], normal);
}

export function reflectionDegrees(outgoing: Vec3, normal: Vec3): number | null {
  return angleBetween(outgoing, normal);
}

export function buildExplanation(view: ViewState): Explanation {
  const modeNote = modeCopy(view.controls.viewMode);
  const inspection = view.inspection;
  if (!inspection) {
    return {
      heading: view.status === 'error' ? 'No picture to explain' : 'Pick a pixel to follow',
      answer: emptySummary(view),
      modeNote,
      summary: emptySummary(view),
      pixelLine: `Picture version ${view.sceneVersion}. No pixel selected.`,
      items: [],
      math: ['Choose a pixel to see the 3D directions and angles for that pixel.'],
      diagram: null,
      stale: false,
    };
  }
  if (inspection.sceneVersion !== view.sceneVersion) {
    return {
      heading: 'This path is out of date',
      answer: 'The scene changed, so the old path is hidden. Pick the pixel again once the picture updates.',
      modeNote,
      summary: 'An older path is hidden so it is not mistaken for the current picture. Pick the pixel again after the picture updates.',
      pixelLine: `Picture version ${view.sceneVersion}. The selected trace is from version ${inspection.sceneVersion} and is hidden.`,
      items: [],
      math: ['The old vectors are hidden until the picture version matches.'],
      diagram: null,
      stale: true,
    };
  }
  const events = Array.isArray(inspection.result?.events) ? inspection.result.events : [];
  if (events.length === 0) {
    return {
      heading: view.controls.viewMode === 'beauty' ? 'Why this pixel is that color' : 'First-hit check for this pixel',
      answer: `Pixel (${inspection.pixel.x}, ${inspection.pixel.y}) returned no trace events.`,
      modeNote,
      summary: 'This pixel returned no trace events.',
      pixelLine: pixelLine(view, inspection),
      items: [],
      math: mathLines(view, inspection, events),
      diagram: null,
      stale: false,
    };
  }
  const built = planEvents(events, view.scene);
  return {
    heading: view.controls.viewMode === 'beauty' ? 'Why this pixel is that color' : 'First-hit check for this pixel',
    answer: answerFor(inspection.pixel, events, view.controls.maxRedirects),
    modeNote,
    summary: summarize(events, view.controls.maxRedirects),
    pixelLine: pixelLine(view, inspection),
    items: built.items,
    math: mathLines(view, inspection, events),
    diagram: built.segments.length || built.marks.length
      ? { segments: built.segments, marks: built.marks, canvasLabel: CANVAS_LABEL }
      : null,
    stale: false,
  };
}

function modeCopy(mode: ViewState['controls']['viewMode']): string {
  if (mode === 'hit') return 'First-hit diagnostic: white means a surface was hit, black means the ray missed. This is not the full picture’s color, and it does not follow a reflection.';
  if (mode === 'albedo') return 'First-hit diagnostic: the color is the first surface’s own color, or black if the ray missed. This is not the full picture, and it does not follow a reflection.';
  return 'Full picture: a mirror can bounce the path, and a matte surface then decides the color, including whether the light is blocked.';
}

function emptySummary(view: ViewState): string {
  if (view.status === 'error') return 'There is no pixel path to explain because the picture is unavailable.';
  if (view.status === 'starting') return 'The picture is still being computed. Choose a pixel once it appears.';
  return 'Click the picture, use the arrow keys on it, or inspect a mirror pixel. The path will be the one computed for that pixel.';
}

function pixelLine(view: ViewState, inspection: NonNullable<ViewState['inspection']>): string {
  const pixel = inspection.pixel;
  return `Picture version ${view.sceneVersion}. Column ${pixel.x}, row ${pixel.y} from the top left, in a ${pixel.width}×${pixel.height} picture.`;
}

/**
 * The direct answer to "why is this pixel that color?": the pixel's coordinates,
 * the path in one sentence, and whether light reaches the surface that ends it.
 */
function answerFor(pixel: { x: number; y: number }, events: TraceEvent[], redirects: number): string {
  const path = summarize(events, redirects);
  const end = events.findLast((event): event is Extract<TraceEvent, { kind: 'end' }> => event.kind === 'end');
  let light = '';
  if (end?.reason === 'surface') {
    const checks = events.filter((event): event is Extract<TraceEvent, { kind: 'shadow' }> => event.kind === 'shadow');
    const lit = checks.filter(event => !event.blocked && event.nDotL > 1e-6).length;
    if (checks.length > 0 && lit === 0) light = ' No light reaches that spot directly, so only the faint ambient light colors it.';
    else if (checks.length > 1 && lit < checks.length) light = ` ${lit} of the ${checks.length} lights reach that spot, so it is partly lit.`;
    else if (lit > 0) light = ' Light reaches that spot, so it shows the surface’s own color, lit.';
  }
  return `Pixel (${pixel.x}, ${pixel.y}): ${path}${light}`;
}

function summarize(events: TraceEvent[], redirects: number): string {
  const hits = events.filter((event): event is Extract<TraceEvent, { kind: 'hit' }> => event.kind === 'hit');
  const end = events.findLast((event): event is Extract<TraceEvent, { kind: 'end' }> => event.kind === 'end');
  if (!end) return 'These are the computed steps for this pixel, in order.';
  if (end.reason === 'sky') return 'The ray misses every object. The pixel is a computed sky color. That is a miss, not an error, and no surface is invented here.';
  if (end.reason === 'budget') {
    const where = hits.length > 0 ? `the ${objectName(hits[hits.length - 1].hit.objectId)}` : 'the mirror';
    return `The path reaches ${where} and needs another mirror bounce. The bounce limit is ${redirects}, so the pixel is black and no next hit is computed.`;
  }
  if (end.reason === 'diagnostic') {
    if (hits.length === 0) return 'This first-hit check misses every object, so the pixel is black. That black is not the sky color used by the full picture.';
    return `This first-hit check stops at the ${objectName(hits[0].hit.objectId)}. It does not follow a reflection or a shadow. Those belong to the full picture only.`;
  }
  if (hits.length >= 2) {
    return `The camera ray reaches the ${objectName(hits[0].hit.objectId)}, bounces, and the color is decided at the ${objectName(hits[hits.length - 1].hit.objectId)}.`;
  }
  if (hits.length === 1) return `The camera ray reaches the ${objectName(hits[0].hit.objectId)} and the color is decided there.`;
  return 'The color is decided at a matte surface.';
}

/** Position of light `index` (0 is the main light), or undefined when it does not exist. */
function lightPositionOf(scene: Scene, index: number): Vec3 | undefined {
  return index > 0 ? scene.extraLights?.[index - 1]?.position : scene.light.position;
}

function planEvents(events: TraceEvent[], scene: Scene): { items: Explanation['items']; segments: PlanSegment[]; marks: PlanMark[] } {
  const items: Explanation['items'] = [];
  const segments: PlanSegment[] = [];
  const marks: PlanMark[] = [];
  let paths = 0;
  let sawHit = false;
  let markedCamera = false;
  const markedLights = new Set<number>();
  let surfaceId: string | null = null;

  for (const event of events) {
    switch (event.kind) {
      case 'hit': {
        sawHit = true;
        paths += 1;
        const name = objectName(event.hit.objectId);
        if (!markedCamera && finiteVec(event.from)) {
          marks.push({ at: copy(event.from), role: 'camera', label: 'camera' });
          markedCamera = true;
        }
        if (finiteVec(event.from) && finiteVec(event.hit.point)) {
          segments.push({
            from: copy(event.from),
            to: copy(event.hit.point),
            role: 'path',
            label: paths === 1 ? '' : 'bounce',
          });
        }
        surfaceId = event.hit.objectId;
        if (finiteVec(event.hit.point)) marks.push({ at: copy(event.hit.point), role: 'hit', label: name });
        const facing = along(event.hit.point, event.hit.normal, NORMAL_LENGTH);
        if (facing && finiteVec(event.hit.point)) {
          segments.push({ from: copy(event.hit.point), to: facing, role: 'normal', label: 'facing' });
        }
        items.push(paths === 1
          ? { kind: 'hit', title: `Reaches the ${name}`, detail: `The calculation starts at the camera and hits the ${name} first.` }
          : { kind: 'hit', title: `Bounced ray reaches the ${name}`, detail: `The bounced ray hits the ${name}.` });
        break;
      }
      case 'reflect': {
        const incidence = incidenceDegrees(event.incoming, event.normal);
        const reflection = reflectionDegrees(event.outgoing, event.normal);
        const same = incidence !== null && reflection !== null && incidence.toFixed(1) === reflection.toFixed(1);
        const comparison = same
          ? 'The 3D angles match, which is the mirror rule. The drawing may still make them look unequal.'
          : 'Compare the 3D numbers with each other. The drawing is not the measurement.';
        items.push({
          kind: 'reflect',
          title: 'Bounces',
          detail: `Incidence ${formatDegrees(incidence)} and reflection ${formatDegrees(reflection)}, measured from the 3D directions. ${comparison}`,
        });
        break;
      }
      case 'shadow': {
        const lightIndex = event.lightIndex ?? 0;
        const lightAt = lightPositionOf(scene, lightIndex);
        // The main light keeps its original wording; extra lights are numbered.
        const prefix = lightIndex > 0 ? `Light ${lightIndex + 1}: ` : '';
        const name = objectName(event.blockerId);
        const sameObject = event.blockerId !== null && event.blockerId === surfaceId;
        const facingAway = Number.isFinite(event.nDotL) && event.nDotL < 1e-6
          ? ' The surface does not face the light, so the direct light adds nothing.'
          : '';
        markLight(lightIndex);
        const item = (entry: Explanation['items'][number]): void => {
          items.push(prefix ? { ...entry, title: prefix + entry.title } : entry);
        };
        if (event.blocked && finiteVec(event.blockerPoint) && finiteVec(event.from)) {
          segments.push({
            from: copy(event.from),
            to: copy(event.blockerPoint),
            role: 'shadow-blocked',
            label: sameObject || prefix ? '' : 'blocked',
            light: lightIndex,
          });
          marks.push({ at: copy(event.blockerPoint), role: 'blocker', label: sameObject ? 'in shadow' : name });
          item(sameObject
            ? {
              kind: 'shadow',
              title: `No direct light on the ${name}`,
              detail: `The check toward the light runs into the ${name} again. The drawing stops at that recorded point. It does not mean a second object is in the way.${facingAway}`,
            }
            : {
              kind: 'shadow',
              title: `Shadow blocked by the ${name}`,
              detail: `The check walks from the surface toward the light and hits the ${name} first. The drawing stops at that recorded blocker and does not continue to the light.${facingAway}`,
            });
        } else if (event.blocked) {
          item({
            kind: 'shadow',
            title: 'Shadow blocked',
            detail: 'The check reports a blocker, but no blocker position was recorded. The drawing does not invent one.',
          });
        } else if (finiteVec(event.from) && finiteVec(lightAt)) {
          segments.push({
            from: copy(event.from),
            to: copy(lightAt),
            role: 'shadow-open',
            label: prefix ? '' : 'light reaches here',
            light: lightIndex,
          });
          item({
            kind: 'shadow',
            title: 'Light reaches this surface',
            detail: `Nothing is between this surface and the light. The drawing follows that clear path to the light’s position.${facingAway}`,
          });
        } else {
          item({
            kind: 'shadow',
            title: 'Light check',
            detail: 'A shadow check was recorded, but its points could not be drawn.',
          });
        }
        break;
      }
      case 'end': {
        if ((event.reason === 'sky' || event.reason === 'diagnostic') && !sawHit) {
          const tip = along(event.from, event.direction, MISS_LENGTH);
          if (!markedCamera && finiteVec(event.from)) {
            marks.push({ at: copy(event.from), role: 'camera', label: 'camera' });
            markedCamera = true;
          }
          if (tip && finiteVec(event.from)) {
            segments.push({
              from: copy(event.from),
              to: tip,
              role: 'miss',
              label: event.reason === 'sky' ? 'sky, not a hit' : 'diagnostic miss, not a hit',
            });
          }
        }
        items.push(endItem(event, sawHit));
        break;
      }
      default: {
        const unexpected: never = event;
        void unexpected;
      }
    }
  }
  return { items, segments, marks };

  function markLight(index: number): void {
    const at = lightPositionOf(scene, index);
    if (markedLights.has(index) || !finiteVec(at)) return;
    markedLights.add(index);
    marks.push({ at: copy(at), role: 'light', label: index > 0 ? `light ${index + 1}` : 'light', light: index });
  }
}

function endItem(event: Extract<TraceEvent, { kind: 'end' }>, sawHit: boolean): Explanation['items'][number] {
  if (event.reason === 'sky') {
    return { kind: 'end', title: 'Misses into the sky', detail: 'No object was hit. The pixel uses the computed sky color. This is a miss, not an error, and the drawing does not add a surface.' };
  }
  if (event.reason === 'budget') {
    return { kind: 'end', title: 'Stops at the bounce limit', detail: 'This mirror needs another bounce, which is not computed. The pixel is black here, and the drawing does not add a guessed next hit.' };
  }
  if (event.reason === 'diagnostic') {
    return sawHit
      ? { kind: 'end', title: 'Stops at the first surface', detail: 'The check stops at the first surface. It does not follow a reflection or decide a shadow. The full picture does those; this diagnostic does not.' }
      : { kind: 'end', title: 'Diagnostic miss', detail: 'No object was hit. In this first-hit diagnostic the pixel is black. That is not the sky color the full picture would show.' };
  }
  return { kind: 'end', title: 'Decides the color here', detail: 'This matte surface ends the path. Its color uses a little light that is always there, plus the direct light if the shadow check allowed it.' };
}

function mathLines(view: ViewState, inspection: NonNullable<ViewState['inspection']>, events: TraceEvent[]): string[] {
  const lines: string[] = [];
  if (finiteVec(inspection.ray?.origin) && finiteVec(inspection.ray.direction)) {
    lines.push(`Pixel ray origin ${formatVec(inspection.ray.origin)}, direction ${formatVec(inspection.ray.direction)}.`);
  }
  if (events.some(event => event.kind === 'reflect')) {
    lines.push('Mirror rule, using the recorded 3D directions: outgoing = normalize(incoming − 2 × (incoming · facing) × facing). Incidence is the angle between the reversed incoming direction and the facing direction. Reflection is the angle between the outgoing direction and the facing direction.');
  } else {
    lines.push('This pixel’s trace has no mirror bounce, so there is no incidence and reflection pair.');
  }
  for (const event of events) {
    if (event.kind === 'reflect') {
      lines.push(`Bounce at ${formatVec(event.point)}: incoming ${formatVec(event.incoming)}, facing ${formatVec(event.normal)}, outgoing ${formatVec(event.outgoing)}. Incidence ${formatDegrees(incidenceDegrees(event.incoming, event.normal))}, reflection ${formatDegrees(reflectionDegrees(event.outgoing, event.normal))}.`);
    } else if (event.kind === 'shadow') {
      const blocker = event.blocked
        ? `Blocker ${event.blockerId ?? 'unknown'} at ${finiteVec(event.blockerPoint) ? formatVec(event.blockerPoint) : 'not recorded'}.`
        : `Light position ${formatVec(lightPositionOf(view.scene, event.lightIndex ?? 0) ?? view.scene.light.position)}.`;
      lines.push(`Shadow step: direction toward the light is ${formatVec(event.toLight)}. This is a direction, not the light’s position. How directly the surface faces the light: ${Number.isFinite(event.nDotL) ? event.nDotL.toFixed(3) : 'unavailable'}. ${blocker}`);
    }
  }
  if (finiteVec(inspection.result?.linearColor)) lines.push(`Linear color before display encoding ${formatVec(inspection.result.linearColor)}.`);
  return lines;
}

function angleBetween(a: Vec3, b: Vec3): number | null {
  if (!finiteVec(a) || !finiteVec(b)) return null;
  const left = Math.hypot(a[0], a[1], a[2]);
  const right = Math.hypot(b[0], b[1], b[2]);
  if (left === 0 || right === 0) return null;
  const cos = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (left * right)));
  return Math.acos(cos) * 180 / Math.PI;
}

function along(from: Vec3, direction: Vec3, distance: number): Vec3 | null {
  if (!finiteVec(from) || !finiteVec(direction)) return null;
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length === 0) return null;
  return [
    from[0] + direction[0] / length * distance,
    from[1] + direction[1] / length * distance,
    from[2] + direction[2] / length * distance,
  ];
}

function finiteVec(value: Vec3 | null | undefined): value is Vec3 {
  return !!value && value.length === 3 && value.every(component => Number.isFinite(component));
}

function copy(value: Vec3): Vec3 {
  return [value[0], value[1], value[2]];
}

function formatVec(value: Vec3 | null | undefined): string {
  if (!finiteVec(value)) return 'unavailable';
  return `(${value.map(component => component.toFixed(3)).join(', ')})`;
}

function formatDegrees(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unavailable';
  return `${value.toFixed(1)}°`;
}
