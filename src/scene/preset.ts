import type { Controls, Scene } from '../contracts.ts';

// Original room: mirror at center, coral target nearer the camera, teal back wall.
// Control ranges keep the target separate from the mirror and the camera outside geometry.
export const CONTROL_RANGES = {
  targetX: { min: -2.8, max: -1.6, step: 0.05 },
  lightX: { min: -4, max: 4, step: 0.1 },
  cameraYawDeg: { min: -15, max: 15, step: 1 },
} as const;

export function initialControls(): Controls {
  return { targetX: -2.1, lightX: -3, cameraYawDeg: 0,
    mirrorMode: 'mirror', maxRedirects: 4, viewMode: 'beauty' };
}

export function createPreset(controls: Controls = initialControls()): Scene {
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
    light: { position: [controls.lightX, 5, -2], color: [1, 0.94, 0.84], intensity: 55 },
    ambient: 0.07,
    skyBottom: [0.28, 0.36, 0.48],
    skyTop: [0.045, 0.09, 0.2],
  };
}
