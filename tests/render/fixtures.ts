import type { CameraBasis, RenderFrame, Scene, Vec3, ViewMode } from '../../src/contracts';

/**
 * Scenes and cameras used by the renderer checks.
 *
 * These are renderer-local test fixtures, not the product preset. The authored
 * scene, its colours, and its slider limits live in src/scene/preset.ts. Values here are
 * chosen so that expected results can be derived by hand, which is the whole
 * point: a test whose expectation came out of the renderer proves nothing.
 */

/** Exact camera basis looking down +Z from the origin. No derivation needed. */
export function axisCamera(origin: Vec3 = [0, 0, 0], tanHalfFov = 1): CameraBasis {
  // forward = +Z, right = cross([0,1,0], [0,0,1]) = [1,0,0], up = cross(f, r) = [0,1,0]
  return {
    origin,
    forward: [0, 0, 1],
    right: [1, 0, 0],
    up: [0, 1, 0],
    tanHalfFov,
  };
}

/** Camera basis from a position/target pair, using the contract's convention. */
export function lookAt(position: Vec3, target: Vec3, fovYDeg: number): CameraBasis {
  const forward = normalise(sub(target, position));
  const right = normalise(cross([0, 1, 0], forward));
  const up = cross(forward, right);
  return {
    origin: position,
    forward,
    right,
    up,
    tanHalfFov: Math.tan((fovYDeg * Math.PI) / 180 / 2),
  };
}

const BLACK_SKY: Pick<Scene, 'skyBottom' | 'skyTop'> = {
  skyBottom: [0, 0, 0],
  skyTop: [0, 0, 0],
};

/** Nothing but sky. Verifies the gradient and the empty-scene path. */
export function emptyScene(): Scene {
  return {
    objects: [],
    materials: [],
    camera: { position: [0, 0, 0], target: [0, 0, 1], fovYDeg: 90 },
    light: { position: [0, 5, 0], color: [1, 1, 1], intensity: 1 },
    ambient: 0,
    skyBottom: [0.25, 0, 0],   // distinct per-channel values so a swapped
    skyTop: [0, 0, 0.75],      // mix() shows up immediately
  };
}

/** One unit sphere at the origin. The canonical intersection fixture. */
export function singleSphereScene(): Scene {
  return {
    ...BLACK_SKY,
    objects: [
      { kind: 'sphere', id: 'unit', materialIndex: 0, center: [0, 0, 0], radius: 1 },
    ],
    materials: [{ mode: 'matte', albedo: [1, 0, 0] }],
    camera: { position: [0, 0, -3], target: [0, 0, 0], fovYDeg: 90 },
    light: { position: [0, 5, 0], color: [1, 1, 1], intensity: 1 },
    ambient: 0.5,
  };
}

/**
 * Two overlapping spheres at exactly the same distance along the view axis.
 * Used for the tie rule: equal t must resolve to the earlier array entry.
 */
export function tieScene(): Scene {
  return {
    ...BLACK_SKY,
    objects: [
      { kind: 'sphere', id: 'first', materialIndex: 0, center: [0, 0, 0], radius: 1 },
      { kind: 'sphere', id: 'second', materialIndex: 1, center: [0, 0, 0], radius: 1 },
    ],
    materials: [
      { mode: 'matte', albedo: [1, 0, 0] },
      { mode: 'matte', albedo: [0, 1, 0] },
    ],
    camera: { position: [0, 0, -3], target: [0, 0, 0], fovYDeg: 90 },
    light: { position: [0, 0, -3], color: [1, 1, 1], intensity: 1 },
    ambient: 1,
  };
}

/**
 * A floor plane, a small matte sphere above it, and a light positioned so the
 * sphere casts a hard shadow on a predictable spot.
 *
 * Light at [0,4,0], sphere centre [0,1,0] radius 0.5: the shadow is a disc
 * around the origin on the y=0 plane. A point at x=2 is lit.
 */
export function shadowScene(): Scene {
  return {
    ...BLACK_SKY,
    objects: [
      { kind: 'plane', id: 'floor', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] },
      { kind: 'sphere', id: 'blocker', materialIndex: 1, center: [0, 1, 0], radius: 0.5 },
    ],
    materials: [
      { mode: 'matte', albedo: [0.8, 0.8, 0.8] },
      { mode: 'matte', albedo: [0.2, 0.2, 0.8] },
    ],
    camera: { position: [0, 3, -6], target: [0, 0, 0], fovYDeg: 60 },
    light: { position: [0, 4, 0], color: [1, 1, 1], intensity: 1 },
    ambient: 0,
  };
}

/**
 * Mirror reflection fixture with hand-computable geometry.
 *
 * Camera at [0,0,-5] looking at +Z. A mirror PLANE at z=0 facing -Z. A red
 * emissive-ish matte sphere sits behind the camera at [0,0,-9]. The centre ray
 * travels +Z, reflects to -Z, and must then hit that sphere. Without a real
 * second intersection the centre pixel would be black.
 */
export function mirrorScene(): Scene {
  return {
    ...BLACK_SKY,
    objects: [
      { kind: 'plane', id: 'mirror', materialIndex: 0, point: [0, 0, 0], normal: [0, 0, -1] },
      { kind: 'sphere', id: 'target', materialIndex: 1, center: [0, 0, -9], radius: 1 },
    ],
    materials: [
      { mode: 'mirror', albedo: [1, 1, 1] },
      { mode: 'matte', albedo: [1, 0, 0] },
    ],
    camera: { position: [0, 0, -5], target: [0, 0, 0], fovYDeg: 60 },
    // Light sits beside the camera so the reflected sphere face is lit.
    light: { position: [0, 0, -5], color: [1, 1, 1], intensity: 10 },
    ambient: 0.25,
  };
}

/** Mirror facing another mirror, to exercise the redirect budget. */
export function doubleMirrorScene(): Scene {
  return {
    ...BLACK_SKY,
    objects: [
      { kind: 'plane', id: 'front', materialIndex: 0, point: [0, 0, 2], normal: [0, 0, -1] },
      { kind: 'plane', id: 'back', materialIndex: 0, point: [0, 0, -2], normal: [0, 0, 1] },
    ],
    materials: [{ mode: 'mirror', albedo: [1, 1, 1] }],
    camera: { position: [0, 0, 0], target: [0, 0, 1], fovYDeg: 60 },
    light: { position: [0, 3, 0], color: [1, 1, 1], intensity: 1 },
    ambient: 0,
  };
}

export function frame(
  scene: Scene,
  camera: CameraBasis,
  width: number,
  height: number,
  viewMode: ViewMode = 'beauty',
  maxRedirects = 4,
): RenderFrame {
  return {
    sceneVersion: 1,
    scene,
    camera,
    width,
    height,
    options: { maxRedirects, viewMode },
  };
}

// --- tiny vector helpers, local to the fixtures ---------------------------

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}
