import type { RenderFrame, Scene } from '../../src/contracts';
import { createRenderer } from '../../src/render/index';
import { lookAt } from './fixtures';

/**
 * Production-path smoke check.
 *
 * Every other renderer check runs with `{ debug: true, preserveDrawingBuffer:
 * true }` and reads pixels back with readPixels. That is NOT how the app will
 * use this module. main.ts calls `createRenderer(canvas, hooks)` with exactly two
 * arguments, which means:
 *
 *   - the production shader variant (no DEBUG_VARIANT, no uDebugMode),
 *   - preserveDrawingBuffer: false, so the drawing buffer is cleared after
 *     compositing and readPixels is no longer a valid way to verify anything.
 *
 * So this check draws into a canvas that is laid out in the page and lets the
 * harness screenshot the COMPOSITED result. If render-on-demand did not
 * actually put visible pixels on screen, no amount of readPixels testing would
 * have revealed it.
 *
 * It also exercises the realistic call pattern: a dirty flag plus
 * requestAnimationFrame, repeated draws, and a resize, rather than one draw
 * into a detached canvas.
 */

declare global {
  interface Window {
    __AI1_SMOKE__?: {
      stage: string;
      drawCount: number;
      errors: string[];
      contextLost: number;
      contextRestored: number;
      ready: boolean;
    };
  }
}

function demoScene(): Scene {
  return {
    objects: [
      { kind: 'plane', id: 'floor', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] },
      { kind: 'plane', id: 'back', materialIndex: 1, point: [0, 0, 6], normal: [0, 0, -1] },
      { kind: 'plane', id: 'left', materialIndex: 2, point: [-4, 0, 0], normal: [1, 0, 0] },
      { kind: 'plane', id: 'right', materialIndex: 3, point: [4, 0, 0], normal: [-1, 0, 0] },
      { kind: 'sphere', id: 'mirror', materialIndex: 4, center: [-1.3, 1.3, 3.2], radius: 1.3 },
      { kind: 'sphere', id: 'target', materialIndex: 5, center: [1.7, 0.9, 1.9], radius: 0.9 },
    ],
    materials: [
      { mode: 'matte', albedo: [0.72, 0.70, 0.66] },
      { mode: 'matte', albedo: [0.58, 0.60, 0.64] },
      { mode: 'matte', albedo: [0.62, 0.24, 0.22] },
      { mode: 'matte', albedo: [0.24, 0.46, 0.34] },
      { mode: 'mirror', albedo: [1, 1, 1] },
      { mode: 'matte', albedo: [0.90, 0.62, 0.15] },
    ],
    camera: { position: [0, 2.2, -4.5], target: [0, 1.4, 2.5], fovYDeg: 55 },
    light: { position: [-1.2, 6.0, -0.5], color: [1, 0.97, 0.92], intensity: 42 },
    ambient: 0.06,
    skyBottom: [0.02, 0.02, 0.03],
    skyTop: [0.05, 0.07, 0.12],
  };
}

const state = {
  stage: 'starting',
  drawCount: 0,
  errors: [] as string[],
  contextLost: 0,
  contextRestored: 0,
  ready: false,
};
window.__AI1_SMOKE__ = state;

function run(): void {
  // Lay the canvas out the way the interface's host does: a sized element in the page,
  // with the drawing buffer smaller than the CSS box.
  const host = document.createElement('div');
  host.style.cssText = 'width:640px;height:360px;margin:0;padding:0;border:0;';
  document.body.style.cssText = 'margin:0;background:#ffffff;';
  document.body.appendChild(host);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
  host.appendChild(canvas);

  // EXACTLY the contract signature. No options object, no debug variant,
  // no preserveDrawingBuffer.
  const renderer = createRenderer(canvas, {
    onContextLost() {
      state.contextLost += 1;
    },
    onContextRestored() {
      state.contextRestored += 1;
    },
  });

  const scene = demoScene();
  let width = 640;
  let height = 360;
  let dirty = true;

  const frame = (): RenderFrame => ({
    sceneVersion: state.drawCount,
    scene,
    camera: lookAt(scene.camera.position, scene.camera.target, scene.camera.fovYDeg),
    width,
    height,
    options: { maxRedirects: 4, viewMode: 'beauty' },
  });

  // Render-on-demand, the pattern main.ts uses: draw only when dirty.
  const tick = () => {
    if (dirty) {
      try {
        renderer.draw(frame());
        state.drawCount += 1;
      } catch (error) {
        state.errors.push(`draw: ${(error as Error)?.message ?? String(error)}`);
      }
      dirty = false;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Stage 1: first paint.
  setTimeout(() => {
    state.stage = 'first-paint';

    // Stage 2: a scene edit must repaint. Move the target sphere.
    setTimeout(() => {
      const target = scene.objects[5];
      if (target.kind === 'sphere') target.center = [2.4, 0.9, 3.4];
      dirty = true;
      state.stage = 'edited';

      // Stage 3: a resize must repaint at the new buffer size, undistorted.
      setTimeout(() => {
        width = 480;
        height = 360;
        dirty = true;
        state.stage = 'resized';

        setTimeout(() => {
          state.stage = 'done';
          state.ready = true;
        }, 300);
      }, 300);
    }, 300);
  }, 300);
}

try {
  run();
} catch (error) {
  state.errors.push(`setup: ${(error as Error)?.stack ?? String(error)}`);
  state.ready = true;
}
