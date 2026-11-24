import type { Vec3 } from '../contracts.ts';

/**
 * Light physics for the added balls: gravity, bounces on the floor, the back wall
 * and invisible side walls, collisions with the room's fixed spheres and with
 * each other, and settling. Pure: no DOM and no clock, so it is unit-tested, and
 * the page only runs it while something is moving.
 */

/** `supported` is set each step when the floor or something below holds the body up. */
export type Body = { pos: Vec3; vel: Vec3; r: number; held?: boolean; supported?: boolean };
export type StaticSphere = { center: Vec3; r: number };
export type Bounds = { x: { min: number; max: number }; z: { min: number; max: number } };

export const GRAVITY = 9.8;           // units per second squared
export const FLOOR_BOUNCE = 0.55;     // fraction of downward speed kept on a floor bounce
export const WALL_BOUNCE = 0.6;
export const BALL_BOUNCE = 0.8;       // ball-on-ball, equal masses
export const STATIC_BOUNCE = 0.5;     // ball on a fixed sphere
const ROLLING_DRAG = 1.6;             // per second, while touching the floor
const REST_SPEED = 0.06;
const SUBSTEP = 1 / 120;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.sqrt(dot(a, a));

/**
 * Whether a body is resting: held up by the floor or by something beneath it, and
 * barely moving. A ball at the top of a bounce is slow too, but nothing holds it.
 */
export function atRest(body: Body): boolean {
  return !!body.supported && len(body.vel) < REST_SPEED;
}

/**
 * Advance every body by `dt` seconds (in fixed substeps). Returns true while
 * anything is still moving.
 */
export function stepPhysics(bodies: Body[], statics: StaticSphere[], bounds: Bounds, dt: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.min(dt, 0.1) / SUBSTEP));
  const h = Math.min(dt, 0.1) / steps;
  for (let s = 0; s < steps; s++) {
    for (const b of bodies) b.supported = false;
    for (const b of bodies) {
      if (b.held) { b.vel = [0, 0, 0]; continue; }
      b.vel[1] -= GRAVITY * h;
      for (let i = 0; i < 3; i++) b.pos[i] += b.vel[i] * h;
      // Floor.
      if (b.pos[1] < b.r) {
        b.pos[1] = b.r;
        if (b.vel[1] < 0) b.vel[1] = -b.vel[1] * FLOOR_BOUNCE;
        if (b.vel[1] < 0.3) b.vel[1] = 0; // too small a hop to see: stop bouncing
      }
      if (b.pos[1] <= b.r + 1e-6) {
        b.supported = true;
        const keep = Math.max(0, 1 - ROLLING_DRAG * h);
        b.vel[0] *= keep;
        b.vel[2] *= keep;
      }
      // Side walls and the back wall.
      for (const [i, range] of [[0, bounds.x], [2, bounds.z]] as Array<[number, { min: number; max: number }]>) {
        if (b.pos[i] < range.min) { b.pos[i] = range.min; if (b.vel[i] < 0) b.vel[i] = -b.vel[i] * WALL_BOUNCE; }
        if (b.pos[i] > range.max) { b.pos[i] = range.max; if (b.vel[i] > 0) b.vel[i] = -b.vel[i] * WALL_BOUNCE; }
      }
      // Fixed spheres (the mirror ball and the colored ball).
      for (const st of statics) collideStatic(b, st);
    }
    // Ball on ball.
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) collidePair(bodies[i], bodies[j]);
  }
  let moving = false;
  for (const b of bodies) {
    if (b.held) continue;
    if (atRest(b)) b.vel = [0, 0, 0];
    else moving = true;
  }
  return moving;
}

function collideStatic(b: Body, st: StaticSphere): void {
  const d = sub(b.pos, st.center);
  const dist = len(d);
  const min = b.r + st.r;
  if (dist >= min || dist === 0) return;
  const n: Vec3 = [d[0] / dist, d[1] / dist, d[2] / dist];
  for (let i = 0; i < 3; i++) b.pos[i] = st.center[i] + n[i] * min;
  if (n[1] > 0.3) b.supported = true; // resting on top of it
  const vn = dot(b.vel, n);
  if (vn < 0) for (let i = 0; i < 3; i++) b.vel[i] -= (1 + STATIC_BOUNCE) * vn * n[i];
}

function collidePair(a: Body, b: Body): void {
  const d = sub(b.pos, a.pos);
  const dist = len(d);
  const min = a.r + b.r;
  if (dist >= min || dist === 0) return;
  const n: Vec3 = [d[0] / dist, d[1] / dist, d[2] / dist];
  const overlap = min - dist;
  // n points from a to b: b rests on a when n points up, a on b when it points down.
  if (n[1] > 0.3) b.supported = true;
  if (n[1] < -0.3) a.supported = true;
  // Separate: a held body stays put and the other takes the whole correction.
  const shareA = a.held ? 0 : b.held ? 1 : 0.5;
  const shareB = 1 - shareA;
  for (let i = 0; i < 3; i++) { a.pos[i] -= n[i] * overlap * shareA; b.pos[i] += n[i] * overlap * shareB; }
  const relative = dot(sub(b.vel, a.vel), n);
  if (relative >= 0) return;
  // Equal masses: exchange the normal component, less what the bounce loses.
  const impulse = -(1 + BALL_BOUNCE) * relative / (a.held || b.held ? 1 : 2);
  for (let i = 0; i < 3; i++) {
    if (!a.held) a.vel[i] -= impulse * n[i];
    if (!b.held) b.vel[i] += impulse * n[i];
  }
  // Keep both above the floor after a push.
  a.pos[1] = Math.max(a.pos[1], a.r);
  b.pos[1] = Math.max(b.pos[1], b.r);
}

/** Run until everything rests (or a time limit), for reduced motion and tests. */
export function settle(bodies: Body[], statics: StaticSphere[], bounds: Bounds, maxSeconds = 12): number {
  let t = 0;
  while (t < maxSeconds) {
    const moving = stepPhysics(bodies, statics, bounds, 1 / 60);
    t += 1 / 60;
    if (!moving) break;
  }
  return t;
}
