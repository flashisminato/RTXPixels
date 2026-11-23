# Verification record

## Environment and actual commands

Local macOS; Node 26.4.0; npm 11.17.0; installed Google Chrome 158.0.8127.36, headless.

- `npm ci`: passed using the lockfile; audit reported 0 vulnerabilities at execution. npm warned that optional fsevents install-script approval was pending; no approval was granted and installation/checks succeeded.
- `npm run typecheck`: passed.
- `npm test`: **31 passed, 0 failed** using Node's built-in test runner and native TypeScript stripping.
- `npm run build`: passed with Vite 8.3.8.
- `npm run test:browser`: builds fresh production output, then **7 passed, 0 failed**.
- `git diff --check`: passed before commit.
- Ownership check: no changes to contract, renderer, UI or style files after bootstrap.

## Numerical/state/integration coverage

Independent sphere near/interior/tangent/miss fixtures; strict roots; non-unit direction normalization; plane hits/parallel threshold/FAR; analytic reflection; nearest ordering and exact ties; independent center/corner/aspect camera vectors and pole orthogonality; Lambertian inverse-square formula and denominator clamp; blockers before/beyond/at light; empty sky; repeated-mirror termination; matte after four redirects; fifth redirect budget; zero-redirect matte; untinted reflection; first-hit diagnostics; display transfer values; bulk/inspector agreement.

Store rejects malformed actions, nonfinite/sparse vectors, counts, indexes, IDs, modes, radii, FOV and normals. Reset reproduces original scene values while advancing version. Snapshots are immutable. Authored control ranges preserve camera clearance and sphere separation. Frame tests cover caps, aspect, high DPI, pixel mapping, resize recomputation, real reflected-target search, unavailable examples, cancellation, stale work and context failures.

An internal independent audit identified missing normalization/subnormal handling, stale-preview-test risk, and UI-notification error handling. These were corrected and regression-tested. This was not the absent AI 1 or AI 2 owner's cross-review.

## Actual browser coverage

1. Built production app: real CPU image (more than 100 distinct colors), real mirror → target events, exact rendered-pixel agreement with inspection, pointer selection and keyboard activation of Reset.
2. Isolated/private-style browser context at DPR 2: aspect-changing resize retains normalized selection; reset still computes after disabling network.
3. Test-only UI action capture: all controls, hit/albedo diagnostics, 60 rapid state changes, stale-frame rejection and invalid-input handling. This tests wiring, **not finished UI sliders**.
4. One injected UI update failure: the control is committed honestly, the stale image is hidden, and a matching new image is rendered.
5. Injected renderer creation failure **after a real WebGL2 context exists**: main replaces the image canvas and renders with Canvas2D.
6. Real WEBGL_lose_context with a test-only renderer: disposal, canvas replacement, retained host selection and CPU inspection at DPR 2.
7. Injected renderer draw failure: CPU fallback instead of claiming a successful frame.

Production tests exercise the real build and actual CPU output. Lifecycle fixtures use headless software WebGL and route-injected test modules; they are **not AI 1's renderer** and do not demonstrate GPU ray-tracing correctness. Test-only action wrappers are not included in production. Each test uses an isolated browser context. No page errors were observed. A screenshot was captured as a local test artifact; visual appearance was not independently reviewed through the available image reader.

## Not verified / remaining blockers

- AI 1's real shaders, CPU/GPU camera or pixel parity, normal/object-ID readback, or hardware GPU behavior.
- AI 2's finished controls, diagram, keyboard pixel selection, accessibility and first-user comprehension.
- Automatic GPU restoration: current policy is CPU for the session, reload to retry.
- Safari/Firefox, another physical device, or mobile interaction.
- A public static host or repository-subpath deployment on that host.
- Organizer rules, deadline, eligibility or submission requirements (event not supplied).

Build and unit-test success do not substitute for these remaining checks.
