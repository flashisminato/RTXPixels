# Verification record — renderer/core merge

## Sources and ownership

The combined checkout joins remote main `2746fb1a2ab1142e1ab35c1d5392ec2e7e96855a` (AI 1's renderer already merged) with AI 3's `integration/core` commit `6bc55c380399ede851ee5cbcd8cf9dbdf21555c2`. Both histories are retained.

Renderer source, renderer tests and AI 1's handoff are byte-for-byte unchanged from the existing main. The real renderer wins the index-file conflict, not AI 3's bootstrap stub. UI/style files and shared contracts are unchanged from AI 3's checkpoint. The existing repository MIT notice is preserved verbatim in README. The obsolete ignore rule for src/contracts.ts is removed; renderer capture ignores are retained.

## Executed checks

Environment: local macOS, Node 26.4.0, npm 11.17.0, installed Chrome 158.0.8127.36.

- `npm run typecheck`: PASS over application and all test sources, including renderer contract conformance.
- `npm test`: **31 passed, 0 failed** (numerical/state/frame/fallback tests in Node).
- `npm run build`: PASS with Vite 8.3.8; the actual renderer is in the production bundle.
- `npm run test:renderer`: **26 GPU checks and 11 production-path smoke checks passed**. The GPU runner reported ANGLE Metal / Apple M1. Production smoke captures composited screenshots rather than reading a discarded default framebuffer.
- `npm run test:browser`: **10 passed, 0 failed**, using headless Chrome / SwiftShader. It always builds fresh production output first.

The renderer's .test.ts file registers tests in a browser-only harness. The original broad Node test glob failed after merging because it tried to import that file as a Node suite. The commands now separate Node tests from browser-only renderer tests without removing either suite. The renderer's requested esbuild dependency is pinned at 0.28.2 in the shared manifest and lockfile; no transient npm install is required.

## Combined application browser coverage

1. Actual production WebGL renderer: nonblank multicolor composited image, real mirror → target CPU inspection and keyboard activation of Reset.
2. Actual renderer with real store actions: light movement changes the displayed image, diagnostic modes use real events, camera/budget edits render, DPR 2 resize fits the host without aspect warnings, normalized selection is recomputed, and reset works after network is disabled.
3. Actual AI 1 diagnostic shader compared with AI 3 reference math: **315 pixel/variant comparisons at DPR 1 and 315 at DPR 2** across three scene states and three host sizes. Includes center/corners, reflected-target examples, beauty, first-hit hit/albedo, RGBA8 object/material IDs and oriented normals. Maximum observed byte difference: **0** on this SwiftShader run. Allowed tolerances remain 3 bytes for beauty, 2 for albedo, 1 for normals, and exact hit/ID outputs; other GPUs are not expected to be bit-identical.
4. Production forced CPU fallback: real image, exact selected pixel/color agreement, pointer selection and reset.
5. Forced fallback at DPR 2: aspect-changing resize, retained selection and offline reset.
6. Instrumented UIActions: all controls, diagnostics, rapid changes, stale-result rejection and invalid input.
7. Injected UI subscriber failure: changed state is not falsely reported as rejected; the stale image is hidden before repainting.
8. Injected compilation failure after a real WebGL2 context is created: image canvas is replaced before Canvas2D is requested.
9. **Actual production renderer** loses its context through WEBGL_lose_context: CPU replacement preserves the host and selection handlers.
10. Injected draw failure: fallback replaces the failed renderer instead of claiming success.

Test-only wrappers and diagnostics are not used by production orchestration. The UI is still the existing harness; driving its captured UIActions is not verification of finished UI controls.

## Findings resolved during integration

- Wrong test environment for renderer tests: separate commands and locked esbuild dependency.
- Bootstrap-dependent fallback assertions: fallback is now explicitly forced; real WebGL application checks were added rather than mislabeling GPU output as CPU output.
- Browser requested a missing favicon.ico: confirmed its URL, then suppressed the unnecessary request using an inline empty favicon in the owned HTML entry.
- Screenshot readback triggers a known GL driver performance notice. Only the specific `GL Driver Message ... GPU stall due to ReadPixels` warning is excluded from application-warning assertions; real GL/application errors and aspect warnings still fail those checks.

The standalone renderer suite intentionally includes mismatched-aspect fixtures and prints warnings for those cases. Correctly sized combined application frames produced no application/aspect warnings.

## Remaining limits

No Safari/Firefox verification, second physical device check, full keyboard pixel selection, finished AI 2 diagram/control assessment, human first-user study, live hosting/subpath verification, or organizer/deadline check. Sampled parity is not exhaustive proof for every pixel/scene/driver. Main stays on CPU after context loss until reload, even though the standalone renderer can restore its context. No deployment or change in repository visibility is part of this merge.
