/**
 * Browser checks for the editorial interface (docs/design/editorial-ui-brief.md).
 *
 *   node --test tests/ui/editorial.browser.mjs
 *
 * Project toolchain only: the Vite dev server and playwright-core with the
 * installed Chrome (CHROME_PATH to override). Covers the integration hooks other
 * owners' tests rely on, the document structure, direct manipulation inside the
 * figures, and linked highlighting between equations and figures.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

let server;
let url;
let browser;

before(async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
}, { timeout: 30000 });

after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { const closed = once(server, 'exit'); server.kill('SIGTERM'); await closed; }
});

async function open(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.startsWith('ready:'), null, { timeout: 20000 });
  return { page, context, errors };
}
const inspected = page => page.locator('pre').evaluate(p => (p.textContent ? JSON.parse(p.textContent).pixel : null));
const controls = page => page.evaluate(() => [...document.querySelectorAll('input[type=range]')].map(i => Number(i.value)));
const ready = (page, version) => page.waitForFunction(v => {
  const c = document.querySelector('.canvas-host > canvas');
  return document.querySelector('[role=status]')?.textContent.startsWith('ready:') && Number(c?.dataset.sceneVersion) >= v;
}, version, { timeout: 15000 });
const version = page => page.locator('.canvas-host > canvas').evaluate(c => Number(c.dataset.sceneVersion));

test('integration hooks other owners rely on are intact', async () => {
  const { page, context, errors } = await open();
  const hooks = await page.evaluate(() => ({
    firstCanvasInHost: document.querySelector('canvas')?.parentElement?.classList.contains('canvas-host'),
    status: document.querySelector('[role=status]')?.textContent ?? '',
    pres: document.querySelectorAll('pre').length,
    padding: getComputedStyle(document.querySelector('.canvas-host')).padding,
  }));
  assert.equal(hooks.firstCanvasInHost, true, 'the image canvas must stay the first <canvas>');
  assert.match(hooks.status, /^ready: /);
  assert.equal(hooks.pres, 1, 'exactly one <pre> (the hidden inspection record)');
  assert.equal(hooks.padding, '0px');
  assert.equal(await page.getByRole('button', { name: 'Inspect a computed mirror example' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Reset', exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('document structure: numbered chapters, index with scroll-spy, numbered figures and equations', async () => {
  const { page, context } = await open();
  await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.eq-no').length > 0);
  const s = await page.evaluate(() => ({
    chapters: [...document.querySelectorAll('.chapter > h2')].map(h => h.textContent),
    toc: [...document.querySelectorAll('.toc a')].map(a => a.getAttribute('href')),
    figures: [...document.querySelectorAll('figcaption .figure-label, .math-fig figcaption b')].map(b => b.textContent.trim()),
    equations: [...document.querySelectorAll('.eq-no')].map(e => e.textContent),
    checks: [...document.querySelectorAll('.math-check')].map(c => c.className),
  }));
  assert.deepEqual(s.chapters, ['1The picture', '2Follow one pixel', '3The mathematics', '4Implementation', '5Limits and credits']);
  assert.deepEqual(s.toc, ['#ch-1', '#ch-2', '#ch-3', '#ch-4', '#ch-5']);
  assert.ok(s.figures.includes('Figure 1.1.') && s.figures.includes('Figure 2.1.') && s.figures.includes('Figure 3.1.'), s.figures.join(' '));
  assert.equal(s.equations[0], '(3.1)');
  assert.ok(s.equations.every((e, i) => e === `(3.${i + 1})`), 'equations are numbered consecutively');
  assert.ok(s.checks.length > 0 && s.checks.every(c => !c.includes('bad')), 'every recomputation matches the tracer');
  await page.locator('.toc a[href="#ch-3"]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.querySelector('.toc a[aria-current="true"]')?.getAttribute('href')), '#ch-3');
  await context.close();
});

test('numeric pixel selector inspects the typed pixel', async () => {
  const { page, context } = await open();
  await page.getByLabel('Pixel column x, counted from the left').fill('100');
  await page.getByLabel('Pixel row y, counted from the top').fill('50');
  await page.getByLabel('Pixel row y, counted from the top').press('Enter');
  await page.waitForFunction(() => document.querySelector('pre')?.textContent?.includes('"x":100'));
  const p = await inspected(page);
  assert.deepEqual([p.x, p.y], [100, 50]);
  await context.close();
});

test('Figure 3.1: drag the pixel in the image-space grid, or step it with the arrow keys', async () => {
  const { page, context, errors } = await open();
  await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  const grid = page.locator('[data-drag="pixel-grid"]');
  await grid.waitFor();
  await grid.scrollIntoViewIfNeeded();
  const box = await grid.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.15, { steps: 6 });
  await page.waitForTimeout(150);
  const mid = await inspected(page);
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.85, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const end = await inspected(page);
  assert.ok(mid.x < mid.width * 0.2 && mid.y < mid.height * 0.25, `dragging to the top left selects a top-left pixel: ${JSON.stringify(mid)}`);
  assert.ok(end.x > end.width * 0.8 && end.y > end.height * 0.75, `dragging to the bottom right selects a bottom-right pixel: ${JSON.stringify(end)}`);
  // Keyboard: one grid cell (1/16 of the width) per arrow press; focus survives the rebuild.
  await page.locator('[data-drag="pixel-grid"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  const left = await inspected(page);
  assert.equal(left.x, end.x - Math.round(end.width / 16));
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-drag')), 'pixel-grid', 'focus stays on the grid');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Figure 2.1: drag the colored object and the light; keyboard steps them', async () => {
  const { page, context, errors } = await open();
  await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  const target = page.locator('[data-drag="target"]');
  await target.waitFor();
  await target.scrollIntoViewIfNeeded();
  const [targetX0, , lightX0] = await controls(page); // range inputs in DOM order: object x, camera, light, bounces
  const v0 = await version(page);
  const tb = await target.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2 + 60, tb.y + tb.height / 2, { steps: 8 });
  await page.mouse.up();
  await ready(page, v0 + 1);
  const [targetX1] = await controls(page);
  assert.ok(targetX1 > targetX0, `dragging right moves the object toward +x: ${targetX0} -> ${targetX1}`);
  // Keyboard on the handle: exactly one control step (0.05).
  await page.locator('[data-drag="target"]').focus();
  const v1 = await version(page);
  await page.keyboard.press('ArrowLeft');
  await ready(page, v1 + 1);
  const [targetX2] = await controls(page);
  assert.ok(Math.abs(targetX2 - (targetX1 - 0.05)) < 1e-9, `ArrowLeft steps by 0.05: ${targetX1} -> ${targetX2}`);
  // The light, if drawn inside the figure, is a handle too.
  const light = page.locator('[data-drag="light"]');
  if (await light.count()) {
    await light.focus();
    const v2 = await version(page);
    await page.keyboard.press('ArrowRight');
    await ready(page, v2 + 1);
    const values = await controls(page);
    const expected = Math.min(4, lightX0 + 0.1);
    assert.ok(Math.abs(values[2] - expected) < 1e-9, `light ArrowRight steps by 0.1 (clamped at 4): ${lightX0} -> ${values[2]}`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('linked highlighting: an equation term and its figure element light up together', async () => {
  const { page, context } = await open();
  await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.math-step [data-ref="delta"]').length >= 2);
  const section = page.locator('.math-step', { has: page.locator('svg [data-ref="delta"]') }).first();
  // A visible term: the one in the derivation is inside a collapsed <details>.
  const term = section.locator('.blk-numbers math [data-ref="delta"]').first();
  await term.scrollIntoViewIfNeeded();
  await term.hover();
  const fromEquation = await section.evaluate(s => [...s.querySelectorAll('[data-ref="delta"]')].map(n => n.classList.contains('is-linked')));
  assert.ok(fromEquation.length >= 2 && fromEquation.every(Boolean), `hovering the equation term links every delta element: ${fromEquation}`);
  await page.mouse.move(0, 0);
  const cleared = await section.evaluate(s => [...s.querySelectorAll('.is-linked')].length);
  assert.equal(cleared, 0, 'moving away clears the highlight');
  await section.locator('svg [data-ref="N"] text').first().hover(); // a reader points at the label
  const fromFigure = await section.evaluate(s => [...s.querySelectorAll('math [data-ref="N"]')].some(n => n.classList.contains('is-linked')));
  assert.ok(fromFigure, 'hovering the figure element links the equation term');
  await context.close();
});

test('chapter 4 shows the real CPU and GPU source, linked from chapter 3, without a second <pre>', async () => {
  const { page, context, errors } = await open();
  await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.impl-link a').length > 0);
  const r = await page.evaluate(() => ({
    listings: [...document.querySelectorAll('code.listing')].map(c => c.textContent),
    pres: document.querySelectorAll('pre').length,
    links: [...document.querySelectorAll('.impl-link a')].map(a => a.getAttribute('href')),
    targets: [...document.querySelectorAll('.source-step')].map(s => s.id),
  }));
  assert.equal(r.listings.length, 8, 'four operations, CPU and GPU each');
  assert.ok(r.listings.every(t => !t.includes('not found in')), 'every named function was extracted from the real source');
  assert.ok(r.listings.some(t => t.includes('export function nearestHit(scene: Scene')), 'the CPU listing is the tracer source');
  assert.ok(r.listings.some(t => /Hit intersectSphere\(vec3 origin/.test(t)), 'the GPU listing is the compiled GLSL');
  assert.equal(r.pres, 1, 'listings use <code class="listing">, never <pre>');
  assert.ok(r.links.length >= 4 && r.links.every(h => r.targets.includes(h.slice(1))), 'every implementation link has a target');
  assert.deepEqual(errors, []);
  await context.close();
});
