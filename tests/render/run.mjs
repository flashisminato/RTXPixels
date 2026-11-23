/**
 * Compatibility entry point for `npm run test:renderer` (package.json is owned
 * by AI 3 and calls `node tests/render/run.mjs && node tests/render/smoke.mjs`).
 *
 * The renderer's browser checks now live in tests/render/gpu.browser.mjs, on the
 * project's own Vite + playwright-core toolchain. This file runs every check
 * EXCEPT the production-path group; smoke.mjs runs exactly that group. Together
 * they run the whole suite once, with no overlap.
 *
 * Preferred single command: node --test tests/render/gpu.browser.mjs
 */
import { spawnSync } from 'node:child_process';

const PRODUCTION_PATTERN = 'production|real app';

const result = spawnSync(process.execPath,
  ['--test', `--test-skip-pattern=${PRODUCTION_PATTERN}`, 'tests/render/gpu.browser.mjs'],
  { stdio: 'inherit' });
process.exit(result.status ?? 1);
