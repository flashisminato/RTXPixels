import type { Action, Vec3, ViewState } from '../contracts.ts';
import { BALL_BOUNDS, BALL_RADIUS, MIRROR_BALL, TARGET_RADIUS } from '../scene/preset.ts';
import { settle, stepPhysics, type Body, type StaticSphere } from '../scene/physics.ts';

/**
 * Runs the ball physics against the store. It wakes when a ball is added or moved,
 * or the colored ball moves; it steps about 60 times a second and sends one
 * 'balls-step' action per step; and it stops as soon as everything rests.
 * Steps run on a timer between frames, not inside requestAnimationFrame: each
 * step schedules the picture's redraw for the next frame, so the redraw always
 * lands before that frame paints and the picture never shows blank.
 * Under reduced motion, balls settle at once.
 */
const STEP_MS = 16;

export function createPhysicsDriver(dispatch: (action: Action) => void, reducedMotion: () => boolean): {
  sync(view: ViewState): void;
  hold(n: number, held: boolean): void;
  dispose(): void;
} {
  const bodies = new Map<number, Body>();
  let statics: StaticSphere[] = [];
  let order: number[] = [];
  let frame = 0;
  let last = 0;
  let disposed = false;
  const bounds = { x: BALL_BOUNDS.x, z: BALL_BOUNDS.z };

  const same = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9;
  const positions = (): Vec3[] => order.map(n => [...bodies.get(n)!.pos] as Vec3);

  function publish(): void {
    if (order.length === 0) return;
    dispatch({ type: 'balls-step', positions: positions() });
  }

  function wake(): void {
    if (disposed || order.length === 0) return;
    if (reducedMotion()) {
      settle(order.map(n => bodies.get(n)!), statics, bounds);
      // Never dispatch from inside the store update that woke us.
      queueMicrotask(() => { if (!disposed) publish(); });
      return;
    }
    if (frame) return;
    last = performance.now();
    frame = window.setTimeout(tick, STEP_MS);
  }

  function tick(): void {
    frame = 0;
    const now = performance.now();
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    const moving = stepPhysics(order.map(n => bodies.get(n)!), statics, bounds, dt);
    publish();
    if (moving && !disposed) frame = window.setTimeout(tick, STEP_MS);
  }

  return {
    sync(view) {
      const controls = view.controls;
      const nextStatics: StaticSphere[] = [
        { center: [...MIRROR_BALL.center] as Vec3, r: MIRROR_BALL.radius },
        { center: [controls.targetX, controls.targetY, controls.targetZ], r: TARGET_RADIUS },
      ];
      let changed = statics.length !== 2 || !same(statics[1].center, nextStatics[1].center);
      statics = nextStatics;
      const seen = new Set<number>();
      for (const ball of controls.balls) {
        seen.add(ball.n);
        const pos: Vec3 = [ball.x, ball.y, ball.z];
        const body = bodies.get(ball.n);
        if (!body) {
          bodies.set(ball.n, { pos, vel: [0, 0, 0], r: BALL_RADIUS });
          changed = true;
        } else if (!same(body.pos, pos)) {
          // Moved from outside (the gizmo, a slider): adopt it and let it fall again.
          body.pos = pos;
          body.vel = [0, 0, 0];
          changed = true;
        }
      }
      for (const n of [...bodies.keys()]) if (!seen.has(n)) bodies.delete(n);
      order = controls.balls.map(b => b.n);
      if (changed) wake();
    },
    hold(n, held) {
      const body = bodies.get(n);
      if (!body) return;
      body.held = held;
      if (!held) wake();
    },
    dispose() {
      disposed = true;
      clearTimeout(frame);
    },
  };
}
