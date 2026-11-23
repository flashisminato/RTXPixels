import type { RenderFrame } from '../contracts.ts';
import { encodeDisplay, makeCameraRay, traceColor } from '../core/index.ts';

type FallbackOptions = { signal: AbortSignal; isCurrent: () => boolean };

/** Render in short cancelable chunks, committing pixels atomically only when the
 * entire frame is current. Caller owns the canvas, AbortController and snapshot. */
export function drawFallback(canvas: HTMLCanvasElement, frame: RenderFrame, { signal, isCurrent }: FallbackOptions): Promise<boolean> {
  if (signal.aborted || !isCurrent()) return Promise.resolve(false);
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Canvas2D is unavailable; cannot display the CPU fallback.'));
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    return Promise.reject(new Error('Fallback drawing buffer does not match its frame.'));
  }
  const image = context.createImageData(frame.width, frame.height);
  return new Promise((resolve, reject) => {
    let pixel = 0;
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    function finish(rendered: boolean, error?: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error !== undefined) reject(error);
      else resolve(rendered);
    }
    function abort() { finish(false); }
    function chunk() {
      if (signal.aborted || !isCurrent()) { finish(false); return; }
      try {
        const deadline = performance.now() + 4;
        const count = frame.width * frame.height;
        do {
          const x = pixel % frame.width;
          const y = Math.floor(pixel / frame.width);
          const ray = makeCameraRay(frame.camera, x, y, frame.width, frame.height);
          const rgb = encodeDisplay(traceColor(frame.scene, ray, frame.options), frame.options.viewMode);
          const offset = pixel * 4;
          image.data[offset] = Math.round(rgb[0] * 255);
          image.data[offset + 1] = Math.round(rgb[1] * 255);
          image.data[offset + 2] = Math.round(rgb[2] * 255);
          image.data[offset + 3] = 255;
          pixel++;
        } while (pixel < count && performance.now() < deadline);
        if (pixel < count) timer = setTimeout(chunk, 0);
        else if (!signal.aborted && isCurrent()) {
          context!.putImageData(image, 0, 0);
          finish(true);
        } else finish(false);
      } catch (error) { finish(false, error); }
    }
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(chunk, 0);
  });
}
