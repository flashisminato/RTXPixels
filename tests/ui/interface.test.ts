// UI explanation checks. CPU traces and hand-built events here are test fixtures.
// They do not verify the GPU renderer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TraceEvent, Vec3, ViewState } from '../../src/contracts.ts';
import { findMirrorExample, makeFrame } from '../../src/core/frame.ts';
import { reflect } from '../../src/core/vector.ts';
import { createPreset, initialControls } from '../../src/scene/preset.ts';
import { CANVAS_LABEL, SCHEMATIC_NOTE, buildExplanation, incidenceDegrees, project, reflectionDegrees, screenMapper } from '../../src/ui/explain.ts';
import { normalizedPoint, snapToStep, stepSelection } from '../../src/ui/selection.ts';

test('selection uses the host content rectangle and arrow keys move one pixel', () => {
  assert.deepEqual(normalizedPoint(10, 30, { left: 0, top: 20, width: 100, height: 50 }), { u: 0.1, v: 0.2 });
  assert.deepEqual(normalizedPoint(1000, -5, { left: 0, top: 0, width: 100, height: 100 }), { u: 1, v: 0 });
  assert.equal(normalizedPoint(0, 0, { left: 0, top: 0, width: 0, height: 10 }), null);

  const width = 160;
  const height = 90;
  const right = stepSelection({ u: (80 + 0.5) / width, v: (40 + 0.5) / height }, 'ArrowRight', width, height);
  const up = stepSelection({ u: (80 + 0.5) / width, v: (40 + 0.5) / height }, 'ArrowUp', width, height);
  assert.equal(right?.u, (81 + 0.5) / width);
  assert.equal(up?.v, (39 + 0.5) / height);
  assert.equal(stepSelection({ u: 0.5 / width, v: 0.5 }, 'ArrowLeft', width, height)?.u, 0);
  assert.equal(stepSelection(null, 'ArrowRight', 64, 64)?.u, 0.5 + 1 / 64);
  assert.equal(stepSelection({ u: 0.5, v: 0.5 }, 'Enter', 64, 64), null);
  assert.equal(snapToStep(-2.12, -2.8, -1.6, 0.05), -2.1);
  assert.equal(snapToStep(5, 0, 4, 1), 4);
  assert.equal(snapToStep(Number.NaN, 0, 4, 1), null);
});

test('3D view keeps sideways, up, and depth distinguishable, like a textbook frame', () => {
  assert.match(SCHEMATIC_NOTE, /3D view/);
  assert.match(CANVAS_LABEL, /not a second camera/);
  assert.match(CANVAS_LABEL, /\+Z depth/);
  const origin = project([0, 0, 0]);
  const side = project([1, 0, 0]);
  const up = project([0, 1, 0]);
  const depth = project([0, 0, 1]);
  assert.ok(side.x > origin.x && Math.abs(side.x - origin.x) > Math.abs(side.y - origin.y), '+x runs mostly sideways');
  assert.ok(up.y > origin.y && Math.abs(up.x - origin.x) < 1e-12, '+y is straight up');
  assert.ok(depth.x > origin.x && depth.y > origin.y, '+z recedes up and to the right');
  // A pure rotation: unit axes keep a common scale in 3D, so a sphere projects to a circle.
  const [a, b, c] = [side, up, depth].map(p => [p.x - origin.x, p.y - origin.y]);
  const gram = [[a[0] ** 2 + b[0] ** 2 + c[0] ** 2, a[0] * a[1] + b[0] * b[1] + c[0] * c[1]], [0, a[1] ** 2 + b[1] ** 2 + c[1] ** 2]];
  assert.ok(Math.abs(gram[0][0] - 1) < 1e-12 && Math.abs(gram[1][1] - 1) < 1e-12 && Math.abs(gram[0][1]) < 1e-12);
  const map = screenMapper([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], 400, 300, 20);
  assert.ok(map);
  const screenOrigin = map([0, 0, 0]);
  const screenSide = map([1, 0, 0]);
  const screenUp = map([0, 1, 0]);
  const screenDepth = map([0, 0, 1]);
  assert.ok(screenSide.x > screenOrigin.x);
  assert.ok(Math.abs(screenSide.x - screenOrigin.x) > Math.abs(screenSide.y - screenOrigin.y));
  assert.ok(screenUp.y < screenOrigin.y && Math.abs(screenUp.x - screenOrigin.x) < 1e-9);
  assert.ok(screenDepth.y < screenOrigin.y && screenDepth.x > screenOrigin.x);
  assert.equal(screenMapper([], 100, 100, 10), null);
});

test('incidence and reflection angles come from 3D directions', () => {
  const incidence = incidenceDegrees([-1, -1, 0], [0, 1, 0]);
  assert.ok(incidence !== null && Math.abs(incidence - 45) < 1e-6);
  assert.equal(incidenceDegrees([0, 0, 0], [0, 1, 0]), null);
  const incoming: Vec3 = [-0.6, -0.8, 0];
  const normal: Vec3 = [0, 1, 0];
  const outgoing = reflect(incoming, normal);
  const inAngle = incidenceDegrees(incoming, normal);
  const outAngle = reflectionDegrees(outgoing, normal);
  assert.ok(inAngle !== null && outAngle !== null && Math.abs(inAngle - outAngle) < 1e-6);
});

test('empty, starting, error, and stale views do not keep a path', () => {
  const waiting = buildExplanation(viewWith());
  assert.equal(waiting.diagram, null);
  assert.equal(waiting.items.length, 0);
  assert.match(waiting.modeNote, /Full picture/);
  assert.match(waiting.summary, /inspect a mirror pixel/i);

  const starting = buildExplanation({ ...viewWith(), status: 'starting', message: 'Computing.' });
  assert.match(starting.summary, /being computed/);
  const failed = buildExplanation({ ...viewWith(), status: 'error', message: 'shader failed' });
  assert.match(failed.summary, /unavailable/);
  assert.equal(failed.diagram, null);

  const hit = buildExplanation(viewWith({ ...initialControls(), viewMode: 'hit' }));
  assert.match(hit.modeNote, /First-hit diagnostic/);
  assert.match(hit.modeNote, /does not follow a reflection/);

  const real = mirrorExample();
  const stale = buildExplanation({ ...real.view, sceneVersion: real.view.sceneVersion + 1 });
  assert.equal(stale.stale, true);
  assert.equal(stale.diagram, null);
  assert.equal(stale.items.length, 0);
  assert.match(stale.summary, /hidden/);
  assert.match(stale.pixelLine, new RegExp(`version ${real.view.sceneVersion + 1}`));
  assert.match(stale.pixelLine, new RegExp(`version ${real.view.inspection?.sceneVersion}`));
});

test('a real mirror trace is explained in event order from 3D angles', () => {
  const { view, inspection } = mirrorExample();
  const explanation = buildExplanation({ ...view, inspection });
  assert.deepEqual(explanation.items.map(item => item.kind), inspection.result.events.map(event => event.kind));
  const text = explanation.items.map(item => `${item.title} ${item.detail}`).join('\n');
  const mirrorAt = text.indexOf('center sphere');
  const targetAt = text.indexOf('colored object');
  assert.ok(mirrorAt >= 0 && targetAt > mirrorAt);
  assert.match(text, /measured from the 3D directions/);
  assert.match(text, /drawing may still make them look unequal/);
  assert.doesNotMatch(text, /angles look equal/);
  const reflectEvent = inspection.result.events.find(event => event.kind === 'reflect');
  assert.ok(reflectEvent && reflectEvent.kind === 'reflect');
  const incidence = incidenceDegrees(reflectEvent.incoming, reflectEvent.normal);
  assert.ok(incidence !== null);
  assert.match(text, new RegExp(incidence.toFixed(1)));
  assert.match(explanation.math.join('\n'), /direction, not the light’s position/);
  const shadow = inspection.result.events.find(event => event.kind === 'shadow');
  assert.ok(shadow && shadow.kind === 'shadow' && explanation.diagram);
  const shadowSegment = explanation.diagram.segments.find(segment => segment.role === 'shadow-open' || segment.role === 'shadow-blocked');
  assert.ok(shadowSegment);
  if (shadow.blocked) {
    assert.equal(shadowSegment.role, 'shadow-blocked');
    assert.deepEqual(shadowSegment.to, shadow.blockerPoint);
  } else {
    assert.equal(shadowSegment.role, 'shadow-open');
    assert.deepEqual(shadowSegment.to, view.scene.light.position);
  }
  assert.notDeepEqual(shadowSegment.to, shadow.toLight);
});

test('budget and diagnostic traces do not invent the next bounce', () => {
  const budget = traced({ ...initialControls(), maxRedirects: 0 });
  const budgetExplanation = buildExplanation(budget.view);
  assert.match(budgetExplanation.summary, /bounce limit is 0/);
  assert.match(budgetExplanation.summary, /no next hit is computed/);
  assert.ok(budgetExplanation.diagram);
  assert.ok(budgetExplanation.diagram.segments.every(segment => segment.role === 'path' || segment.role === 'normal'));
  assert.ok(budgetExplanation.diagram.marks.every(mark => mark.role === 'camera' || mark.role === 'hit'));

  const diagnostic = traced({ ...initialControls(), viewMode: 'hit' });
  const diagnosticExplanation = buildExplanation(diagnostic.view);
  assert.match(diagnosticExplanation.summary, /first-hit check/i);
  assert.match(diagnosticExplanation.modeNote, /First-hit diagnostic/);
  assert.doesNotMatch(diagnosticExplanation.summary, /color is decided at the colored object/);
  const diagnosticEnd = diagnostic.inspection.result.events.at(-1);
  assert.equal(diagnosticEnd?.kind, 'end');
  assert.equal(diagnosticEnd?.kind === 'end' ? diagnosticEnd.reason : undefined, 'diagnostic');
  assert.ok(diagnosticExplanation.diagram?.segments.every(segment => segment.role !== 'shadow-open' && segment.role !== 'shadow-blocked'));
});

test('sky misses and shadow blockers use recorded points only', () => {
  const sky = buildExplanation(fixture([{ kind: 'end', reason: 'sky', from: [0, 1, -2], direction: [0, 0, 1] }]));
  assert.match(sky.summary, /not an error/);
  assert.equal(sky.diagram?.marks.filter(mark => mark.role === 'hit').length, 0);
  assert.match(sky.diagram?.segments[0]?.label ?? '', /not a hit/);

  const blocked = fixture([
    hit('target', [0, 1, -2], [0, 1, 0]),
    { kind: 'shadow', from: [0, 1.0001, 0], toLight: [0, 1, 0], blocked: true, blockerId: 'floor', blockerPoint: [0, 0, 0], nDotL: 0.5 },
    { kind: 'end', reason: 'surface', from: [0, 1, 0], direction: [0, 0, 1] },
  ]);
  const blockedExplanation = buildExplanation(blocked);
  const blockedSegment = blockedExplanation.diagram?.segments.find(segment => segment.role === 'shadow-blocked');
  assert.deepEqual(blockedSegment?.to, [0, 0, 0]);
  assert.ok(!blockedExplanation.diagram?.segments.some(segment => segment.to[0] === blocked.scene.light.position[0]
    && segment.to[1] === blocked.scene.light.position[1] && segment.to[2] === blocked.scene.light.position[2]));
  assert.match(blockedExplanation.items.map(item => item.title).join('\n'), /Shadow blocked by the floor/);

  const self = fixture([
    hit('target', [0, 1, -2], [0, 1, 0]),
    { kind: 'shadow', from: [0, 1.0001, 0], toLight: [0, 1, 0], blocked: true, blockerId: 'target', blockerPoint: [0, 1.2, 0], nDotL: 0 },
    { kind: 'end', reason: 'surface', from: [0, 1, 0], direction: [0, -1, 0] },
  ]);
  const selfText = buildExplanation(self).items.map(item => `${item.title} ${item.detail}`).join('\n');
  assert.match(selfText, /runs into the colored object again/);
  assert.match(selfText, /does not face the light/);
  assert.doesNotMatch(selfText, /Shadow blocked by the colored object/);

  const open = fixture([
    hit('floor', [0, 2, 0], [0, 0, 0]),
    { kind: 'shadow', from: [0, 0.0001, 0], toLight: [0, 1, 0], blocked: false, blockerId: null, blockerPoint: null, nDotL: 0 },
    { kind: 'end', reason: 'surface', from: [0, 0, 0], direction: [0, -1, 0] },
  ]);
  open.scene.light.position = [1, 4, -1];
  const openExplanation = buildExplanation(open);
  const openSegment = openExplanation.diagram?.segments.find(segment => segment.role === 'shadow-open');
  assert.deepEqual(openSegment?.to, [1, 4, -1]);
  assert.match(openExplanation.items.map(item => item.detail).join('\n'), /does not face the light/);
});

function viewWith(controls = initialControls(), sceneVersion = 1): ViewState {
  return {
    sceneVersion, scene: createPreset(controls), controls, inspection: null,
    status: 'ready', message: 'Test fixture, not a renderer result.',
  };
}

function traced(controls = initialControls()): { view: ViewState; inspection: NonNullable<ViewState['inspection']> } {
  const view = viewWith(controls);
  const found = findMirrorExample(makeFrame(view, 160, 90));
  assert.ok(found, 'expected the preset search to find a mirror pixel');
  return { view: { ...view, inspection: found.inspection }, inspection: found.inspection };
}

function mirrorExample(): { view: ViewState; inspection: NonNullable<ViewState['inspection']> } {
  return traced();
}

function fixture(events: TraceEvent[]): ViewState {
  const view = viewWith();
  view.inspection = {
    sceneVersion: view.sceneVersion,
    pixel: { x: 1, y: 2, width: 10, height: 8 },
    ray: { origin: [0, 1, -2], direction: [0, 0, 1] },
    result: { linearColor: [0.2, 0.3, 0.4], events },
  };
  return view;
}

function hit(objectId: string, from: Vec3, point: Vec3): TraceEvent {
  return {
    kind: 'hit', from, incoming: [0, -1, 0],
    hit: { objectId, materialIndex: 1, t: 1, point, outwardNormal: [0, 1, 0], normal: [0, 1, 0], frontFace: true },
  };
}

test('the direct answer names the pixel and stays under 50 words across the picture', async () => {
  const { createStore } = await import('../../src/state/index.ts');
  const { makeFrame, inspectPixel } = await import('../../src/core/frame.ts');
  const store = createStore();
  store.dispatch({ type: 'light-add' });
  for (const mode of ['beauty', 'hit'] as const) {
    if (mode === 'hit') store.dispatch({ type: 'view-mode', value: 'hit' });
    const view = store.getSnapshot();
    const frame = makeFrame(view, 160, 90);
    for (let y = 2; y < 90; y += 9) for (let x = 2; x < 160; x += 9) {
      const inspection = inspectPixel(frame, x, y);
      const { answer } = buildExplanation({ ...view, inspection });
      assert.ok(answer.startsWith(`Pixel (${x}, ${y}): `), answer);
      assert.ok(answer.split(/\s+/).length < 50, `${answer.split(/\s+/).length} words: ${answer}`);
      assert.doesNotMatch(answer, /picture version/i);
    }
  }
});

test('every figure element carries the step of the event that produced it, in order', async () => {
  const { createStore } = await import('../../src/state/index.ts');
  const { makeFrame, findMirrorExample } = await import('../../src/core/frame.ts');
  const store = createStore();
  store.dispatch({ type: 'light-add' });
  const view = store.getSnapshot();
  const example = findMirrorExample(makeFrame(view, 320, 180))!;
  const plan = buildExplanation({ ...view, inspection: example.inspection }).diagram!;
  const events = example.inspection.result.events;
  for (const item of [...plan.segments, ...plan.marks]) {
    assert.ok(Number.isInteger(item.step) && item.step! >= 0 && item.step! < events.length, JSON.stringify(item));
  }
  const firstPath = plan.segments.find(s => s.role === 'path')!;
  const shadow = plan.segments.find(s => s.role.startsWith('shadow'))!;
  assert.equal(events[firstPath.step!].kind, 'hit');
  assert.equal(events[shadow.step!].kind, 'shadow');
  assert.ok(firstPath.step! < shadow.step!, 'the camera ray comes before the shadow check');
});
