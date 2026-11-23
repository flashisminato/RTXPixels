# AI 1 handoff — image renderer

Owner: AI 1 (graphics). Owned paths: `src/render/**`, `tests/render/**`, this file.

## Checkpoint 3 — INTEGRATED ON core-v1, CPU/GPU PARITY VERIFIED

### 1. Branch, commits, contract

| | |
|---|---|
| Branch | `feature/renderer-core` |
| Base | `6bc55c3` = tag `core-v1` (AI 3's `integration/core`) |
| Contract | v1, unchanged. AI 3's `src/contracts.ts` is used as-is. |

This branch contains **only AI 1-owned paths** on top of `core-v1`. It replaces AI 3's
renderer stub, exactly as the bootstrap intended. Merging it is a normal merge.

**Superseded:** the older `feature/renderer` (`d2f13c1`) was built before the bootstrap
existed, on a different root commit. It was merged into `main` by PR #1. Note that
`main` and `integration/core` currently share **no common ancestor**; how the two
histories are joined is the integrator's decision (see §5).

### 2. Changed files, dependencies, configuration

```
src/render/index.ts                 createRenderer: lifecycle, draw, aspect check
src/render/gl.ts                    context, compile/link, readable errors
src/render/uniforms.ts              validation and explicit uniform packing
src/render/constants.ts             re-exports contract constants + GPU codes
src/render/shaders/trace.frag.ts    the tracer (GLSL ES 3.00)
src/render/shaders/fullscreen.vert.ts
tests/render/uniforms.test.ts       Node unit suite, runs in `npm test` / CI
tests/render/conformance.ts         compile-time pin of the 2-arg contract signature
tests/render/gpu.browser.mjs        browser suite (Vite dev + playwright-core)
tests/render/renderer.gpu.ts        26 hand-derived GPU checks
tests/render/{gpu,smoke,capture}.html + *-entry.ts, harness.ts, fixtures.ts, png.mjs
docs/handoffs/ai1.md
```

**No dependency or config change.** The browser suite uses the project's own Vite and
`playwright-core`. The earlier esbuild runner and the pre-bootstrap contract
placeholder were deleted. Artifacts go to `test-results/render/`, already ignored.

Optional request: a script `"test:render": "node --test tests/render/gpu.browser.mjs"`.

### 3. Working behaviour

WebGL2 renderer behind `createRenderer(canvas, hooks).draw(frame)`. It handles spheres
and planes, nearest hit with the contract tie rule, matte shading, hard shadows,
perfect mirrors with a 0–4 redirect budget, and the beauty/hit/albedo modes with their
distinct colour pipelines. It also covers context loss and restore, idempotent
dispose, and scene validation that rejects bad input before upload. It uses AI 3's
camera basis verbatim and never derives its own.

In the integrated app: `main.ts` reaches `ready: WebGL frame drawn` at 640×360,
at both DPR 1 and 2, with zero renderer warnings.

### 4. Checks actually run

Node 26.4.0 / npm 11.17.0 (matches `.nvmrc`), macOS, headless Chrome 158.

| Check | Result |
|---|---|
| `npm run check` (= CI: typecheck, unit, build) | **38/38** (AI 3's 31 + 7 renderer), typecheck and build pass |
| `node --test tests/render/gpu.browser.mjs` | **16/16** across both implementations below |
| GPU implementations | ANGLE **Metal, Apple M5** (hardware) and **SwiftShader** (software) |

The browser suite includes:

- **Full-frame CPU/GPU parity inside the real app.** Every pixel of the WebGL image
  is compared against AI 3's CPU tracer in 15 control states: all view modes, mirror
  and matte, redirects 0/1/4, and every slider at both extremes. That's 230,400 px
  per state, on both implementations. **Max difference: 1/255. Edge mismatches: 0.**
- **Production screenshot parity.** The production renderer is untouched, and its
  composited screenshot is compared against the CPU. This is what a visitor actually
  sees. Max difference: 1/255.
- **Mutation-tested.** A half-pixel camera offset and a broken shadow test were both
  injected deliberately, and both failed the parity check on the first frame. A 2%
  tone-curve error was *not* caught, which is correct: it changes output by at most
  about 1 byte, below 8-bit precision.
- The 26 hand-derived checks, production-path smoke, a PNG-decoder self-test, and
  evidence captures.

**Frame cost** at 640×360, worst case (mirror, 4 redirects). These are synchronous
upper bounds (draw plus forced GPU finish, 120 frames):

| Implementation | median | p95 |
|---|---|---|
| Apple M5 (Metal) | 0.4 ms | ≤ 1.8 ms |
| SwiftShader (software) | 6.1 ms | ≤ 8.5 ms |

**Not run:** Safari, Firefox, mobile GPUs, a second physical device, AI 2's real UI
(still AI 3's stub), and a deployed URL.

### 5. Next integration actions and precise requests

**For AI 3:**

1. **Merge `feature/renderer-core` into `integration/core`.** It touches AI 1 paths only.
2. **Your browser smoke needs a 16-line change after the merge.** Tests 1–4 wait for the CPU
   fallback, which only happened because the stub threw. With the real renderer the
   app correctly goes `ready`, and they time out. I measured **3/7 passing**. The patch
   below disables WebGL2 inside those four pages. That works for the bundled preview,
   where module routes can't intercept `src/render`, and it exercises the genuine
   "no WebGL2" fallback through the renderer's `ContextCreationError`. I applied it,
   **verified 7/7**, and reverted it; it's your file to commit.

   ```diff
   @@ after `const waitFallback = ...`
   +async function forceCpu(page) {
   +  await page.addInitScript(() => {
   +    const original = HTMLCanvasElement.prototype.getContext;
   +    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
   +      return type === 'webgl2' ? null : original.call(this, type, ...rest);
   +    };
   +  });
   +}
   @@ first line inside withPage(...) of tests 1, 2, 3 and 4
   +    await forceCpu(page);
   @@ test 1
   -    assert.match(await page.locator('[role=status]').textContent(), /awaiting AI 1/);
   +    assert.match(await page.locator('[role=status]').textContent(), /Could not create a WebGL2 context/);
   ```

3. **Decide one shadow rule (contract owner's call).** CPU counts a blocker at
   `t < distance`; the GPU uses `t < distance − EPS`, following the plan's pseudocode.
   They differ only if a surface is within 1e-4 of the light. Current control ranges
   never produce that, which is why parity is exact. Tell me which to adopt and I'll
   align the shader if needed.
4. **Your clarification, confirmed:** the GPU also uses normalized `L`. The endpoint is
   `scene.light.position`.
5. **Your cross-review request (CPU reflection and normals):** reviewed line by line
   against the shader. Camera ray, sphere roots including inside/tangent, the tie rule,
   plane normalization, face-forward normals, `reflect` and `P + EPS·N` offsets, the
   budget rule, the matte formula, diagnostic modes and encodings all agree. **No
   defects found.** Full-frame parity independently confirms it.
6. **Scene observation, not a defect.** The dark ring around the mirror's upper edge is
   the mirror reflecting the back wall at **y ≈ 11.8**. The wall is an infinite plane,
   and inverse-square falloff makes it dark that far from the light. Traced with your
   `traceRay`: `(320,128)` → mirror → back-wall `(0.12, 11.78, 5)`. Worth one line in
   AI 2's explanation, or a ceiling plane in the preset.
7. **History:** `main` (with old PR #1) and `integration/core` have unrelated roots.
   Please decide how to join them before the next merge to `main`.

**For AI 2:** nothing blocks you. The renderer only touches the canvas it's given. If
you ever see `[renderer] … will stretch` in the console, the canvas CSS box and the
drawing buffer have different aspect ratios.

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

**Checkpoint 1** (`4b6fc45`, pre-bootstrap) and **checkpoint 2** (`d2f13c1`). These built
and verified the renderer against a transcribed contract before any bootstrap existed.
Checkpoint 2 found that the production two-argument path had never drawn a frame, and
added screenshot-based verification.

**Self-review at checkpoint 3** found four defects in that earlier work, all fixed here:

1. If WebGL2 creation failed, the WebGL1 probe ran **on the real canvas**, binding a
   second context type. That breaks the contract rule the CPU fallback relies on. It
   now probes a throwaway canvas.
2. The aspect check ran **before** resizing, so it compared against the previous
   frame's layout. It produced four false stretch warnings in the GPU suite, which
   went unnoticed because only PASS/FAIL lines were read. It now runs after the
   resize, with a tolerance matching `fitBuffer`'s documented "within one pixel".
3. "Higher redirect budgets reveal deeper reflections" asserted black for **both**
   budgets, so it could never fail. It's replaced by a hand-derived two-mirror
   periscope: budgets 0 and 1 give black, budget 2 gives red 148.
4. The smoke "image changed" check compared PNG **byte sizes**. It now decodes and
   compares pixels.

Also fixed: if the first shader compile threw, the context-loss listeners stayed
attached to the canvas. Two new unit assertions of mine initially matched comment
text instead of declarations, and the recursion check tested ordering rather than
recursion. Both were corrected, and the recursion check now has a test proving it
can fail.
