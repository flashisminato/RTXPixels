import type { Vec3 } from '../contracts.ts';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(...a);
  if (!Number.isFinite(length) || length === 0) throw new RangeError('Cannot normalize a zero or nonfinite vector.');
  // Divide components directly: the reciprocal of a valid subnormal length can overflow.
  return [a[0] / length, a[1] / length, a[2] / length];
}
export function reflect(direction: Vec3, normal: Vec3): Vec3 {
  return normalize(sub(direction, scale(normal, 2 * dot(direction, normal))));
}
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
