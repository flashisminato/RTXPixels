# Follow a Pixel

An original educational web experiment: how does a game decide what a mirror shows?
Shared contract **v1**, matte and perfect mirrors only. No glass, API keys or runtime services.

## Bootstrap baseline

This baseline intentionally contains an honest WebGL stub and minimal UI harness, not a finished renderer or explanatory interface. CPU exports are signatures until the integration/core checkpoint. Do not interpret a successful build as a rendered scene.

## Commands

Use the tested runtime Node **26.4.0** (`nvm install && nvm use`) and npm **11.17.0**. Exact dependencies and transitive versions are locked.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run preview
# or all verification:
npm run check
```

Tests use Node's built-in test runner and native TypeScript stripping. No test framework is required. Vite bundles ordinary HTML/CSS/TypeScript.

## Team workflow

Read [the shared contract](docs/contract-v1.md) and [ownership](docs/ownership.md). Both feature accounts must start at the SAME bootstrap commit, identified in the delivered handoff. AI 1: `feature/renderer`; AI 2: `feature/ui`; AI 3: `integration/core`. Only AI 3 integrates reviewed owned-file changes into main. No remote is configured; never use the reference repository as a write remote.

## Deployment

Build command: `npm ci && npm run check`; output: `dist`. Vite uses relative asset URLs for root or repository-subpath hosting. No SPA rewrites are needed. Choose a human-maintained static host before publication; no credentials, deployment workflow or public URL are present. Core calculation is offline after the page loads; offline cold-start caching is not promised.

## Provenance

Inspired by [Light Teachings by Kia Preston (pkncoder)](https://github.com/pkncoder/Light-Teachings/tree/57260fe2a6badbc826271856bbcf6c8a2090de17). This baseline does not copy or adapt upstream source. The AI 3 implementation is generated from the supplied mathematical contract, not a port. [Public credit](public/notices/credits.html) records limitations; actual adaptations by incoming modules must add the complete upstream MIT notice and exact source/function record. Do not claim pixel-for-pixel reproduction or invention of ray tracing.
