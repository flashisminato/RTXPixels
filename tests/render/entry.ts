/**
 * Browser entry point for the renderer checks.
 *
 * Runs every case, records the actual GPU it ran against, and publishes the
 * result on `window.__AI1_RESULT__` for the headless runner to collect. The
 * reported renderer string matters: a pass on a software rasteriser is not the
 * same claim as a pass on real hardware, and the handoff must say which.
 */
import { main } from './renderer.test';

declare global {
  interface Window {
    __AI1_RESULT__?: unknown;
  }
}

function describeGpu(): { renderer: string; webgl2: boolean } {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { renderer: 'none (WebGL2 unavailable)', webgl2: false };

  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info
    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  const vendor = info
    ? String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL))
    : String(gl.getParameter(gl.VENDOR));

  return { renderer: `${vendor} / ${renderer}`, webgl2: true };
}

async function go(): Promise<void> {
  const gpu = describeGpu();
  let outcomes: unknown = [];
  let fatal: string | null = null;

  try {
    outcomes = await main();
  } catch (error) {
    fatal = (error as Error)?.stack ?? String(error);
  }

  window.__AI1_RESULT__ = {
    ...gpu,
    outcomes: fatal
      ? [{ name: 'test suite execution', status: 'fail', detail: fatal }]
      : outcomes,
    samples: (globalThis as Record<string, unknown>).__AI1_PIXEL_SAMPLES__ ?? null,
  };
}

void go();
