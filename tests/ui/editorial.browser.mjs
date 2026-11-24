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
/** Chapter 3 starts as the simplified result; "Explain more" shows every step. */
async function expandMath(page) {
  const more = page.locator('.math-more');
  await more.waitFor();
  if (await more.getAttribute('aria-expanded') !== 'true') await more.click();
  await page.waitForFunction(() => document.querySelector('.math-more')?.getAttribute('aria-expanded') === 'true');
}

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

test('document structure: three chapters, index with scroll-spy, numbered figures and equations', async () => {
  const { page, context } = await open();
  await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  // Collapsed: only the simplified result, with no step numbers.
  await page.waitForFunction(() => document.querySelectorAll('.math-step').length === 1);
  const collapsed = await page.evaluate(() => ({
    title: document.querySelector('.math-step h3')?.textContent,
    visibleNumbers: [...document.querySelectorAll('.math-step .eq-no')].filter(e => e.offsetParent !== null).length,
  }));
  assert.equal(collapsed.title, 'Simplified result');
  assert.equal(collapsed.visibleNumbers, 0);
  await expandMath(page);
  await page.waitForFunction(() => document.querySelectorAll('.math-step').length > 1);
  const s = await page.evaluate(() => ({
    chapters: [...document.querySelectorAll('.chapter > h2')].map(h => h.textContent),
    toc: [...document.querySelectorAll('.toc a')].map(a => a.getAttribute('href')),
    figures: [...document.querySelectorAll('figcaption .figure-label, .math-fig figcaption b')].map(b => b.textContent.trim()),
    equations: [...document.querySelectorAll('.eq-no')].map(e => e.textContent),
    removed: document.querySelectorAll('.math-check, .blk-assume, .impl-link, #ch-4, #ch-5').length,
    lastTitle: [...document.querySelectorAll('.math-step h3')].at(-1)?.textContent,
  }));
  assert.deepEqual(s.chapters, ['1The picture', '2Follow one pixel', '3The mathematics']);
  assert.deepEqual(s.toc, ['#ch-1', '#ch-2', '#ch-3']);
  assert.ok(s.figures.includes('Figure 1.1.') && s.figures.includes('Figure 2.1.') && s.figures.includes('Figure 3.1.'), s.figures.join(' '));
  assert.equal(s.equations[0], '(3.1)');
  assert.ok(s.equations.every((e, i) => e === `(3.${i + 1})`), 'equations are numbered consecutively');
  assert.equal(s.removed, 0, 'no checks, assumption lists, implementation links or chapters 4 and 5');
  assert.match(s.lastTitle, /^3\.\d+From light to a screen color$/, 'expanded, the simplified result is the last numbered step');
  await page.locator('.toc a[href="#ch-3"]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.querySelector('.toc a[aria-current="true"]')?.getAttribute('href')), '#ch-3');
  await context.close();
});

test('the pixel answer is one short paragraph, and the steps open with Explain more', async () => {
  const { page, context } = await open();
  await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  await page.waitForFunction(() => document.querySelector('.explain .summary')?.textContent.startsWith('Pixel ('));
  const before = await page.evaluate(() => ({
    answer: document.querySelector('.explain .summary').textContent,
    stepsHidden: document.querySelector('.events').hidden,
    button: document.querySelector('.explain-more')?.textContent,
    afterFigure: document.querySelector('.schematic')?.nextElementSibling?.classList.contains('explain-more'),
  }));
  assert.ok(before.answer.split(/\s+/).length < 50, before.answer);
  assert.equal(before.stepsHidden, true);
  assert.equal(before.button, 'Explain more');
  assert.equal(before.afterFigure, true, 'the button sits right after Figure 2.1');
  await page.locator('.explain-more').click();
  assert.equal(await page.evaluate(() => document.querySelector('.events').hidden), false);
  assert.ok(await page.locator('.events li').count() > 0);
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
  await expandMath(page);
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
  const light = page.locator('[data-drag="light-0"]');
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
  await expandMath(page);
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

test('the typeset shading law and its numbers divide by π, as the contract and both tracers do', async () => {
  // A missing 1/π in the printed law once went unnoticed. Check the rendered text itself.
  const { page, context, errors } = await open();
  await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  await expandMath(page);
  const section = page.locator('.math-step', { has: page.locator('h3', { hasText: 'Is the light visible?' }) }).first();
  await section.waitFor();
  const text = await section.evaluate(s => ({
    law: s.querySelector('.blk-law math')?.textContent ?? '',
    numbers: [...s.querySelectorAll('.blk-numbers math')].map(m => m.textContent).join(' '),
  }));
  assert.match(text.law, /π[\s\u2062]*max/, `law: ${text.law}`); // U+2062: invisible times
  assert.match(text.numbers, /π\s*⋅\s*\d/, `numbers: ${text.numbers}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Figure 2.1 instrument: the room shows before a pick; camera and every light are handles; clicking a surface follows its pixel', async () => {
  const { page, context, errors } = await open();
  await page.getByRole('tab', { name: /Lights/ }).click();
  await page.locator('.add-light').click();
  await ready(page, 2);
  const handles = await page.evaluate(() => [...document.querySelectorAll('.ray-diagram [data-drag]')].map(e => e.getAttribute('data-drag')));
  assert.deepEqual(handles.sort(), ['camera', 'light-0', 'light-1', 'target'], 'room drawn and draggable before any pixel is picked');

  // Keyboard on the camera handle orbits it one degree per press.
  const v0 = await version(page);
  await page.locator('[data-drag="camera"]').focus();
  await page.keyboard.press('ArrowRight');
  await ready(page, v0 + 1);
  assert.equal(await page.evaluate(() => window.__view?.controls.cameraYawDeg ?? Number(document.querySelector('input[id$="-camera"]').value)), 1);

  // Keyboard on an extra light moves it up (height) by one step.
  const before = Number(await page.locator('input[id$="-light1-y"]').inputValue());
  const v1 = await version(page);
  await page.locator('[data-drag="light-1"]').focus();
  await page.keyboard.press('ArrowUp');
  await ready(page, v1 + 1);
  const after = Number(await page.locator('input[id$="-light1-y"]').inputValue());
  assert.ok(Math.abs(after - (before + 0.1)) < 1e-9, `light 2 height ${before} -> ${after}`);

  // A plain click on the colored object follows the pixel that looks at it.
  const globe = await page.locator('[data-drag="target"]').boundingBox();
  await page.mouse.click(globe.x + globe.width / 2, globe.y + globe.height / 2);
  await page.waitForFunction(() => document.querySelector('pre')?.textContent);
  const record = await page.locator('pre').evaluate(p => JSON.parse(p.textContent));
  assert.equal(record.result.events.find(e => e.kind === 'hit').hit.objectId, 'target');
  assert.match(await page.locator('.explain .summary').textContent(), /colored object/);
  assert.ok(await page.locator('.replay-path').isVisible(), 'a Replay button appears with a path');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Figure 2.1 plays a new path step by step, and shows it at once under reduced motion', async () => {
  const { page, context } = await open();
  await page.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  // Mid-play, the first path segment is still short and a light dot rides its tip.
  await page.waitForTimeout(250);
  const mid = await page.evaluate(() => ({ photons: document.querySelectorAll('.ray-diagram .photon').length }));
  assert.ok(mid.photons > 0, 'the travelling dot is present while the path draws');
  await page.waitForTimeout(3200);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.ray-diagram .photon').length), 0, 'the dot is gone when the path is complete');
  await context.close();

  const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const p2 = await reduced.newPage();
  await p2.goto(url);
  await p2.waitForFunction(() => document.querySelector('[role=status]')?.textContent.startsWith('ready:'), null, { timeout: 20000 });
  await p2.getByRole('button', { name: 'Inspect a computed mirror example' }).click();
  await p2.waitForTimeout(150);
  const still = await p2.evaluate(() => ({
    photons: document.querySelectorAll('.ray-diagram .photon').length,
    hidden: [...document.querySelectorAll('.ray-diagram svg *')].filter(e => e.style?.opacity === '0').length,
    replayHidden: document.querySelector('.replay-path')?.style.visibility === 'hidden',
  }));
  assert.deepEqual(still, { photons: 0, hidden: 0, replayHidden: true });
  await reduced.close();
});

test('Figure 2.1 stays room-sized for far bounces, and Reset restores the view, the scene and the pixel', async () => {
  const { page, context, errors } = await open();
  // Camera at 40°: the centre pixel's bounce lands ~636 units away on the infinite floor.
  const v0 = await version(page);
  await page.locator('input[id$="-camera"]').evaluate(input => { input.value = '40'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await ready(page, v0 + 1);
  await page.getByLabel('Pixel column x, counted from the left').fill('320');
  await page.getByLabel('Pixel row y, counted from the top').fill('180');
  await page.getByLabel('Pixel row y, counted from the top').press('Enter');
  await page.waitForFunction(() => document.querySelector('pre')?.textContent?.includes('"x":320'));
  const far = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('.ray-diagram svg text')].map(t => t.textContent);
    const hits = JSON.parse(document.querySelector('pre').textContent).result.events.filter(e => e.kind === 'hit').map(e => e.hit.point);
    return { farthest: Math.max(...hits.flat().map(Math.abs)), ticks: Math.max(...texts.filter(t => /^-?\d+$/.test(t)).map(Number)), continues: texts.some(t => t.startsWith('continues to')) };
  });
  assert.ok(far.farthest > 100, `the scenario really reaches far: ${far.farthest}`);
  assert.ok(far.ticks <= 8, `the frame stays room-sized (largest tick ${far.ticks})`);
  assert.ok(far.continues, 'the cut ray says where it continues');

  // Turn the view, then Reset everything.
  await page.locator('.ray-diagram').focus();
  await page.keyboard.press('ArrowLeft');
  const v1 = await version(page);
  await page.locator('.reset-figure').click();
  await ready(page, v1 + 1);
  const after = await page.evaluate(() => ({
    yaw: document.querySelector('input[id$="-camera"]').value,
    record: document.querySelector('pre').textContent,
    marker: document.querySelector('.pixel-marker').hidden,
  }));
  assert.deepEqual(after, { yaw: '0', record: '', marker: true });
  assert.deepEqual(errors, []);
  await context.close();
});
