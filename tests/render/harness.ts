import type { CameraBasis, RenderFrame, Scene, Vec3, ViewMode } from '../../src/contracts';
import { createRenderer, type RendererInternals } from '../../src/render/index';

/**
 * Minimal in-browser test harness for the renderer.
 *
 * Deliberately dependency-free: these checks must run against a real WebGL2
 * context, which a Node test framework cannot provide.
 */

export type TestCase = { name: string; run: () => void | Promise<void> };
export type TestOutcome = {
  name: string;
  status: 'pass' | 'fail';
  detail?: string;
};

const cases: TestCase[] = [];

export function test(name: string, run: () => void | Promise<void>): void {
  cases.push({ name, run });
}

export async function runAll(): Promise<TestOutcome[]> {
  const outcomes: TestOutcome[] = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      outcomes.push({ name: testCase.name, status: 'pass' });
    } catch (error) {
      const err = error as Error;
      outcomes.push({
        name: testCase.name,
        status: 'fail',
        detail: `${err?.message ?? String(error)}`,
      });
    }
  }
  return outcomes;
}

// --- assertions -----------------------------------------------------------

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertClose(
  actual: number,
  expected: number,
  tolerance: number,
  message: string,
): void {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${message}: expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

export function assertPixel(
  actual: Uint8Array | Uint8ClampedArray,
  expected: [number, number, number],
  tolerance: number,
  message: string,
): void {
  const [r, g, b] = [actual[0], actual[1], actual[2]];
  const ok =
    Math.abs(r - expected[0]) <= tolerance &&
    Math.abs(g - expected[1]) <= tolerance &&
    Math.abs(b - expected[2]) <= tolerance;
  if (!ok) {
    throw new Error(
      `${message}: expected rgb(${expected.join(', ')}) ± ${tolerance}, got rgb(${r}, ${g}, ${b})`,
    );
  }
}

export function assertThrows(fn: () => unknown, match: RegExp, message: string): void {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    const text = (error as Error)?.message ?? String(error);
    if (!match.test(text)) {
      throw new Error(`${message}: threw, but message did not match ${match}. Got: ${text}`);
    }
  }
  if (!threw) throw new Error(`${message}: expected a throw, but the call returned normally`);
}

// --- rendering helpers ----------------------------------------------------

export type Harness = {
  canvas: HTMLCanvasElement;
  renderer: RendererInternals;
  lost: number;
  restored: number;
};

export function makeHarness(debug = false): Harness {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  document.body.appendChild(canvas);

  const state = { lost: 0, restored: 0 };
  const renderer = createRenderer(
    canvas,
    {
      onContextLost() {
        state.lost += 1;
      },
      onContextRestored() {
        state.restored += 1;
      },
    },
    { debug, preserveDrawingBuffer: true },
  );

  return {
    canvas,
    renderer,
    get lost() {
      return state.lost;
    },
    get restored() {
      return state.restored;
    },
  } as Harness;
}

export function drawAndRead(harness: Harness, frame: RenderFrame): Uint8Array {
  harness.renderer.draw(frame);
  const { width, height } = frame;
  const pixels = new Uint8Array(width * height * 4);
  harness.renderer.gl.readPixels(
    0,
    0,
    width,
    height,
    harness.renderer.gl.RGBA,
    harness.renderer.gl.UNSIGNED_BYTE,
    pixels,
  );
  return pixels;
}

/**
 * Read one pixel addressed from the TOP LEFT, matching the contract's pixel
 * convention. readPixels is bottom-left, so the row is flipped here once.
 */
export function pixelAt(
  pixels: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8Array {
  const flippedY = height - 1 - y;
  const offset = (flippedY * width + x) * 4;
  return pixels.subarray(offset, offset + 4);
}

/**
 * Trace exactly one ray.
 *
 * A 1x1 drawing buffer makes the single pixel's screen coordinates exactly
 * (sx, sy) = (0, 0), so the traced direction is exactly `direction` and the
 * right/up basis vectors cannot influence the result. This turns every
 * point-wise expectation into something derivable by hand.
 */
export function traceOneRay(
  harness: Harness,
  scene: Scene,
  origin: Vec3,
  direction: Vec3,
  viewMode: ViewMode = 'beauty',
  maxRedirects = 4,
): Uint8Array {
  const camera = basisFromForward(origin, direction);
  const frame: RenderFrame = {
    sceneVersion: 1,
    scene,
    camera,
    width: 1,
    height: 1,
    options: { maxRedirects, viewMode },
  };
  return drawAndRead(harness, frame).subarray(0, 4);
}

/** Any orthonormal basis around `forward`; irrelevant at a 1x1 buffer. */
export function basisFromForward(origin: Vec3, forward: Vec3): CameraBasis {
  const f = normalise(forward);
  const reference: Vec3 = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const right = normalise(cross(reference, f));
  const up = cross(f, right);
  return { origin, forward: f, right, up, tanHalfFov: 1 };
}

// --- colour maths, written independently of the shader --------------------

export function reinhard(c: number): number {
  return c / (1 + c);
}

export function linearToSrgb(c: number): number {
  const clamped = Math.min(1, Math.max(0, c));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

export function toByte(c: number): number {
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

/** Beauty pipeline: tone map once, encode once. */
export function expectBeauty(linear: Vec3): [number, number, number] {
  return [
    toByte(linearToSrgb(reinhard(linear[0]))),
    toByte(linearToSrgb(reinhard(linear[1]))),
    toByte(linearToSrgb(reinhard(linear[2]))),
  ];
}

/** Albedo diagnostic: sRGB encode only, no tone mapping. */
export function expectAlbedo(linear: Vec3): [number, number, number] {
  return [
    toByte(linearToSrgb(linear[0])),
    toByte(linearToSrgb(linear[1])),
    toByte(linearToSrgb(linear[2])),
  ];
}

// --- vectors --------------------------------------------------------------

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}
