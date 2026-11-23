/**
 * Compatibility entry point: the production-path group of the renderer suite.
 * See tests/render/run.mjs for why this file exists.
 *
 * Covers the two-argument createRenderer path, render-on-demand, composited
 * screenshots, aspect reporting, the real app's WebGL path, and full-frame and
 * screenshot CPU/GPU parity against AI 3's CPU tracer.
 */
import { spawnSync } from 'node:child_process';

const PRODUCTION_PATTERN = 'production|real app';

const result = spawnSync(process.execPath,
  ['--test', `--test-name-pattern=${PRODUCTION_PATTERN}`, 'tests/render/gpu.browser.mjs'],
  { stdio: 'inherit' });
process.exit(result.status ?? 1);
