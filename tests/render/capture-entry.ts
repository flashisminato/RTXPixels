import type { RenderFrame, Scene, Vec3 } from '../../src/contracts.ts';
import { createRenderer } from '../../src/render/index.ts';
import { lookAt } from './fixtures.ts';

/**
 * Render a handful of frames and publish them as PNG data URLs.
 *
 * The scene here is a renderer evidence fixture, not the product preset: it
 * exists to make reflection, shadow and diagnostic behaviour visible to a
 * human reviewer. AI 3 authors the real scene, colours and control limits.
 */

declare global {
  interface Window {
    __AI1_CAPTURES__?: Array<{ name: string; dataUrl: string }>;
  }
}

function demoScene(): Scene {
  return {
    objects: [
      // Room: floor, back wall, and two coloured side walls.
      { kind: 'plane', id: 'floor', materialIndex: 0, point: [0, 0, 0], normal: [0, 1, 0] },
      { kind: 'plane', id: 'back', materialIndex: 1, point: [0, 0, 6], normal: [0, 0, -1] },
      { kind: 'plane', id: 'left', materialIndex: 2, point: [-4, 0, 0], normal: [1, 0, 0] },
      { kind: 'plane', id: 'right', materialIndex: 3, point: [4, 0, 0], normal: [-1, 0, 0] },
      { kind: 'plane', id: 'ceiling', materialIndex: 0, point: [0, 7, 0], normal: [0, -1, 0] },
      // Mirror sphere and a matte target whose reflection should be visible.
      { kind: 'sphere', id: 'mirror', materialIndex: 4, center: [-1.3, 1.3, 3.2], radius: 1.3 },
      { kind: 'sphere', id: 'target', materialIndex: 5, center: [1.7, 0.9, 1.9], radius: 0.9 },
    ],
    materials: [
      { mode: 'matte', albedo: [0.72, 0.70, 0.66] },  // floor / ceiling
      { mode: 'matte', albedo: [0.58, 0.60, 0.64] },  // back wall
      { mode: 'matte', albedo: [0.62, 0.24, 0.22] },  // left wall
      { mode: 'matte', albedo: [0.24, 0.46, 0.34] },  // right wall
      { mode: 'mirror', albedo: [1, 1, 1] },
      { mode: 'matte', albedo: [0.90, 0.62, 0.15] },  // target
    ],
    camera: { position: [0, 2.2, -4.5], target: [0, 1.4, 2.5], fovYDeg: 55 },
    light: { position: [-1.2, 6.0, -0.5], color: [1, 0.97, 0.92], intensity: 42 },
    ambient: 0.06,
    skyBottom: [0.02, 0.02, 0.03],
    skyTop: [0.05, 0.07, 0.12],
  };
}

function toFrame(scene: Scene, width: number, height: number, overrides: Partial<RenderFrame['options']> = {}): RenderFrame {
  return {
    sceneVersion: 1,
    scene,
    camera: lookAt(scene.camera.position, scene.camera.target, scene.camera.fovYDeg),
    width,
    height,
    options: { maxRedirects: 4, viewMode: 'beauty', ...overrides },
  };
}

function run(): void {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = createRenderer(
    canvas,
    { onContextLost() {}, onContextRestored() {} },
    { preserveDrawingBuffer: true },
  );

  const W = 640;
  const H = 360;
  const captures: Array<{ name: string; dataUrl: string }> = [];

  const shoot = (name: string, frame: RenderFrame) => {
    renderer.draw(frame);
    captures.push({ name, dataUrl: canvas.toDataURL('image/png') });
  };

  const scene = demoScene();

  shoot('01-beauty', toFrame(scene, W, H));
  shoot('02-hit-diagnostic', toFrame(scene, W, H, { viewMode: 'hit' }));
  shoot('03-albedo-diagnostic', toFrame(scene, W, H, { viewMode: 'albedo' }));
  shoot('04-redirects-0', toFrame(scene, W, H, { maxRedirects: 0 }));

  // Move the target: its reflection in the mirror must move with it.
  const moved = demoScene();
  const target = moved.objects[6];
  if (target.kind === 'sphere') (target as { center: Vec3 }).center = [2.6, 0.9, 3.6];
  shoot('05-target-moved', toFrame(moved, W, H));

  // Move the light: shadows must move, not the geometry.
  const relit = demoScene();
  relit.light = { position: [2.8, 5.4, -0.5], color: [1, 0.97, 0.92], intensity: 42 };
  shoot('06-light-moved', toFrame(relit, W, H));

  // Mirror switched to matte: proves the image is recomputed, not swapped.
  const matte = demoScene();
  matte.materials[4] = { mode: 'matte', albedo: [0.75, 0.75, 0.78] };
  shoot('07-mirror-as-matte', toFrame(matte, W, H));

  window.__AI1_CAPTURES__ = captures;
}

run();
