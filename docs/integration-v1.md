# Integration v1 — renderer and core combined

## Current shared baseline

This merge combines existing team main `2746fb1a2ab1142e1ab35c1d5392ec2e7e96855a` with AI 3's core checkpoint `6bc55c380399ede851ee5cbcd8cf9dbdf21555c2`. Both histories are retained rather than replacing main with the unrelated core history. The exact integrated commit is the merge commit delivered to main; both feature owners must fetch and update from that same commit before their next handoff.

`bootstrap-v1` and `core-v1` remain historical tags. The shared src/contracts.ts is unchanged v1. AI 1's renderer, tests and handoff are unchanged from existing main. AI 2's harness/styles are unchanged from the core checkpoint. Only AI 3-owned integration/config/test/documentation files were adapted.

## Resolved AI 1 requests

- The real shared contract, build system, CPU math and main wiring are now present with the real renderer, not a second throwing stub.
- CPU plane normals are normalized, matching renderer packing. Material counts are validated before tracing; no uMaterialCount shader uniform is required by the CPU.
- The existing optional debug renderer surface is used only by integration tests for RGBA8 object/material IDs and oriented normals. No public ViewMode values were added.
- Sampled comparison uses the original authored preset, not the earlier mostly-black minimal fixture: 630 CPU/GPU checks passed across DPR 1/2, center/corners, resize, edits and diagnostic modes on SwiftShader.
- The supplied renderer runners are wired to `npm run test:renderer` with locked esbuild 0.28.2. Node tests run separately because renderer.test.ts is browser-only. All sources remain covered by typecheck.
- The pre-bootstrap placeholder generator is no longer used by the app or documented install workflow; src/contracts.ts is tracked and is not ignored. AI 1 should remove its now-obsolete placeholder helper/type mirror in its own follow-up rather than AI 3 editing renderer-owned files.

## Semantic clarification still to coordinate with AI 2

CPU `TraceEvent.shadow.toLight` stores normalized L from `shadow.from = P + EPS*N` toward the light (zero only when light and origin coincide). The actual endpoint is `view.scene.light.position`. Use that endpoint for diagram geometry, and L/nDotL for explanation. Do not silently interpret toLight as a position.

## Remaining owner handoffs

AI 1: review CPU reflection/normal code as the requested owner cross-review; report hardware/other-browser parity differences. Existing hardware renderer tests passed on ANGLE Metal / Apple M1, but the integrated parity run used SwiftShader.

AI 2: supply the real controls and separate diagram, keyboard pixel selection, first-hit diagnostic labels, meaningful status/limitations and actual first-user feedback. Use real inspection events. Keep canvasHost empty at mount and free of padding/border; main owns/replaces only its image canvas.

Authoritative control limits remain in src/scene/preset.ts: targetX −2.8…−1.6, lightX −4…4, yaw −15°…15°, redirects 0…4. At 640×360, the default computed example is (286,180), hitting mirror then target; at fallback 160×90 it is (71,45). The default reflected target point is ambient-only, not directly lit. At lightX=+4 the low-resolution example becomes directly lit.

For the next integration, review/import owned changes only, update browser selectors for the real UI instead of imposing the harness DOM, and run `npm run check`, `npm run test:renderer`, and `npm run test:browser`. No v2 glass or external deployment is authorized by this merge.
