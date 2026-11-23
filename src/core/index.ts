import { EPS, FAR, PLANE_PARALLEL_THRESHOLD } from '../contracts.ts';
import type { CameraBasis, Hit, Ray, Scene, TraceEvent, TraceOptions, TraceResult, Vec3, ViewMode } from '../contracts.ts';
import { add, clamp, cross, dot, normalize, reflect, scale, sub } from './vector.ts';

export function makeCameraBasis(scene: Scene): CameraBasis {
  let forward = normalize(sub(scene.camera.target, scene.camera.position));
  // A vertical look direction has no unique right vector; keep a small +Z component.
  if (Math.hypot(forward[0], forward[2]) < 1e-4) {
    forward = normalize([0, forward[1], 1e-4]);
  }
  const right = normalize(cross([0, 1, 0], forward));
  return { origin: [...scene.camera.position], forward, right, up: cross(forward, right),
    tanHalfFov: Math.tan(scene.camera.fovYDeg * Math.PI / 360) };
}

export function makeCameraRay(camera: CameraBasis, x: number, y: number, width: number, height: number): Ray {
  const sx = (2 * (x + 0.5) / width - 1) * (width / height);
  const sy = 1 - 2 * (y + 0.5) / height;
  return { origin: [...camera.origin], direction: normalize(add(camera.forward,
    add(scale(camera.right, sx * camera.tanHalfFov), scale(camera.up, sy * camera.tanHalfFov)))) };
}

export function nearestHit(scene: Scene, inputRay: Ray, tMin: number, tMax: number): Hit | null {
  // Bounds and returned t are world distances even for a non-unit input direction.
  const ray: Ray = { origin: inputRay.origin, direction: normalize(inputRay.direction) };
  let closest: Hit | null = null;
  let limit = tMax;
  for (const object of scene.objects) {
    let t: number;
    let outwardNormal: Vec3;
    if (object.kind === 'sphere') {
      const offset = sub(ray.origin, object.center);
      const a = dot(ray.direction, ray.direction);
      const halfB = dot(offset, ray.direction);
      const c = dot(offset, offset) - object.radius * object.radius;
      const discriminant = halfB * halfB - a * c;
      if (discriminant < 0) continue;
      const root = Math.sqrt(discriminant);
      t = (-halfB - root) / a;
      if (!(t > tMin && t < limit)) t = (-halfB + root) / a;
      if (!(t > tMin && t < limit)) continue;
      outwardNormal = normalize(sub(add(ray.origin, scale(ray.direction, t)), object.center));
    } else {
      outwardNormal = normalize(object.normal);
      const denominator = dot(outwardNormal, ray.direction);
      if (Math.abs(denominator) < PLANE_PARALLEL_THRESHOLD) continue;
      t = dot(sub(object.point, ray.origin), outwardNormal) / denominator;
      if (!(t > tMin && t < limit)) continue;
    }
    const frontFace = dot(ray.direction, outwardNormal) < 0;
    closest = { objectId: object.id, materialIndex: object.materialIndex, t,
      point: add(ray.origin, scale(ray.direction, t)), outwardNormal,
      normal: frontFace ? outwardNormal : scale(outwardNormal, -1), frontFace };
    // Strict comparison above preserves the earlier object on exact ties.
    limit = t;
  }
  return closest;
}

function sky(scene: Scene, direction: Vec3): Vec3 {
  const t = clamp(0.5 * (direction[1] + 1), 0, 1);
  return add(scale(scene.skyBottom, 1 - t), scale(scene.skyTop, t));
}

// One implementation serves inspection and fallback. Omitting events avoids event-array
// collection and event object construction on the bulk-rendering path.
function trace(scene: Scene, primary: Ray, options: TraceOptions, events?: TraceEvent[]): Vec3 {
  let ray: Ray = { origin: primary.origin, direction: normalize(primary.direction) };
  let redirects = 0;
  while (true) {
    const hit = nearestHit(scene, ray, EPS, FAR);
    if (hit) events?.push({ kind: 'hit', from: ray.origin, incoming: ray.direction, hit });
    if (options.viewMode !== 'beauty') {
      events?.push({ kind: 'end', reason: 'diagnostic', from: hit?.point ?? ray.origin, direction: ray.direction });
      if (!hit) return [0, 0, 0];
      return options.viewMode === 'hit' ? [1, 1, 1] : [...scene.materials[hit.materialIndex].albedo];
    }
    if (!hit) {
      events?.push({ kind: 'end', reason: 'sky', from: ray.origin, direction: ray.direction });
      return sky(scene, ray.direction);
    }
    const material = scene.materials[hit.materialIndex];
    const offset = add(hit.point, scale(hit.normal, EPS));
    if (material.mode === 'mirror') {
      if (redirects >= options.maxRedirects) {
        events?.push({ kind: 'end', reason: 'budget', from: hit.point, direction: ray.direction });
        return [0, 0, 0];
      }
      const outgoing = reflect(ray.direction, hit.normal);
      events?.push({ kind: 'reflect', point: hit.point, incoming: ray.direction, outgoing, normal: hit.normal });
      ray = { origin: offset, direction: outgoing };
      redirects++;
      continue;
    }
    const toLight = sub(scene.light.position, offset);
    const distanceSquared = dot(toLight, toLight);
    const distance = Math.sqrt(distanceSquared);
    const lightDirection: Vec3 = distance > 0 ? scale(toLight, 1 / distance) : [0, 0, 0];
    const nDotL = Math.max(dot(hit.normal, lightDirection), 0);
    const blocker = distance > EPS ? nearestHit(scene, { origin: offset, direction: lightDirection }, EPS, distance) : null;
    events?.push({ kind: 'shadow', from: offset, toLight: lightDirection, blocked: blocker !== null,
      blockerId: blocker?.objectId ?? null, blockerPoint: blocker?.point ?? null, nDotL });
    const irradiance = blocker ? 0 : scene.light.intensity * nDotL / Math.max(distanceSquared, 0.01);
    const color = material.albedo.map((channel, i) =>
      scene.ambient * channel + channel / Math.PI * scene.light.color[i] * irradiance) as Vec3;
    events?.push({ kind: 'end', reason: 'surface', from: hit.point, direction: ray.direction });
    return color;
  }
}

export function traceRay(scene: Scene, ray: Ray, options: TraceOptions): TraceResult {
  const events: TraceEvent[] = [];
  return { linearColor: trace(scene, ray, options, events), events };
}

/** Internal bulk path; does not change the public traceRay result or shared contract. */
export function traceColor(scene: Scene, ray: Ray, options: TraceOptions): Vec3 {
  return trace(scene, ray, options);
}

export function encodeDisplay(linear: Vec3, mode: ViewMode): Vec3 {
  return linear.map(value => {
    let c = Math.max(0, value);
    if (mode === 'hit') return clamp(c, 0, 1);
    if (mode === 'beauty') c = c / (1 + c);
    return clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055, 0, 1);
  }) as Vec3;
}
