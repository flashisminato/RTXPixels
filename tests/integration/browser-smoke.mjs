import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

// Uses installed Chrome (or CHROME_PATH). No browser download or runtime dependency.
// Test-only route wrappers below never alter the owned renderer/UI source files.
const children = [];
let browser;
let preview;
let dev;
async function serve(mode) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(mode === 'preview' ? ['preview'] : []),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Vite exited: ${output}`);
    try { if ((await fetch(url)).ok) return url; } catch (error) {
      if (!(error instanceof TypeError)) throw error; // Expected connection refusal while starting.
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Vite startup timed out: ${output}`);
}
before(async () => {
  preview = await serve('preview');
  dev = await serve('dev');
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  console.log(`Browser: ${browser.version()} (headless Chrome; SwiftShader for integrated browser/parity checks)`);
}, { timeout: 30000 });
after(async () => {
  await browser?.close();
  await Promise.all(children.map(async child => {
    if (child.exitCode === null) { const closed = once(child, 'exit'); child.kill('SIGTERM'); await closed; }
  }));
});
async function withPage(run, deviceScaleFactor = 1) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, deviceScaleFactor });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try { await run(page, context); assert.deepEqual(errors, []); }
  finally { await context.close(); }
}
async function forceFallback(page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' ? null : original.call(this, type, ...args);
    };
  });
}
const waitReady = page => page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.startsWith('ready:'));
const waitFallback = page => page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.startsWith('fallback:'));
const inspection = page => page.locator('pre').evaluate(element => JSON.parse(element.textContent));
async function verifyInspectedPixel(page) {
  const result = await inspection(page);
  const bytes = await page.locator('.canvas-host > canvas').evaluate((canvas, pixel) =>
    Array.from(canvas.getContext('2d').getImageData(pixel.x, pixel.y, 1, 1).data), result.pixel);
  const mode = await page.evaluate(() => window.__view?.controls.viewMode ?? 'beauty');
  const expected = result.result.linearColor.map(value => {
    let c = Math.max(0, value);
    if (mode === 'hit') return Math.round(c * 255);
    if (mode === 'beauty') c /= 1 + c;
    return Math.round(Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
  });
  assert.deepEqual(bytes, [...expected, 255]);
  return result;
}
async function captureUI(page) {
  await page.route(/\/src\/ui\/index\.ts$/, route => route.fulfill({ contentType: 'text/javascript', body: `
    import { mountUI as original } from '/src/ui/index.ts?unwrapped';
    export function mountUI(root, actions) {
      window.__actions = actions;
      const handle = original(root, actions);
      return { ...handle, update(view) {
        window.__view = view;
        if (window.__throwNextUpdate) {
          window.__throwNextUpdate = false;
          window.__visibleAtFailure = document.querySelector('.canvas-host > canvas').style.visibility;
          throw new Error('Injected UI update failure');
        }
        handle.update(view);
      } };
    }` }));
}
async function waitVersion(page, version, status = 'fallback') {
  await page.waitForFunction(({ version, status }) => window.__view?.sceneVersion === version && window.__view.status === status &&
    Number(document.querySelector('.canvas-host > canvas').dataset.sceneVersion) === version, { version, status });
}

function appWarnings(page) {
  const warnings = [];
  page.on('console', event => {
    // Composited screenshot readback can cause this specific driver performance
    // notice. It is not an application error or an aspect/GL correctness warning.
    if (event.type() === 'warning' && event.text().includes('GL Driver Message') && event.text().includes('GPU stall due to ReadPixels')) return;
    if (['warning', 'error'].includes(event.type())) warnings.push(event.text());
  });
  return warnings;
}

async function compositedImage(page) {
  // Production WebGL uses preserveDrawingBuffer:false. Observe the composited
  // screenshot, not a readPixels call after the browser has cleared its buffer.
  const png = await page.locator('.canvas-host > canvas').screenshot({ scale: 'css' });
  const colors = await page.evaluate(async base64 => {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    image.src = `data:image/png;base64,${base64}`;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 16) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return colors.size;
  }, png.toString('base64'));
  assert.ok(colors > 100, `Expected a real shaded scene, got ${colors} colors`);
  return png;
}

test('production WebGL app draws a real image and computes mirror inspection and reset', async () => {
  await withPage(async page => {
    const warnings = appWarnings(page);
    await page.goto(preview);
    await waitReady(page);
    assert.deepEqual(await page.locator('.canvas-host > canvas').evaluate(canvas => [canvas.width, canvas.height]), [640, 360]);
    await compositedImage(page);
    await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
    const example = await inspection(page);
    assert.deepEqual(example.result.events.filter(e => e.kind === 'hit').map(e => e.hit.objectId), ['mirror', 'target']);
    assert.deepEqual([example.pixel.width, example.pixel.height], [640, 360]);
    await page.getByRole('button', { name: 'Reset', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('canvas').dataset.sceneVersion === '2');
    await waitReady(page);
    assert.equal((await inspection(page)).sceneVersion, 2);
    assert.deepEqual(warnings, []);
  });
}, { timeout: 30000 });

test('real renderer responds to state/options and high-DPI resize without stretching', async () => {
  await withPage(async (page, context) => {
    const warnings = appWarnings(page);
    await captureUI(page);
    await page.goto(dev);
    await waitReady(page);
    const original = await compositedImage(page);
    await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
    await page.evaluate(() => window.__actions.dispatch({ type: 'light-x', value: 4 }));
    await waitVersion(page, 2, 'ready');
    assert.notDeepEqual(await compositedImage(page), original);
    let version = 2;
    for (const action of [{ type: 'view-mode', value: 'hit' }, { type: 'view-mode', value: 'albedo' },
      { type: 'view-mode', value: 'beauty' }, { type: 'camera-yaw', value: 15 }, { type: 'redirects', value: 0 }]) {
      await page.evaluate(action => window.__actions.dispatch(action), action);
      await waitVersion(page, ++version, 'ready');
      const selected = await inspection(page);
      assert.equal(selected.sceneVersion, version);
      if (action.type === 'view-mode' && action.value !== 'beauty') assert.equal(selected.result.events.at(-1).reason, 'diagnostic');
    }
    const selected = await inspection(page);
    await page.locator('.canvas-host').evaluate(host => { host.style.width = '240px'; host.style.aspectRatio = '1 / 1'; });
    await page.waitForFunction(() => document.querySelector('canvas').width === 360 && document.querySelector('canvas').height === 360 &&
      document.querySelector('[role=status]').textContent.startsWith('ready:'));
    const resized = await inspection(page);
    assert.deepEqual([resized.pixel.width, resized.pixel.height], [360, 360]);
    assert.equal(resized.pixel.x, Math.floor((selected.pixel.x + 0.5) / selected.pixel.width * 360));
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await waitVersion(page, version + 1, 'ready');
    assert.deepEqual(warnings, []);
  }, 2);
}, { timeout: 30000 });

test('CPU/GPU beauty, first-hit, ID and normal parity at center/corners, resize and DPR 1/2', async () => {
  for (const dpr of [1, 2]) {
    await withPage(async page => {
      await page.goto(dev);
      await waitReady(page);
      const result = await page.evaluate(async () => {
        const { checkGPUParity } = await import('/tests/integration/gpu-parity.ts');
        return checkGPUParity();
      });
      assert.ok(result.comparisons >= 270);
      assert.ok(result.observedObjects.includes('mirror'));
      assert.equal(result.dpr, dpr);
      console.log(`Parity DPR ${dpr}: ${result.comparisons} pixels/variants; max byte difference ${result.maxByteError}; ${result.backend}`);
    }, dpr);
  }
}, { timeout: 60000 });

test('production forced fallback: real CPU image, computed example, pointer selection and keyboard reset', async () => {
  await withPage(async page => {
    await forceFallback(page);
    await page.goto(preview);
    await waitFallback(page);
    assert.match(await page.locator('[role=status]').textContent(), /WebGL2/);
    const colors = await page.locator('.canvas-host > canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return { count: colors.size, width: canvas.width, height: canvas.height };
    });
    assert.ok(colors.count > 100);
    assert.deepEqual([colors.width, colors.height], [160, 90]);
    await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
    const example = await verifyInspectedPixel(page);
    assert.deepEqual(example.result.events.filter(e => e.kind === 'hit').map(e => e.hit.objectId), ['mirror', 'target']);
    await page.locator('.canvas-host').click({ position: { x: 20, y: 20 } });
    const clicked = await verifyInspectedPixel(page);
    assert.notDeepEqual(clicked.pixel, example.pixel);
    await page.getByRole('button', { name: 'Reset', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('canvas').dataset.sceneVersion === '2');
    await waitFallback(page);
    const reset = await verifyInspectedPixel(page);
    assert.equal(reset.sceneVersion, 2);
    await page.screenshot({ path: 'test-results/cpu-fallback.png', fullPage: false });
  });
}, { timeout: 30000 });

test('production forced fallback: high DPI, aspect-changing resize and offline reset retain normalized selection', async () => {
  await withPage(async (page, context) => {
    await forceFallback(page);
    await page.goto(preview);
    await waitFallback(page);
    await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
    const before = await inspection(page);
    await page.locator('.canvas-host').evaluate(host => { host.style.width = '240px'; host.style.aspectRatio = '1 / 1'; });
    await page.waitForFunction(() => document.querySelector('canvas').width === 90 && document.querySelector('[role=status]').textContent.startsWith('fallback:'));
    const after = await verifyInspectedPixel(page);
    assert.deepEqual([after.pixel.width, after.pixel.height], [90, 90]);
    assert.equal(after.pixel.x, Math.floor((before.pixel.x + 0.5) / before.pixel.width * 90));
    assert.equal(after.pixel.y, Math.floor((before.pixel.y + 0.5) / before.pixel.height * 90));
    assert.equal(after.sceneVersion, before.sceneVersion);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('canvas').dataset.sceneVersion === '2');
    await waitFallback(page);
    await verifyInspectedPixel(page);
  }, 2);
}, { timeout: 30000 });

test('instrumented UI actions: diagnostics, all controls and rapid changes use current real events', async () => {
  await withPage(async page => {
    await forceFallback(page);
    await captureUI(page);
    await page.goto(dev);
    await waitFallback(page);
    await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
    let version = 1;
    for (const action of [
      { type: 'view-mode', value: 'hit' }, { type: 'view-mode', value: 'albedo' },
      { type: 'view-mode', value: 'beauty' }, { type: 'mirror-mode', value: 'matte' },
      { type: 'mirror-mode', value: 'mirror' }, { type: 'target-x', value: -2.8 },
      { type: 'light-x', value: 4 }, { type: 'camera-yaw', value: 15 }, { type: 'redirects', value: 0 },
    ]) {
      await page.evaluate(action => window.__actions.dispatch(action), action);
      await waitVersion(page, ++version);
      const selected = await verifyInspectedPixel(page);
      assert.equal(selected.sceneVersion, version);
      if (action.type === 'view-mode' && action.value !== 'beauty') {
        assert.equal(selected.result.events.at(-1).reason, 'diagnostic');
        assert.ok(selected.result.events.every(e => e.kind === 'hit' || e.kind === 'end'));
      }
    }
    await page.evaluate(() => {
      for (let i = 0; i < 60; i++) window.__actions.dispatch({ type: 'target-x', value: i % 2 ? -1.6 : -2.8 });
    });
    await waitVersion(page, version + 60);
    assert.equal((await verifyInspectedPixel(page)).sceneVersion, version + 60);
    await page.evaluate(() => window.__actions.dispatch({ type: 'light-x', value: NaN }));
    assert.equal(await page.evaluate(() => window.__view.sceneVersion), version + 60);
    assert.match(await page.locator('[role=status]').textContent(), /Control rejected/);
  });
}, { timeout: 30000 });

test('a UI subscriber failure does not leave an old image paired with a committed control', async () => {
  await withPage(async page => {
    await forceFallback(page);
    await captureUI(page);
    await page.goto(dev);
    await waitFallback(page);
    await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
    const immediate = await page.evaluate(() => {
      window.__throwNextUpdate = true;
      window.__actions.dispatch({ type: 'light-x', value: 4 });
      return { message: window.__view.message, version: window.__view.sceneVersion, visibility: window.__visibleAtFailure };
    });
    assert.equal(immediate.version, 2);
    assert.equal(immediate.visibility, 'hidden');
    assert.match(immediate.message, /Control changed, but updating the view failed/);
    await waitVersion(page, 2);
    assert.equal((await verifyInspectedPixel(page)).sceneVersion, 2);
  });
}, { timeout: 30000 });

test('failure AFTER actual WebGL2 creation replaces the canvas before CPU rendering', async () => {
  await withPage(async page => {
    await page.route(/\/src\/render\/index\.ts$/, route => route.fulfill({ contentType: 'text/javascript', body: `
      export function createRenderer(canvas) {
        window.__originalCanvas = canvas;
        window.__gl = canvas.getContext('webgl2');
        if (!window.__gl) throw new Error('Test machine lacks WebGL2');
        throw new Error('Injected compilation failure after WebGL2 creation');
      }` }));
    await page.goto(dev);
    await waitFallback(page);
    assert.equal(await page.evaluate(() => !!window.__gl), true);
    assert.equal(await page.evaluate(() => window.__originalCanvas !== document.querySelector('.canvas-host > canvas')), true);
    assert.match(await page.locator('[role=status]').textContent(), /Injected compilation failure/);
    await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
    await verifyInspectedPixel(page);
  });
}, { timeout: 30000 });

test('production renderer context loss preserves host listeners and switches to CPU', async () => {
  await withPage(async page => {
    await page.goto(preview);
    await waitReady(page);
    assert.deepEqual(await page.locator('.canvas-host > canvas').evaluate(canvas => [canvas.width, canvas.height]), [640, 360]);
    await page.evaluate(() => {
      window.__originalCanvas = document.querySelector('.canvas-host > canvas');
      window.__originalCanvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();
    });
    await waitFallback(page);
    assert.equal(await page.evaluate(() => window.__originalCanvas.isConnected), false);
    assert.equal(await page.evaluate(() => window.__originalCanvas !== document.querySelector('.canvas-host > canvas')), true);
    await page.locator('.canvas-host').click({ position: { x: 100, y: 100 } });
    await verifyInspectedPixel(page);
    await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
    await verifyInspectedPixel(page);
  }, 2);
}, { timeout: 30000 });

test('synchronous renderer draw failure falls back without claiming a ready frame', async () => {
  await withPage(async page => {
    await page.route(/\/src\/render\/index\.ts$/, route => route.fulfill({ contentType: 'text/javascript', body: `
      export function createRenderer(canvas) {
        canvas.getContext('webgl2');
        return { draw() { throw new Error('Injected draw failure'); }, dispose() { window.__disposedRenderer = true; } };
      }` }));
    await page.goto(dev);
    await waitFallback(page);
    assert.match(await page.locator('[role=status]').textContent(), /Injected draw failure/);
    assert.equal(await page.evaluate(() => window.__disposedRenderer), true);
  });
}, { timeout: 30000 });
