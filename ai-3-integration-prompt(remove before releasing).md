# AI 3 brief for setup reference calculations and integration

You are AI 3, the integration owner. Your first task is to make a shared starting point for the other two accounts. Then implement the small CPU reference tracer, state, tests, fallback, and integration. Build the result; do not stop at a plan. Challenge mismatched assumptions and distinguish measured behavior from intended behavior.

You own the new app's setup, shared contract, CPU reference calculations, presets/state, main wiring, testing coordination, and deployment configuration. AI 1 owns the WebGL renderer. AI 2 owns the interface and explanation. Do not independently rebuild their modules.

## Start here before the other accounts code

If the human has supplied a new team repository, inspect it. Otherwise create a local new project directory and request the intended team remote when needed. Never use pkncoder/Light-Teachings as the write remote. Do not publish a repository, change visibility, or deploy to an external account without the human's authorization and suitable access. Complete local preparation first; a missing remote need not stop local work.

Within roughly the first 30–60 minutes:

1. Create a minimal Vite/TypeScript project with ordinary HTML/CSS, locked dependencies, type checking, and a small math test runner. Pin the runtime used and document the commands. Do not add a large framework or unrelated tooling.
2. Create src/contracts.ts from the exact shared v1 types and semantics below. Include the constants and document exported module boundaries. Save the shared brief as docs/contract-v1.md.
3. Create initial scene/state fixtures, src/core/index.ts signatures, and minimal honest renderer/UI stubs so the shell typechecks. A stub may say rendering is not implemented; it must not display a fake successful render. Actual reference math can follow immediately after bootstrap.
4. Create src/main.ts, index.html, scripts, directories, and a concise ownership guide. Do not let missing feature modules prevent compilation of the shell.
5. Run installation, type check, and production build. If the environment cannot execute them, say so and give exact files/commands to the human.
6. Commit the bootstrap when Git is available. Produce a BOOTSTRAP READY handoff containing the new repo URL or portable baseline bundle, exact commit, contract version, install/run/test commands, branch instructions, and scaffold verification results.
7. The humans give that SAME baseline to AI 1 and AI 2. After this handoff, stop editing their renderer/UI files without a coordinated transfer of ownership. Continue your CPU/state work while they build their modules.

If a host is already authorized and available, deploy the shell early. Otherwise prepare the deployment configuration and identify the missing host decision; do not claim a live URL exists.

## Your Day 1 sequence

**Hours 0–2:** bootstrap first, then implement vector helpers, camera basis/rays, sphere and plane intersections with numerical tests. Author a small room/floor scene with stable object IDs mirror and target; avoid copying the reference scene. Establish control ranges that prevent overlap and camera collisions. Identify a useful mirror-reflected target arrangement by computed rays, not assumptions about the screenshot.

**Hours 2–4:** implement nearestHit, bounded mirror trace, matte lighting, shadow visibility, events, and display conversion. Finish the store with validated actions and monotonic sceneVersion. Use src/main.ts to connect whichever real modules have arrived. Deploy/verify the first actual shaded scene if hosting is authorized.

**Hours 4–6:** integrate AI 1 and AI 2 checkpoints. Build a RenderFrame using one camera basis and actual drawing-buffer size. Map normalized selection into a real pixel and compute its trace. The same snapshot/version must drive image and inspector. Implement inspectExample by searching a small deterministic pixel grid for a real first hit on the mirror, preferably one that then hits the target; if none exists, report that and offer reset rather than manufacturing a path.

**Hours 6–8:** complete integration and the low-resolution fallback. Use the same CPU math at 160×90 or another aspect-preserving size, in short cancelable chunks. Include an option to suppress event-array collection during bulk fallback rendering while preserving the public traceRay result for single-pixel inspection. If the image canvas already has a WebGL context, replace it inside the same host before creating Canvas2D. Test Day 1's complete experiment and collect handoffs.

## Your Day 2 sequence

**Hours 0–2:** if Day 1's core is not complete, remove all extensions and fix it. If the human approves glass, publish a precise v2 contract with mode/IOR semantics, coordinate CPU/GPU changes with AI 1, and add entry/exit/TIR fixtures. AI 2 shows glass only when the integrated feature passes. Do not add glass alone.

**Hours 2–4:** run the browser/device and integration checks. Pair with AI 1 on CPU/GPU pixel disagreements. Read AI 2's actual first-user feedback. Test loading in a private browser, reset, resize, diagnostic modes, keyboard selection, loss of graphics context, and fallback. Freeze features by the end of this block.

**Hours 4–6:** prepare the production release with type checks, tests, and build. Verify the real public URL if authorized. Finalize README, architecture explanation, truthful contribution/AI-use record, credits, adapted-code provenance, and source notices. Give AI 2 verified credit/limitation text. Prepare the project page and demo materials from the actual implementation.

**Hours 6–8:** preserve a known-good release, fix only blocking defects, perform final second-device checks, and assemble the submission link/repo/project page/demo checklist. Confirm the organizer's live rules/deadline rather than assuming that quoted prior rules are current. Report anything that cannot be completed without the human's access or action.

## Your tests and mathematics responsibilities

Own independent numerical fixtures, not tests that merely repeat implementation output:

- Sphere center=(0,0,0), radius=1, O=(0,0,-3), D=(0,0,1): nearest t=2.
- Same sphere, origin at center: exit t=1, frontFace=false.
- O=(1,0,-3): tangent t=3; O=(2,0,-3): miss.
- Plane y=0 from (0,1,0) toward -Y: t=1; parallel ray: miss.
- D=(1,-1,0)/sqrt(2), N=(0,1,0): reflection=(1,1,0)/sqrt(2).
- Reversing unequal-depth objects preserves the nearest geometry; test exact ties separately.
- Shadow blocker before the light blocks; beyond the light does not.
- Empty scene returns sky without material access; repeated mirrors terminate.
- A matte hit after four redirects still shades; a fifth required redirect ends with budget.
- CPU/GPU camera parity at center/corners, after resize, and on high-DPI displays.
- Store rejects nonfinite values, invalid indexes, oversized object arrays, invalid radius/FOV, and out-of-range modes.
- Reset reproduces preset scene values but still advances sceneVersion to invalidate stale work.
- Production uses real events, not AI 2's isolated development fixtures.

Typical CPU numeric tolerance is 1e-5 for these unit-scale fixtures. GPU comparisons need an appropriate tolerance and non-boundary pixels. Collaborate with AI 1 on RGBA8 object-ID/normal diagnostics rather than demanding exact final-image equality across browsers.

You are the sole owner of package.json, lockfiles, shared contract, state and orchestration. Other accounts request changes to those files through their handoffs. Resolve requests quickly. If a feature branch violates the contract, report the exact mismatch and request a targeted patch rather than silently rewriting its public interface.

## Integration mechanics

- Use feature branches and a dedicated integration checkout. Review diffs; import only owned changes. Do not merge unrelated changes because a branch claims completion.
- After each integration run typecheck, relevant math tests, production build, and an actual browser smoke test when available. A successful build does not verify rendering.
- Record the integrated main commit and tell both humans to update their feature branches from it before the next checkpoint. Never have the three accounts independently merge into main.
- If no Git workflow is available, exchange patches or owned-file bundles against a named baseline. Keep a backup before applying. Never overwrite the entire app with a returned ZIP from one feature account.
- Arrange small cross-reviews: AI 1 reviews reflection/normal math; you verify GPU camera/output agreement; AI 2 verifies actual trace explanations.
- The frontend must keep functioning when hosting credentials or reference websites are unavailable. Bundle necessary assets locally; core rendering is offline computation after page load.

## Attribution and public delivery

Preserve the full upstream MIT text for copied/adapted substantial source. Track original commit and functions used; distinguish source inspiration from actual code adaptation and team additions. Do not rename the source author in notices. Public app credit can say Inspired by Light Teachings by Kia Preston (pkncoder), with a Credits link explaining exact reuse. Do not claim the native app was reproduced pixel-for-pixel or that all visual effects are implemented.

Choose a static host the human can maintain through judging. Build/publish dist, configure any repository subpath correctly, and test the deployed page rather than only the local preview. External publication needs the human's chosen destination and authorization; prepare everything else in advance.

## First response and first action

Say that you will establish the shared bootstrap first, inspect the available workspace, and begin setup. Ask only for necessary missing location/access. Your first milestone response must include the complete BOOTSTRAP READY handoff, not just a proposed directory tree. Once ready, continue CPU/state/tests work while the other accounts implement their modules.

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
