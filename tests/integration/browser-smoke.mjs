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
  console.log(`Browser: ${browser.version()} (headless Chrome; software graphics for lifecycle fixtures)`);
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
async function waitVersion(page, version) {
  await page.waitForFunction(v => window.__view?.sceneVersion === v && window.__view.status === 'fallback' &&
    Number(document.querySelector('.canvas-host > canvas').dataset.sceneVersion) === v, version);
}

test('production preview: real CPU image, computed example, pointer selection and keyboard reset', async () => {
  await withPage(async page => {
    await page.goto(preview);
    await waitFallback(page);
    assert.match(await page.locator('[role=status]').textContent(), /awaiting AI 1/);
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

test('production: high DPI, aspect-changing resize and offline reset retain normalized selection', async () => {
  await withPage(async (page, context) => {
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

test('real WebGL context loss with test renderer preserves host listeners and switches to CPU', async () => {
  await withPage(async page => {
    await page.route(/\/src\/render\/index\.ts$/, route => route.fulfill({ contentType: 'text/javascript', body: `
      export function createRenderer(canvas, hooks) {
        const gl = canvas.getContext('webgl2');
        if (!gl) throw new Error('Test machine lacks WebGL2');
        window.__gl = gl;
        window.__originalCanvas = canvas;
        const lost = event => { event.preventDefault(); hooks.onContextLost(); };
        canvas.addEventListener('webglcontextlost', lost);
        return {
          draw(frame) { window.__frame = frame; gl.clearColor(0.1, 0.2, 0.3, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
          dispose() { window.__disposedRenderer = true; canvas.removeEventListener('webglcontextlost', lost); }
        };
      }` }));
    await page.goto(dev);
    await page.waitForFunction(() => document.querySelector('[role=status]').textContent.startsWith('ready:'));
    assert.deepEqual(await page.evaluate(() => [window.__frame.width, window.__frame.height]), [640, 360]);
    await page.evaluate(() => window.__gl.getExtension('WEBGL_lose_context').loseContext());
    await waitFallback(page);
    assert.equal(await page.evaluate(() => window.__disposedRenderer), true);
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
