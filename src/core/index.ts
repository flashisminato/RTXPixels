import type { CameraBasis, Hit, Ray, Scene, TraceOptions, TraceResult, Vec3, ViewMode } from '../contracts.ts';

// Bootstrap signatures only. CPU reference implementation follows on integration/core.
function pending(): never { throw new Error('CPU reference calculations are not implemented yet.'); }
export function makeCameraBasis(_scene: Scene): CameraBasis { return pending(); }
export function makeCameraRay(_camera: CameraBasis, _x: number, _y: number, _width: number, _height: number): Ray { return pending(); }
export function nearestHit(_scene: Scene, _ray: Ray, _tMin: number, _tMax: number): Hit | null { return pending(); }
export function traceRay(_scene: Scene, _ray: Ray, _options: TraceOptions): TraceResult { return pending(); }
export function encodeDisplay(_linear: Vec3, _mode: ViewMode): Vec3 { return pending(); }
