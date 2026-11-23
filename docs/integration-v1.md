# Next integration — AI 1 and AI 2

## Common baseline

Original bootstrap: `3cf5dcdd1e13331e547f9e59014572e645ce0af3`, tag `bootstrap-v1`.
Both accounts must update their existing feature branches from the same `core-v1` main checkpoint before the next handoff. The delivery report supplies the exact hash. Do not independently integrate feature work into main.

There are **no changes** to `src/contracts.ts`, `src/render/**`, `src/ui/**` or `src/styles/**` since bootstrap. AI 3 added only owned implementation/tests/documentation and the dev-only browser automation dependency. The same v1 interfaces still compile.

## Semantic clarification to coordinate

The brief does not explicitly distinguish a direction from a displacement for `TraceEvent.shadow.toLight`. This CPU implementation stores **normalized L**, pointing from `shadow.from = P + EPS*N` toward the light (zero only when the light exactly coincides with that origin). The actual light endpoint is `view.scene.light.position`. AI 2 should use that endpoint for diagram geometry, and the event's L/nDotL for explanation. Confirm this interpretation at the first handoff; do not silently treat toLight as an endpoint. Types remain v1.

## AI 1 requests

- Replace only your throwing renderer stub. Consume the provided camera basis and actual frame.width/height. Account for bottom-left gl_FragCoord.
- Keep strict EPS/FAR/parallel/discriminant/tie rules, offset direction and redirect-budget semantics identical. Matte after four redirects must still shade.
- Throw descriptive creation/compilation/draw failures; call context-loss hooks and clean up owned resources/listeners. Main handles canvas replacement, scheduling and CPU fallback.
- Please cross-review CPU normals/reflection. Internal agent audits were run, but they are not a substitute for your owner cross-review.
- Provide non-boundary RGBA8 diagnostic readback fixtures for object ID/normal and camera parity at center/corners, resized aspect and high DPI. Do not add new public ViewMode values without coordination.
- No final-image GPU equivalence is currently verified. Bring actual measured results and tolerances, not a successful shader build alone.

## AI 2 requests

- Replace only your harness/styles. Use real `ViewState.inspection`; never ship isolated fixture events as production results.
- Import `CONTROL_RANGES` from `src/scene/preset.ts`: targetX −2.8…−1.6; lightX −4…4; yaw −15°…15°. Native controls should match these limits, plus redirects 0…4 and v1 modes.
- Keep `canvasHost` empty at mount and free of padding/border. Decorations belong on a parent. Main manages/replaces only its canvas; your diagram canvas is separate.
- Implement keyboard pixel selection, a usable real explanation, first-hit diagnostic labels, status/limitations, reset and credits. These are not complete in the bootstrap harness.
- At 160×90 the default search selects pixel (71,45); at 640×360 it selects (286,180). Both have real mirror → target hits. The default reflected target point has nDotL=0 and ambient-only color: do not describe it as directly lit. Moving lightX to +4 makes that same low-resolution example directly lit; this was computed, not assumed.
- Supply actual first-user feedback and verify the explanation against event ordering and offset shadow origin.

## Integrator's next merge

Review returned diffs and provenance; import owned changes only. Update browser-test selectors for the real UI instead of imposing harness DOM structure on AI 2. Replace stub-dependent production fallback expectations with genuine GPU and forced-fallback checks. Run typecheck, all tests, build and browser checks after each integration. Main's `npm test` discovers tests/**/*.test.ts, including incoming renderer/UI suites.

Run the complete experiment: move target/light/camera; inspect and explain the actual new pixel; vary redirect budget; first-hit diagnostics; reset; resize; keyboard selection; graphics loss/fallback. Only then consider a human-approved v2 glass proposal.
