import type { CameraBasis, Material, Scene, SceneObject, ViewMode } from '../contracts';
import {
  MAX_MATERIALS,
  MAX_OBJECTS,
  MAX_EXTRA_LIGHTS,
  MAX_REDIRECTS,
  MODE_MATTE,
  MODE_MIRROR,
  OBJECT_PLANE,
  OBJECT_SPHERE,
  VIEW_ALBEDO,
  VIEW_BEAUTY,
  VIEW_HIT,
} from './constants';

/**
 * Flat, explicitly validated arrays ready for upload.
 *
 * The original Metal renderer copied fixed-stride native structs straight into
 * a GPU buffer (`Renderer.buildSceneBuffer` copies 20 object strides even when
 * nine are populated). None of that layout reasoning crosses into the browser:
 * every field here is written by name, and only the active count is read by the
 * shader.
 */
export type PackedScene = {
  objectA: Float32Array;        // MAX_OBJECTS * 4
  objectB: Float32Array;        // MAX_OBJECTS * 4
  objectMaterial: Int32Array;   // MAX_OBJECTS
  albedo: Float32Array;         // MAX_MATERIALS * 3
  materialMode: Int32Array;     // MAX_MATERIALS
  objectCount: number;
  materialCount: number;
};

export class SceneValidationError extends Error {
  constructor(message: string) {
    super(`Renderer received an invalid scene: ${message}`);
    this.name = 'SceneValidationError';
  }
}

function assertFiniteVec3(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new SceneValidationError(`${label} must be a 3-element array`);
  }
  const [x, y, z] = value as number[];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new SceneValidationError(`${label} must contain finite numbers, got ${JSON.stringify(value)}`);
  }
  return [x, y, z];
}

function normalise(v: [number, number, number], label: string): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 0)) {
    throw new SceneValidationError(`${label} has zero length and cannot be normalised`);
  }
  return [v[0] / length, v[1] / length, v[2] / length];
}

function modeCode(material: Material, index: number): number {
  switch (material.mode) {
    case 'matte':
      return MODE_MATTE;
    case 'mirror':
      return MODE_MIRROR;
    default:
      // Glass is deliberately absent from contract v1. Rendering it as matte
      // would silently misinform the visitor, so refuse loudly instead.
      throw new SceneValidationError(
        `material ${index} has mode "${String((material as { mode: unknown }).mode)}", which is not part of ` +
          `contract v1 (matte | mirror). Glass needs a coordinated v2.`,
      );
  }
}

export function viewModeCode(mode: ViewMode): number {
  switch (mode) {
    case 'beauty':
      return VIEW_BEAUTY;
    case 'hit':
      return VIEW_HIT;
    case 'albedo':
      return VIEW_ALBEDO;
    default:
      throw new SceneValidationError(`unknown view mode "${String(mode)}"`);
  }
}

export function clampRedirects(value: number): number {
  if (!Number.isFinite(value)) {
    throw new SceneValidationError(`maxRedirects must be finite, got ${String(value)}`);
  }
  return Math.min(MAX_REDIRECTS, Math.max(0, Math.trunc(value)));
}

/**
 * Validate and flatten a scene. Throws rather than uploading nonsense, because
 * a silently wrong image is worse than a visible error in a teaching app.
 */
export function packScene(scene: Scene): PackedScene {
  if (!scene || typeof scene !== 'object') {
    throw new SceneValidationError('scene is not an object');
  }

  const objects: SceneObject[] = Array.isArray(scene.objects) ? scene.objects : [];
  const materials: Material[] = Array.isArray(scene.materials) ? scene.materials : [];

  if (objects.length > MAX_OBJECTS) {
    throw new SceneValidationError(`${objects.length} objects exceeds MAX_OBJECTS=${MAX_OBJECTS}`);
  }
  if (materials.length > MAX_MATERIALS) {
    throw new SceneValidationError(`${materials.length} materials exceeds MAX_MATERIALS=${MAX_MATERIALS}`);
  }
  if (materials.length === 0 && objects.length > 0) {
    throw new SceneValidationError('objects are present but the material array is empty');
  }

  const objectA = new Float32Array(MAX_OBJECTS * 4);
  const objectB = new Float32Array(MAX_OBJECTS * 4);
  const objectMaterial = new Int32Array(MAX_OBJECTS);
  const albedo = new Float32Array(MAX_MATERIALS * 3);
  const materialMode = new Int32Array(MAX_MATERIALS);

  // Unused slots get safe values. The shader never iterates past the active
  // count, but a NaN left in a padded slot can still poison some drivers.
  objectB.fill(0);
  for (let i = 0; i < MAX_OBJECTS; i++) {
    objectA[i * 4 + 3] = 1;          // harmless radius
    objectB[i * 4 + 1] = 1;          // unit +Y normal
    objectB[i * 4 + 3] = OBJECT_SPHERE;
  }

  materials.forEach((material, index) => {
    if (!material || typeof material !== 'object') {
      throw new SceneValidationError(`material ${index} is not an object`);
    }
    const linear = assertFiniteVec3(material.albedo, `material ${index} albedo`);
    albedo[index * 3 + 0] = linear[0];
    albedo[index * 3 + 1] = linear[1];
    albedo[index * 3 + 2] = linear[2];
    materialMode[index] = modeCode(material, index);
  });

  objects.forEach((object, index) => {
    if (!object || typeof object !== 'object') {
      throw new SceneValidationError(`object ${index} is not an object`);
    }

    const materialIndex = object.materialIndex;
    if (!Number.isInteger(materialIndex) || materialIndex < 0 || materialIndex >= materials.length) {
      throw new SceneValidationError(
        `object ${index} ("${String(object.id)}") has materialIndex ${String(materialIndex)}, ` +
          `outside the zero-based range 0..${materials.length - 1}`,
      );
    }
    objectMaterial[index] = materialIndex;

    if (object.kind === 'sphere') {
      const centre = assertFiniteVec3(object.center, `object ${index} center`);
      const radius = object.radius;
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new SceneValidationError(`object ${index} radius must be a positive finite number`);
      }
      objectA[index * 4 + 0] = centre[0];
      objectA[index * 4 + 1] = centre[1];
      objectA[index * 4 + 2] = centre[2];
      objectA[index * 4 + 3] = radius;
      objectB[index * 4 + 3] = OBJECT_SPHERE;
      return;
    }

    if (object.kind === 'plane') {
      const point = assertFiniteVec3(object.point, `object ${index} point`);
      // Normalise defensively: the shader's plane maths assumes a unit normal,
      // and an unnormalised one silently scales every computed t.
      const normal = normalise(
        assertFiniteVec3(object.normal, `object ${index} normal`),
        `object ${index} normal`,
      );
      objectA[index * 4 + 0] = point[0];
      objectA[index * 4 + 1] = point[1];
      objectA[index * 4 + 2] = point[2];
      objectA[index * 4 + 3] = 0;
      objectB[index * 4 + 0] = normal[0];
      objectB[index * 4 + 1] = normal[1];
      objectB[index * 4 + 2] = normal[2];
      objectB[index * 4 + 3] = OBJECT_PLANE;
      return;
    }

    throw new SceneValidationError(
      `object ${index} has kind "${String((object as { kind: unknown }).kind)}"; ` +
        `contract v1 supports sphere | plane`,
    );
  });

  return {
    objectA,
    objectB,
    objectMaterial,
    albedo,
    materialMode,
    objectCount: objects.length,
    materialCount: materials.length,
  };
}

export type PackedCamera = {
  origin: [number, number, number];
  forward: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  tanHalfFov: number;
};

/**
 * The camera basis is supplied by AI 3 and used verbatim. The renderer does NOT
 * recompute it from position/target: deriving it twice is exactly how CPU and
 * GPU drift apart. Validation only.
 */
export function packCamera(camera: CameraBasis): PackedCamera {
  if (!camera || typeof camera !== 'object') {
    throw new SceneValidationError('camera basis is not an object');
  }
  const tanHalfFov = camera.tanHalfFov;
  if (!Number.isFinite(tanHalfFov) || tanHalfFov <= 0) {
    throw new SceneValidationError(`camera tanHalfFov must be positive and finite, got ${String(tanHalfFov)}`);
  }
  return {
    origin: assertFiniteVec3(camera.origin, 'camera origin'),
    forward: assertFiniteVec3(camera.forward, 'camera forward'),
    right: assertFiniteVec3(camera.right, 'camera right'),
    up: assertFiniteVec3(camera.up, 'camera up'),
    tanHalfFov,
  };
}

export function packLight(scene: Scene): {
  position: [number, number, number];
  color: [number, number, number];
  intensity: number;
  ambient: number;
  skyBottom: [number, number, number];
  skyTop: [number, number, number];
} {
  const light = scene.light;
  if (!light || typeof light !== 'object') {
    throw new SceneValidationError('scene.light is missing');
  }
  if (!Number.isFinite(light.intensity)) {
    throw new SceneValidationError(`light intensity must be finite, got ${String(light.intensity)}`);
  }
  if (!Number.isFinite(scene.ambient)) {
    throw new SceneValidationError(`ambient must be finite, got ${String(scene.ambient)}`);
  }
  return {
    position: assertFiniteVec3(light.position, 'light position'),
    color: assertFiniteVec3(light.color, 'light color'),
    intensity: light.intensity,
    ambient: scene.ambient,
    skyBottom: assertFiniteVec3(scene.skyBottom, 'skyBottom'),
    skyTop: assertFiniteVec3(scene.skyTop, 'skyTop'),
  };
}

export type PackedExtraLights = {
  position: Float32Array;   // MAX_EXTRA_LIGHTS * 3
  color: Float32Array;      // MAX_EXTRA_LIGHTS * 3
  intensity: Float32Array;  // MAX_EXTRA_LIGHTS
  count: number;
};

/** Validate and flatten the optional extra lights. Unused slots stay zero. */
export function packExtraLights(scene: Scene): PackedExtraLights {
  const extras: unknown = (scene as { extraLights?: unknown }).extraLights ?? [];
  if (!Array.isArray(extras)) {
    throw new SceneValidationError('scene.extraLights must be an array when present');
  }
  if (extras.length > MAX_EXTRA_LIGHTS) {
    throw new SceneValidationError(`${extras.length} extra lights exceeds MAX_EXTRA_LIGHTS=${MAX_EXTRA_LIGHTS}`);
  }
  const position = new Float32Array(MAX_EXTRA_LIGHTS * 3);
  const color = new Float32Array(MAX_EXTRA_LIGHTS * 3);
  const intensity = new Float32Array(MAX_EXTRA_LIGHTS);
  extras.forEach((light: { position?: unknown; color?: unknown; intensity?: unknown } | null, index) => {
    if (!light || typeof light !== 'object') {
      throw new SceneValidationError(`extra light ${index} is not an object`);
    }
    if (typeof light.intensity !== 'number' || !Number.isFinite(light.intensity)) {
      throw new SceneValidationError(`extra light ${index} intensity must be finite, got ${String(light.intensity)}`);
    }
    position.set(assertFiniteVec3(light.position, `extra light ${index} position`), index * 3);
    color.set(assertFiniteVec3(light.color, `extra light ${index} color`), index * 3);
    intensity[index] = light.intensity;
  });
  return { position, color, intensity, count: extras.length };
}
