import type { Inspection, RenderFrame, ViewState } from '../contracts.ts';
import { makeCameraBasis, makeCameraRay, traceRay } from './index.ts';

/** Fit the measured content box, accounting for DPR, without exceeding either cap.
 * Integer drawing buffers approximate the host aspect to within one pixel. */
export function fitBuffer(cssWidth: number, cssHeight: number, dpr = 1, maxWidth = 640, maxHeight = 360): { width: number; height: number } {
  if (![cssWidth, cssHeight, dpr, maxWidth, maxHeight].every(n => Number.isFinite(n) && n > 0)) {
    throw new RangeError('Buffer dimensions and device pixel ratio must be positive and finite.');
  }
  const factor = Math.min(dpr, maxWidth / cssWidth, maxHeight / cssHeight);
  return { width: Math.max(1, Math.floor(cssWidth * factor)), height: Math.max(1, Math.floor(cssHeight * factor)) };
}

export function makeFrame(view: ViewState, width: number, height: number): RenderFrame {
  return { sceneVersion: view.sceneVersion, scene: view.scene, camera: makeCameraBasis(view.scene), width, height,
    options: { maxRedirects: view.controls.maxRedirects, viewMode: view.controls.viewMode } };
}

export function normalizedPixel(u: number, v: number, width: number, height: number): { x: number; y: number } {
  if (![u, v].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new RangeError('Selection must be normalized to [0, 1].');
  return { x: Math.min(width - 1, Math.floor(u * width)), y: Math.min(height - 1, Math.floor(v * height)) };
}

export function inspectPixel(frame: RenderFrame, x: number, y: number): Inspection {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
    throw new RangeError('Inspection pixel must be inside the drawing buffer.');
  }
  const ray = makeCameraRay(frame.camera, x, y, frame.width, frame.height);
  return { sceneVersion: frame.sceneVersion, pixel: { x, y, width: frame.width, height: frame.height },
    ray, result: traceRay(frame.scene, ray, frame.options) };
}

export function inspectNormalized(frame: RenderFrame, u: number, v: number): Inspection {
  const pixel = normalizedPixel(u, v, frame.width, frame.height);
  return inspectPixel(frame, pixel.x, pixel.y);
}

/** Search only real, current-option traces. Prefer mirror -> target, otherwise a
 * genuine first mirror hit. Never manufacture a path if the grid misses it. */
export function findMirrorExample(frame: RenderFrame): { inspection: Inspection; reflectedTarget: boolean } | null {
  let firstMirror: Inspection | null = null;
  const columns = Math.min(48, frame.width);
  const rows = Math.min(27, frame.height);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const inspection = inspectNormalized(frame, (column + 0.5) / columns, (row + 0.5) / rows);
      const hits = inspection.result.events.filter(event => event.kind === 'hit');
      if (hits[0]?.hit.objectId !== 'mirror') continue;
      firstMirror ??= inspection;
      if (hits[1]?.hit.objectId === 'target') return { inspection, reflectedTarget: true };
    }
  }
  return firstMirror ? { inspection: firstMirror, reflectedTarget: false } : null;
}
