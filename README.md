# Follow a Pixel

An original educational web experiment: **How does a game decide what a mirror shows?**

## Current checkpoint: CPU reference and integration ready

The app displays a real, locally calculated **160×90 CPU fallback** with spheres, planes, a perfect mirror, direct matte lighting and hard shadows. Click the image to inspect the actual ray events, inspect a computed mirror example, or reset. No API keys or runtime services.

**Not a finished team release:** AI 1's WebGL renderer and AI 2's full controls/explanatory diagram have not arrived. Their bootstrap stubs remain unchanged. The development harness labels this explicitly; the image itself is computed, not a placeholder. Contract **v1**: no glass.

## Run and verify

Tested runtime: Node **26.4.0**, npm **11.17.0**. Use `nvm install && nvm use`; exact package/transitive versions are locked.

```sh
npm ci
npm run dev
npm run check       # typecheck + all TypeScript tests + production build
npm run preview
npm run test:browser
```

`test:browser` builds fresh output and uses installed Google Chrome through `playwright-core`. For another installation, set `CHROME_PATH` to its executable. No browser is downloaded automatically. The browser suite starts/stops its own local servers and isolated browser contexts. It is separate from CI's portable math/build gate.

Latest verification: **31 numerical/state/integration tests and 7 browser tests passed**, plus typecheck and build. See [verification](docs/verification.md) for the exact scope, fixtures, and important limits. Browser tests currently target the bootstrap harness; their selectors must be updated when AI 2's real interface is integrated.

## Structure

- `src/contracts.ts`: unchanged shared v1 types and constants.
- `src/core/`: vector math, camera, intersections, shading, events, display conversion and frame/selection helpers.
- `src/scene/`: original room preset and authoritative control limits.
- `src/state/`: validated actions, immutable snapshots and monotonic scene versions.
- `src/fallback/`: cancelable, event-free bulk CPU rendering.
- `src/main.ts`: canvas ownership, scheduling, resize, inspection and fallback orchestration.
- `src/render/`: AI 1 ownership; currently an honest throwing stub.
- `src/ui/`, `src/styles/`: AI 2 ownership; currently a minimal development harness.

Read [architecture](docs/architecture.md), [the shared contract](docs/contract-v1.md), [ownership](docs/ownership.md), and [integration notes](docs/integration-v1.md).

## Team workflow

Both feature accounts start at **the same** `bootstrap-v1` commit: `3cf5dcdd1e13331e547f9e59014572e645ce0af3`. AI 1 works on `feature/renderer`; AI 2 on `feature/ui`. AI 3 developed this checkpoint on `integration/core`, then fast-forwarded local `main`. The `core-v1` tag identifies the integrated checkpoint; the delivered handoff gives its exact hash.

Clone a portable bundle with `git clone --branch main <bundle> <new-checkout>`. Existing feature branches must update from the same integration commit, not overwrite their checkout with a returned archive. Only AI 3 integrates reviewed owned-file changes into main. No remote is configured, and nothing has been pushed. Never use the reference repository as a write remote.

## Deployment

Build: `npm ci && npm run check`; publish directory: `dist`. Relative asset URLs support a root or repository subpath; no SPA rewrites are required. No host account, publication workflow, credentials or live URL is configured. Publication requires the human's chosen destination and authorization. Core computation works offline **after the page loads**; cold-start offline caching is not implemented.

## Provenance and limitations

Inspired by [Light Teachings by Kia Preston (pkncoder)](https://github.com/pkncoder/Light-Teachings/tree/57260fe2a6badbc826271856bbcf6c8a2090de17). AI 3 did not copy or adapt upstream source; this implementation follows the supplied mathematical contract. Incoming adaptations must preserve the full upstream MIT text and identify source commits/functions. See [contribution record](docs/contributions.md) and [public credits](public/notices/credits.html).

No GPU parity, second-device verification, full keyboard pixel selection, first-user study, deployed-host test or organizer/deadline verification is claimed. See the [release checklist and demo guide](docs/release.md).
