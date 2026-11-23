import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Scene } from '../../src/contracts.ts';
import { EPS, FAR, MAX_MATERIALS, MAX_OBJECTS, MAX_REDIRECTS } from '../../src/contracts.ts';
import * as renderConstants from '../../src/render/constants.ts';
import { buildTraceFragmentSource } from '../../src/render/shaders/trace.frag.ts';
import {
  clampRedirects,
  packCamera,
  packLight,
  packScene,
  SceneValidationError,
  viewModeCode,
} from '../../src/render/uniforms.ts';
import { createPreset, initialControls } from '../../src/scene/preset.ts';

/**
 * Renderer checks that need no GPU. These run under the project's `npm test`
 * on every `npm run check`, so packing and shader-generation regressions are
 * caught in CI. The GPU behaviour itself is covered by tests/render/*.browser.mjs.
 */

function sphereScene(): Scene {
  return {
    objects: [{ kind: 'sphere', id: 's', materialIndex: 0, center: [0, 0, 0], radius: 1 }],
    materials: [{ mode: 'matte', albedo: [1, 0, 0] }],
    camera: { position: [0, 0, -3], target: [0, 0, 0], fovYDeg: 60 },
    light: { position: [0, 5, 0], color: [1, 1, 1], intensity: 1 },
    ambient: 0.1,
    skyBottom: [0, 0, 0],
    skyTop: [0, 0, 0],
  };
}

test('renderer constants are the shared contract values, not copies', () => {
  assert.equal(renderConstants.EPS, EPS);
  assert.equal(renderConstants.FAR, FAR);
  assert.equal(renderConstants.MAX_OBJECTS, MAX_OBJECTS);
  assert.equal(renderConstants.MAX_MATERIALS, MAX_MATERIALS);
  assert.equal(renderConstants.MAX_REDIRECTS, MAX_REDIRECTS);
});

test('the authored preset packs without error at every control extreme', () => {
  // The GPU must accept every scene the store can produce.
  for (const targetX of [-2.8, -1.6]) {
    for (const lightX of [-4, 4]) {
      for (const cameraYawDeg of [-15, 15]) {
        for (const mirrorMode of ['mirror', 'matte'] as const) {
          const scene = createPreset({ ...initialControls(), targetX, lightX, cameraYawDeg, mirrorMode });
          const packed = packScene(scene);
          assert.equal(packed.objectCount, scene.objects.length);
          packLight(scene);
        }
      }
    }
  }
});

test('packing is explicit: positions, types, materials and padding', () => {
  const packed = packScene({
    ...sphereScene(),
    objects: [
      { kind: 'sphere', id: 'a', materialIndex: 1, center: [1, 2, 3], radius: 0.5 },
      { kind: 'plane', id: 'b', materialIndex: 0, point: [0, -1, 0], normal: [0, 2, 0] },
    ],
    materials: [
      { mode: 'matte', albedo: [0.1, 0.2, 0.3] },
      { mode: 'mirror', albedo: [1, 1, 1] },
    ],
  });

  assert.deepEqual([...packed.objectA.slice(0, 4)], [1, 2, 3, 0.5]);
  assert.equal(packed.objectB[3], renderConstants.OBJECT_SPHERE);
  assert.deepEqual([...packed.objectA.slice(4, 7)], [0, -1, 0]);
  // Non-unit plane normals are normalised, matching the CPU reference.
  assert.deepEqual([...packed.objectB.slice(4, 8)], [0, 1, 0, renderConstants.OBJECT_PLANE]);
  assert.deepEqual([...packed.objectMaterial.slice(0, 2)], [1, 0]);
  assert.equal(packed.materialMode[0], renderConstants.MODE_MATTE);
  assert.equal(packed.materialMode[1], renderConstants.MODE_MIRROR);
  assert.ok(Math.abs(packed.albedo[1] - 0.2) < 1e-7);

  // Unused slots hold finite, harmless values.
  for (const value of packed.objectA) assert.ok(Number.isFinite(value));
  for (const value of packed.objectB) assert.ok(Number.isFinite(value));
});

test('invalid scenes are rejected before upload, never rendered wrongly', () => {
  const base = sphereScene();
  const rejects = (scene: unknown, pattern: RegExp) =>
    assert.throws(() => packScene(scene as Scene), (error: unknown) =>
      error instanceof SceneValidationError && pattern.test(error.message));

  rejects({ ...base, objects: [{ ...base.objects[0], materialIndex: 3 }] }, /materialIndex/);
  rejects({ ...base, objects: [{ ...base.objects[0], materialIndex: 0.5 }] }, /materialIndex/);
  rejects({ ...base, materials: [{ mode: 'glass', albedo: [1, 1, 1] }] }, /contract v1/);
  rejects({ ...base, objects: [{ ...base.objects[0], center: [0, Number.NaN, 0] }] }, /finite/);
  rejects({ ...base, objects: [{ ...base.objects[0], radius: 0 }] }, /radius/);
  rejects({ ...base, objects: [{ kind: 'box', id: 'x', materialIndex: 0 }] }, /sphere \| plane/);
  rejects({ ...base, objects: [{ kind: 'plane', id: 'p', materialIndex: 0, point: [0, 0, 0], normal: [0, 0, 0] }] }, /zero length/);
  rejects({ ...base, objects: Array.from({ length: MAX_OBJECTS + 1 }, (_, i) => ({ ...base.objects[0], id: `s${i}` })) }, /MAX_OBJECTS/);
  rejects({ ...base, materials: [] }, /material array is empty/);

  assert.throws(() => packCamera({ origin: [0, 0, 0], forward: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], tanHalfFov: 0 }),
    SceneValidationError);
  assert.throws(() => packLight({ ...base, light: { ...base.light, intensity: Number.POSITIVE_INFINITY } }),
    SceneValidationError);
});

test('redirect budget and view mode codes', () => {
  assert.equal(clampRedirects(-1), 0);
  assert.equal(clampRedirects(2.9), 2);
  assert.equal(clampRedirects(99), MAX_REDIRECTS);
  assert.throws(() => clampRedirects(Number.NaN), SceneValidationError);
  assert.deepEqual(['beauty', 'hit', 'albedo'].map(m => viewModeCode(m as 'beauty')), [0, 1, 2]);
  assert.throws(() => viewModeCode('wireframe' as 'beauty'), SceneValidationError);
});

test('generated shader: version first, contract constants embedded, debug code absent in production', () => {
  const production = buildTraceFragmentSource();
  const debug = buildTraceFragmentSource({ debug: true });

  assert.ok(production.startsWith('#version 300 es\n'), '#version must be the very first line');
  assert.match(production, /#define EPS 0\.0001\b/);
  assert.match(production, /#define FAR 1000\.0\b/);
  assert.match(production, new RegExp(`#define MAX_REDIRECTS ${MAX_REDIRECTS}\\b`));

  // The diagnostic block is guarded by #ifdef DEBUG_VARIANT, so its text is
  // present but the GLSL preprocessor removes it. What production must never
  // do is DEFINE the switch or DECLARE the uniform. (If the guarded block were
  // compiled without the declaration, the shader would fail to compile, which
  // the GPU suite would catch.)
  assert.doesNotMatch(production, /#define DEBUG_VARIANT/, 'production must not enable diagnostics');
  assert.doesNotMatch(production, /uniform\s+int\s+uDebugMode/, 'production must not declare the debug uniform');
  assert.match(production, /#ifdef DEBUG_VARIANT[\s\S]*#endif/, 'diagnostics must stay behind the preprocessor guard');
  assert.match(debug, /#define DEBUG_VARIANT 1/);
  assert.match(debug, /uniform int uDebugMode/);
  // Match DECLARATIONS, not text: the source explains in a comment why this
  // uniform does not exist, and that comment must not fail the check.
  assert.doesNotMatch(production, /uniform\s+\w+\s+uMaterialCount/, 'dead uniform would be stripped and fail the link check');

  // No recursion: GLSL ES forbids it and the contract requires a bounded loop.
  // Extract each function body by brace matching and look for a self-call.
  for (const name of ['traceLinear', 'shadeMatte', 'nearestHit', 'occluded']) {
    const body = functionBody(production, name);
    assert.ok(body.length > 0, `could not locate ${name} in the shader`);
    assert.doesNotMatch(body, new RegExp(`\\b${name}\\s*\\(`), `${name} must not call itself`);
  }
  // The encounter loop is bounded by a compile-time constant.
  assert.match(functionBody(production, 'traceLinear'), /for \(int encounter = 0; encounter <= MAX_REDIRECTS; encounter\+\+\)/);
});

/** Body of the first GLSL function definition named `name`, braces excluded. */
function functionBody(source: string, name: string): string {
  const header = new RegExp(`\\b\\w+\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!header) return '';
  let depth = 1;
  let i = header.index + header[0].length;
  const start = i;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
  }
  return source.slice(start, i - 1);
}

test('the recursion check can actually fail', () => {
  // A check that cannot fail proves nothing. Feed it a recursive function.
  const recursive = 'vec3 traceLinear(vec3 o, vec3 d) {\n  return traceLinear(o, d);\n}\n';
  assert.match(functionBody(recursive, 'traceLinear'), /\btraceLinear\s*\(/);
});
