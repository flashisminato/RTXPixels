import type { Renderer, RendererHooks } from '../contracts.ts';

// AI 1 owns this module after the bootstrap handoff. Never pretend to render.
export function createRenderer(_canvas: HTMLCanvasElement, _hooks: RendererHooks): Renderer {
  throw new Error('WebGL renderer is not implemented yet; awaiting AI 1.');
}
