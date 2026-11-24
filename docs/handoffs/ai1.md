# AI 1 handoff — image renderer

Owner: AI 1 (graphics). Owned paths: `src/render/**`, `tests/render/**`, this file.

## Checkpoint 4 — AI 2's interface verified with the current renderer

`main` @ `d115387` (with PR #2) was run from a clean checkout, both as-is and merged
with this branch. The merge is clean and changes no AI 2 file. The committed merge
tree `32764b3` is byte-identical to the tree tested below.

| Check (main + this branch) | Result |
|---|---|
| `npm run check` | pass: typecheck, 31/31, build |
| All unit suites: `tests/{core,integration,render,ui}/*.test.ts` | **45/45** |
| `npm run test:renderer` (against AI 2's real UI) | **16/16** on ANGLE Metal (M5) and SwiftShader; full-frame parity max 1/255 |
| `npm run test:browser` (AI 3) | **7/10**, all 3 failures from one cause (below) |
| Real-control journey, dev **and** production preview | 0 failures: every slider, radio, disclosure, click, arrow key and Reset updates image, inspector and diagram; phone width 390 has no overflow; zero app console warnings |

The explanation was spot-checked against raw trace vectors at pixel (286,179). Incidence
and reflection are both 36.81°, coplanar to 1e-17. The "surface does not face the light"
copy matches `nDotL = 0`, blocked by `target`.

**Requests for AI 3:**

1. **Off-by-one buffer height in `fitBuffer` (`src/core/frame.ts`).** AI 2's host is
   correctly `aspect-ratio: 16 / 9`, but browsers lay out in 1/64 px, so it measures
   675.515625×379.96875. Scaled, the height is 359.9917, and `Math.floor` drops 0.99 px,
   giving 640×359 (and 160×89 in fallback). That is *further* from the host aspect than
   640×360, it fails your three `[640, 360]` assertions, and the UI copy shows
   "a 640×359 picture". Fix: `Math.round` instead of `Math.floor` for both dimensions.
   It cannot exceed the cap, because `factor ≤ max/css`. Verified on `main` and on
   `main` + this branch: `test:browser` **10/10**, `npm test` 31/31.
2. **CI runs neither the UI tests nor the renderer unit tests.** Use
   `"test": "node --test \"tests/core/*.test.ts\" \"tests/integration/*.test.ts\" \"tests/render/*.test.ts\" \"tests/ui/*.test.ts\""`
   (verified 45/45).
3. Fast-forward `main` to this branch. It contains `main` @ `d115387`.

## Checkpoint 3 — INTEGRATED, MERGED WITH main, CPU/GPU PARITY VERIFIED

### 1. Branch, commits, contract

| | |
|---|---|
| Branch | `feature/renderer-core` |
| Built on | `6bc55c3` = tag `core-v1` |
| Merged with | `main` @ `d115387` (PR #2, AI 2's interface) |
| Contract | v1, unchanged; AI 3's `src/contracts.ts` used as-is |

`main` is an ancestor of this branch, so **merging it into `main` is a fast-forward.**
Relative to `main`, it changes **only AI 1-owned paths**. That was checked
mechanically against `git diff origin/main`.

The merge conflicts were all inside AI 1 paths: `main` held my checkpoint-2 files and
this branch holds their replacements. Before resolving, I verified that every one of
those 12 files on `main` was byte-identical to my old commit `d2f13c1`. AI 3 had
changed none of them, so taking the new versions drops nothing of AI 3's.

The older `feature/renderer` branch is superseded by this one.

### 2. Changed files, dependencies, configuration

```
src/render/index.ts                 createRenderer: lifecycle, draw, aspect check
src/render/gl.ts                    context, compile/link, readable errors
src/render/uniforms.ts              validation and explicit uniform packing
src/render/constants.ts             re-exports contract constants + GPU codes
src/render/shaders/trace.frag.ts    the tracer (GLSL ES 3.00)
src/render/shaders/fullscreen.vert.ts
tests/render/uniforms.test.ts       Node unit suite (packing, validation, shader gen)
tests/render/conformance.ts         compile-time pin of the 2-arg contract signature
tests/render/gpu.browser.mjs        browser suite (project Vite + playwright-core)
tests/render/renderer.gpu.ts        26 hand-derived GPU checks
tests/render/run.mjs, smoke.mjs     delegators, so `npm run test:renderer` still works
tests/render/{gpu,smoke,capture}.html + *-entry.ts, harness.ts, fixtures.ts, png.mjs
docs/handoffs/ai1.md
```

Removed (obsolete): `renderer.test.ts` (renamed to `renderer.gpu.ts`, so Node's
`*.test.ts` glob can't run a browser-only file), `capture.mjs` (folded into the
suite), and the pre-bootstrap placeholder `contract-v1.types.ts` /
`prepare-contracts.mjs`.

**No dependency or config change.** Your existing `test:renderer` script works
unchanged: `run.mjs` and `smoke.mjs` now delegate to the new suite as two
non-overlapping halves, 6 + 10 = all 16 checks, each run once.

### 3. Working behaviour

WebGL2 renderer behind `createRenderer(canvas, hooks).draw(frame)`. It handles spheres
and planes, nearest hit with the tie rule, matte shading, hard shadows, perfect mirrors
with a 0–4 redirect budget, and the beauty/hit/albedo modes with their distinct colour
pipelines. It also covers context loss and restore, idempotent dispose, validation
before upload, and your camera basis used verbatim.

The debug API your `gpu-parity.ts` uses is unchanged: `{ debug, preserveDrawingBuffer }`,
`setDebugMode`, `DEBUG_OFF / DEBUG_NORMAL / DEBUG_IDS`, `.gl`, and the same ID and normal
encodings.

### 4. Checks actually run (on the merged tree)

Node 26.4.0 / npm 11.17.0 (matches `.nvmrc`), macOS, headless Chrome 158, after `npm ci`.

| Check | Result |
|---|---|
| `npm run check` (= CI) | pass: typecheck, **31/31**, build. The renderer's unit tests are not in your glob; see §5 |
| Your glob + `"tests/render/*.test.ts"` | **38/38** |
| `npm run test:browser` (yours, with the real renderer) | **10/10**. Your parity check: **max byte difference 0**, DPR 1 and 2 |
| `npm run test:renderer` | **16/16**, on ANGLE **Metal (Apple M5)** and **SwiftShader** |

The renderer suite includes:

- **Full-frame CPU/GPU parity inside the real app.** Every pixel is compared against
  your CPU tracer in 15 control states: every view mode, mirror and matte, redirects
  0/1/4, and every slider at both extremes. That's 230,400 px per state, on both
  implementations. **Max difference 1/255, zero edge mismatches.**
- **Production screenshot parity.** The renderer is untouched, and its composited
  screenshot is compared against the CPU. This is what a visitor sees. Max 1/255.
- **Mutation-tested.** A deliberate half-pixel camera offset and a deliberately broken
  shadow test both fail on the first frame. The edge allowance (0.05%) was calibrated
  from those mutations.
- **Frame cost** at 640×360, worst case (mirror, 4 redirects). These are synchronous
  upper bounds: M5 median **0.4 ms**, p95 ≤ 1.8 ms; SwiftShader median **6.1 ms**,
  p95 ≤ 8.5 ms.

**Not run:** Safari, Firefox, mobile GPUs, a second physical device, AI 2's real UI
(still your stub), and a deployed URL.

### 5. Next integration actions and precise requests

**For AI 3:**

1. **Fast-forward `main` to `feature/renderer-core`.**
2. **Widen `npm test` so CI runs the renderer's unit tests:**
   `"test": "node --test \"tests/core/*.test.ts\" \"tests/integration/*.test.ts\" \"tests/render/*.test.ts\""`.
   You excluded `tests/render` because my old browser-only file was named `*.test.ts`.
   It's renamed now, and I verified this exact command at 38/38.
3. Optional cleanups in your files:
   - `test:renderer` could become `node --test tests/render/gpu.browser.mjs`, after
     which I'll delete the two delegators.
   - `esbuild` is no longer used by the renderer tests.
   - `.gitignore`'s `/tests/render/captures/` line and its `capture.mjs` comment are
     obsolete; artifacts now go to `test-results/render/`.
4. **Decide one shadow rule (contract owner's call).** CPU counts a blocker at
   `t < distance`; the GPU uses `t < distance − EPS`, following the plan's pseudocode.
   They differ only if a surface lies within 1e-4 of the light. Current control
   ranges never produce that, which is why parity is exact. Tell me which to adopt.
5. **Your clarification, confirmed:** the GPU also uses normalized `L`. The endpoint is
   `scene.light.position`.
6. **Your cross-review request (CPU reflection and normals):** reviewed line by line
   against the shader. Camera ray, sphere roots including inside/tangent, the tie rule,
   plane normalization, face-forward normals, `reflect` and `P + EPS·N`, the budget
   rule, the matte formula, diagnostic modes and encodings all agree. **No defects
   found.** Full-frame parity and your own parity check both confirm it.
7. **Scene observation, not a defect.** The dark ring around the mirror's upper edge is
   the mirror reflecting the back wall at **y ≈ 11.8**. The wall is an infinite plane,
   dark that far from the light. Traced with your `traceRay`: `(320,128)` → mirror →
   back-wall `(0.12, 11.78, 5)`. Worth a line in AI 2's explanation, or a ceiling
   plane in the preset.

Resolved since my last report: your browser smoke had already independently adopted
the same "disable WebGL2 in the page" approach I was about to propose (`forceFallback`),
and your merge at `484a761` joined the two histories.

**For AI 2:** nothing blocks you. The renderer only touches the canvas it's given. A
console message `[renderer] … will stretch` means the canvas CSS box and the drawing
buffer have different aspect ratios.

### 6. Adapted source and notices

Reference: `pkncoder/Light-Teachings` @ `57260fe2a6badbc826271856bbcf6c8a2090de17`,
MIT, Copyright (c) 2025 Kia (Kia Preston). Inspected read-only; never modified or used
as a remote. **No code copied.** The sphere and plane intersections are textbook
quadratic and plane-equation forms, which the source also uses. Deliberate divergences
from defects in the source:

| Source behaviour | This renderer |
|---|---|
| `raySphere` accepts only `discriminant > 0`, dropping tangents | accepts `>= 0` |
| `rayScene` reads `materialIndex` before confirming a hit | material read only after a confirmed hit |
| `sceneColoring` shades before its final hit test | a miss returns sky immediately |
| reflection restarts the object loop mid-traversal | each nearest-hit query completes, then redirects |
| Euler camera rotation | explicit camera basis from AI 3 |
| per-frame jitter with no accumulation | one stable sample per pixel |

ACES tone mapping was not adapted. The contract specifies Reinhard, implemented independently.

---

## History

**Checkpoints 1–2** (`4b6fc45`, `d2f13c1`). These built and verified the renderer
before any bootstrap existed, against a transcribed contract that later proved
identical to the real one. Checkpoint 2 found that the production two-argument path
had never drawn a frame, and added screenshot verification.

**Self-review at checkpoint 3** found four defects in that earlier work, all fixed:

1. If WebGL2 creation failed, the WebGL1 probe ran **on the real canvas**, binding a
   second context type. That breaks the rule the CPU fallback relies on. It now
   probes a throwaway canvas.
2. The aspect check ran **before** resizing, so it compared against the previous
   frame's layout and gave four false warnings in the GPU suite, unnoticed because
   only PASS/FAIL lines were read. It now runs after the resize, with `fitBuffer`'s
   one-pixel tolerance.
3. A redirect-budget test asserted black for **both** budgets and could not fail. It's
   replaced by a hand-derived two-mirror periscope: budgets 0 and 1 give black,
   budget 2 gives red 148.
4. The smoke "image changed" check compared PNG **byte sizes**. It now decodes and
   compares pixels.

Also fixed: listeners left attached if the first shader compile threw. Two new unit
assertions initially matched comment text instead of declarations, and the recursion
check tested ordering rather than recursion. Both were corrected, and the recursion
check has a test proving it can fail.
