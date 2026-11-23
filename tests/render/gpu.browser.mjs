/**
 * AI 1 renderer browser checks.
 *
 *   node --test tests/render/gpu.browser.mjs
 *
 * Same toolchain as AI 3's tests/integration/browser-smoke.mjs: the project's
 * Vite dev server plus playwright-core driving the installed Chrome. No
 * browser download, no extra dependency.
 *
 * Every check runs once per WebGL implementation:
 *   hardware    - ANGLE on the machine's real GPU (Metal on macOS)
 *   swiftshader - Chrome's software rasteriser, what GPU-less machines get
 * Override with AI1_BACKENDS=hardware or AI1_BACKENDS=swiftshader.
 *
 * Checks:
 *   1. PNG decoder self-test, so screenshot comparisons cannot lie.
 *   2. The 26-case renderer GPU suite (tests/render/renderer.gpu.ts).
 *   3. Production-path smoke: two-argument createRenderer, render-on-demand,
 *      composited screenshots, aspect-mismatch reporting.
 *   4. The real app uses WebGL, not the CPU fallback, with no renderer warnings.
 *   5. Full-frame CPU/GPU parity inside the real app, across control states:
 *      every pixel of the WebGL image against AI 3's CPU reference tracer.
 *   6. Production screenshot parity: what a visitor literally sees, against
 *      the CPU reference. No readback hooks, production renderer untouched.
 *   7. Evidence captures written to test-results/render/.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { decodePng } from './png.mjs';

const OUT = 'test-results/render';
const BACKENDS = {
  hardware: ['--ignore-gpu-blocklist'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
const SELECTED = (process.env.AI1_BACKENDS ?? 'hardware,swiftshader')
  .split(',').map(s => s.trim()).filter(Boolean);
for (const name of SELECTED) {
  if (!BACKENDS[name]) throw new Error(`Unknown backend "${name}". Use: ${Object.keys(BACKENDS).join(', ')}`);
}

/** Per-channel tolerance for float32 GPU versus float64 CPU in smooth regions. */
const TOLERANCE = 2;
/** A neighbour this different marks a geometric or shadow discontinuity. */
const EDGE_CONTRAST = 24;
/**
 * Max share of pixels allowed to disagree, and only on discontinuities.
 *
 * Calibrated by measurement and mutation testing, not guessed:
 *  - The correct renderer measured ZERO edge mismatches on both ANGLE/Metal
 *    (Apple M5) and SwiftShader, across all 15 control states.
 *  - A deliberate half-pixel camera offset produced 352 edge mismatches
 *    (0.153%); a broken shadow test produced 687 (0.298%).
 * An earlier 0.5% allowance would have let the half-pixel bug pass on edges
 * alone. 0.05% (115 px at 640x360) still leaves headroom for other drivers'
 * float behaviour while failing both mutations on their edges by themselves.
 */
const MAX_EDGE_SHARE = 0.0005;

// ---------------------------------------------------------------------------
// Dev server and browser plumbing (mirrors AI 3's browser-smoke.mjs)
// ---------------------------------------------------------------------------

const children = [];
let dev;

async function serveDev() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js',
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Vite exited: ${output}`);
    try { if ((await fetch(url)).ok) return url; } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Vite startup timed out: ${output}`);
}

before(async () => {
  mkdirSync(OUT, { recursive: true });
  dev = await serveDev();
}, { timeout: 30000 });

after(async () => {
  await Promise.all(children.map(async child => {
    if (child.exitCode === null) { const closed = once(child, 'exit'); child.kill('SIGTERM'); await closed; }
  }));
});

function launch(backend) {
  return chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    // sRGB output profile so screenshots are not colour-managed into the
    // display's profile, which would make byte comparison meaningless.
    args: ['--force-color-profile=srgb', ...BACKENDS[backend]],
  });
}

async function withPage(browser, run, { deviceScaleFactor = 1, viewport = { width: 1100, height: 850 } } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();
  const pageErrors = [];
  const rendererWarnings = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.text().includes('[renderer]')) rendererWarnings.push(message.text());
  });
  try {
    await run(page, { pageErrors, rendererWarnings });
  } finally {
    await context.close();
  }
}

async function gpuName(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'none (WebGL2 unavailable)';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  });
}

// ---------------------------------------------------------------------------
// Test-only module wrappers. They never modify the source files: they wrap the
// real modules, which Vite still serves under a ?unwrapped query.
// ---------------------------------------------------------------------------

/** Real renderer, but with a readable drawing buffer and the drawn frame exposed. */
const READBACK_RENDERER = `
import { createRenderer as real } from '/src/render/index.ts?unwrapped';
export function createRenderer(canvas, hooks) {
  const renderer = real(canvas, hooks, { preserveDrawingBuffer: true });
  const probe = window.__ai1 = { renderer, frame: null, draws: 0 };
  return {
    draw(frame) { renderer.draw(frame); probe.frame = frame; probe.draws++; },
    dispose() { renderer.dispose(); },
  };
}`;

/** Observe the view state and actions the app hands to the UI. */
const OBSERVED_UI = `
import { mountUI as original } from '/src/ui/index.ts?unwrapped';
export function mountUI(root, actions) {
  window.__actions = actions;
  const handle = original(root, actions);
  return { ...handle, update(view) { window.__view = view; handle.update(view); } };
}`;

async function wrapRenderer(page) {
  await page.route(/\/src\/render\/index\.ts$/, route =>
    route.fulfill({ contentType: 'text/javascript', body: READBACK_RENDERER }));
}
async function observeUI(page) {
  await page.route(/\/src\/ui\/index\.ts$/, route =>
    route.fulfill({ contentType: 'text/javascript', body: OBSERVED_UI }));
}

/** Wait until the app reports a WebGL-ready frame for `version`. */
async function waitReady(page, version) {
  await page.waitForFunction(v => {
    const view = window.__view;
    if (!view || view.sceneVersion !== v) return false;
    if (view.status === 'fallback' || view.status === 'error') return true; // fail fast below
    if (view.status !== 'ready') return false;
    return !window.__ai1 || window.__ai1.frame?.sceneVersion === v;
  }, version, { timeout: 20000 });
  const view = await page.evaluate(() => ({ status: window.__view.status, message: window.__view.message }));
  assert.equal(view.status, 'ready', `app did not reach a WebGL-ready frame: ${view.status}: ${view.message}`);
}

// ---------------------------------------------------------------------------
// Parity: CPU reference computed in the page, compared in Node
// ---------------------------------------------------------------------------

/**
 * Compute AI 3's CPU reference for every pixel of `frame` inside the page,
 * using the app's own modules, and return RGB bytes (top-left origin).
 * If `readGpu`, also return the WebGL readback (RGBA, flipped to top-left).
 */
async function computeInPage(page, { readGpu }) {
  const result = await page.evaluate(async ({ readGpu }) => {
    const core = await import('/src/core/index.ts');
    let frame;
    if (readGpu) {
      frame = window.__ai1.frame;
    } else {
      const { makeFrame } = await import('/src/core/frame.ts');
      const canvas = document.querySelector('canvas[aria-label^="Computed ray-traced scene"]');
      frame = makeFrame(window.__view, canvas.width, canvas.height);
    }
    const { width: w, height: h } = frame;

    const cpu = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ray = core.makeCameraRay(frame.camera, x, y, w, h);
        const linear = core.traceColor(frame.scene, ray, frame.options);
        const display = core.encodeDisplay(linear, frame.options.viewMode);
        const i = (y * w + x) * 3;
        cpu[i] = Math.round(display[0] * 255);
        cpu[i + 1] = Math.round(display[1] * 255);
        cpu[i + 2] = Math.round(display[2] * 255);
      }
    }

    const toBase64 = bytes => {
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    };

    let gpu = null;
    if (readGpu) {
      const gl = window.__ai1.renderer.gl;
      const raw = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      const flipped = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) flipped.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      gpu = toBase64(flipped);
    }
    return { width: w, height: h, viewMode: frame.options.viewMode, cpu: toBase64(cpu), gpu };
  }, { readGpu });

  return {
    ...result,
    cpu: new Uint8Array(Buffer.from(result.cpu, 'base64')),
    gpu: result.gpu ? new Uint8Array(Buffer.from(result.gpu, 'base64')) : null,
  };
}

/**
 * Compare CPU RGB against GPU RGBA. A mismatch is tolerated ONLY on a
 * discontinuity (silhouette, shadow boundary, reflected edge), where float32
 * and float64 legitimately land a ray on different sides. Any mismatch in a
 * smooth region is a real semantic disagreement.
 */
function compare(cpu, gpu, width, height) {
  const total = width * height;
  let edge = 0;
  let maxSmoothDelta = 0;
  let maxAnyDelta = 0;
  const smooth = [];

  const cpuAt = (x, y, c) => cpu[(y * width + x) * 3 + c];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let delta = 0;
      for (let c = 0; c < 3; c++) {
        delta = Math.max(delta, Math.abs(cpuAt(x, y, c) - gpu[(y * width + x) * 4 + c]));
      }
      maxAnyDelta = Math.max(maxAnyDelta, delta);
      if (delta <= TOLERANCE) continue;

      let isEdge = false;
      for (let dy = -1; dy <= 1 && !isEdge; dy++) {
        for (let dx = -1; dx <= 1 && !isEdge; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          for (let c = 0; c < 3; c++) {
            if (Math.abs(cpuAt(nx, ny, c) - cpuAt(x, y, c)) > EDGE_CONTRAST) { isEdge = true; break; }
          }
        }
      }
      if (isEdge) { edge++; continue; }

      maxSmoothDelta = Math.max(maxSmoothDelta, delta);
      if (smooth.length < 6) {
        smooth.push({ x, y, delta,
          cpu: [cpuAt(x, y, 0), cpuAt(x, y, 1), cpuAt(x, y, 2)],
          gpu: [...gpu.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)] });
      }
    }
  }
  return { total, edge, edgeShare: edge / total, smoothMismatches: smooth.length, smooth, maxSmoothDelta, maxAnyDelta };
}

function assertParity(label, stats) {
  const line = `${label}: ${stats.total} px, max delta ${stats.maxAnyDelta}, ` +
    `edge-only mismatches ${stats.edge} (${(stats.edgeShare * 100).toFixed(3)}%), smooth-region mismatches ${stats.smoothMismatches}`;
  console.log(`    ${line}`);
  assert.equal(stats.smoothMismatches, 0,
    `${label}: CPU and GPU disagree in a smooth region (a semantic mismatch, not rounding): ${JSON.stringify(stats.smooth)}`);
  assert.ok(stats.edgeShare <= MAX_EDGE_SHARE,
    `${label}: ${stats.edge} silhouette/shadow-edge mismatches exceeds ${MAX_EDGE_SHARE * 100}% of pixels`);
}

// ---------------------------------------------------------------------------
// The checks, per backend
// ---------------------------------------------------------------------------

for (const backend of SELECTED) {
  describe(`renderer on ${backend}`, () => {
    let browser;
    before(async () => { browser = await launch(backend); }, { timeout: 30000 });
    after(async () => { await browser?.close(); });

    test('PNG decoder self-test against known colours', async () => {
      await withPage(browser, async page => {
        await page.setContent(`<body style="margin:0">
          <div style="display:grid;grid-template-columns:40px 40px;width:80px">
            <div style="height:40px;background:rgb(255,0,0)"></div><div style="height:40px;background:rgb(0,255,0)"></div>
            <div style="height:40px;background:rgb(0,0,255)"></div><div style="height:40px;background:rgb(37,141,200)"></div>
          </div></body>`);
        const png = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: 80, height: 80 } }));
        assert.deepEqual([png.width, png.height], [80, 80]);
        const at = (x, y) => [...png.rgba.subarray((y * 80 + x) * 4, (y * 80 + x) * 4 + 3)];
        assert.deepEqual(at(20, 20), [255, 0, 0]);
        assert.deepEqual(at(60, 20), [0, 255, 0]);
        assert.deepEqual(at(20, 60), [0, 0, 255]);
        assert.deepEqual(at(60, 60), [37, 141, 200], 'mid-range colour must survive the screenshot path unchanged');
      });
    });

    test('renderer GPU suite (26 hand-derived checks)', async () => {
      await withPage(browser, async (page, { pageErrors, rendererWarnings }) => {
        await page.goto(`${dev}/tests/render/gpu.html`);
        await page.waitForFunction(() => window.__AI1_RESULT__, null, { timeout: 60000 });
        const result = await page.evaluate(() => window.__AI1_RESULT__);
        console.log(`    GPU: ${result.renderer}`);
        const failed = result.outcomes.filter(o => o.status !== 'pass');
        for (const o of result.outcomes) console.log(`    ${o.status === 'pass' ? 'pass' : 'FAIL'}  ${o.name}${o.detail ? ` -> ${o.detail}` : ''}`);
        assert.equal(result.webgl2, true, 'WebGL2 is unavailable');
        assert.equal(failed.length, 0, `${failed.length} renderer check(s) failed`);
        assert.ok(result.outcomes.length >= 26, `expected at least 26 checks, ran ${result.outcomes.length}`);
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(rendererWarnings, [], 'no renderer warnings expected: every test canvas is sized consistently');
      });
    }, { timeout: 90000 });

    test('production path: 2-arg createRenderer, render-on-demand, composited output, aspect reporting', async () => {
      await withPage(browser, async (page, { pageErrors, rendererWarnings }) => {
        await page.setViewportSize({ width: 700, height: 420 });
        await page.goto(`${dev}/tests/render/smoke.html`);
        const shots = {};
        for (const stage of ['first-paint', 'edited', 'resized']) {
          await page.waitForFunction(s => {
            const order = ['starting', 'first-paint', 'edited', 'resized', 'done'];
            return order.indexOf(window.__AI1_SMOKE__?.stage) >= order.indexOf(s);
          }, stage, { timeout: 15000 });
          await page.waitForTimeout(100); // let the compositor present the repaint
          const png = await page.screenshot({ clip: { x: 0, y: 0, width: 640, height: 360 } });
          writeFileSync(`${OUT}/${backend}-smoke-${stage}.png`, png);
          shots[stage] = decodePng(png);
        }
        await page.waitForFunction(() => window.__AI1_SMOKE__?.ready, null, { timeout: 15000 });
        const state = await page.evaluate(() => window.__AI1_SMOKE__);

        assert.deepEqual(state.errors, []);
        assert.deepEqual(pageErrors, []);
        assert.ok(state.drawCount >= 3, `expected >= 3 draws, got ${state.drawCount}`);
        assert.equal(state.contextLost, 0);

        const distinct = new Set();
        const rgba = shots['first-paint'].rgba;
        for (let i = 0; i < rgba.length; i += 4) distinct.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
        assert.ok(distinct.size > 500, `first paint must be a real image, found only ${distinct.size} distinct colours`);

        const differs = (a, b) => a.rgba.some((value, i) => value !== b.rgba[i]);
        assert.ok(differs(shots['first-paint'], shots['edited']), 'moving an object must change the composited image');

        // The resize stage deliberately draws 480x360 into a 640x360 box.
        assert.equal(rendererWarnings.filter(w => w.includes('stretch')).length, 1,
          `the deliberate stretch must be reported exactly once: ${JSON.stringify(rendererWarnings)}`);
        assert.equal(rendererWarnings.length, 1, `unexpected renderer warnings: ${JSON.stringify(rendererWarnings)}`);
      });
    }, { timeout: 60000 });

    test('real app: uses WebGL (not the CPU fallback), no renderer warnings, buffer within contract cap', async () => {
      for (const deviceScaleFactor of [1, 2]) {
        await withPage(browser, async (page, { pageErrors, rendererWarnings }) => {
          await observeUI(page);
          await page.goto(dev);
          await waitReady(page, 1);
          const status = await page.evaluate(() => window.__view.message);
          assert.match(status, /WebGL frame drawn/);
          const size = await page.evaluate(() => {
            const canvas = document.querySelector('canvas[aria-label^="Computed ray-traced scene"]');
            return { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight };
          });
          assert.ok(size.w <= 640 && size.h <= 360, `buffer ${size.w}x${size.h} exceeds the 640x360 cap`);
          assert.ok(Math.abs(size.w / size.h - size.cw / size.ch) < 0.02, `buffer aspect does not match host: ${JSON.stringify(size)}`);
          assert.deepEqual(pageErrors, []);
          assert.deepEqual(rendererWarnings, [], 'the integrated app must not trigger renderer warnings');
          console.log(`    DPR ${deviceScaleFactor}: buffer ${size.w}x${size.h} in a ${size.cw}x${size.ch} CSS box`);
        }, { deviceScaleFactor });
      }
    }, { timeout: 60000 });

    test('real app: full-frame CPU/GPU parity across every control', async () => {
      await withPage(browser, async (page, { pageErrors }) => {
        await wrapRenderer(page);
        await observeUI(page);
        await page.goto(dev);
        await waitReady(page, 1);

        const states = [
          ['initial preset', null],
          ['view hit', { type: 'view-mode', value: 'hit' }],
          ['view albedo', { type: 'view-mode', value: 'albedo' }],
          ['view beauty', { type: 'view-mode', value: 'beauty' }],
          ['mirror as matte', { type: 'mirror-mode', value: 'matte' }],
          ['mirror restored', { type: 'mirror-mode', value: 'mirror' }],
          ['redirects 0', { type: 'redirects', value: 0 }],
          ['redirects 1', { type: 'redirects', value: 1 }],
          ['redirects 4', { type: 'redirects', value: 4 }],
          ['target x min', { type: 'target-x', value: -2.8 }],
          ['target x max', { type: 'target-x', value: -1.6 }],
          ['light x min', { type: 'light-x', value: -4 }],
          ['light x max', { type: 'light-x', value: 4 }],
          ['camera yaw min', { type: 'camera-yaw', value: -15 }],
          ['camera yaw max', { type: 'camera-yaw', value: 15 }],
        ];

        let version = 1;
        for (const [label, action] of states) {
          if (action) {
            await page.evaluate(a => window.__actions.dispatch(a), action);
            await waitReady(page, ++version);
          }
          const frame = await computeInPage(page, { readGpu: true });
          assertParity(label, compare(frame.cpu, frame.gpu, frame.width, frame.height));
        }
        assert.deepEqual(pageErrors, []);
      });
    }, { timeout: 240000 });

    test('production screenshot parity: what a visitor sees equals the CPU reference', async () => {
      await withPage(browser, async (page, { pageErrors, rendererWarnings }) => {
        // Production renderer, untouched. Only the UI is observed so the frame
        // can be reconstructed exactly as main.ts builds it.
        await observeUI(page);
        await page.goto(dev);
        await waitReady(page, 1);

        // Pin the host to integer coordinates with CSS size == buffer size at
        // DPR 1, so the screenshot is a 1:1 copy of the drawing buffer.
        await page.evaluate(() => {
          const canvas = document.querySelector('canvas[aria-label^="Computed ray-traced scene"]');
          canvas.parentElement.style.cssText +=
            ';position:fixed!important;left:0!important;top:0!important;width:640px!important;' +
            'height:360px!important;padding:0!important;border:0!important;z-index:2147483647';
        });
        await page.waitForFunction(() => {
          const canvas = document.querySelector('canvas[aria-label^="Computed ray-traced scene"]');
          return canvas.width === 640 && canvas.height === 360 && window.__view?.status === 'ready';
        }, null, { timeout: 15000 });
        await page.waitForTimeout(150);

        for (const [label, action] of [['initial preset', null], ['light moved', { type: 'light-x', value: 3.5 }]]) {
          if (action) {
            const v = await page.evaluate(() => window.__view.sceneVersion);
            await page.evaluate(a => window.__actions.dispatch(a), action);
            await waitReady(page, v + 1);
            await page.waitForTimeout(150);
          }
          const png = await page.screenshot({ clip: { x: 0, y: 0, width: 640, height: 360 } });
          writeFileSync(`${OUT}/${backend}-app-${label.replace(/\s+/g, '-')}.png`, png);
          const shot = decodePng(png);
          const frame = await computeInPage(page, { readGpu: false });
          assert.deepEqual([frame.width, frame.height], [640, 360]);
          assertParity(`screenshot, ${label}`, compare(frame.cpu, shot.rgba, 640, 360));
        }
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(rendererWarnings, []);
      });
    }, { timeout: 120000 });

    test('measurement: synchronous frame cost in the real app at the contract resolution', async () => {
      // Report-only. Each sample is draw() followed by a 1-pixel readPixels,
      // which forces the GPU to finish, so it is an UPPER BOUND on frame cost
      // (it includes the pipeline flush a normal frame would overlap).
      // Measured on the worst case the controls allow: mirror on, 4 redirects.
      await withPage(browser, async page => {
        await wrapRenderer(page);
        await observeUI(page);
        await page.goto(dev);
        await waitReady(page, 1);
        const stats = await page.evaluate(() => {
          const { renderer, frame } = window.__ai1;
          const gl = renderer.gl;
          const pixel = new Uint8Array(4);
          const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          for (let i = 0; i < 10; i++) { renderer.draw(frame); sync(); } // warm-up
          const samples = [];
          for (let i = 0; i < 120; i++) {
            const start = performance.now();
            renderer.draw(frame);
            sync();
            samples.push(performance.now() - start);
          }
          samples.sort((a, b) => a - b);
          return { width: frame.width, height: frame.height, redirects: frame.options.maxRedirects,
            median: samples[60], p95: samples[114], max: samples[119] };
        });
        console.log(`    ${stats.width}x${stats.height}, ${stats.redirects} redirects: median ${stats.median.toFixed(2)} ms, ` +
          `p95 ${stats.p95.toFixed(2)} ms, max ${stats.max.toFixed(2)} ms (synchronous upper bound)`);
        assert.ok(Number.isFinite(stats.median));
      });
    }, { timeout: 60000 });

    test('evidence captures', async () => {
      await withPage(browser, async page => {
        await page.goto(`${dev}/tests/render/capture.html`);
        await page.waitForFunction(() => window.__AI1_CAPTURES__, null, { timeout: 30000 });
        const captures = await page.evaluate(() => window.__AI1_CAPTURES__);
        for (const { name, dataUrl } of captures) {
          writeFileSync(`${OUT}/${backend}-${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
        }
        assert.equal(captures.length, 7);
      });
    }, { timeout: 60000 });
  });
}
