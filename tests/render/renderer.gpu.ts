import type { Scene, Vec3 } from '../../src/contracts.ts';
import {
  buildTraceFragmentSource,
  createRenderer,
  RENDERER_LIMITS,
  ShaderCompileError,
} from '../../src/render/index.ts';
import { compileShader } from '../../src/render/gl.ts';
import { EPS } from '../../src/render/constants.ts';
import { packScene, viewModeCode, clampRedirects } from '../../src/render/uniforms.ts';
import {
  axisCamera,
  doubleMirrorScene,
  emptyScene,
  frame,
  lookAt,
  mirrorScene,
  shadowScene,
  singleSphereScene,
  tieScene,
} from './fixtures.ts';
import {
  assert,
  assertClose,
  assertPixel,
  assertThrows,
  drawAndRead,
  expectAlbedo,
  expectBeauty,
  makeHarness,
  pixelAt,
  runAll,
  test,
  toByte,
  traceOneRay,
  type Harness,
  type TestOutcome,
} from './harness.ts';

/**
 * Renderer checks owned by AI 1.
 *
 * Every expectation below is derived by hand from the contract, not captured
 * from this implementation's output. Where a value depends on the display
 * pipeline, the harness recomputes that pipeline independently.
 */

let shared: Harness;

function harness(): Harness {
  if (!shared) shared = makeHarness(true);
  return shared;
}

// ---------------------------------------------------------------------------
// 1. Compilation and failure reporting
// ---------------------------------------------------------------------------

test('WebGL2 context, shader compile and program link succeed', () => {
  const h = harness();
  assert(Boolean(h.renderer.gl), 'expected a WebGL2 context');
  assert(!h.renderer.gl.isContextLost(), 'context was lost immediately after creation');
});

test('shader compile failure reports the driver log and the offending lines', () => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  assert(Boolean(gl), 'no WebGL2 for the negative compile test');

  // Corrupt the real generated shader so the failure path runs against the
  // same source the renderer ships, then check the error the renderer's own
  // helper produces: driver log plus the quoted offending line.
  const broken = buildTraceFragmentSource().replace('void main() {', 'void main( {');
  let error: unknown = null;
  try {
    compileShader(gl!, 'fragment', broken);
  } catch (caught) {
    error = caught;
  }

  assert(error instanceof ShaderCompileError, 'expected a ShaderCompileError');
  const compileError = error as ShaderCompileError;
  assert(compileError.stage === 'fragment', 'the error must name the failing stage');
  assert(compileError.infoLog.trim().length > 0, 'the driver info log must be captured');
  assert(
    compileError.annotatedSource.includes('void main( {'),
    'the annotated source must quote the offending line, not just a line number',
  );
  assert(
    /\bmain\b/.test(compileError.message),
    `the message must be actionable, got: ${compileError.message.slice(0, 200)}`,
  );

  // A correct shader must still compile through the same helper.
  const good = compileShader(gl!, 'fragment', buildTraceFragmentSource());
  assert(Boolean(good), 'the unmodified shader must compile');
});

test('production renderer refuses diagnostic output', () => {
  const canvas = document.createElement('canvas');
  const renderer = createRenderer(canvas, { onContextLost() {}, onContextRestored() {} });
  assertThrows(
    () => renderer.setDebugMode(1),
    /debug: true/,
    'production renderer must not expose diagnostics',
  );
  renderer.dispose();
});

// ---------------------------------------------------------------------------
// 2. Empty scene and the sky gradient
// ---------------------------------------------------------------------------

test('empty scene renders the sky gradient, not black', () => {
  const h = harness();
  const scene = emptyScene();

  // Straight up: t = clamp(0.5*(1+1)) = 1 -> exactly skyTop.
  const up = traceOneRay(h, scene, [0, 0, 0], [0, 1, 0]);
  assertPixel(up, expectBeauty(scene.skyTop), 2, 'ray straight up should be skyTop');

  // Straight down: t = 0 -> exactly skyBottom.
  const down = traceOneRay(h, scene, [0, 0, 0], [0, -1, 0]);
  assertPixel(down, expectBeauty(scene.skyBottom), 2, 'ray straight down should be skyBottom');

  // Horizontal: t = 0.5 -> the midpoint of the two colours.
  const flat = traceOneRay(h, scene, [0, 0, 0], [0, 0, 1]);
  const mid: Vec3 = [
    (scene.skyBottom[0] + scene.skyTop[0]) / 2,
    (scene.skyBottom[1] + scene.skyTop[1]) / 2,
    (scene.skyBottom[2] + scene.skyTop[2]) / 2,
  ];
  assertPixel(flat, expectBeauty(mid), 2, 'horizontal ray should be the gradient midpoint');
});

// ---------------------------------------------------------------------------
// 3. Sphere intersection cases, read through the hit diagnostic
// ---------------------------------------------------------------------------

test('sphere outside / tangent / miss / inside cases', () => {
  const h = harness();
  const scene = singleSphereScene();
  const WHITE: [number, number, number] = [255, 255, 255];
  const BLACK: [number, number, number] = [0, 0, 0];

  // Outside, aimed at the centre: t = 2 at (0,0,-1).
  assertPixel(
    traceOneRay(h, scene, [0, 0, -3], [0, 0, 1], 'hit'),
    WHITE,
    0,
    'ray from (0,0,-3) along +Z must hit the unit sphere',
  );

  // Tangent: origin (1,0,-3) along +Z grazes the sphere at exactly x = 1.
  // The Metal source rejects this (discriminant > 0); contract v1 accepts it.
  assertPixel(
    traceOneRay(h, scene, [1, 0, -3], [0, 0, 1], 'hit'),
    WHITE,
    0,
    'tangent ray must register a hit under contract v1 (discriminant >= 0)',
  );

  // Clear miss.
  assertPixel(
    traceOneRay(h, scene, [2, 0, -3], [0, 0, 1], 'hit'),
    BLACK,
    0,
    'ray passing 2 units off-axis must miss',
  );

  // Origin inside the sphere: the near root is negative, so the far root at
  // t = 1 must be selected instead of reporting a miss.
  assertPixel(
    traceOneRay(h, scene, [0, 0, 0], [0, 0, 1], 'hit'),
    WHITE,
    0,
    'a ray starting inside the sphere must hit its far wall',
  );
});

test('normals are oriented correctly outside and inside', () => {
  const h = harness();
  const scene = singleSphereScene();
  h.renderer.setDebugMode(1); // face-forward normal, encoded n*0.5+0.5

  // Looking down at the top of the sphere: outward normal is +Y, and since the
  // ray arrives from above, the face-forward normal is also +Y.
  const top = traceOneRay(h, scene, [0, 3, 0], [0, -1, 0]);
  assertClose(top[0], toByte(0.5), 2, 'top-of-sphere normal x');
  assertClose(top[1], toByte(1.0), 2, 'top-of-sphere normal must point up (+Y)');
  assertClose(top[2], toByte(0.5), 2, 'top-of-sphere normal z');

  // From inside, hitting the far wall at (0,0,1): the outward normal is +Z,
  // but the face-forward normal must flip to -Z against the incoming ray.
  const inside = traceOneRay(h, scene, [0, 0, 0], [0, 0, 1]);
  assertClose(inside[2], toByte(0.0), 2, 'inside hit must flip the normal to -Z');

  h.renderer.setDebugMode(0);
});

// ---------------------------------------------------------------------------
// 4. Planes
// ---------------------------------------------------------------------------

test('plane hits, parallel rejection, and behind-the-camera rejection', () => {
  const h = harness();
  const floorOnly: Scene = {
    ...emptyScene(),
    objects: [{ kind: 'plane', id: 'floor', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] }],
    materials: [{ mode: 'matte', albedo: [1, 1, 1] }],
  };
  const WHITE: [number, number, number] = [255, 255, 255];
  const BLACK: [number, number, number] = [0, 0, 0];

  assertPixel(
    traceOneRay(h, floorOnly, [0, 2, 0], [0, -1, 0], 'hit'),
    WHITE,
    0,
    'downward ray must hit the floor plane',
  );

  // Exactly parallel: |dot(D,N)| = 0 < 1e-6, so this is a miss, not a
  // division by zero producing an infinite t.
  assertPixel(
    traceOneRay(h, floorOnly, [0, 2, 0], [0, 0, 1], 'hit'),
    BLACK,
    0,
    'a ray parallel to the plane must miss cleanly',
  );

  // Plane behind the ray: t would be negative and must be rejected.
  assertPixel(
    traceOneRay(h, floorOnly, [0, 2, 0], [0, 1, 0], 'hit'),
    BLACK,
    0,
    'a plane behind the ray origin must not be hit',
  );
});

// ---------------------------------------------------------------------------
// 5. Nearest-hit ordering
// ---------------------------------------------------------------------------

test('nearest hit wins and exact ties resolve to the earlier object', () => {
  const h = harness();

  // Two spheres on the view axis; the near one must occlude the far one.
  const occlusion: Scene = {
    ...emptyScene(),
    objects: [
      { kind: 'sphere', id: 'far', materialIndex: 0, center: [0, 0, 6], radius: 1 },
      { kind: 'sphere', id: 'near', materialIndex: 1, center: [0, 0, 3], radius: 1 },
    ],
    materials: [
      { mode: 'matte', albedo: [1, 0, 0] },
      { mode: 'matte', albedo: [0, 1, 0] },
    ],
  };
  assertPixel(
    traceOneRay(h, occlusion, [0, 0, 0], [0, 0, 1], 'albedo'),
    expectAlbedo([0, 1, 0]),
    2,
    'the nearer sphere must be returned even though it is later in the array',
  );

  // Identical geometry, different materials: the earlier entry must win.
  assertPixel(
    traceOneRay(h, tieScene(), [0, 0, -3], [0, 0, 1], 'albedo'),
    expectAlbedo([1, 0, 0]),
    2,
    'an exact distance tie must resolve to the earlier array object',
  );
});

// ---------------------------------------------------------------------------
// 6. Matte shading and hard shadows
// ---------------------------------------------------------------------------

test('matte shading matches the contract formula', () => {
  const h = harness();

  // A floor plane lit from directly above, no blocker. Hit point is the
  // origin; light at (0,2,0) so N·L = 1 and distance² = 4.
  const scene: Scene = {
    ...emptyScene(),
    objects: [{ kind: 'plane', id: 'floor', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] }],
    materials: [{ mode: 'matte', albedo: [0.5, 0.5, 0.5] }],
    light: { position: [0, 2, 0], color: [1, 1, 1], intensity: 4 },
    ambient: 0.1,
  };

  const albedo = 0.5;
  const distanceSquared = (2 - EPS) * (2 - EPS);
  const expected = 0.1 * albedo + (albedo / Math.PI) * 1 * 4 * 1 / Math.max(distanceSquared, 0.01);

  const pixel = traceOneRay(h, scene, [0, 2, 0], [0, -1, 0]);
  assertPixel(
    pixel,
    expectBeauty([expected, expected, expected]),
    3,
    'matte shading must equal ambient*albedo + (albedo/PI)*color*intensity*NdotL/d^2',
  );
});

test('a blocker before the light casts a shadow; one beyond the light does not', () => {
  const h = harness();

  // Floor at y=0, light at (0,4,0), blocker sphere centred (0,1,0) r=0.5.
  const scene = shadowScene();

  // The viewing ray must reach the FLOOR, so it approaches at 45 degrees and
  // passes beside the blocker rather than through it. A ray straight down the
  // Y axis would hit the blocker sphere itself and measure its colour instead.
  const diagonal: Vec3 = [-Math.SQRT1_2, -Math.SQRT1_2, 0];

  // Shadowed: from (4,4,0) the ray's closest approach to the blocker centre is
  // sqrt(0.5) = 0.707 > 0.5, so it clears the sphere and lands on (0,0,0),
  // which the blocker occludes from the light directly overhead.
  const shadowed = traceOneRay(h, scene, [4, 4, 0], diagonal);
  // ambient is 0 in this fixture, so a shadowed point is exactly black.
  assertPixel(shadowed, [0, 0, 0], 2, 'a point under the blocker must be in shadow');

  // Lit: the same diagonal from (6,4,0) lands on (2,0,0), which has clear
  // line of sight to the light.
  const lit = traceOneRay(h, scene, [6, 4, 0], diagonal);
  assert(lit[0] > 10, `a point beside the blocker must be lit, got ${lit[0]}`);

  // Blocker beyond the light must NOT shadow. Lowering the light to (0,0.2,0)
  // puts it below the sphere, which spans y 0.5..1.5, so the blocker now lies
  // past the light and the shadow ray's tMax must exclude it.
  const beyond: Scene = {
    ...scene,
    light: { position: [0, 0.2, 0], color: [1, 1, 1], intensity: 0.05 },
  };
  const notShadowed = traceOneRay(h, beyond, [4, 4, 0], diagonal);
  assert(
    notShadowed[0] > 10,
    `a blocker beyond the light must not cast a shadow, got ${notShadowed[0]}`,
  );
});

test('surfaces facing away from the light receive ambient only', () => {
  const h = harness();
  const scene: Scene = {
    ...emptyScene(),
    objects: [{ kind: 'plane', id: 'floor', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] }],
    materials: [{ mode: 'matte', albedo: [1, 1, 1] }],
    // Light below the plane: N·L <= 0 for the upward-facing side.
    light: { position: [0, -5, 0], color: [1, 1, 1], intensity: 10 },
    ambient: 0.2,
  };
  const pixel = traceOneRay(h, scene, [0, 3, 0], [0, -1, 0]);
  assertPixel(
    pixel,
    expectBeauty([0.2, 0.2, 0.2]),
    3,
    'a back-facing surface must show ambient only, with no negative light term',
  );
});

// ---------------------------------------------------------------------------
// 7. Mirrors: real secondary intersections, not an environment trick
// ---------------------------------------------------------------------------

test('a mirror shows geometry found by the reflected ray', () => {
  const h = harness();
  const scene = mirrorScene();

  // Centre ray: camera (0,0,-5) -> +Z -> mirror plane at z=0 -> reflects to -Z
  // -> must find the red sphere centred (0,0,-9). Sky is black in this
  // fixture, so any red at all can only come from a real second intersection.
  const pixel = traceOneRay(h, scene, [0, 0, -5], [0, 0, 1]);
  assert(
    pixel[0] > 30,
    `the mirror must show the red sphere via a reflected ray, got rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`,
  );
  assert(
    pixel[0] > pixel[2] + 20,
    `the reflected colour must be dominated by the red target, got rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`,
  );
});

test('moving the reflected object changes the mirror image', () => {
  const h = harness();
  const before = traceOneRay(h, mirrorScene(), [0, 0, -5], [0, 0, 1]);

  // Slide the target far off-axis. The same reflected ray must now miss it.
  const moved = mirrorScene();
  const target = moved.objects[1];
  assert(target.kind === 'sphere', 'fixture changed shape');
  (target as { center: Vec3 }).center = [6, 0, -9];

  const after = traceOneRay(h, moved, [0, 0, -5], [0, 0, 1]);
  assert(
    Math.abs(before[0] - after[0]) > 20,
    `moving the target must change the mirror pixel: before ${before[0]}, after ${after[0]}`,
  );
  assert(after[0] < 20, `with the target moved aside the mirror should show black sky, got ${after[0]}`);
});

test('a mirror does not self-intersect at its own surface', () => {
  const h = harness();
  // A single mirror plane with nothing to reflect. If the EPS offset were
  // wrong the reflected ray would immediately re-hit the plane and, being a
  // mirror, would burn the whole redirect budget and return black.
  const scene: Scene = {
    ...emptyScene(),
    objects: [{ kind: 'plane', id: 'mirror', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] }],
    materials: [{ mode: 'mirror', albedo: [1, 1, 1] }],
    skyBottom: [0.25, 0, 0],
    skyTop: [0, 0, 0.75],
  };
  // Looking down at 45 degrees; reflects upward and must reach the sky.
  const pixel = traceOneRay(h, scene, [0, 1, -1], [0, -0.7071067811865476, 0.7071067811865476]);
  assert(
    pixel[0] + pixel[1] + pixel[2] > 30,
    `a mirror with a clear view of the sky must not return black (self-intersection), got rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`,
  );
});

test('redirect budget terminates mirrors and still shades matte surfaces', () => {
  const h = harness();

  // Budget 0 against a mirror: a reflective surface needing a redirect must
  // return black and a budget termination, never a fabricated sky sample.
  const zeroBudget = traceOneRay(h, mirrorScene(), [0, 0, -5], [0, 0, 1], 'beauty', 0);
  assertPixel(zeroBudget, [0, 0, 0], 1, 'a mirror with zero redirect budget must be black');

  // Budget 0 against a matte surface: still shaded normally.
  const matte: Scene = {
    ...emptyScene(),
    objects: [{ kind: 'plane', id: 'floor', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] }],
    materials: [{ mode: 'matte', albedo: [1, 1, 1] }],
    light: { position: [0, 2, 0], color: [1, 1, 1], intensity: 4 },
    ambient: 0.2,
  };
  const matteAtZero = traceOneRay(h, matte, [0, 2, 0], [0, -1, 0], 'beauty', 0);
  assert(
    matteAtZero[0] > 30,
    `a matte surface must still be shaded at zero budget, got ${matteAtZero[0]}`,
  );

  // Facing mirrors: the budget must terminate the loop, not hang or wrap.
  const infinite = traceOneRay(h, doubleMirrorScene(), [0, 0, 0], [0, 0, 1], 'beauty', 4);
  assertPixel(infinite, [0, 0, 0], 1, 'facing mirrors must terminate on the budget and return black');
});

test('higher redirect budgets reveal deeper reflections', () => {
  const h = harness();
  // A two-mirror periscope, derived by hand:
  //   camera (0,0,0) looking +Z
  //   -> mirror A through (0,0,4), normal (0,1,-1)/sqrt2, reflects +Z into +Y
  //   -> mirror B through (0,4,4), normal (0,-1,-1)/sqrt2, reflects +Y into -Z
  //   -> red matte sphere centred (0,4,0), r=1, hit at (0,4,1) facing +Z
  // The target is reachable ONLY after exactly two redirects.
  // The sky is green, so a budget path that wrongly returned sky could not
  // masquerade as the required black.
  const s = Math.SQRT1_2;
  const scene: Scene = {
    objects: [
      { kind: 'plane', id: 'mirrorA', materialIndex: 0, point: [0, 0, 4], normal: [0, s, -s] },
      { kind: 'plane', id: 'mirrorB', materialIndex: 0, point: [0, 4, 4], normal: [0, -s, -s] },
      { kind: 'sphere', id: 'target', materialIndex: 1, center: [0, 4, 0], radius: 1 },
    ],
    materials: [
      { mode: 'mirror', albedo: [1, 1, 1] },
      { mode: 'matte', albedo: [1, 0, 0] },
    ],
    camera: { position: [0, 0, 0], target: [0, 0, 1], fovYDeg: 60 },
    // Head-on light 2 units in front of the hit point: N.L = 1, nothing between.
    light: { position: [0, 4, 3], color: [1, 1, 1], intensity: 4 },
    ambient: 0.1,
    skyBottom: [0, 0.5, 0],
    skyTop: [0, 0.5, 0],
  };

  const at = (budget: number) => traceOneRay(h, scene, [0, 0, 0], [0, 0, 1], 'beauty', budget);

  // Shadow origin is P + EPS*N, so the light distance is 2 - EPS.
  const d = 2 - EPS;
  const red = 0.1 * 1 + (1 / Math.PI) * 1 * 4 * 1 / Math.max(d * d, 0.01);
  const expected = expectBeauty([red, 0, 0]);

  assertPixel(at(0), [0, 0, 0], 1, 'budget 0: mirror A needs a redirect, so the pixel must be black');
  assertPixel(at(1), [0, 0, 0], 1, 'budget 1: mirror B needs a second redirect, so the pixel must be black');
  assertPixel(at(2), expected, 3, 'budget 2: the target is reached after exactly two redirects');
  assertPixel(at(4), expected, 3, 'budget 4: a larger budget must not change a path that ends at budget 2');

  // The budget must be clamped into range rather than throwing or wrapping.
  assert(clampRedirects(99) === 4, 'maxRedirects must clamp to 4');
  assert(clampRedirects(-3) === 0, 'maxRedirects must clamp to 0');
});

// ---------------------------------------------------------------------------
// 8. Diagnostic view modes
// ---------------------------------------------------------------------------

test('hit mode is exact white or black and bypasses conversion', () => {
  const h = harness();
  const scene = singleSphereScene();
  const hit = traceOneRay(h, scene, [0, 0, -3], [0, 0, 1], 'hit');
  const miss = traceOneRay(h, scene, [5, 0, -3], [0, 0, 1], 'hit');
  assertPixel(hit, [255, 255, 255], 0, 'hit mode must produce exact white, with no tone mapping');
  assertPixel(miss, [0, 0, 0], 0, 'hit mode must produce exact black on a miss');
});

test('albedo mode returns the material colour without tone mapping', () => {
  const h = harness();
  const scene: Scene = {
    ...singleSphereScene(),
    materials: [{ mode: 'matte', albedo: [0.5, 0.25, 0.75] }],
  };
  const pixel = traceOneRay(h, scene, [0, 0, -3], [0, 0, 1], 'albedo');
  assertPixel(
    pixel,
    expectAlbedo([0.5, 0.25, 0.75]),
    2,
    'albedo mode must be sRGB-encoded only; a Reinhard curve here would darken it',
  );

  // The same colour through the beauty path must be visibly darker, proving
  // the two pipelines are genuinely different and not accidentally identical.
  const beautyExpected = expectBeauty([0.5, 0.25, 0.75]);
  const albedoExpected = expectAlbedo([0.5, 0.25, 0.75]);
  assert(
    albedoExpected[0] > beautyExpected[0] + 10,
    'tone mapping must measurably change the beauty result relative to albedo',
  );
});

test('diagnostic modes inspect the FIRST hit, ignoring reflections', () => {
  const h = harness();
  const scene = mirrorScene();
  // Beauty shows the reflected red sphere; albedo must show the mirror's own
  // white material, because diagnostics never follow a redirect.
  const pixel = traceOneRay(h, scene, [0, 0, -5], [0, 0, 1], 'albedo');
  assertPixel(
    pixel,
    expectAlbedo([1, 1, 1]),
    2,
    'albedo mode must report the first surface, not the reflected one',
  );
});

// ---------------------------------------------------------------------------
// 9. Viewport, aspect ratio and orientation
// ---------------------------------------------------------------------------

test('image is upright: pixel y increases downward', () => {
  const h = harness();
  // Sky only, with a strong vertical gradient. The top row of the image must
  // be skyTop. If gl_FragCoord's bottom-left origin were mishandled the image
  // would be flipped.
  const scene = emptyScene();
  const width = 4;
  const height = 4;
  const pixels = drawAndRead(h, frame(scene, axisCamera([0, 0, 0], 1), width, height));

  const topRow = pixelAt(pixels, 2, 0, width, height);
  const bottomRow = pixelAt(pixels, 2, height - 1, width, height);

  assert(
    topRow[2] > bottomRow[2],
    `the top of the image must be bluer (skyTop): top b=${topRow[2]}, bottom b=${bottomRow[2]}`,
  );
  assert(
    bottomRow[0] > topRow[0],
    `the bottom of the image must be redder (skyBottom): top r=${topRow[0]}, bottom r=${bottomRow[0]}`,
  );
});

test('aspect ratio widens the horizontal field, not the vertical', () => {
  const h = harness();
  // With tanHalfFov = 1, screen x maps to world x = z * sx. A 1:1 frame has
  // sx in (-1,1), so at z = 2 it sees |x| < 2. A 2:1 frame has sx in (-2,2),
  // seeing |x| < 4. A sphere at x = 3 therefore falls in the gap: invisible
  // when square, visible when wide. Vertical extent is unchanged by aspect.
  const scene: Scene = {
    ...emptyScene(),
    objects: [{ kind: 'sphere', id: 'side', materialIndex: 0, center: [3, 0, 2], radius: 0.25 }],
    materials: [{ mode: 'matte', albedo: [1, 1, 1] }],
  };
  const camera = axisCamera([0, 0, 0], 1);

  const square = drawAndRead(h, frame(scene, camera, 64, 64, 'hit'));
  const wide = drawAndRead(h, frame(scene, camera, 128, 64, 'hit'));

  const anyLit = (pixels: Uint8Array) => {
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 128) return true;
    return false;
  };

  assert(!anyLit(square), 'the off-axis sphere must be outside a 1:1 frame');
  assert(anyLit(wide), 'the off-axis sphere must become visible in a 2:1 frame');
});

test('changing the drawing buffer size re-renders at the new size', () => {
  const h = harness();
  const scene = singleSphereScene();
  const camera = lookAt([0, 0, -3], [0, 0, 0], 60);

  // Read the canvas size through a widened accessor: TypeScript otherwise
  // narrows canvas.width to the literal just assigned and flags the second
  // comparison as impossible, which would hide a real regression.
  const size = () => [h.canvas.width as number, h.canvas.height as number] as const;

  const small = drawAndRead(h, frame(scene, camera, 16, 16, 'hit'));
  assert(small.length === 16 * 16 * 4, 'small buffer size mismatch');
  assert(size()[0] === 16 && size()[1] === 16, `canvas was not resized to 16x16, got ${size().join('x')}`);

  const large = drawAndRead(h, frame(scene, camera, 48, 32, 'hit'));
  assert(large.length === 48 * 32 * 4, 'large buffer size mismatch');
  assert(size()[0] === 48 && size()[1] === 32, `canvas was not resized to 48x32, got ${size().join('x')}`);

  // The sphere must still be centred after the resize, not stretched off-centre.
  const centre = pixelAt(large, 24, 16, 48, 32);
  assert(centre[0] > 128, 'the sphere must remain centred after a resize');
});

// ---------------------------------------------------------------------------
// 10. Uniform packing and validation (pure, no GPU needed)
// ---------------------------------------------------------------------------

test('scene packing validates indices, kinds and counts', () => {
  const base = singleSphereScene();

  assertThrows(
    () => packScene({ ...base, objects: [{ ...base.objects[0], materialIndex: 5 } as never] }),
    /materialIndex/,
    'an out-of-range material index must be rejected',
  );

  assertThrows(
    () => packScene({ ...base, materials: [{ mode: 'glass' as never, albedo: [1, 1, 1] }] }),
    /contract v1/,
    'glass must be rejected while the contract is at v1',
  );

  assertThrows(
    () =>
      packScene({
        ...base,
        objects: Array.from({ length: 9 }, (_, i) => ({ ...base.objects[0], id: `s${i}` })),
      }),
    /MAX_OBJECTS/,
    'more than eight objects must be rejected',
  );

  assertThrows(
    () => packScene({ ...base, objects: [{ ...base.objects[0], center: [0, Number.NaN, 0] } as never] }),
    /finite/,
    'a non-finite coordinate must be rejected before upload',
  );

  // Plane normals are normalised defensively: an unnormalised normal would
  // silently scale every computed t.
  const packed = packScene({
    ...base,
    objects: [{ kind: 'plane', id: 'p', materialIndex: 0, point: [0, 0, 0], normal: [0, 3, 0] }],
    materials: [{ mode: 'matte', albedo: [1, 1, 1] }],
  });
  assertClose(packed.objectB[1], 1, 1e-6, 'plane normal must be normalised during packing');

  assert(viewModeCode('beauty') === 0, 'beauty view code');
  assert(viewModeCode('hit') === 1, 'hit view code');
  assert(viewModeCode('albedo') === 2, 'albedo view code');
  assert(RENDERER_LIMITS.maxObjects === 8, 'MAX_OBJECTS must be 8 under contract v1');
});

// ---------------------------------------------------------------------------
// 11. Lifecycle: context loss, restore, dispose
// ---------------------------------------------------------------------------

test('context loss and restoration drive the hooks and rebuild resources', async () => {
  const local = makeHarness();
  const extension = local.renderer.gl.getExtension('WEBGL_lose_context');
  if (!extension) {
    throw new Error('WEBGL_lose_context is unavailable; cannot verify context recovery');
  }

  extension.loseContext();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert(local.lost === 1, `onContextLost must fire exactly once, got ${local.lost}`);

  // Drawing during a lost context must be a no-op, not a thrown error.
  local.renderer.draw(frame(singleSphereScene(), axisCamera(), 4, 4));

  extension.restoreContext();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(local.restored === 1, `onContextRestored must fire exactly once, got ${local.restored}`);

  // After restoration the renderer must draw again without re-creation.
  local.renderer.draw(frame(singleSphereScene(), axisCamera(), 4, 4));
  local.renderer.dispose();
});

test('dispose releases resources and rejects further draws', () => {
  const local = makeHarness();
  local.renderer.draw(frame(emptyScene(), axisCamera(), 4, 4));
  local.renderer.dispose();
  local.renderer.dispose(); // must be idempotent
  assertThrows(
    () => local.renderer.draw(frame(emptyScene(), axisCamera(), 4, 4)),
    /after dispose/,
    'drawing after dispose must throw a clear error',
  );
});

// ---------------------------------------------------------------------------
// 12. Pixel samples for CPU/GPU comparison (AI 3 integration)
// ---------------------------------------------------------------------------

test('publishes stable off-silhouette pixel samples for CPU comparison', () => {
  const h = harness();
  const scene = mirrorScene();
  const camera = lookAt([0, 0, -5], [0, 0, 0], 60);
  const width = 64;
  const height = 36;
  const pixels = drawAndRead(h, frame(scene, camera, width, height));

  // Deliberately away from silhouettes, where a half-pixel disagreement
  // between implementations is expected and proves nothing.
  const samples = [
    [16, 9],
    [32, 18],
    [48, 27],
    [8, 30],
    [56, 6],
  ] as const;

  const report: Record<string, number[]> = {};
  for (const [x, y] of samples) {
    const p = pixelAt(pixels, x, y, width, height);
    report[`${x},${y}`] = [p[0], p[1], p[2]];
  }
  (globalThis as Record<string, unknown>).__AI1_PIXEL_SAMPLES__ = report;
  assert(Object.keys(report).length === samples.length, 'expected five published samples');
});

// ---------------------------------------------------------------------------

export async function main(): Promise<TestOutcome[]> {
  return runAll();
}
