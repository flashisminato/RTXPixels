import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MATERIALS, MAX_OBJECTS } from '../../src/contracts.ts';
import type { Action, Vec3 } from '../../src/contracts.ts';
import { inspectPixel, makeFrame } from '../../src/core/frame.ts';
import { BALL_BOUNDS, BALL_RADIUS, MAX_BALLS, MIRROR_BALL, targetPositionIsFree } from '../../src/scene/preset.ts';
import { settle, stepPhysics, type Body } from '../../src/scene/physics.ts';
import { createStore } from '../../src/state/index.ts';
import { buildExplanation } from '../../src/ui/explain.ts';
import { buildMathStory } from '../../src/ui/math-model.ts';

const bounds = { x: BALL_BOUNDS.x, z: BALL_BOUNDS.z };
const ball = (pos: Vec3, vel: Vec3 = [0, 0, 0]): Body => ({ pos: [...pos] as Vec3, vel: [...vel] as Vec3, r: BALL_RADIUS });

test('a dropped ball falls, bounces lower each time, and comes to rest on the floor', () => {
  const b = ball([1, 4, -1]);
  let peaks = 0, lastPeak = Infinity, prevVy = 0;
  for (let t = 0; t < 8; t += 1 / 60) {
    const moving = stepPhysics([b], [], bounds, 1 / 60);
    if (prevVy > 0 && b.vel[1] <= 0) { assert.ok(b.pos[1] < lastPeak, 'each bounce is lower'); lastPeak = b.pos[1]; peaks++; }
    prevVy = b.vel[1];
    if (!moving) break;
  }
  assert.ok(peaks >= 1, 'it bounced');
  assert.ok(Math.abs(b.pos[1] - BALL_RADIUS) < 1e-6, `resting on the floor: y = ${b.pos[1]}`);
  assert.deepEqual(b.vel, [0, 0, 0]);
});

test('a ball never comes to rest in mid-air at the top of a bounce', () => {
  const b = ball([0, 0.5, -2], [0, 0.04, 0]); // nearly still, just above the floor
  stepPhysics([b], [], bounds, 1 / 60);
  assert.notDeepEqual(b.vel, [0, 0, 0], 'not supported, so it keeps falling');
  settle([b], [], bounds);
  assert.ok(Math.abs(b.pos[1] - BALL_RADIUS) < 1e-6);
});

test('balls bounce off the walls, the fixed spheres and each other, and never end up overlapping', () => {
  const bodies = [ball([4.4, 3, 0], [3, 0, 0]), ball([-1, 3, -2.9], [0, 0, -3]), ball([0.3, 3.2, 1.4]), ball([0.6, 5, 1.6])];
  const statics = [{ center: MIRROR_BALL.center, r: MIRROR_BALL.radius }, { center: [-2.1, 0.65, -0.4] as Vec3, r: 0.65 }];
  settle(bodies, statics, bounds);
  for (const b of bodies) {
    assert.ok(b.pos[0] >= bounds.x.min - 1e-9 && b.pos[0] <= bounds.x.max + 1e-9 && b.pos[2] >= bounds.z.min - 1e-9 && b.pos[2] <= bounds.z.max + 1e-9);
    assert.ok(b.pos[1] >= BALL_RADIUS - 1e-9);
    for (const s of statics) assert.ok(Math.hypot(...b.pos.map((c, i) => c - s.center[i])) >= BALL_RADIUS + s.r - 1e-3, 'outside the fixed spheres');
  }
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    assert.ok(Math.hypot(...bodies[i].pos.map((c, k) => c - bodies[j].pos[k])) >= 2 * BALL_RADIUS - 1e-2, `balls ${i} and ${j} overlap`);
  }
});

test('a held ball stays put while others bounce off it', () => {
  const held = { ...ball([0, 2, -2]), held: true };
  const other = ball([0, 3.5, -2]);
  settle([held, other], [], bounds, 3);
  assert.deepEqual(held.pos, [0, 2, -2]);
  assert.ok(Math.abs(other.pos[1] - BALL_RADIUS) < 1e-6 || other.pos[1] > 2, 'the other one rolled off or rests on it');
});

test('adding balls: labels, own materials, capped so the scene fits the renderer; reset removes them', () => {
  const store = createStore();
  for (let i = 0; i < MAX_BALLS; i++) store.dispatch({ type: 'ball-add' });
  const full = store.getSnapshot();
  assert.deepEqual(full.controls.balls.map(b => b.n), [1, 2, 3, 4]);
  assert.ok(full.scene.objects.length <= MAX_OBJECTS && full.scene.materials.length <= MAX_MATERIALS);
  assert.throws(() => store.dispatch({ type: 'ball-add' }));
  store.dispatch({ type: 'ball-color', index: 1, value: 4 });
  store.dispatch({ type: 'ball-mode', index: 1, value: 'mirror' });
  assert.equal(store.getSnapshot().scene.materials[5].mode, 'mirror');
  store.dispatch({ type: 'ball-remove', index: 0 });
  store.dispatch({ type: 'ball-add' });
  assert.deepEqual(store.getSnapshot().controls.balls.map(b => b.n), [2, 3, 4, 1], 'the freed label is reused');
  store.dispatch({ type: 'reset' });
  const reset = store.getSnapshot();
  assert.equal(reset.controls.balls.length, 0);
  assert.deepEqual(reset.scene.objects.map(o => o.id), ['mirror', 'target', 'floor', 'back-wall'], 'back to the orange ball and the mirror ball');
});

test('ball and colored-ball moves are validated: bounds, the mirror ball, physics frames', () => {
  const store = createStore();
  store.dispatch({ type: 'ball-add' });
  const before = store.getSnapshot();
  const bad: unknown[] = [
    { type: 'ball-move', index: 0, axis: 'y', value: 99 }, { type: 'ball-move', index: 3, axis: 'x', value: 0 },
    { type: 'ball-color', index: 0, value: 99 }, { type: 'ball-mode', index: 0, value: 'glass' },
    { type: 'balls-step', positions: [] }, { type: 'balls-step', positions: [[NaN, 1, 1]] },
    // The colored ball may not move into the mirror ball (default x 0 is clear at z -0.4, not at z 1.5).
    { type: 'target-move', axis: 'z', value: 1.5 }, { type: 'target-move', axis: 'x', value: 9 },
  ];
  store.dispatch({ type: 'target-move', axis: 'x', value: 0 });
  const ready = store.getSnapshot();
  for (const action of bad) {
    assert.throws(() => store.dispatch(action as Action), /./, JSON.stringify(action));
    assert.equal(store.getSnapshot(), ready);
  }
  assert.notEqual(ready, before);
  assert.equal(targetPositionIsFree([0, 1, 1.5]), false);
  // A physics frame slightly outside the bounds is clamped, not rejected.
  store.dispatch({ type: 'balls-step', positions: [[9, 0.1, 0]] });
  const b = store.getSnapshot().controls.balls[0];
  assert.deepEqual([b.x, b.y], [BALL_BOUNDS.x.max, BALL_BOUNDS.y.min]);
});

test('with balls in the room, every pixel is explained and chapter 3 reproduces the traced color', () => {
  const store = createStore();
  for (let i = 0; i < MAX_BALLS; i++) store.dispatch({ type: 'ball-add' });
  store.dispatch({ type: 'ball-mode', index: 2, value: 'mirror' });
  // Let them settle, as the page would.
  const bodies = store.getSnapshot().controls.balls.map(b => ball([b.x, b.y, b.z]));
  settle(bodies, [{ center: MIRROR_BALL.center, r: 1 }, { center: [-2.1, 0.65, -0.4], r: 0.65 }], bounds);
  store.dispatch({ type: 'balls-step', positions: bodies.map(b => b.pos) });
  const view = store.getSnapshot();
  const frame = makeFrame(view, 160, 90);
  let ballHits = 0;
  for (let y = 2; y < 90; y += 4) for (let x = 2; x < 160; x += 4) {
    const inspection = inspectPixel(frame, x, y);
    if (inspection.result.events.some(e => e.kind === 'hit' && e.hit.objectId.startsWith('ball-'))) ballHits++;
    const { answer } = buildExplanation({ ...view, inspection });
    assert.ok(answer.split(/\s+/).length < 50, answer);
    const story = buildMathStory({ ...view, inspection });
    if (story.kind === 'story' && story.story.shade?.colorError != null) assert.ok(story.story.shade.colorError < 1e-9);
  }
  assert.ok(ballHits > 20, `pixels that see a ball: ${ballHits}`);
  assert.match(buildExplanation({ ...view, inspection: inspectPixel(frame, 0, 0) }).answer, /Pixel \(0, 0\)/);
});

test('a ball can be switched to Static and back; static balls are obstacles that never move', () => {
  const store = createStore();
  store.dispatch({ type: 'ball-add' });
  assert.equal(store.getSnapshot().controls.balls[0].physics, true, 'new balls follow physics');
  store.dispatch({ type: 'ball-physics', index: 0, value: false });
  assert.equal(store.getSnapshot().controls.balls[0].physics, false);
  assert.throws(() => store.dispatch({ type: 'ball-physics', index: 0, value: 'yes' } as unknown as Action));
  // In the physics, a static ball is a held body: it stays in mid-air and others bounce off it.
  const still = { ...ball([0, 2.5, -1]), held: true };
  const falling = ball([0.1, 4.5, -1]);
  settle([still, falling], [], bounds, 6);
  assert.deepEqual(still.pos, [0, 2.5, -1]);
  assert.ok(Math.hypot(...falling.pos.map((c, i) => c - still.pos[i])) >= 2 * BALL_RADIUS - 1e-2, 'the falling ball did not pass through it');
});
