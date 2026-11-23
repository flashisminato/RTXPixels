/**
 * Compile-time conformance to the shared contract.
 *
 * Nothing here runs. Its job is to fail `tsc` if the renderer ever stops
 * matching the module signature AI 3 will import:
 *
 *   createRenderer(canvas: HTMLCanvasElement, hooks: RendererHooks): Renderer;
 *
 * The runtime tests all call `createRenderer` with a third options argument and
 * use the extra debug members, so on their own they would not notice the public
 * two-argument shape drifting. This file pins it.
 */
import type { Renderer, RendererHooks, RenderFrame } from '../../src/contracts';
import { createRenderer } from '../../src/render/index';

// The exact signature AI 3 depends on.
type ContractFactory = (canvas: HTMLCanvasElement, hooks: RendererHooks) => Renderer;

// Fails to compile if the extra parameter ever stops being optional, if the
// return type stops satisfying Renderer, or if the parameter types drift.
const _factoryConforms: ContractFactory = createRenderer;

// The returned object must be usable as a plain contract Renderer, with no
// knowledge of the renderer-internal members.
declare const canvas: HTMLCanvasElement;
declare const hooks: RendererHooks;
declare const frame: RenderFrame;

const _renderer: Renderer = createRenderer(canvas, hooks);
_renderer.draw(frame);
_renderer.dispose();

// `Renderer` must expose exactly draw and dispose to the host: if the contract
// gains a member the renderer does not implement, this assignment breaks.
type _ExactSurface = {
  [K in keyof Renderer]: Renderer[K];
};
const _surface: _ExactSurface = _renderer;

export {};
