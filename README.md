# RTXPixel

**Real-time ray-tracing interactive environment in WebGL.** Ever wondered why RTX makes the lighting in games look so real? Click any pixel of a small ray-traced room and follow the ray behind it: where it lands, how it bounces off mirrors, whether each light reaches it, and how that becomes a color. Every figure, equation and number is recomputed live from the scene you control.

Live site: https://flashisminato.github.io/Ray-Tracking/

## What you can do

- **Follow a pixel.** Click the picture (or type a pixel) to get a one-paragraph answer, an animated 3D figure of the path, and the full mathematics behind the color.
- **Change the scene.** Move the colored ball in x, y and z; switch the center sphere between mirror and matte; repaint the back wall or turn it into a mirror; add up to four colored point lights; add up to four balls that drop in, bounce and settle (or stay static).
- **Switch ray tracing on and off** to see exactly what it adds: reflections and shadows.
- **Work directly in Figure 2.1.** Drag the camera, the lights and the balls; click a ball for x/y/z arrows; click a surface to follow its pixel; turn the 3D view.

The picture is drawn by a WebGL2 ray tracer (up to 640×360). A CPU reference tracer computes every number on the page from the same scene, and a low-resolution CPU fallback takes over if WebGL is unavailable. No accounts, API keys or servers are involved.

## Run and verify

Tested runtime: Node **26.4.0**, npm **11.17.0** (`nvm install && nvm use`). Exact package versions are locked.

```sh
npm ci
npm run dev             # local development server
npm run check           # typecheck + Node tests + production build
npm run preview         # serve the production build
npm run test:renderer   # browser-only GPU renderer checks and production smoke
npm run test:browser    # whole app in a browser: CPU/GPU pixel parity, fallback, controls
node --test tests/ui/*.test.ts          # interface logic
node --test tests/ui/editorial.browser.mjs  # interface in a browser
```

The browser suites use the installed Google Chrome through `playwright-core`; set `CHROME_PATH` for another installation. No browser is downloaded automatically.

## Structure

- `src/contracts.ts`: the shared types and limits that the renderer, the CPU core and the interface agree on.
- `src/core/`: vector math, camera, intersections, shading, trace events, display conversion, frame and pixel helpers.
- `src/scene/`: the room preset, control limits, and the ball physics (`physics.ts`).
- `src/state/`: validated actions, immutable snapshots and scene versions.
- `src/render/`: the WebGL2 ray tracer.
- `src/fallback/`: cancelable CPU rendering when WebGL is unavailable.
- `src/main.ts`: canvas ownership, scheduling, resize, inspection and fallback.
- `src/ui/`, `src/styles/`: the page, Figure 2.1, the mathematics chapter and the controls.

See [architecture](docs/architecture.md) for how a scene becomes a picture and an inspected pixel.

## Implementation

The same mathematics is implemented twice. A CPU reference tracer in TypeScript produces every number on the page: the answer, the steps and the equations. A GPU shader in GLSL draws the picture (Figure 1.1). The browser tests check that the two agree pixel by pixel.

| Step | CPU reference (`src/core/index.ts`) | GPU shader (`src/render/shaders/trace.frag.ts`) |
| --- | --- | --- |
| From a pixel to a ray: screen coordinates, the camera frame and the ray direction | `makeCameraBasis`, `makeCameraRay` | `main` |
| Finding the nearest surface: the sphere quadratic and the plane solve | `nearestHit` | `intersectSphere`, `intersectPlane`, `nearestHit` |
| Bounces, shadows and shading: the mirror bounce, the shadow test for each light, the shading law, and how a path ends | `trace`, `sceneLights`, `reflect` (`src/core/vector.ts`) | `traceLinear`, `shadeMatte`, `directLight`, `occluded` |
| Display encoding: the tone curve, sRGB encoding and 8-bit rounding | `encodeDisplay` | `reinhard`, `linearToSrgbChannel`, `linearToSrgb` |

## Deployment

Build: `npm ci && npm run check`; publish directory: `dist`. Relative asset URLs support a root or repository subpath; no SPA rewrites are required. The `Verify` workflow checks pushes and pull requests, then deploys the built `dist` artifact to [GitHub Pages](https://flashisminato.github.io/Ray-Tracking/) only for successful runs on `main` outside pull requests. It can also be run manually on `main`. In repository Settings → Pages, keep the source set to **GitHub Actions**; do not publish the source tree with Jekyll. Core computation works offline **after the page loads**; cold-start offline caching is not implemented.

## Notes

CPU/GPU agreement is verified by sampled pixel comparisons in headless Chrome, not on every GPU and driver. Ray tracing is an established technique; the contribution here is the interactive explanation and the original scene.

## Repository license

The repository notice is preserved verbatim below.

# Ray-Tracking
This software uses MIT license:
Copyright (c) <2026> <Keteris>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Ray-Tracking"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
