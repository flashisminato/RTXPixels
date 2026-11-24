import { MAX_LIGHTS, MAX_MATERIALS, MAX_OBJECTS, MAX_REDIRECTS } from '../contracts.ts';
import type { Controls, Scene } from '../contracts.ts';
import { BALL_BOUNDS, BALL_COLORS, CONTROL_RANGES, EXTRA_LIGHT_TINTS, MAX_BALLS, WALL_COLORS, targetPositionIsFree } from '../scene/preset.ts';

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
export function finiteRange(value: unknown, min: number, max: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and between ${min} and ${max}.`);
  }
}
function vector(value: unknown, name: string, min = -10, max = 10): asserts value is [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${name} must contain three numbers.`);
  for (const component of value) finiteRange(component, min, max, name);
}
export function validateControls(value: unknown): asserts value is Controls {
  const controls = record(value, 'Controls');
  for (const [key, range] of Object.entries(CONTROL_RANGES)) finiteRange(controls[key], range.min, range.max, key);
  if (controls.mirrorMode !== 'matte' && controls.mirrorMode !== 'mirror') throw new RangeError('Unsupported mirror mode.');
  if (controls.wallMode !== 'matte' && controls.wallMode !== 'mirror') throw new RangeError('Unsupported wall finish.');
  finiteRange(controls.wallColor, 0, WALL_COLORS.length - 1, 'Wall color');
  if (!Number.isInteger(controls.wallColor)) throw new RangeError('Wall color must be an integer.');
  if (!targetPositionIsFree([controls.targetX as number, controls.targetY as number, controls.targetZ as number])) throw new RangeError('The colored ball cannot overlap the mirror ball.');
  if (!Array.isArray(controls.balls) || controls.balls.length > MAX_BALLS) throw new RangeError(`At most ${MAX_BALLS} added balls are supported.`);
  const labels = new Set<number>();
  for (const entry of controls.balls) {
    const ball = record(entry, 'Ball');
    finiteRange(ball.n, 1, MAX_BALLS, 'Ball label');
    if (!Number.isInteger(ball.n) || labels.has(ball.n)) throw new RangeError('Ball labels must be unique integers.');
    labels.add(ball.n);
    finiteRange(ball.x, BALL_BOUNDS.x.min, BALL_BOUNDS.x.max, 'Ball x');
    finiteRange(ball.y, BALL_BOUNDS.y.min, BALL_BOUNDS.y.max, 'Ball y');
    finiteRange(ball.z, BALL_BOUNDS.z.min, BALL_BOUNDS.z.max, 'Ball z');
    finiteRange(ball.color, 0, BALL_COLORS.length - 1, 'Ball color');
    if (!Number.isInteger(ball.color)) throw new RangeError('Ball color must be an integer.');
    if (ball.mode !== 'matte' && ball.mode !== 'mirror') throw new RangeError('Unsupported ball finish.');
  }
  if (controls.viewMode !== 'beauty' && controls.viewMode !== 'raster' && controls.viewMode !== 'hit' && controls.viewMode !== 'albedo') throw new RangeError('Unsupported view mode.');
  finiteRange(controls.maxRedirects, 0, MAX_REDIRECTS, 'Redirect budget');
  if (!Number.isInteger(controls.maxRedirects)) throw new RangeError('Redirect budget must be an integer.');
  if (!Array.isArray(controls.extraLights) || controls.extraLights.length > MAX_LIGHTS - 1) {
    throw new RangeError(`At most ${MAX_LIGHTS - 1} extra lights are supported.`);
  }
  const tints = new Set<number>();
  for (const entry of controls.extraLights) {
    const light = record(entry, 'Extra light');
    finiteRange(light.x, CONTROL_RANGES.lightX.min, CONTROL_RANGES.lightX.max, 'Extra light x');
    finiteRange(light.y, CONTROL_RANGES.lightY.min, CONTROL_RANGES.lightY.max, 'Extra light y');
    finiteRange(light.z, CONTROL_RANGES.lightZ.min, CONTROL_RANGES.lightZ.max, 'Extra light z');
    finiteRange(light.intensity, CONTROL_RANGES.lightIntensity.min, CONTROL_RANGES.lightIntensity.max, 'Extra light intensity');
    finiteRange(light.tint, 0, EXTRA_LIGHT_TINTS.length - 1, 'Extra light tint');
    if (!Number.isInteger(light.tint) || tints.has(light.tint)) throw new RangeError('Extra light tints must be unique integers.');
    tints.add(light.tint);
  }
}

function validateLight(value: unknown, name: string): void {
  const light = record(value, name);
  vector(light.position, `${name} position`);
  vector(light.color, `${name} color`, 0, Number.MAX_VALUE);
  finiteRange(light.intensity, 0, Number.MAX_VALUE, `${name} intensity`);
}

export function validateScene(value: unknown): asserts value is Scene {
  const scene = record(value, 'Scene');
  if (!Array.isArray(scene.objects) || scene.objects.length > MAX_OBJECTS) throw new RangeError('At most eight objects are supported.');
  if (!Array.isArray(scene.materials) || scene.materials.length > MAX_MATERIALS) throw new RangeError('At most eight materials are supported.');
  for (const entry of scene.materials) {
    const material = record(entry, 'Material');
    if (material.mode !== 'matte' && material.mode !== 'mirror') throw new RangeError('Unsupported material mode.');
    vector(material.albedo, 'Albedo', 0, 1);
  }
  const ids = new Set<string>();
  for (const entry of scene.objects) {
    const object = record(entry, 'Object');
    if (typeof object.id !== 'string' || !object.id.trim() || ids.has(object.id)) throw new RangeError('Object IDs must be nonempty and unique.');
    ids.add(object.id);
    finiteRange(object.materialIndex, 0, scene.materials.length - 1, 'Material index');
    if (!Number.isInteger(object.materialIndex)) throw new RangeError('Material index must be an integer.');
    if (object.kind === 'sphere') {
      vector(object.center, 'Sphere center');
      finiteRange(object.radius, 0.1, 1.5, 'Sphere radius');
    } else if (object.kind === 'plane') {
      vector(object.point, 'Plane point');
      vector(object.normal, 'Plane normal');
      if (Math.hypot(...object.normal) === 0) throw new RangeError('Plane normal must be nonzero.');
    } else throw new RangeError('Unsupported object kind.');
  }
  const camera = record(scene.camera, 'Camera');
  vector(camera.position, 'Camera position');
  vector(camera.target, 'Camera target');
  if (camera.position.every((component, i) => component === (camera.target as number[])[i])) throw new RangeError('Camera target must differ from its position.');
  finiteRange(camera.fovYDeg, 20, 100, 'Vertical FOV');
  validateLight(scene.light, 'Light');
  if (scene.extraLights !== undefined) {
    if (!Array.isArray(scene.extraLights) || scene.extraLights.length > MAX_LIGHTS - 1) {
      throw new RangeError(`At most ${MAX_LIGHTS - 1} extra lights are supported.`);
    }
    for (const light of scene.extraLights) validateLight(light, 'Extra light');
  }
  finiteRange(scene.ambient, 0, 1, 'Ambient');
  vector(scene.skyBottom, 'Sky bottom', 0, Number.MAX_VALUE);
  vector(scene.skyTop, 'Sky top', 0, Number.MAX_VALUE);
}
