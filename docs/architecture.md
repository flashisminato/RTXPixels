# Architecture

## Shared boundary

The renderer (`src/render/`), the CPU core (`src/core/`) and the interface (`src/ui/`) share the types in `src/contracts.ts`. The renderer and the interface do not own state, fallback, scheduling or the image canvas: `src/main.ts` does, and the store (`src/state/`) is the single source of truth for the scene.

## Snapshot → frame → image + inspection

1. An action is validated before state changes. The preset is reconstructed, the scene version advances (including reset), and the old inspection is dropped. Nonfinite values, invalid indexes/counts/radii/FOV/modes are rejected. Published snapshots are deeply frozen.
2. Main invalidates current work immediately, hides the previous image, and coalesces rendering with one animation-frame callback. The state version detects scene/options changes; a separate generation detects resize and backend changes within the same scene version.
3. A frame combines one scene snapshot, one CPU camera basis, actual integer drawing-buffer dimensions and current options. WebGL is capped at 640×360; fallback at 160×90. Both are fit to host aspect, with at most one pixel of integer-rounding error.
4. Only the current generation/version can present a completed frame. A retained normalized selection maps to that frame's real top-left pixel center, using the same basis and scene. Resize recomputes selection even when sceneVersion is unchanged.
5. Inspector events come directly from `traceRay`. No production fixture or invented reflected path is used. Example search traces a deterministic 48×27 grid (or smaller for tiny buffers), preferring an actual mirror → target sequence. Failure is reported with a reset suggestion.

## CPU math

The camera looks along +Z initially, with +Y up. The CPU supplies forward/right/up and tanHalfFov to the integrated GPU renderer. Vertical camera poles are nudged toward +Z. Public intersection directions and normals are normalized; returned t and bounds use world distances.

Sphere intersections accept nonnegative discriminants and select the nearest strict in-range root, including exit roots. Plane denominators below 1e-6 miss. A strict closest-distance bound preserves the earlier array object on an exact tie. Missing geometry never causes a material read.

A bounded iterative trace resolves a complete nearest hit before choosing material behavior. Mirrors are untinted, offset by EPS along the oriented normal, and use at most four redirects. With ray tracing off ('raster' view), the first surface is shaded with direct light only: no shadow rays and no redirects. Matte surfaces still shade after the final allowed redirect. A fifth required reflection ends black with a budget event. Diagnostics stop at the first hit and do not use shadows/reflections.

Matte illumination uses the specified ambient + inverse-square Lambertian point-light model. Shadow distances are bounded strictly before the light. Every v1 object blocks shadows, including mirrors. Beauty applies Reinhard then piecewise sRGB; albedo applies sRGB only; hit bypasses both.

## Cancelable fallback

`traceColor` invokes the same trace implementation without an event array, avoiding event construction for bulk pixels. `traceRay` always returns its public event list for a selected pixel.

Fallback yields after roughly a 4 ms computation slice (one pixel can overrun that budget). Abort removes the pending timer immediately. A complete ImageData buffer is committed only after checking the current generation/version, so partial/stale frames cannot be inspected. This is cooperative main-thread work, not a worker or a guaranteed frame rate.

## Graphics failure and lifecycle

Creation, drawing, or graphics-context loss switches to CPU. Main disposes the renderer and replaces only the image canvas before asking for Canvas2D. It never requests both context types on the same canvas; the UI host and host listeners survive.

After context loss the page stays on CPU for the session. Events from a detached WebGL canvas are ignored; reload retries WebGL. Automatic GPU recovery is not claimed. Shutdown aborts work, cancels animation frames, removes observers/listeners, and disposes renderer/UI resources. Expected operational errors are shown in status text. UI subscriber failures are distinguished from rejected controls, and changed frames are invalidated before UI notification.

## Scope and performance

No worker, cache, framework, server, telemetry or recovery log is used. Added balls are moved by a small fixed-step physics routine (`src/scene/physics.ts`) that runs only while something moves. There is no glass, stochastic sampling, soft shadowing or diffuse global illumination. Performance measurements do not establish a frame-rate target; low resolution keeps the reference fallback bounded and understandable.
