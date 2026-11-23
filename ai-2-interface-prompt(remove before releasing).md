# AI 2 brief for the interface and explanation

You are AI 2, the interaction and teaching-experience owner. Implement the interface and selected-pixel explanation for our shared app. Challenge unclear explanations and test whether a newcomer understands the mechanism. You are not building a separate application or inventing a visual simulation.

Inputs the human must provide before repository edits: the NEW team repository or baseline files, AI 3's bootstrap commit, and any newer contract version. The complete shared brief and contract are included below.

## Your deliverable

mountUI(root,actions) returns an empty image canvasHost, update(view), and dispose(). It builds the actual product layout, controls, separate explanatory diagram, event list, keyboard interactions, status/error messages, and visible credits. Own src/ui/**, src/styles/**, tests/ui/**, and docs/handoffs/ai2.md only.

Do not implement the ray tracer, WebGL setup, global scene store, file upload system, authentication, or deployment. Do not change src/contracts.ts or package/config files. Do not replace computed results with stored example rays.

## Day 1 work sequence

**While AI 3 bootstraps, about 30–60 minutes:** draft the opening view and first two-minute experiment. The lead question is How does a game decide what a mirror shows? The first action is Move the colored object and watch its reflection. Sketch a large image with focused controls and a separate explanatory diagram; no generic 3D editor.

**Hours 1–2:** start feature/ui at the shared bootstrap commit. Implement mountUI and the exact UIHandle/UIActions boundary. Provide a clear canvasHost with no padding/border, decorated by an outer wrapper. AI 3 inserts the image canvas. Build the layout and emit typed actions. Commit the shell early.

**Hours 2–4:** connect target-X, light-X, camera-yaw, matte/mirror, redirect-budget, view-mode, and reset controls to dispatch. Read actual values from ViewState; never silently keep a second scene model. Place advanced controls behind an expandable panel. Use native labels, keyboard focus, numeric values, and touch-friendly targets. Coordinate preset-specific ranges with AI 3.

**Hours 4–6:** implement normalized image selection and the separate Canvas2D ray diagram. Use only Inspection.result.events from AI 3. Draw camera-to-hit segments, surface normals, mirror directions, and shadow visibility with text labels. Use an oblique orthographic schematic based on recorded 3D points, with clear depth/axis labeling. A projection may shorten angles, so numeric incidence/reflection values must come from 3D vectors. Do not teach equality of angles using distorted screen angles.

**Hours 6–8:** integrate real GPU output and real trace events. Add the event list, useful empty/miss/budget states, and Inspect a mirror pixel button calling inspectExample(). AI 3 computes a real example pixel; you do not hard-code a ray. Clear or visibly refresh stale inspection results when sceneVersion changes. Make reset restore a useful view.

## Day 2 work sequence

**Hours 0–2:** polish explanation and accessibility. Make the computational camera-to-scene direction explicit; physical light travels toward the camera. Keep beauty-path explanations distinct from first-hit diagnostic modes. Add no glass control unless the integration lead approves a shared version and reports implementation ready.

**Hours 2–4:** the human tests with two first-time users without explaining the interface. Ask them to move the object, inspect a reflection, and explain why the pixel changed. Record actual confusion and revise copy/layout. Test narrow screens, keyboard-only use, readable labels, focus, contrast, and reduced motion. Freeze features at the end of this block.

**Hours 4–6:** finalize Credits and limitations using text supplied by AI 3. Help prepare the project page and demo storyboard; hand the text to AI 3 for submission documentation. Capture only actual working behavior and describe missing effects honestly.

**Hours 6–8:** resolve release blockers and help the human explain the app in two minutes. Do not introduce a visual redesign at this stage.

## Teaching and interaction requirements

- Default screen works without setup; three prominent controls at most, with further depth expandable.
- The image and inspector refer to the same sceneVersion and framebuffer pixel.
- If no geometry is hit, show a computed sky/miss explanation, not an error.
- If the redirect budget is reached, explain the limit; do not draw a guessed next intersection.
- A shadow segment extends toward the light and marks the actual blocker when blocked.
- Label the diagram schematic; it is a projected view of computed geometry, not a second ray-traced camera.
- A perfect uniform sphere should not have a rotation control advertised as changing reflections. Move the object or camera.
- Provide a keyboard alternative to mouse selection, such as a focusable image surface with arrow-key movement of normalized selection plus the example-pixel button.
- Handle starting, ready, fallback, and error states using actual status/message values. A failed shader must not leave a misleading decorative render in place.
- Keep user-facing controls nontechnical. Put equations and vectors behind Explain the math.
- If you need fixtures for UI development, isolate them in tests, identify them as test fixtures, and keep them out of the production entry point. Never claim they verify the real renderer.

## Checks you own

Controls emit correct actions; UI state reflects updates; reset works; canvas selection uses the content rectangle; keyboard selection works; trace events are rendered in order; projection uses actual event positions; diagram handles an empty trace; stale results disappear; narrow layout remains usable; controls and credits are discoverable. Where browser testing is unavailable, clearly list the unverified checks.

## First response and first action

Confirm the received baseline and contract version, describe the first-screen interaction briefly, then implement the owned UI files. Request only genuinely missing baseline/access information. Provide the first functioning UI shell early so integration can start.

---

## Shared brief for all three accounts

We are three humans using three separate AI chats to build one original educational web app in two working days. Each human has about 16 hours. The working title is Follow a Pixel. The question is: How does a game decide what a mirror shows?

The app must compute a colored scene with a mirror sphere and hard shadows. A visitor moves an object, camera, or light, then selects a pixel to inspect the actual ray intersections, reflection, and shadow decision behind its color. All core calculations run locally in our code. No API key, login, video substitute, or prerecorded results. Our contribution is the interactive explanation and original experience, not a claim that we invented ray tracing.

Use a NEW team repository. Never modify or push to the reference repository. Reference snapshot:
https://github.com/pkncoder/Light-Teachings/tree/57260fe2a6badbc826271856bbcf6c8a2090de17

Useful original files are LightTeachings/Renderer.swift, LightTeachings/Shaders/fragment.metal, RayTracer.metal, Models/SimpleShading.metal, and the shared header. The active source is a fullscreen shader doing analytic intersections, perfect reflections, simplified refraction, and direct lighting. It is not a progressive path tracer. Do not copy uninitialized-hit material reads, object-loop restarts, or jitter without accumulation. Preserve attribution for actual adaptations. The repository's author credit is Kia Preston (pkncoder); its MIT copyright notice is Copyright (c) 2025 Kia.

### Scope and workflow

- Stack: Vite, TypeScript, ordinary HTML/CSS, raw WebGL2 for the image, Canvas2D for the explanatory diagram. Use native controls. No additional UI/graphics framework in the baseline.
- Core: spheres and planes; at most eight objects/materials; one point light; matte and perfect-mirror materials; hard shadows; one stable sample per pixel; at most four ray redirects; reset; real computed pixel inspector; responsive UI; credits; public static hosting.
- No general scene editor, accounts, chatbot, mesh import, BVH, cylinders, CSG, diffuse global illumination, soft shadows, or glossy mirror effects.
- Glass is disabled in contract version 1. Only the human integration lead can approve a version 2 after the Day 1 core works. It needs CPU and GPU entry/exit/TIR tests. Do not add it independently.
- Each account works in a separate checkout and branch from the same bootstrap commit. AI 1 uses feature/renderer; AI 2 uses feature/ui; AI 3 uses integration/core and is the sole integrator into main.
- Do not create three complete applications. Do not replace other people's files, change the stack, or silently rename shared APIs.
- Before starting code, inspect the repository, bootstrap commit, contracts, and current handoffs. If these are unavailable, report the precise missing input. You may read reference code or design owned work while waiting, but must not invent a different project structure.
- AI 3 owns shared contracts and package/config changes. Request a contract change through a handoff; continue unaffected work. After approval, AI 3 commits the change and gives both accounts the new commit and version.
- Aim for an integrated milestone every two hours. Hand off tested partial work; do not wait until the whole module is finished. Never say a test passed unless you ran it. State browser and device verification limits.
- If this chat cannot execute or edit files, produce complete owned files or a patch against the supplied commit, list paths, and label execution unverified. The human or coding environment must apply and test them. Do not fabricate commits, links, deployment, or screenshots.

### File ownership

| Owner | Files |
|---|---|
| AI 1 | src/render/**, tests/render/**, docs/handoffs/ai1.md |
| AI 2 | src/ui/**, src/styles/**, tests/ui/**, docs/handoffs/ai2.md |
| AI 3 | src/contracts.ts, src/core/**, src/state/**, src/scene/**, src/fallback/**, src/main.ts, index.html, project/package/CI configuration, tests/core/**, tests/integration/**, public/notices/**, docs other than the other two handoff files, README |

AI 3 may create minimal renderer/UI stubs ONLY in the bootstrap commit before handing ownership to AI 1/2. After handoff, AI 3 asks the owner to fix implementation defects, or explicitly coordinates temporary ownership of a file. Merge conflict resolution must preserve both intentions; do not wholesale replace a feature branch with an older version.

## Shared contract version 1

AI 3 must materialize the following types in src/contracts.ts in the bootstrap commit. All accounts consume that committed file. These are proposed interfaces for our new app, not pre-existing implementation.

```ts
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
```

Required module exports:

```ts
// AI 1: src/render/index.ts
createRenderer(canvas: HTMLCanvasElement, hooks: RendererHooks): Renderer;
// Throw a descriptive error if WebGL2 creation/compilation fails.
// No DOM UI, store mutation, CPU fallback, or independent animation loop here.

// AI 2: src/ui/index.ts
mountUI(root: HTMLElement, actions: UIActions): UIHandle;
// canvasHost is an EMPTY host. AI 3 inserts/manages the image canvas.
// UI imports src/styles/main.css; includes its own separate diagram canvas.

// AI 3: src/core/index.ts
makeCameraBasis(scene: Scene): CameraBasis;
makeCameraRay(camera: CameraBasis, x: number, y: number,
              width: number, height: number): Ray;
nearestHit(scene: Scene, ray: Ray, tMin: number, tMax: number): Hit | null;
traceRay(scene: Scene, ray: Ray, options: TraceOptions): TraceResult;
encodeDisplay(linear: Vec3, mode: ViewMode): Vec3; // sRGB [0,1]
```

### Mathematics and rendering agreement

- Y is up; initial camera looks toward positive Z. forward=normalize(target-position); right=normalize(cross([0,1,0],forward)); up=cross(forward,right). Clamp away from vertical camera poles. The GPU receives this camera basis from AI 3, rather than independently choosing rotation conventions.
- Pixel x/y are integer drawing-buffer coordinates from the TOP LEFT. Use x+0.5/y+0.5. sx=(2*(x+0.5)/width-1)*(width/height); sy=1-2*(y+0.5)/height. D=normalize(forward+sx*tanHalfFov*right+sy*tanHalfFov*up). GLSL must account for bottom-left gl_FragCoord.
- EPS=1e-4, FAR=1000, plane parallel threshold=1e-6. Normalize ray directions and normals. Scenes use unit-scale geometry bounded roughly within ±10. Accept sphere discriminant >=0. A negative discriminant is a miss in v1; numerical tolerances belong in assertions, not different CPU/GPU intersection rules.
- Hits satisfy tMin < t < tMax. Select nearest positive root, including the far root when inside a sphere. frontFace=dot(D,outwardNormal)<0; normal=frontFace?outwardNormal:-outwardNormal. Return null on miss; never read miss materials. Exact equal-distance ties go to the earlier array object.
- Camera/object material indexes are zero-based. Valid sphere radius 0.1–1.5, FOV 20–100 degrees. The store validates all finite inputs and counts.
- Camera is outside opaque geometry. Author presets and slider limits to prevent overlap and camera collisions. Use original colors and arrangement, not copied sample JSON.
- Matte shading: ambient*albedo + visibility*(albedo/PI)*light.color*intensity*max(dot(N,L),0)/max(distanceSquared,0.01). Compute L and distance from P+EPS*N to the light. Shadow blockers must lie strictly before the light; all v1 objects are opaque to shadow rays. Shadow event nDotL uses max(dot(N,L),0).
- Mirror direction is normalize(D-2*dot(D,N)*N). Start the next ray at P+EPS*N. Perfect mirror is untinted; no local matte term. Resolve a complete nearest hit before deciding the next direction.
- maxRedirects is 0–4. A matte surface encountered after the last allowed redirect is still shaded. A reflective surface needing another redirect returns black and a budget event. There is no shader recursion.
- Miss sky: t=clamp(0.5*(D.y+1),0,1); mix(skyBottom,skyTop,t).
- beauty mode traces reflections and shading. hit/albedo modes inspect the FIRST hit, bypassing reflections and shadow shading. Hit mode returns exact white/black. Albedo returns the material linear albedo or black on miss. End these modes with reason diagnostic.
- All color math uses linear RGB. beauty display uses Reinhard c/(1+c), then standard piecewise linear-to-sRGB. albedo uses sRGB conversion without tone mapping. hit bypasses both. No exposure slider, gamma approximation, or second conversion.
- One sample only; no jitter or accumulation. CPU and GPU implement identical semantics. Diagnostics must be labeled first-hit diagnostics, not the beauty ray's final surface.
- AI 3 schedules rendering when dirty, handles resize, increments sceneVersion on scene/options changes, and rejects stale inspector/fallback results. Store the selected normalized position and recompute after resize.
- AI 2 emits normalized pointer coordinates relative to canvasHost's content area. That host has no padding/border; put decorations on its parent. AI 3 maps coordinates to actual drawing-buffer pixels. Default maximum drawing buffer is 640×360 scaled to host aspect ratio, without exceeding either cap; lower it if necessary. Never stretch a different aspect ratio into the host.
- On failure after a WebGL context exists, AI 3 replaces the image canvas before obtaining a Canvas2D context. Do not attempt two different context types on the same canvas. AI 2's host and event handlers survive replacement.

### Shared handoff format

At every checkpoint update ONLY your own docs/handoffs/aiN.md and give the human this same compact report:

1. Branch, current commit, and base/main commit used; contract version.
2. Changed files and any dependencies/config changes requested.
3. Working behavior and remaining known failures.
4. Exact checks run, actual outcomes, and checks not run.
5. Next integration action; any precise question for the other owner.
6. Adapted source/functions and notices required.

If Git is unavailable, provide a patch/file bundle and its exact baseline instead of inventing a commit. Do not send credentials or personal account details between chats. The humans transfer these handoffs; do not assume the other accounts can see this conversation.
