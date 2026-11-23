# AI 3 — renderer/core merge into team main

## 1. Branch, commits and contract

Prepared in a separate `integration/combined` worktree for delivery to `flashisminato/Ray-Tracking` **main**, explicitly authorized by the human. Both histories are preserved in the merge.

- Existing team main: **2746fb1a2ab1142e1ab35c1d5392ec2e7e96855a** (AI 1's renderer already merged).
- AI 3 source branch: **integration/core**, commit **6bc55c380399ede851ee5cbcd8cf9dbdf21555c2**.
- Shared bootstrap: **3cf5dcdd1e13331e547f9e59014572e645ce0af3**, tag bootstrap-v1.
- Contract: **v1 unchanged**. Historical core-v1 still points to the pre-merge CPU checkpoint; it was not moved.

The exact resulting merge commit is identified in the delivery message and main history. After fetching, both feature owners must update their branches from that same integrated main commit, not from the old independent histories.

## 2. Changes and conflict resolution

- Selected the existing main version of src/render/index.ts, preserving the real renderer instead of the bootstrap throwing stub.
- Imported AI 3's committed core/state/preset/fallback/main, contracts, build/runtime/CI setup, tests and documentation.
- Combined .gitignore rules; removed the pre-bootstrap rule ignoring src/contracts.ts. Preserved the existing repository MIT notice verbatim in README.
- Kept all renderer source/tests/AI 1 handoff unchanged, and all UI/style files/shared types unchanged from the core checkpoint.
- Separated browser-only renderer tests from Node tests. Added `npm run test:renderer` and pinned its requested dev-only esbuild dependency at **0.28.2**. No transient install, stack change or runtime service.
- Updated owned integration browser tests: real production renderer checks, explicit forced-fallback checks, real renderer context loss and sampled CPU/GPU parity. Added tests/integration/gpu-parity.ts, using AI 1's existing debug interface without changing public contracts.
- Added an inline empty favicon to the owned HTML entry after reproducing an unnecessary favicon.ico 404. Updated AI 3 documentation and public limitations to match actual integration.

## 3. Working behavior and remaining limits

The actual WebGL2 renderer now uses the same scene snapshot, camera basis, drawing-buffer dimensions and options as CPU inspection. Target/light/camera actions, first-hit diagnostics and redirect budgets drive the real renderer through the store. The existing harness exposes real computed pixel selection, mirror examples and reset; full AI 2 controls/diagram/keyboard pixel selection remain absent.

Production rendering is capped at 640×360 and fitted to host aspect. Real WebGL loss switches to a replaced 160×90-or-aspect-fitted CPU canvas while preserving host listeners. The app stays on CPU until reload after a context loss. Computation works offline after page load.

Not a final release: AI 2's interface, human feedback, remaining owner cross-reviews, other browsers/physical devices, public deployment and organizer/deadline verification are still pending.

## 4. Checks actually run

Local macOS, Node 26.4.0, npm 11.17.0, Chrome 158.0.8127.36.

- Typecheck of application and all tests: PASS.
- `npm test`: **31 passed**.
- Production build: PASS.
- `npm run test:renderer`: **26 renderer checks + 11 production-path checks passed**; GPU runner reported ANGLE Metal / Apple M1.
- `npm run test:browser`: **10 passed**, running the combined app in headless Chrome / SwiftShader.
- Included **630 sampled CPU/GPU pixel/diagnostic comparisons**, 315 each at DPR 1/2, across scene edits and resizes, including center/corners, mirrors, beauty, first-hit modes, IDs and normals. Observed maximum byte difference was 0 on SwiftShader; tolerances remain explicit and other devices are not claimed bit-identical.

See docs/verification.md for exact coverage and instrumentation. Renderer smoke includes deliberate aspect-mismatch fixtures; those warnings are expected. Combined app tests reject unexpected application/aspect warnings, excluding only the identified screenshot-readback driver performance notice. No page error is accepted.

## 5. Next integration and owner requests

Both feature accounts fetch the integrated main commit before the next checkpoint. AI 2 supplies only UI/style-owned changes and actual explanation/user feedback; do not overwrite the app with a ZIP. AI 1 reviews CPU reflection/normals and removes its now-unused pre-bootstrap contract mirror/generator in its own follow-up. They remain untouched by AI 3 and are not used by the app or test commands.

AI 1's questions: plane normals are normalized on CPU, matching packing; uMaterialCount is not required; scene/material counts are validated; existing test-only diagnostic methods are used only in tests. AI 2 still needs to confirm that shadow.toLight means normalized L, not the light endpoint.

Commands: `npm ci`, `npm run dev`, `npm run check`, `npm run test:renderer`, `npm run test:browser`, `npm run preview`. Browser commands require installed Chrome or CHROME_PATH. CI runs the portable typecheck/Node/build gate, not hardware GPU checks.

## 6. Provenance and external delivery

AI 3's implementation follows the supplied mathematical contract with no copied upstream source. AI 1's unchanged handoff records read-only reference inspection and independent implementation of standard equations, with no code copied. Kia Preston inspiration credit is preserved, and the team's pre-existing README license notice is retained unchanged. Any future actual adaptation must include the full original upstream MIT notice and exact file/function/commit record.

Only source merge/push is authorized here. No change in repository visibility, host deployment, live URL, release publication or competition submission is claimed.
