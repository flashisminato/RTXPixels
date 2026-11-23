# Follow a Pixel

**How does a game decide what a mirror shows?**

Follow a Pixel is an interactive browser ray tracer built to answer that question. It renders a small room with a mirror sphere, a colored target and a movable light. You can change the scene, pick any pixel, and see the actual calculation behind that pixel's color: which surface the ray hit, how it bounced off the mirror, and whether the light was blocked.

Nothing is prerecorded. Every image and every explanation is computed live in your browser. There is no login, no server, and no API key.

> **Live demo:** not deployed yet. The link will be added here once the app is published.
>
> **Status:** the renderer, the CPU tracer behind the inspector, and the scene logic for every control below are built and tested. The on-screen controls and the step-by-step explanation panel are still being finished. The current interface lets you click a pixel to inspect it, jump to a computed mirror example, and reset.

## What you can do

- **Move the target sphere** and watch its reflection move in the mirror.
- **Move the light** and watch the hard shadows follow it.
- **Turn the camera** up to 15° to either side.
- **Turn the mirror matte** to see the same sphere without reflections.
- **Change the bounce limit** (0–4) to see how many reflections a ray may follow.
- **Switch view modes:** the final image, a *hit* view (did the first ray hit anything?) and an *albedo* view (the surface color of the first hit).
- **Inspect any pixel** to see the computed path of its ray, step by step.
- **Reset** to the starting scene in one action.

## How it works

The app traces rays **backwards**, from the camera into the scene. Real light travels the other way, from the light to your eye, but tracing backwards only computes the rays that actually reach the screen.

For every pixel:

1. **Shoot a ray** from the camera through the center of the pixel.
2. **Find the nearest surface** it hits. The scene is built from spheres and flat planes, which are tested with exact geometric formulas.
3. **If the surface is a mirror**, reflect the ray around the surface normal and repeat from step 2. A ray may bounce at most 4 times. A mirror that would need another bounce beyond the limit is drawn black.
4. **If the surface is matte**, send a *shadow ray* towards the light. If any object lies between the surface and the light, the point is in shadow and gets only a little ambient light. Otherwise it is lit, more brightly when it faces the light directly and less brightly the farther away the light is.
5. **If the ray hits nothing**, it shows the sky.

Finally the color is tone-mapped and converted for display.

The image is drawn on the **GPU** with WebGL2. When you inspect a pixel, the same calculation runs again on the **CPU** for that one pixel, which is what produces the step-by-step explanation. Automated tests compare the GPU image with the CPU calculation pixel by pixel, so the explanation matches what is on screen.

If WebGL2 is unavailable, or the graphics context is lost, the app switches to a lower-resolution image computed entirely on the CPU, and every control and the inspector keep working.

## Running it locally

Requires **Node 26.4.0** (see `.nvmrc`) and npm.

```sh
nvm install && nvm use   # optional: selects the pinned Node version
npm ci                   # install the exact locked dependencies
npm run dev              # start the development server
```

Open the local URL that `npm run dev` prints.

| Command | What it does |
|---|---|
| `npm run check` | Type check, unit tests and production build. This is what CI runs. |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run test:renderer` | GPU renderer checks in Chrome |
| `npm run test:browser` | Whole-app browser checks in Chrome, including CPU/GPU comparison |

The browser tests use your installed Google Chrome and never download a browser. To use a different installation, set `CHROME_PATH` to its executable.

## Browser support

Any browser with WebGL2 gets the GPU image, at up to 640×360 pixels. Browsers without it get the CPU image at up to 160×90. Desktop Chrome on macOS is tested. Safari, Firefox and mobile devices have not been verified yet.

## Deployment

The app is a static site: build it with `npm ci && npm run check` and publish the `dist/` folder. Asset paths are relative, so it works at a domain root or in a subfolder such as a GitHub Pages project page. No server-side routing is needed. After the page has loaded, all computation runs offline.

## Project structure

```
src/
  contracts.ts   shared types and constants every module agrees on
  core/          CPU ray tracer: camera, intersections, shading, inspection
  render/        WebGL2 GPU renderer
  scene/         the room preset and the allowed range of every control
  state/         validated scene state, versioning and reset
  fallback/      low-resolution CPU image when WebGL2 is unavailable
  ui/, styles/   the interface
  main.ts        wires everything together
tests/           unit, renderer and whole-app browser tests
docs/            architecture, shared contract, verification and release notes
```

To go deeper, see the [architecture](docs/architecture.md), the [shared contract](docs/contract-v1.md) and the [verification notes](docs/verification.md).

## Limitations

This is a focused teaching tool, not a full renderer:

- Shapes are spheres and infinite planes only.
- There is one point light, so shadows have hard edges.
- Mirrors are perfect. There is no glass, refraction, blurry reflection or indirect light bouncing between surfaces.
- Each pixel uses a single ray, so edges are not anti-aliased.

## Credits

Inspired by **[Light Teachings](https://github.com/pkncoder/Light-Teachings/tree/57260fe2a6badbc826271856bbcf6c8a2090de17) by Kia Preston (pkncoder)**, a native macOS ray tracer. Follow a Pixel is an independent browser project. No code from Light Teachings was copied; the ray-tracing maths uses standard textbook formulas. The original contribution is the interactive pixel inspector and the experience built around it.

Built by a three-person team working with AI coding assistants. The [contribution record](docs/contributions.md) documents how each part was produced, including the use of AI. The in-app [credits page](public/notices/credits.html) covers the inspiration, AI use and limitations.

The app has no runtime dependencies. It is built with [Vite](https://vite.dev) and [TypeScript](https://www.typescriptlang.org).

## License

MIT License

Copyright (c) 2026 Keteris

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
