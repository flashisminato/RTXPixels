import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeDisplay } from '../../src/core/index.ts';
import { findMirrorExample, fitBuffer, inspectNormalized, inspectPixel, makeFrame, normalizedPixel } from '../../src/core/frame.ts';
import { createStore, initialView } from '../../src/state/index.ts';
import { drawFallback } from '../../src/fallback/index.ts';

function canvasFixture(width: number, height: number) {
  let writes = 0;
  let pixels: Uint8ClampedArray | null = null;
  const canvas = {
    width, height,
    getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: { data: Uint8ClampedArray }) => { writes++; pixels = image.data; },
    }),
  } as unknown as HTMLCanvasElement;
  return { canvas, writes: () => writes, pixels: () => pixels! };
}

test('buffer sizing fits host aspect and caps on small, portrait, and high-DPI hosts', () => {
  assert.deepEqual(fitBuffer(1280, 720, 2), { width: 640, height: 360 });
  assert.deepEqual(fitBuffer(200, 100, 2), { width: 400, height: 200 });
  assert.deepEqual(fitBuffer(300, 600, 3), { width: 180, height: 360 });
  assert.deepEqual(fitBuffer(1000, 500, 2, 160, 90), { width: 160, height: 80 });
  assert.deepEqual(fitBuffer(1280, 720, 2, 160, 90), { width: 160, height: 90 });
  assert.throws(() => fitBuffer(0, 10));
  assert.throws(() => fitBuffer(10, 10, Infinity));
});

test('selection uses real top-left integer pixels and recomputes after resize', () => {
  assert.deepEqual(normalizedPixel(0, 0, 160, 90), { x: 0, y: 0 });
  assert.deepEqual(normalizedPixel(1, 1, 160, 90), { x: 159, y: 89 });
  assert.deepEqual(normalizedPixel(0.25, 0.75, 160, 90), { x: 40, y: 67 });
  assert.throws(() => normalizedPixel(NaN, 0.5, 160, 90));
  assert.throws(() => normalizedPixel(1.1, 0.5, 160, 90));
  const view = initialView();
  const small = inspectNormalized(makeFrame(view, 160, 90), 0.25, 0.75);
  const large = inspectNormalized(makeFrame(view, 640, 360), 0.25, 0.75);
  assert.equal(small.sceneVersion, large.sceneVersion);
  assert.equal(large.pixel.x, 160);
  assert.equal(large.pixel.y, 270);
  assert.notDeepEqual(small.ray.direction, large.ray.direction); // Different pixel centers, not a reused trace.
  assert.throws(() => inspectPixel(makeFrame(view, 160, 90), 160, 0));
});

test('deterministic preset search finds an actual mirror then target at both resolutions', () => {
  for (const [width, height] of [[160, 90], [640, 360]]) {
    const frame = makeFrame(initialView(), width, height);
    const example = findMirrorExample(frame);
    assert.ok(example, 'The original scene must contain a visible mirror on the search grid.');
    assert.equal(example.reflectedTarget, true, 'The preset must demonstrate a computed reflected target.');
    assert.deepEqual(example.inspection.result.events.filter(e => e.kind === 'hit').map(e => e.hit.objectId), ['mirror', 'target']);
    assert.deepEqual(example.inspection, inspectPixel(frame, example.inspection.pixel.x, example.inspection.pixel.y));
  }
});

test('example search reports unavailable paths honestly for missing mirror and diagnostics', () => {
  const view = initialView();
  view.scene.objects = view.scene.objects.filter(object => object.id !== 'mirror');
  assert.equal(findMirrorExample(makeFrame(view, 160, 90)), null);
  const diagnostic = initialView(); diagnostic.controls.viewMode = 'hit';
  const example = findMirrorExample(makeFrame(diagnostic, 160, 90))!;
  assert.equal(example.reflectedTarget, false);
  assert.deepEqual(example.inspection.result.events.map(e => e.kind), ['hit', 'end']);
});

test('CPU fallback commits exactly one complete image matching single-pixel inspection', async () => {
  const frame = makeFrame(initialView(), 16, 9);
  const fixture = canvasFixture(16, 9);
  const done = await drawFallback(fixture.canvas, frame, { signal: new AbortController().signal, isCurrent: () => true });
  assert.equal(done, true);
  assert.equal(fixture.writes(), 1);
  for (const [x, y] of [[0, 0], [8, 4], [15, 8]]) {
    const color = encodeDisplay(inspectPixel(frame, x, y).result.linearColor, frame.options.viewMode);
    const actual = Array.from(fixture.pixels().slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
    assert.deepEqual(actual, [...color.map(c => Math.round(c * 255)), 255]);
  }
});

test('aborted and stale fallback work never writes pixels', async () => {
  const frame = makeFrame(initialView(), 160, 90);
  for (const kind of ['abort', 'stale'] as const) {
    const fixture = canvasFixture(160, 90);
    const controller = new AbortController();
    let current = true;
    const work = drawFallback(fixture.canvas, frame, { signal: controller.signal, isCurrent: () => current });
    if (kind === 'abort') controller.abort(); else current = false;
    assert.equal(await work, false);
    assert.equal(fixture.writes(), 0);
  }
  const controller = new AbortController(); controller.abort();
  const fixture = canvasFixture(160, 90);
  assert.equal(await drawFallback(fixture.canvas, frame, { signal: controller.signal, isCurrent: () => true }), false);
});

test('fallback rejects missing 2D context and mismatched buffers', async () => {
  const options = { signal: new AbortController().signal, isCurrent: () => true };
  const frame = makeFrame(initialView(), 16, 9);
  await assert.rejects(drawFallback({ getContext: () => null } as unknown as HTMLCanvasElement, frame, options), /Canvas2D/);
  await assert.rejects(drawFallback(canvasFixture(32, 18).canvas, frame, options), /does not match/);
});

test('scene change cancels stale frame/inspection adoption', async () => {
  const store = createStore();
  const frame = makeFrame(store.getSnapshot(), 160, 90);
  const fixture = canvasFixture(160, 90);
  const work = drawFallback(fixture.canvas, frame, { signal: new AbortController().signal,
    isCurrent: () => store.getSnapshot().sceneVersion === frame.sceneVersion });
  store.dispatch({ type: 'reset' });
  assert.equal(await work, false);
  assert.equal(fixture.writes(), 0);
  assert.equal(store.setInspection(inspectPixel(frame, 80, 45)), false);
});
