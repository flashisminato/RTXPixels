import { EPS } from '../contracts.ts';
import type { CameraBasis, Scene, SceneObject, TraceEvent, Vec3, ViewMode, ViewState } from '../contracts.ts';
import { encodeDisplay, makeCameraBasis } from '../core/index.ts';
import { incidenceDegrees, objectName, reflectionDegrees } from './explain.ts';

/**
 * The numbers behind the "Explain the math" figures, for one inspected pixel.
 *
 * Pure: no DOM, so it is unit-tested in Node. Every value is either read from
 * the published inspection (the trace the CPU tracer recorded) or recomputed
 * from the same scene with the contract's formulas. Recomputed values carry
 * their difference from the recorded value, so tests can prove the panel shows
 * the traced numbers rather than a parallel approximation.
 */

export type PixelStep = {
  x: number; y: number; width: number; height: number;
  sx: number; sy: number;
  /** k = tan(fov_y / 2) */
  k: number;
  fovYDeg: number;
  basis: CameraBasis;
  cameraTarget: Vec3;
  /** f + s_x k r + s_y k u, before normalization */
  unnormalized: Vec3;
  direction: Vec3;
  /** max |component| difference between the recomputed and the recorded ray direction */
  directionError: number;
};

export type SphereSolve = {
  center: Vec3; radius: number;
  /** h = (O - C) . D, with a = D . D = 1 */
  h: number;
  /** c = |O - C|^2 - R^2 */
  c: number;
  /** delta = h^2 - c */
  delta: number;
  tNear: number; tFar: number;
  root: 'near' | 'far';
  /** perpendicular distance from the centre to the ray's line */
  impact: number;
};

export type PlaneSolve = { point: Vec3; normal: Vec3; numerator: number; denominator: number };

export type HitStep = {
  order: number;
  objectId: string; name: string; materialIndex: number;
  origin: Vec3; direction: Vec3;
  t: number; point: Vec3;
  normal: Vec3; outwardNormal: Vec3; frontFace: boolean;
  sphere: SphereSolve | null;
  plane: PlaneSolve | null;
  /** |recomputed t - recorded t| */
  tError: number;
};

export type ReflectStep = {
  order: number;
  point: Vec3; incoming: Vec3; normal: Vec3; outgoing: Vec3;
  dDotN: number;
  thetaI: number; thetaR: number;
  nextOrigin: Vec3;
  /** max |component| difference between D - 2(D.N)N (normalized) and the recorded outgoing */
  outgoingError: number;
};

export type ShadeStep = {
  surface: HitStep;
  shadowOrigin: Vec3;
  lightPosition: Vec3;
  distance: number; distanceSquared: number;
  toLight: Vec3;
  /** N . L before clamping; its sign says whether the surface faces the light */
  rawNDotL: number;
  /** max(N . L, 0), as recorded */
  nDotL: number;
  /** angle between N and L in degrees */
  phiDeg: number;
  blocked: boolean; blockerId: string | null; blockerName: string | null;
  blockerPoint: Vec3 | null; blockerT: number | null;
  selfBlocked: boolean;
  visibility: 0 | 1;
  albedo: Vec3; ambient: number; lightColor: Vec3; intensity: number;
  /** The extra lights' direct terms at the same surface, in light order (empty with one light). */
  extraLights: ExtraLightTerm[];
  /** a rho + V (rho (.) c_L) I max(N.L, 0) / (pi max(d^2, 0.01)), plus each extra light's term */
  color: Vec3;
  /** max |component| difference from the recorded linear color (when this surface ends the path) */
  colorError: number | null;
};

export type ExtraLightTerm = {
  index: number; position: Vec3; lightColor: Vec3; intensity: number;
  nDotL: number; distanceSquared: number; blocked: boolean; blockerId: string | null;
  visibility: 0 | 1;
  /** V (rho (.) c_L) I max(N.L, 0) / (pi max(d^2, 0.01)) for this light */
  direct: Vec3;
};

export type LocalStep = {
  surface: HitStep;
  albedo: Vec3; ambient: number;
  /** One term per light: rho / pi (.) c_L * I * max(N.L, 0) / max(d^2, 0.01). */
  terms: Array<{ index: number; lightColor: Vec3; intensity: number; nDotL: number; distanceSquared: number; direct: Vec3 }>;
  color: Vec3;
};

export type EndStep =
  | { reason: 'surface' }
  | { reason: 'sky'; direction: Vec3; ts: number; bottom: Vec3; top: Vec3; color: Vec3 }
  | { reason: 'budget'; limit: number; used: number }
  | { reason: 'diagnostic'; mode: 'hit' | 'albedo'; hit: HitStep | null; color: Vec3 };

export type DisplayStep = {
  mode: ViewMode;
  linear: Vec3;
  /** c / (1 + c), beauty mode only */
  toneMapped: Vec3 | null;
  /** final display value in [0, 1] */
  encoded: Vec3;
  bytes: [number, number, number];
};

export type MathStory = {
  sceneVersion: number;
  mode: ViewMode;
  maxRedirects: number;
  pixel: PixelStep;
  hits: HitStep[];
  reflects: ReflectStep[];
  shade: ShadeStep | null;
  /** Ray tracing off: the first surface's direct lighting, with no shadow checks. */
  local: LocalStep | null;
  end: EndStep;
  display: DisplayStep;
};

export type MathStoryResult =
  | { kind: 'story'; story: MathStory }
  | { kind: 'empty' }
  | { kind: 'stale' };

// --- vector helpers -------------------------------------------------------

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => scale(a, 1 / length(a));
const maxDiff = (a: Vec3, b: Vec3): number => Math.max(...[0, 1, 2].map(i => Math.abs(a[i] - b[i])));
const degrees = (cosine: number): number => Math.acos(Math.min(1, Math.max(-1, cosine))) * 180 / Math.PI;

// --- builders --------------------------------------------------------------

function pixelStep(view: ViewState): PixelStep {
  const inspection = view.inspection!;
  const { x, y, width, height } = inspection.pixel;
  const basis = makeCameraBasis(view.scene);
  const sx = (2 * (x + 0.5) / width - 1) * (width / height);
  const sy = 1 - 2 * (y + 0.5) / height;
  const k = basis.tanHalfFov;
  const unnormalized = add(basis.forward, add(scale(basis.right, sx * k), scale(basis.up, sy * k)));
  const direction = normalize(unnormalized);
  return {
    x, y, width, height, sx, sy, k,
    fovYDeg: view.scene.camera.fovYDeg,
    basis,
    cameraTarget: view.scene.camera.target,
    unnormalized, direction,
    directionError: maxDiff(direction, inspection.ray.direction),
  };
}

function solveSphere(object: Extract<SceneObject, { kind: 'sphere' }>, origin: Vec3, direction: Vec3, t: number): SphereSolve {
  const oc = sub(origin, object.center);
  const h = dot(oc, direction);
  const c = dot(oc, oc) - object.radius * object.radius;
  const delta = h * h - c;
  const root = Math.sqrt(Math.max(delta, 0));
  const tNear = -h - root;
  const tFar = -h + root;
  return {
    center: object.center, radius: object.radius, h, c, delta, tNear, tFar,
    root: Math.abs(t - tNear) <= Math.abs(t - tFar) ? 'near' : 'far',
    impact: Math.sqrt(Math.max(0, dot(oc, oc) - h * h)),
  };
}

function hitStep(scene: Scene, event: Extract<TraceEvent, { kind: 'hit' }>, order: number): HitStep {
  const { hit } = event;
  const object = scene.objects.find(candidate => candidate.id === hit.objectId) ?? null;
  const origin = event.from;
  const direction = event.incoming;
  let sphere: SphereSolve | null = null;
  let plane: PlaneSolve | null = null;
  let tError = 0;
  if (object?.kind === 'sphere') {
    sphere = solveSphere(object, origin, direction, hit.t);
    tError = Math.abs((sphere.root === 'near' ? sphere.tNear : sphere.tFar) - hit.t);
  } else if (object?.kind === 'plane') {
    const normal = normalize(object.normal);
    const numerator = dot(sub(object.point, origin), normal);
    const denominator = dot(direction, normal);
    plane = { point: object.point, normal, numerator, denominator };
    tError = Math.abs(numerator / denominator - hit.t);
  }
  return {
    order,
    objectId: hit.objectId, name: objectName(hit.objectId), materialIndex: hit.materialIndex,
    origin, direction, t: hit.t, point: hit.point,
    normal: hit.normal, outwardNormal: hit.outwardNormal, frontFace: hit.frontFace,
    sphere, plane, tError,
  };
}

function reflectStep(event: Extract<TraceEvent, { kind: 'reflect' }>, order: number): ReflectStep {
  const dDotN = dot(event.incoming, event.normal);
  const recomputed = normalize(sub(event.incoming, scale(event.normal, 2 * dDotN)));
  return {
    order,
    point: event.point, incoming: event.incoming, normal: event.normal, outgoing: event.outgoing,
    dDotN,
    thetaI: incidenceDegrees(event.incoming, event.normal) ?? degrees(-dDotN),
    thetaR: reflectionDegrees(event.outgoing, event.normal) ?? degrees(dot(event.outgoing, event.normal)),
    nextOrigin: add(event.point, scale(event.normal, EPS)),
    outgoingError: maxDiff(recomputed, event.outgoing),
  };
}

type ShadowEvent = Extract<TraceEvent, { kind: 'shadow' }>;

function shadeStep(view: ViewState, surface: HitStep, event: ShadowEvent, extras: ShadowEvent[], endsPath: boolean): ShadeStep {
  const { scene } = view;
  const lightPosition = scene.light.position;
  const toLightVector = sub(lightPosition, event.from);
  const distanceSquared = dot(toLightVector, toLightVector);
  const distance = Math.sqrt(distanceSquared);
  const rawNDotL = dot(surface.normal, event.toLight);
  const visibility: 0 | 1 = event.blocked ? 0 : 1;
  const albedo = scene.materials[surface.materialIndex].albedo;
  const irradiance = visibility * scene.light.intensity * event.nDotL / Math.max(distanceSquared, 0.01);
  const color: Vec3 = [0, 1, 2].map(i =>
    scene.ambient * albedo[i] + albedo[i] / Math.PI * scene.light.color[i] * irradiance) as Vec3;
  const extraLights: ExtraLightTerm[] = [];
  for (const extra of extras) {
    const light = scene.extraLights?.[(extra.lightIndex ?? 0) - 1];
    if (!light) continue;
    const offset = sub(light.position, extra.from);
    const d2 = dot(offset, offset);
    const v: 0 | 1 = extra.blocked ? 0 : 1;
    const e = v * light.intensity * extra.nDotL / Math.max(d2, 0.01);
    const direct = [0, 1, 2].map(i => albedo[i] / Math.PI * light.color[i] * e) as Vec3;
    for (let i = 0; i < 3; i++) color[i] += direct[i];
    extraLights.push({ index: extra.lightIndex!, position: light.position, lightColor: light.color, intensity: light.intensity,
      nDotL: extra.nDotL, distanceSquared: d2, blocked: extra.blocked, blockerId: extra.blockerId, visibility: v, direct });
  }
  const recorded = view.inspection!.result.linearColor;
  return {
    surface,
    shadowOrigin: event.from,
    lightPosition, distance, distanceSquared,
    toLight: event.toLight,
    rawNDotL, nDotL: event.nDotL,
    phiDeg: degrees(rawNDotL),
    blocked: event.blocked,
    blockerId: event.blockerId,
    blockerName: event.blockerId ? objectName(event.blockerId) : null,
    blockerPoint: event.blockerPoint,
    blockerT: event.blockerPoint ? length(sub(event.blockerPoint, event.from)) : null,
    selfBlocked: event.blocked && event.blockerId === surface.objectId,
    visibility,
    albedo, ambient: scene.ambient, lightColor: scene.light.color, intensity: scene.light.intensity,
    extraLights,
    color,
    colorError: endsPath ? maxDiff(color, recorded) : null,
  };
}

function localStep(view: ViewState, surface: HitStep): LocalStep {
  const { scene } = view;
  const albedo = scene.materials[surface.materialIndex].albedo;
  const from = add(surface.point, scale(surface.normal, EPS));
  const color = albedo.map(c => scene.ambient * c) as Vec3;
  const lights = [scene.light, ...(scene.extraLights ?? [])];
  const terms = lights.map((light, index) => {
    const offset = sub(light.position, from);
    const distanceSquared = dot(offset, offset);
    const distance = Math.sqrt(distanceSquared);
    const toLight: Vec3 = distance > 0 ? scale(offset, 1 / distance) : [0, 0, 0];
    const nDotL = Math.max(dot(surface.normal, toLight), 0);
    const e = light.intensity * nDotL / Math.max(distanceSquared, 0.01);
    const direct = [0, 1, 2].map(i => albedo[i] / Math.PI * light.color[i] * e) as Vec3;
    for (let i = 0; i < 3; i++) color[i] += direct[i];
    return { index, lightColor: light.color, intensity: light.intensity, nDotL, distanceSquared, direct };
  });
  return { surface, albedo, ambient: scene.ambient, terms, color };
}

function displayStep(mode: ViewMode, linear: Vec3): DisplayStep {
  const encoded = encodeDisplay(linear, mode);
  return {
    mode, linear,
    toneMapped: mode === 'beauty' || mode === 'raster' ? linear.map(c => Math.max(0, c) / (1 + Math.max(0, c))) as Vec3 : null,
    encoded,
    bytes: encoded.map(value => Math.round(value * 255)) as [number, number, number],
  };
}

/**
 * Build the story for the currently published inspection.
 * Returns 'empty' when no pixel is selected and 'stale' when the inspection
 * belongs to an older scene version, so no outdated numbers are ever shown.
 */
export function buildMathStory(view: ViewState | null): MathStoryResult {
  const inspection = view?.inspection;
  if (!view || !inspection) return { kind: 'empty' };
  if (inspection.sceneVersion !== view.sceneVersion) return { kind: 'stale' };

  const mode = view.controls.viewMode;
  const events = inspection.result.events;
  const hits: HitStep[] = [];
  const reflects: ReflectStep[] = [];
  let shade: ShadeStep | null = null;
  let order = 0;
  let primaryShadow: ShadowEvent | null = null;
  const extraShadows: ShadowEvent[] = [];

  const last = events.at(-1);
  const endReason = last?.kind === 'end' ? last.reason : 'surface';

  for (const event of events) {
    if (event.kind === 'hit') hits.push(hitStep(view.scene, event, ++order));
    else if (event.kind === 'reflect') reflects.push(reflectStep(event, ++order));
    else if (event.kind === 'shadow' && hits.length > 0) {
      if (event.lightIndex) extraShadows.push(event);
      else primaryShadow = event;
    }
  }
  // Shadow events of all lights belong to the last surface, which ends the path.
  // Ray tracing off: recompute the direct light at the first surface, with V = 1.
  let local: LocalStep | null = null;
  if (mode === 'raster' && endReason === 'surface' && hits.length > 0) local = localStep(view, hits[0]);
  if (primaryShadow && hits.length > 0) {
    shade = shadeStep(view, hits[hits.length - 1], primaryShadow, extraShadows, endReason === 'surface');
  }

  let end: EndStep;
  if (endReason === 'sky' && last?.kind === 'end') {
    const direction = last.direction;
    const ts = Math.min(1, Math.max(0, 0.5 * (direction[1] + 1)));
    const { skyBottom: bottom, skyTop: top } = view.scene;
    end = { reason: 'sky', direction, ts, bottom, top, color: add(scale(bottom, 1 - ts), scale(top, ts)) };
  } else if (endReason === 'budget') {
    end = { reason: 'budget', limit: view.controls.maxRedirects, used: reflects.length };
  } else if (endReason === 'diagnostic') {
    const first = hits[0] ?? null;
    const diagnosticMode = mode === 'albedo' ? 'albedo' : 'hit';
    const color: Vec3 = !first ? [0, 0, 0]
      : diagnosticMode === 'hit' ? [1, 1, 1]
        : [...view.scene.materials[first.materialIndex].albedo] as Vec3;
    end = { reason: 'diagnostic', mode: diagnosticMode, hit: first, color };
  } else {
    end = { reason: 'surface' };
  }

  return {
    kind: 'story',
    story: {
      sceneVersion: inspection.sceneVersion,
      mode,
      maxRedirects: view.controls.maxRedirects,
      pixel: pixelStep(view),
      hits, reflects, shade, local, end,
      display: displayStep(mode, inspection.result.linearColor),
    },
  };
}
