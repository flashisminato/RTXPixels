// Shared contract v1. Changes require integration-owner coordination.
// Semantics and module ownership: docs/contract-v1.md.
export const CONTRACT_VERSION = 1 as const;
export const EPS = 1e-4;
export const FAR = 1000;
export const PLANE_PARALLEL_THRESHOLD = 1e-6;
export const MAX_OBJECTS = 8;
export const MAX_MATERIALS = 8;
export const MAX_REDIRECTS = 4;
/** Point lights in a scene: the main light plus up to three extra ones. */
export const MAX_LIGHTS = 4;

export type Vec3 = [number, number, number];
export type Mode = 'matte' | 'mirror';
export type ViewMode = 'beauty' | 'hit' | 'albedo';
export type Material = { mode: Mode; albedo: Vec3 }; // LINEAR RGB
export type PointLight = { position: Vec3; color: Vec3; intensity: number }; // LINEAR RGB
export type SceneObject =
  | { kind: 'sphere'; id: string; materialIndex: number;
      center: Vec3; radius: number }
  | { kind: 'plane'; id: string; materialIndex: number;
      point: Vec3; normal: Vec3 };
export type Scene = {
  objects: SceneObject[];
  materials: Material[];
  camera: { position: Vec3; target: Vec3; fovYDeg: number };
  light: PointLight; // the main light, index 0
  /** Additional point lights, indices 1.. (at most MAX_LIGHTS - 1). Optional: absent means none. */
  extraLights?: PointLight[];
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
      blockerId: string | null; blockerPoint: Vec3 | null; nDotL: number;
      /** Which light this check walks toward; absent means the main light (0). */
      lightIndex?: number }
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
/** One extra light's controls. `tint` picks its color from EXTRA_LIGHT_TINTS. */
export type LightControl = { x: number; y: number; z: number; intensity: number; tint: number };
export type LightAxis = 'x' | 'y' | 'z';
export type Controls = {
  targetX: number; lightX: number; cameraYawDeg: number;
  mirrorMode: Mode; maxRedirects: number; viewMode: ViewMode;
  /** The main light's height, depth and strength (its sideways position is lightX). */
  lightY: number; lightZ: number; lightIntensity: number;
  extraLights: LightControl[];
};
export type Action =
  | { type: 'target-x'; value: number }
  | { type: 'light-x'; value: number }
  /** index 0 is the main light; 1.. are the extra lights. */
  | { type: 'light-move'; index: number; axis: LightAxis; value: number }
  | { type: 'light-intensity'; index: number; value: number }
  | { type: 'light-add' }
  | { type: 'light-remove'; index: number }
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
