/**
 * TEMPORARY, RENDERER-LOCAL MIRROR OF SHARED CONTRACT v1.
 *
 * `src/contracts.ts` is owned by AI 3 and does not exist yet: the repository
 * has no bootstrap commit, no package manifest, and no source tree outside
 * this branch. The renderer cannot typecheck or run without those types, so
 * this file holds a verbatim copy of the contract text from the AI 1 brief.
 *
 * Rules for this file:
 *  - It is NOT the contract. AI 3's committed `src/contracts.ts` always wins.
 *  - It is types only. No values, no behaviour, nothing to drift.
 *  - Delete it the moment the bootstrap commit lands, and re-run the renderer
 *    tests against the real file. Any difference found at that point is a
 *    defect in this copy, and must be reported rather than patched in silence.
 *
 * `tests/render/prepare-contracts.mjs` copies these declarations to
 * `src/contracts.ts` ONLY when that path is absent, purely so the renderer can
 * be compiled and tested before bootstrap. That generated file is never
 * committed on feature/renderer.
 */

export type Vec3 = [number, number, number];
export type Mode = 'matte' | 'mirror';
export type ViewMode = 'beauty' | 'hit' | 'albedo';
export type Material = { mode: Mode; albedo: Vec3 }; // LINEAR RGB
export type SceneObject =
  | { kind: 'sphere'; id: string; materialIndex: number;
      center: Vec3; radius: number }
  | { kind: 'plane'; id: string; materialIndex: number;
      point: Vec3; normal: Vec3 };
export type Scene = {
  objects: SceneObject[];
  materials: Material[];
  camera: { position: Vec3; target: Vec3; fovYDeg: number };
  light: { position: Vec3; color: Vec3; intensity: number }; // LINEAR RGB
  ambient: number;
  skyBottom: Vec3; // LINEAR RGB
  skyTop: Vec3;    // LINEAR RGB
};
export type CameraBasis = {
  origin: Vec3; forward: Vec3; right: Vec3; up: Vec3; tanHalfFov: number;
};
export type Ray = { origin: Vec3; direction: Vec3 };
export type Hit = {
  objectId: string; materialIndex: number; t: number; point: Vec3;
  outwardNormal: Vec3; normal: Vec3; frontFace: boolean;
};
export type TraceOptions = { maxRedirects: number; viewMode: ViewMode };
export type TraceEvent =
  | { kind: 'hit'; from: Vec3; incoming: Vec3; hit: Hit }
  | { kind: 'reflect'; point: Vec3; incoming: Vec3; outgoing: Vec3; normal: Vec3 }
  | { kind: 'shadow'; from: Vec3; toLight: Vec3; blocked: boolean;
      blockerId: string | null; blockerPoint: Vec3 | null; nDotL: number }
  | { kind: 'end'; reason: 'surface' | 'sky' | 'budget' | 'diagnostic';
      from: Vec3; direction: Vec3 };
export type TraceResult = { linearColor: Vec3; events: TraceEvent[] };
export type RenderFrame = {
  sceneVersion: number; scene: Scene; camera: CameraBasis;
  width: number; height: number; options: TraceOptions;
};
export type Inspection = {
  sceneVersion: number;
  pixel: { x: number; y: number; width: number; height: number };
  ray: Ray; result: TraceResult;
};
export type Controls = {
  targetX: number; lightX: number; cameraYawDeg: number;
  mirrorMode: Mode; maxRedirects: number; viewMode: ViewMode;
};
export type Action =
  | { type: 'target-x'; value: number }
  | { type: 'light-x'; value: number }
  | { type: 'camera-yaw'; value: number }
  | { type: 'mirror-mode'; value: Mode }
  | { type: 'redirects'; value: number }
  | { type: 'view-mode'; value: ViewMode }
  | { type: 'reset' };
export type ViewState = {
  sceneVersion: number; scene: Scene; controls: Controls;
  inspection: Inspection | null;
  status: 'starting' | 'ready' | 'fallback' | 'error'; message: string;
};
export type UIActions = {
  dispatch(action: Action): void;
  inspectAt(u: number, v: number): void; // normalized top-left [0,1]
  inspectExample(): void;
};
export type UIHandle = {
  canvasHost: HTMLElement;
  update(view: ViewState): void;
  dispose(): void;
};
export type RendererHooks = {
  onContextLost(): void;
  onContextRestored(): void;
};
export type Renderer = {
  draw(frame: RenderFrame): void;
  dispose(): void;
};
