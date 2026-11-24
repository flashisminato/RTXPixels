# AI 2 — interface checkpoint

## 1. Branch, commits and contract

Uncommitted on **main** at **484a76101730d08eb0c26e94bc897f5b89f37065** (“Merge AI 3 core into main and verify renderer integration”). No branch or commit was created. Contract **v1 unchanged**. `src/contracts.ts` was not edited.

## 2. Changes and dependencies

Owned files only. No package, config, contract, renderer, store, or core change.

- `src/ui/index.ts` — `mountUI(root, actions)` returns `canvasHost`, `update(view)`, and `dispose()`.
- `src/ui/selection.ts` — content-box normalized clicks and one-pixel arrow steps.
- `src/ui/explain.ts` — narration and the Canvas2D plan, derived only from `ViewState`.
- `src/ui/diagram.ts` — the separate schematic canvas.
- `src/styles/main.css` — layout, focus, and the empty host.
- `tests/ui/interface.test.ts` — selection, projection, angles, and explanation cases.
- `docs/handoffs/ai2.md` — this note.

`npm test` does not include `tests/ui`. That script was left as AI 3 owns it. UI tests run with `node --test tests/ui/interface.test.ts`.

## 3. Working behavior and remaining limits

`canvasHost` has class `canvas-host`, no padding or border, and no children when `mountUI` returns. The frame around it carries the outline. AI 3’s image canvas is the first canvas in document order; the schematic canvas (`.ray-diagram`) comes later. The only `<pre>` is hidden and holds `JSON.stringify(inspection)` or an empty string. Status text is exactly `${status}: ${message}`.

Three controls sit on the first screen: colored-object X, mirror/matte, and camera yaw. Light, bounce limit, and view mode stay inside a closed “More controls” disclosure. There is no sphere-rotation control and no glass control. Buttons are named “Inspect a computed mirror example” and “Reset”. Credits link to `./notices/credits.html`.

Clicks use the host content box. Arrow keys move one drawing-buffer pixel. Actions go out only through `actions.dispatch`, `actions.inspectAt`, and `actions.inspectExample`. The ring and the path are cleared when the published inspection is missing or its `sceneVersion` does not match. Angles come from the recorded 3D directions. A sky miss is not described as an error. A budget or diagnostic end does not draw a guessed next hit. An open shadow is drawn toward the light position; a blocked shadow stops at `blockerPoint`. When the blocker is the same object, the copy says the check runs into that object again.

`shadow.toLight` is treated as a normalized direction toward the light, not as the light’s position. The math panel says that explicitly.

Known integration limit: `src/main.ts` keeps its own selected normalized point across Reset and inspects it again when the next frame is ready. The UI follows that published inspection. A reset with no stored point leaves the ring hidden.

## 4. Checks actually run

- `npx tsc --noEmit`: pass.
- `node --test tests/ui/interface.test.ts`: 7 passed, 0 failed.
- Browser on `http://127.0.0.1:5174/` (dev server, narrow panel, then a 1200px emulated width): host padding and border 0 with one child canvas; frame border 0; one empty `<pre>` after reset; details closed; image canvas before `.ray-diagram`. Setting the object slider to −1.6 produced `starting: Scene changed…`, then `ready: WebGL frame drawn…`, and picture version 2. Inspect example selected column 286, row 180, with incidence and reflection both 36.8° and the same-object shadow copy. A picture click moved the selection; ArrowRight moved it from column 191 to 192. Reset restored the controls and, with no stored point, hid the ring. At 1200px CSS width the layout grid was two columns (about 740px and 404px). The schematic axis key shows distinct +X, +Y, and +Z.

Not run: `npm test`, `npm run test:renderer`, `npm run test:browser`, production build.

## 5. Next integration

Fetch this uncommitted UI onto the integrated main when the human asks to commit or merge it. Do not overwrite `src/main.ts` or the contracts. AI 3’s question is answered: `shadow.toLight` is normalized L. If Reset should also forget the last pixel, that belongs in `src/main.ts`, which still re-inspects its stored point after the new frame.

## 6. Provenance

The interface is an independent implementation of contract v1 and the published scene. No upstream renderer or tracer source was copied. The existing credits page is linked, not replaced.
