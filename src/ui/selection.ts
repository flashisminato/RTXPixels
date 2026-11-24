/** Pointer and keyboard selection on the image host. Coordinates are top-left normalized. */

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizedPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { u: number; v: number } | null {
  if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    u: clamp01((clientX - rect.left) / rect.width),
    v: clamp01((clientY - rect.top) / rect.height),
  };
}

/** Move one drawing-buffer pixel. v grows downward, matching the picture's top-left origin. */
export function stepSelection(
  current: { u: number; v: number } | null,
  key: string,
  width: number,
  height: number,
): { u: number; v: number } | null {
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!delta) return null;
  const pixelWidth = Number.isFinite(width) && width >= 1 ? width : 64;
  const pixelHeight = Number.isFinite(height) && height >= 1 ? height : 64;
  const base = current ?? { u: 0.5, v: 0.5 };
  return {
    u: clamp01(base.u + delta[0] / pixelWidth),
    v: clamp01(base.v + delta[1] / pixelHeight),
  };
}

export function snapToStep(value: number, min: number, max: number, step: number): number | null {
  if (![value, min, max, step].every(Number.isFinite) || step <= 0 || max < min) return null;
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = min + Math.round((clamped - min) / step) * step;
  const places = Math.min(10, (step.toString().split('.')[1] ?? '').length);
  const rounded = Number(snapped.toFixed(places));
  if (!Number.isFinite(rounded)) return null;
  return Math.min(max, Math.max(min, rounded));
}
