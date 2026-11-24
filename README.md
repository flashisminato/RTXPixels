# How does the RTX work? A real-time ray-tracing interactive environment with math illustration using a WebGL renderer

The app renders the original room through **WebGL2 renderer**, capped at 640×360, with spheres, planes, a perfect mirror, direct matte lighting and hard shadows. A cancelable **160×90 CPU fallback** handles unavailable or lost graphics contexts. Both buffers fit the host aspect. Click the image to inspect actual CPU ray events for the same frame, select a computed mirror example, or reset. No API keys or runtime services.

**Not a finished team release:** AI 2's full controls/explanatory diagram has not arrived; its minimal development harness is preserved. The renderer is no longer a stub. Contract **v1** remains unchanged: no glass.

## Run and verify

Tested runtime: Node **26.4.0**, npm **11.17.0**. Use `nvm install && nvm use`; exact package/transitive versions are locked.

```sh
npm ci
npm run dev
npm run check       # all-source typecheck + Node core/integration tests + build
npm run preview
npm run test:renderer # browser-only GPU suite and production smoke
npm run test:browser  # combined application, CPU/GPU parity and fallback
```

`test:browser` builds fresh output and uses installed Google Chrome through `playwright-core`. For another installation, set `CHROME_PATH` to its executable. No browser is downloaded automatically. The browser suite starts/stops its own local servers and isolated browser contexts. It is separate from CI's portable math/build gate.

Latest verification: **31 numerical/state/integration tests, 26 renderer checks, 11 renderer production-smoke checks and 10 combined-browser tests passed**, plus typecheck and build. The combined suite includes 630 sampled CPU/GPU pixel/diagnostic comparisons at DPR 1 and 2 on SwiftShader. AI 1's standalone renderer suite also passed on ANGLE Metal / Apple M1. See [verification](docs/verification.md) for scope and limits. Node and browser-only renderer tests have separate commands; both are type-checked. Update browser selectors when the real interface is integrated.

## Structure

- `src/contracts.ts`: unchanged shared v1 types and constants.
- `src/core/`: vector math, camera, intersections, shading, events, display conversion and frame/selection helpers.
- `src/scene/`: original room preset and authoritative control limits.
- `src/state/`: validated actions, immutable snapshots and monotonic scene versions.
- `src/fallback/`: cancelable, event-free bulk CPU rendering.
- `src/main.ts`: canvas ownership, scheduling, resize, inspection and fallback orchestration.
- `src/render/`: WebGL2 implementation, preserved unchanged from the existing main branch.
- `src/ui/`, `src/styles/`: A minimal development harness.

Read [architecture](docs/architecture.md), [the shared contract](docs/contract-v1.md), [ownership](docs/ownership.md), and [integration notes](docs/integration-v1.md).

## Team workflow

Team repository: [flashisminato/Ray-Tracking](https://github.com/flashisminato/Ray-Tracking).

The merge joins the existing renderer history at `2746fb1` and the `integration/core` checkpoint at `6bc55c3`, preserving both histories. It was prepared in a separate `integration/combined` checkout. The original `bootstrap-v1` and `core-v1` tags remain historical checkpoints, not tags for the combined app.

Both feature accounts should fetch and update their feature branches from the same integrated `main` commit before their next handoff. Do not overwrite an entire checkout or merge an old renderer stub over real code. Only AI 3 integrates reviewed owned-file changes into main. Never use the reference repository as a write remote.

## Deployment

Build: `npm ci && npm run check`; publish directory: `dist`. Relative asset URLs support a root or repository subpath; no SPA rewrites are required. The `Verify` workflow checks pushes and pull requests, then deploys the built `dist` artifact to [GitHub Pages](https://flashisminato.github.io/Ray-Tracking/) only for successful runs on `main` outside pull requests. It can also be run manually on `main`. In repository Settings → Pages, keep the source set to **GitHub Actions**; do not publish the source tree with Jekyll. Core computation works offline **after the page loads**; cold-start offline caching is not implemented.

## Implementation

*Moved here from chapter 4 of the web page.*

The same mathematics is implemented twice. A CPU reference tracer in TypeScript produces every number on the page: the answer, the steps and the equations. A GPU shader in GLSL draws the picture (Figure 1.1). The browser tests check that the two agree pixel by pixel.

| Step | CPU reference (`src/core/index.ts`) | GPU shader (`src/render/shaders/trace.frag.ts`) |
| --- | --- | --- |
| From a pixel to a ray: screen coordinates, the camera frame and the ray direction | `makeCameraBasis`, `makeCameraRay` | `main` |
| Finding the nearest surface: the sphere quadratic and the plane solve | `nearestHit` | `intersectSphere`, `intersectPlane`, `nearestHit` |
| Bounces, shadows and shading: the mirror bounce, the shadow test for each light, the shading law, and how a path ends | `trace`, `sceneLights`, `reflect` (`src/core/vector.ts`) | `traceLinear`, `shadeMatte`, `directLight`, `occluded` |
| Display encoding: the tone curve, sRGB encoding and 8-bit rounding | `encodeDisplay` | `reinhard`, `linearToSrgbChannel`, `linearToSrgb` |

## Limits and credits

*Moved here from chapter 5 of the web page.*

Version 1 computes spheres, planes, up to four point lights, hard shadows, and perfect mirrors, with at most four bounces. It does not compute glass, soft shadows, or light that bounces off matte surfaces. Ray tracing is an established technique, not our invention. See the [credits and limitations](public/notices/credits.html) page and the provenance notes below.

## Provenance and limitations

Inspired by [Light Teachings by Kia Preston (pkncoder)](https://github.com/pkncoder/Light-Teachings/tree/57260fe2a6badbc826271856bbcf6c8a2090de17). AI 3 did not copy or adapt upstream source; this implementation follows the supplied mathematical contract. Incoming adaptations must preserve the full upstream MIT text and identify source commits/functions. See [contribution record](docs/contributions.md) and [public credits](public/notices/credits.html).

Sampled CPU/GPU parity is verified on headless SwiftShader, not universally across hardware/drivers. Second-device verification, full keyboard pixel selection, a first-user study, deployed-host testing and organizer/deadline verification remain outstanding. See the [release checklist and demo guide](docs/release.md).

## Repository license

The existing repository notice is preserved verbatim below. This is separate from the upstream inspiration credit.

# Ray-Tracking
This software uses MIT license:
Copyright (c) <2026> <Keteris>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Ray-Tracking"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
