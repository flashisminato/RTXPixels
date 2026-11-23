# AI 3 — CPU / INTEGRATION READY

## 1. Branch, commits, contract

Work branch: `integration/core`; local `main` is fast-forwarded to the completed checkpoint. Exact current commit: `git rev-parse core-v1` (the tag is created after this commit; the portable delivery report includes its full hash).

Base/main used: **3cf5dcdd1e13331e547f9e59014572e645ce0af3**, tag `bootstrap-v1`. Contract **v1 unchanged**. No team remote, push, publication or deployment.

## 2. Changed files / configuration

Implemented `src/core/index.ts`, `src/core/vector.ts`, `src/core/frame.ts`, `src/state/index.ts`, `src/state/validation.ts`, `src/fallback/index.ts` and `src/main.ts`. Added numerical/state/frame/fallback tests and browser smoke checks. Updated README, public credits, and AI 3 documentation.

Added dev-only `playwright-core` **1.65.1** and its lockfile entries for installed-Chrome smoke checks. `npm test` discovers all tests/**/*.test.ts (including future owned suites); `npm run test:browser` always builds fresh output first. No UI/graphics framework, browser download, production dependency, server service or API key.

**No edits** to `src/contracts.ts`, `src/render/**`, `src/ui/**` or `src/styles/**` since bootstrap. No feature branch has been imported because none was supplied.

## 3. Working behavior / remaining failures

Real CPU room rendering at an aspect-preserving cap of 160×90; exact sphere/plane intersections, matte point lighting and hard shadows; untinted perfect mirrors; bounded redirect events; first-hit hit/albedo modes; correct display conversion. One shared math implementation produces inspector events and event-free bulk colors.

Validated immutable state, monotonic versions, reset, coalesced dirty rendering, normalized selection after resize, stale-work rejection, cancelable CPU chunks, and image-canvas replacement after graphics failure. The deterministic default search finds real mirror → target hits at (71,45) for 160×90 and (286,180) for 640×360.

Remaining: renderer stub intentionally throws; full AI 2 UI/diagram/keyboard pixel selection is absent. CPU fallback is the actual displayed image, not a fake GPU success. A lost graphics context stays on CPU until reload. GPU parity and human feedback are not verified.

## 4. Executed checks and limits

Environment: Node **26.4.0**, npm **11.17.0**, macOS, headless Chrome **158.0.8127.36**.

- `npm ci`: PASS; zero audit findings at execution. Optional fsevents install-script approval warning remained; no approval was granted.
- `npm run typecheck`: PASS.
- `npm test`: **31 passed, 0 failed**.
- `npm run build`: PASS.
- `npm run test:browser`: **7 passed, 0 failed**, including real production CPU image/pixel parity, isolated context, high DPI, resize, offline reset, instrumented controls/diagnostics, stale work, UI error handling, post-WebGL-creation fallback, real context-loss extension and draw-failure fallback.
- `git diff --check`: PASS; ownership diff checked.

Lifecycle tests use test-only renderer modules with software WebGL. They do not verify AI 1's shaders. Full real UI, keyboard pixel selection, another physical device/browser, public URL, deployed subpath and organizer rules/deadline were not verified. Screenshot capture succeeded; visual review was unavailable through the image reader.

## 5. Next integration / precise requests

Give both accounts the same bootstrap, then have both update from this same integration checkpoint before their next handoff. Return owned-file patches/branches, not full-app overwrites. See `docs/integration-v1.md`.

AI 1: provide the real renderer and diagnostic readback tests; cross-review CPU reflection/normals. AI 2: provide real controls/diagram/events and first-user feedback; respect exported control limits. Clarification to confirm: CPU `shadow.toLight` is normalized L, not an endpoint; the endpoint is scene.light.position.

Human decisions still needed before external delivery: new team remote, maintained static-host destination/authorization, organizer/event and live deadline. Local implementation is not blocked by their absence.

Run commands: `npm ci`, `npm run dev`, `npm run check`, `npm run preview`, `npm run test:browser`. Set CHROME_PATH only when Chrome is not at its standard installation. TypeScript tests run without Chrome.

## 6. Adapted sources / notices

No upstream source/functions copied or adapted by AI 3. Original scene and CPU/integration code implement the supplied mathematical brief. Inspiration and Kia Preston credit are preserved. Incoming substantial adaptations require exact source/function/commit records and the complete original MIT notice. Contribution and AI-use limits are documented; absent team work is not claimed.
