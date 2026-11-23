# AI 1 handoff — image renderer

Owner: AI 1 (graphics). Owned paths: `src/render/**`, `tests/render/**`, this file.

---

## Checkpoint 1 — renderer core complete, pre-bootstrap

**1. Branch, commit, base, contract version**

| | |
|---|---|
| Branch | `feature/renderer` |
| Base commit | `88bafb2` (`Add files via upload`) — the repository tip |
| Contract version | v1, transcribed from the AI 1 brief |
| Bootstrap commit | **NOT AVAILABLE.** See the blocking issue below. |

**The repository contains no bootstrap.** At `88bafb2` there is no `package.json`,
no `src/`, no `src/contracts.ts`, no build or test configuration — only the four
planning documents and a ZIP. The brief instructs AI 1 to branch from AI 3's
bootstrap commit and consume their committed `src/contracts.ts`. That commit does
not exist yet.

Rather than stall, the renderer was built against the contract v1 text quoted in
the brief, and a clearly-labelled type-only placeholder was used so the module
could be compiled and tested. Details under *Dependencies and requests*.

**2. Changed files**

```
src/render/index.ts                   createRenderer, draw, lifecycle
src/render/gl.ts                      context, compile, link, error reporting
src/render/uniforms.ts                validation and flat uniform packing
src/render/constants.ts               EPS, FAR, capacities, enum codes
src/render/shaders/fullscreen.vert.ts covering triangle
src/render/shaders/trace.frag.ts      the tracer
tests/render/renderer.test.ts         26 checks
tests/render/fixtures.ts              hand-derivable scenes
tests/render/harness.ts               assertions, pixel reads, independent colour maths
tests/render/entry.ts                 browser entry, records the real GPU
tests/render/run.mjs                  headless Chrome GPU runner
tests/render/capture.mjs              PNG evidence capture
tests/render/capture-entry.ts         capture fixtures
tests/render/contract-v1.types.ts     TEMPORARY contract mirror, see below
tests/render/prepare-contracts.mjs    pre-bootstrap shim
.gitignore                            ignores the generated placeholder + captures
```

No dependency or configuration change is requested. `esbuild` is used by the test
runner only and is installed transiently with `npm i --no-save`; AI 3 owns the
real manifest and should fold this runner into the project's own tooling.

**3. Working behaviour**

- WebGL2 context creation with actionable failure messages; `ShaderCompileError`
  quotes the offending source lines, not just a driver line number.
- Perspective camera rays built from AI 3's supplied `CameraBasis`. The renderer
  deliberately does **not** recompute the basis from position/target — deriving it
  twice is how CPU and GPU drift apart.
- Analytic sphere and plane intersection, nearest-hit with the contract's
  tie rule (equal `t` resolves to the earlier array entry).
- Matte shading exactly per the contract formula, hard shadows with blockers
  tested strictly between surface and light.
- Bounded mirror loop, 0–4 redirects, no recursion. Real secondary intersections.
- `beauty` / `hit` / `albedo` view modes with the contract's distinct colour
  pipelines (Reinhard+sRGB / none / sRGB only).
- Context loss and restoration rebuild all GPU resources; `dispose` is idempotent.
- Scene validation rejects bad material indices, non-finite values, >8 objects,
  and `glass` while the contract is at v1.

**4. Checks actually run**

`node tests/render/run.mjs` — **26 of 26 passed.**

Executed in headless Google Chrome against real hardware:

```
Google Inc. (Apple) / ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)
WebGL2: yes
```

This is a genuine GPU path, not SwiftShader. Coverage: compile/link success and
failure reporting, empty-scene sky gradient, sphere outside/tangent/inside/miss,
normal orientation outside and inside, plane hit/parallel/behind, nearest-hit and
exact ties, the matte formula to ±3/255 of an independently computed expectation,
shadow blocker before vs beyond the light, back-facing surfaces, mirror showing
real reflected geometry, reflection tracking a moved object, mirror
self-intersection, redirect budget 0 and parallel mirrors, deeper budgets,
all three view modes, image orientation, aspect ratio, resize, uniform packing
validation, context loss/restore, and dispose.

Two findings during this work, both now fixed and both worth recording:

- The renderer's own missing-uniform link guard caught `uMaterialCount` being
  uploaded but never read, so the driver stripped it. The uniform was removed;
  material-index validity is enforced CPU-side in `packScene`. The guard did
  exactly its job.
- Two test expectations were wrong, not the renderer: a shadow probe aimed down
  the Y axis hit the blocker sphere instead of the floor, and an aspect-ratio
  fixture placed a sphere at x=1.6 which is inside the 1:1 frustum at z=2. Both
  were re-derived by hand and corrected. Flagged here because a test that is
  adjusted until it passes is worthless; these were verified against the maths
  before being changed.

Visual evidence: `node tests/render/capture.mjs` writes seven 640×360 PNGs to
`tests/render/captures/` (git-ignored). Reviewed by eye: the mirror sphere shows
the coloured walls, the floor, and the target sphere's reflection; both spheres
cast hard shadows; moving the target moves its reflection; `maxRedirects: 0`
renders the mirror black while matte surfaces still shade correctly.

**5. Checks NOT run**

- **No browser other than Chrome.** Safari and Firefox are unverified. ANGLE's
  Metal backend is the only implementation this has touched.
- **No second physical device**, no mobile GPU, no integrated/discrete Intel or
  AMD path.
- **No frame-rate measurement.** No performance claim is made at any resolution.
- **No CPU/GPU parity comparison**, because AI 3's reference tracer does not
  exist yet. The suite publishes five off-silhouette sample pixels for that
  comparison when it becomes possible (see below).
- **Not integrated with a real page.** `src/main.ts` and `src/ui/**` do not exist.
  The renderer has never been driven by the real store or UI.
- No typecheck against AI 3's real `src/contracts.ts` — see the blocker.

**6. Next integration action, and questions for other owners**

For **AI 3**, in priority order:

1. **Publish the bootstrap.** It is the one thing blocking everyone. Nothing in
   the repository can be built or integrated until `package.json`,
   `src/contracts.ts` and a build command exist.
2. On arrival I will delete the placeholder, rebase onto the bootstrap commit,
   recompile against the real contract, and report any divergence rather than
   quietly patching it.
3. Confirm these two intentional readings of the contract:
   - `uMaterialCount` is not a shader uniform. Material access is only ever
     reached through a confirmed hit, and index validity is a CPU-side
     precondition. Does the reference tracer rely on a count anywhere?
   - A `plane` whose supplied `normal` is not unit length is **normalised during
     packing** rather than rejected. An unnormalised normal silently scales every
     computed `t`, so CPU and GPU must agree on this. Does the reference
     normalise, or should both reject instead?
4. Five CPU/GPU comparison pixels are published on
   `globalThis.__AI1_PIXEL_SAMPLES__` from the `mirrorScene` fixture at 64×36,
   deliberately away from silhouettes where sub-pixel disagreement proves
   nothing. Current GPU values (sRGB bytes, top-left coordinates):

   | pixel | rgb |
   |---|---|
   | 16,9 | 0, 0, 0 |
   | 32,18 | 162, 0, 0 |
   | 48,27 | 0, 0, 0 |
   | 8,30 | 0, 0, 0 |
   | 56,6 | 0, 0, 0 |

   Four of five are black sky in that minimal fixture. Once the authored preset
   exists, these samples should be re-pointed at it so the comparison is
   meaningful across all three channels.
5. The debug shader variant (`createRenderer(..., { debug: true })` plus
   `setDebugMode`) exposes face-forward normals and object/material ids for
   integration tests. It is compiled out of the production program entirely, and
   `setDebugMode` throws if the renderer was not created in debug mode. Confirm
   this is the interface you want before you write tests against it.

For **AI 2**: nothing is blocked on you. The renderer touches only the canvas it
is handed, adds no DOM, and runs no animation loop. AI 3 inserts and manages the
canvas inside your `canvasHost`.

**7. Adapted source and required notices**

Reference: `pkncoder/Light-Teachings` @ `57260fe2a6badbc826271856bbcf6c8a2090de17`,
MIT, Copyright (c) 2025 Kia (Kia Preston). Inspected read-only in a separate
directory; never modified, never a write remote.

No code was copied. The analytic sphere and plane intersections follow the
standard quadratic and plane-equation derivations that the source also uses;
these are textbook forms rather than original authorship, and the provenance is
recorded here for the submission's attribution requirements.

The implementation deliberately **diverges** from the source in six places, each
of which is a defect or a portability hazard identified during review:

| Source behaviour | What this renderer does |
|---|---|
| `raySphere` accepts only `discriminant > 0.0`, dropping exact tangents | accepts `>= 0.0` per contract v1 |
| `rayScene` reads `currentHit.materialIndex` before confirming `currentHit.hit` | every material fetch sits inside a confirmed-hit branch; misses carry `materialIndex = -1` |
| `sceneColoring` computes ambient and shadow data before its final hit test | a miss returns sky immediately |
| reflection restarts the object loop with mutable indices, interleaving traversal and bouncing | each nearest-hit query completes, then one outgoing direction is chosen |
| Euler camera rotation in `Rotations.metal` | explicit camera basis supplied by AI 3 |
| per-frame jitter with no accumulation buffer | one stable sample per pixel, no jitter |

ACES tone mapping from `ToneMapping.metal` was **not** adapted; the contract
specifies Reinhard, which is implemented independently.

---

## Blocking issue — no bootstrap commit

`src/contracts.ts` is owned by AI 3 and does not exist. To avoid stalling, the
renderer branch carries:

- `tests/render/contract-v1.types.ts` — a types-only mirror of the contract v1
  block from the AI 1 brief. Not the contract; AI 3's committed file always wins.
- `tests/render/prepare-contracts.mjs` — writes that mirror to `src/contracts.ts`
  **only when the path is absent**, with a do-not-commit banner. The generated
  file is git-ignored and is never committed on this branch.

The moment the bootstrap lands: delete the generated file, re-run
`node tests/render/run.mjs`, and report any difference between the placeholder
and the real contract as a defect in the placeholder.

## How to run

```bash
node tests/render/prepare-contracts.mjs   # no-op once AI 3's contract exists
npm i --no-save --no-package-lock esbuild # until AI 3 publishes a manifest
node tests/render/run.mjs                 # 26 GPU checks in headless Chrome
node tests/render/capture.mjs             # PNG evidence into tests/render/captures/
```

`CHROME_PATH` overrides browser discovery. `--headful` shows the window.
