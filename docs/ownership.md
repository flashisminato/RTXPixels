# Ownership and module boundaries

Contract version 1 is src/contracts.ts plus docs/contract-v1.md. Shared constants export EPS, FAR, PLANE_PARALLEL_THRESHOLD, MAX_OBJECTS, MAX_MATERIALS and MAX_REDIRECTS.

- AI 1: src/render/**, tests/render/**, docs/handoffs/ai1.md. Export createRenderer(canvas, hooks), synchronous draw(frame), dispose(). Receive the camera basis; no animation loop, fallback, store changes or UI.
- AI 2: src/ui/**, src/styles/**, tests/ui/**, docs/handoffs/ai2.md. Export mountUI(root, actions). Return an empty undecorated canvasHost; import styles; own the separate explanatory diagram canvas. Use real ViewState.inspection events. The authoritative preset control limits are exported by src/scene/preset.ts.
- AI 3: contracts, core, state, presets, fallback, main, package/config, core/integration tests, notices and all other documentation.

The bootstrap alone supplies minimal render/UI/style stubs. Ownership transfers on bootstrap handoff; integration work must not edit those files. Request patches from the owner for interface violations, or obtain explicit temporary ownership.

CPU API is the five functions in the shared brief. State and fallback are internal to AI 3; feature modules consume only shared contracts (and published control limits where needed). No v1 type/semantics change without a coordinated handoff. Scene snapshots are immutable to consumers.

## Branch handoff

Clone the portable Git bundle into separate checkouts. Create feature/renderer or feature/ui at the exact bootstrap commit. Commit only owned files. Share the commit and patch/bundle, base commit, checks and remaining defects in your handoff. Do not overwrite the whole app from another account's ZIP. Ask AI 3 for dependency/config changes.

After each integration, AI 3 reports the new main commit; both feature branches update from that same commit. Small cross-review: AI 1 reviews CPU normals/reflection; AI 3 verifies GPU camera/output; AI 2 checks real explanations.
