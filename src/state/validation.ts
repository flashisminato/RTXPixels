import { MAX_MATERIALS, MAX_OBJECTS, MAX_REDIRECTS } from '../contracts.ts';
import type { Controls, Scene } from '../contracts.ts';
import { CONTROL_RANGES } from '../scene/preset.ts';

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
  if (controls.viewMode !== 'beauty' && controls.viewMode !== 'hit' && controls.viewMode !== 'albedo') throw new RangeError('Unsupported view mode.');
  finiteRange(controls.maxRedirects, 0, MAX_REDIRECTS, 'Redirect budget');
  if (!Number.isInteger(controls.maxRedirects)) throw new RangeError('Redirect budget must be an integer.');
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
  const light = record(scene.light, 'Light');
  vector(light.position, 'Light position');
  vector(light.color, 'Light color', 0, Number.MAX_VALUE);
  finiteRange(light.intensity, 0, Number.MAX_VALUE, 'Light intensity');
  finiteRange(scene.ambient, 0, 1, 'Ambient');
  vector(scene.skyBottom, 'Sky bottom', 0, Number.MAX_VALUE);
  vector(scene.skyTop, 'Sky top', 0, Number.MAX_VALUE);
}
