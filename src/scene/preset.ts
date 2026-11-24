import { MAX_LIGHTS } from '../contracts.ts';
import type { Controls, LightControl, Scene, Vec3 } from '../contracts.ts';

// Original room: mirror at center, coral target nearer the camera, teal back wall.
// Control ranges keep the target separate from the mirror and the camera outside geometry.
export const CONTROL_RANGES = {
  targetX: { min: -2.8, max: -1.6, step: 0.05 },
  lightX: { min: -4, max: 4, step: 0.1 },
  cameraYawDeg: { min: -40, max: 40, step: 1 },
  // Height and depth keep every light above both spheres and in front of the back wall.
  lightY: { min: 2.2, max: 7, step: 0.1 },
  lightZ: { min: -4, max: 4.5, step: 0.1 },
  lightIntensity: { min: 0, max: 150, step: 1 },
} as const;

/** Linear-RGB colors for extra lights, so each one is recognisable in the picture. */
export const EXTRA_LIGHT_TINTS: readonly Vec3[] = [
  [0.3, 0.55, 1],    // cool blue
  [1, 0.3, 0.6],     // pink
  [0.35, 1, 0.4],    // green
];
const MAIN_LIGHT_COLOR: Vec3 = [1, 0.94, 0.84];

/** Where a newly added light appears, by tint, so it is visible straight away. */
const NEW_LIGHT_SPOTS: readonly Omit<LightControl, 'tint'>[] = [
  { x: 3, y: 4.5, z: -1, intensity: 60 },
  { x: 0.5, y: 6, z: 3.5, intensity: 60 },
  { x: -2, y: 3, z: 3, intensity: 60 },
];

/** A new extra light using the first unused tint, or null when the scene is full. */
export function newExtraLight(existing: readonly LightControl[]): LightControl | null {
  if (existing.length >= MAX_LIGHTS - 1) return null;
  const used = new Set(existing.map(light => light.tint));
  const tint = EXTRA_LIGHT_TINTS.findIndex((_, i) => !used.has(i));
  if (tint < 0) return null;
  return { ...NEW_LIGHT_SPOTS[tint], tint };
}

export function initialControls(): Controls {
  return { targetX: -2.1, lightX: -3, cameraYawDeg: 0,
    mirrorMode: 'mirror', maxRedirects: 4, viewMode: 'beauty',
    lightY: 5, lightZ: -2, lightIntensity: 55, extraLights: [] };
}

export function createPreset(input: Partial<Controls> = initialControls()): Scene {
  // Partial input keeps older callers (which only knew lightX) working with the defaults.
  const controls: Controls = { ...initialControls(), ...input };
  const yaw = controls.cameraYawDeg * Math.PI / 180;
  return {
    objects: [
      { kind: 'sphere', id: 'mirror', materialIndex: 0, center: [0, 1, 1.5], radius: 1 },
      { kind: 'sphere', id: 'target', materialIndex: 1, center: [controls.targetX, 0.65, -0.4], radius: 0.65 },
      { kind: 'plane', id: 'floor', materialIndex: 2, point: [0, 0, 0], normal: [0, 1, 0] },
      { kind: 'plane', id: 'back-wall', materialIndex: 3, point: [0, 0, 5], normal: [0, 0, -1] },
    ],
    materials: [
      { mode: controls.mirrorMode, albedo: [0.65, 0.75, 0.9] },
      { mode: 'matte', albedo: [0.9, 0.15, 0.065] },
      { mode: 'matte', albedo: [0.38, 0.32, 0.22] },
      { mode: 'matte', albedo: [0.08, 0.3, 0.32] },
    ],
    camera: { position: [7 * Math.sin(yaw), 2.4, 1.5 - 7 * Math.cos(yaw)], target: [0, 0.9, 1.5], fovYDeg: 48 },
    light: { position: [controls.lightX, controls.lightY, controls.lightZ], color: [...MAIN_LIGHT_COLOR], intensity: controls.lightIntensity },
    extraLights: controls.extraLights.map(light => ({
      position: [light.x, light.y, light.z], color: [...EXTRA_LIGHT_TINTS[light.tint]], intensity: light.intensity })),
    ambient: 0.07,
    skyBottom: [0.28, 0.36, 0.48],
    skyTop: [0.045, 0.09, 0.2],
  };
}
