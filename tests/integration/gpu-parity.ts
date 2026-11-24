import { EPS, FAR } from '../../src/contracts.ts';
import type { Vec3, ViewMode } from '../../src/contracts.ts';
import { encodeDisplay, makeCameraRay, nearestHit, traceRay } from '../../src/core/index.ts';
import { findMirrorExample, fitBuffer, makeFrame } from '../../src/core/frame.ts';
import { createRenderer, DEBUG_IDS, DEBUG_NORMAL, DEBUG_OFF } from '../../src/render/index.ts';
import { createStore } from '../../src/state/index.ts';

/** Browser-only integration check. Uses AI 1's unchanged diagnostic surface and
 * AI 3's actual reference math, rather than a second contract shim or renderer. */
export function checkGPUParity() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = createRenderer(canvas, { onContextLost() {}, onContextRestored() {} },
    { debug: true, preserveDrawingBuffer: true });
  const store = createStore();
  let comparisons = 0;
  let maxByteError = 0;
  const observedObjects = new Set<string>();
  try {
    const extension = renderer.gl.getExtension('WEBGL_debug_renderer_info');
    const backend = extension ? String(renderer.gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
    for (let scenario = 0; scenario < 4; scenario++) {
      if (scenario === 1) store.dispatch({ type: 'light-x', value: 4 });
      if (scenario === 2) {
        store.dispatch({ type: 'target-x', value: -2.8 });
        store.dispatch({ type: 'camera-yaw', value: 15 });
      }
      if (scenario === 3) {
        // Four lights: every extra light adds its own shadow-checked term on both paths.
        store.dispatch({ type: 'light-add' });
        store.dispatch({ type: 'light-add' });
        store.dispatch({ type: 'light-add' });
        store.dispatch({ type: 'light-move', index: 2, axis: 'y', value: 2.2 });
        store.dispatch({ type: 'light-intensity', index: 1, value: 150 });
        store.dispatch({ type: 'light-move', index: 0, axis: 'z', value: 3 });
      }
      for (const [cssWidth, cssHeight] of [[320, 180], [240, 240], [333, 187]]) {
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        const size = fitBuffer(cssWidth, cssHeight, window.devicePixelRatio);
        canvas.width = size.width;
        canvas.height = size.height;
        const frame = makeFrame(store.getSnapshot(), canvas.width, canvas.height);
        const points = [[0, 0], [frame.width - 1, 0], [0, frame.height - 1], [frame.width - 1, frame.height - 1],
          [Math.floor(frame.width / 2), Math.floor(frame.height / 2)],
          [Math.floor(frame.width * 0.25), Math.floor(frame.height * 0.8)]];
        const example = findMirrorExample(frame);
        if (example) points.push([example.inspection.pixel.x, example.inspection.pixel.y]);
        const variants: { mode: ViewMode; debug: number; tolerance: number }[] = [
          { mode: 'beauty', debug: DEBUG_OFF, tolerance: 3 },
          { mode: 'hit', debug: DEBUG_OFF, tolerance: 0 },
          { mode: 'albedo', debug: DEBUG_OFF, tolerance: 2 },
          { mode: 'beauty', debug: DEBUG_IDS, tolerance: 0 },
          { mode: 'beauty', debug: DEBUG_NORMAL, tolerance: 1 },
        ];
        for (const variant of variants) {
          frame.options.viewMode = variant.mode;
          renderer.setDebugMode(variant.debug);
          renderer.draw(frame);
          const pixels = new Uint8Array(frame.width * frame.height * 4);
          renderer.gl.readPixels(0, 0, frame.width, frame.height, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, pixels);
          for (const [x, y] of points) {
            const ray = makeCameraRay(frame.camera, x, y, frame.width, frame.height);
            const hit = nearestHit(frame.scene, ray, EPS, FAR);
            if (hit) observedObjects.add(hit.objectId);
            let expected: number[];
            if (variant.debug === DEBUG_IDS) {
              expected = hit ? [frame.scene.objects.findIndex(object => object.id === hit.objectId) + 1, hit.materialIndex + 1, 255] : [0, 0, 0];
            } else if (variant.debug === DEBUG_NORMAL) {
              const normal: Vec3 = hit?.normal ?? [0, 0, 0];
              expected = normal.map(value => Math.round((value * 0.5 + 0.5) * 255));
            } else {
              expected = encodeDisplay(traceRay(frame.scene, ray, frame.options).linearColor, variant.mode).map(c => Math.round(c * 255));
            }
            const offset = ((frame.height - 1 - y) * frame.width + x) * 4;
            const actual = Array.from(pixels.subarray(offset, offset + 3));
            const error = Math.max(...actual.map((value, i) => Math.abs(value - expected[i])));
            if (error > variant.tolerance) {
              throw new Error(`CPU/GPU mismatch: scenario ${scenario}, ${frame.width}x${frame.height}, pixel ${x},${y}, mode ${variant.mode}, debug ${variant.debug}; CPU ${expected}, GPU ${actual}, tolerance ${variant.tolerance}`);
            }
            maxByteError = Math.max(maxByteError, error);
            comparisons++;
          }
        }
      }
    }
    return { comparisons, maxByteError, observedObjects: [...observedObjects], backend, dpr: window.devicePixelRatio };
  } finally {
    renderer.dispose();
    canvas.remove();
  }
}
