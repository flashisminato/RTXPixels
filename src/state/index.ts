import type { Action, Inspection, Scene, ViewState } from '../contracts.ts';
import { BALL_BOUNDS, createPreset, initialControls, newBall, newExtraLight } from '../scene/preset.ts';
import { validateControls, validateScene } from './validation.ts';

export { validateControls, validateScene } from './validation.ts';

export function initialView(): ViewState {
  return { sceneVersion: 1, scene: createPreset(), controls: initialControls(),
    inspection: null, status: 'starting', message: 'Preparing the first computed frame.' };
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A preset-only store. An optional initial scene is validated at the data boundary;
 * control changes and reset always reconstruct the original controlled preset. */
export function createStore(initialScene: Scene = createPreset()) {
  validateScene(initialScene);
  let view = freeze({ ...initialView(), scene: structuredClone(initialScene) });
  const listeners = new Set<(snapshot: ViewState) => void>();
  function publish(next: ViewState) {
    view = freeze(next);
    for (const listener of listeners) listener(view);
  }
  return {
    getSnapshot: (): ViewState => view,
    subscribe(listener: (snapshot: ViewState) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispatch(action: Action): void {
      if (!action || typeof action !== 'object') throw new TypeError('Action must be an object.');
      const controls = { ...view.controls, extraLights: view.controls.extraLights.map(light => ({ ...light })), balls: view.controls.balls.map(ball => ({ ...ball })) };
      const ballIndex = (index: unknown): number => {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= controls.balls.length) throw new RangeError('Ball index is out of range.');
        return index;
      };
      const axisOf = (axis: unknown): 'x' | 'y' | 'z' => {
        if (axis !== 'x' && axis !== 'y' && axis !== 'z') throw new RangeError('Unsupported axis.');
        return axis;
      };
      const lightIndex = (index: unknown): number => {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > controls.extraLights.length) {
          throw new RangeError('Light index is out of range.');
        }
        return index;
      };
      switch (action.type) {
        case 'target-x': controls.targetX = action.value; break;
        case 'target-move': {
          const axis = axisOf(action.axis);
          if (axis === 'x') controls.targetX = action.value;
          else if (axis === 'y') controls.targetY = action.value;
          else controls.targetZ = action.value;
          break;
        }
        case 'ball-add': {
          const ball = newBall(controls.balls);
          if (!ball) throw new RangeError('The room already has the maximum number of balls.');
          controls.balls.push(ball);
          break;
        }
        case 'ball-remove': controls.balls.splice(ballIndex(action.index), 1); break;
        case 'ball-color': controls.balls[ballIndex(action.index)].color = action.value; break;
        case 'ball-mode': controls.balls[ballIndex(action.index)].mode = action.value; break;
        case 'ball-physics': controls.balls[ballIndex(action.index)].physics = action.value; break;
        case 'ball-move': controls.balls[ballIndex(action.index)][axisOf(action.axis)] = action.value; break;
        case 'balls-step': {
          if (!Array.isArray(action.positions) || action.positions.length !== controls.balls.length) throw new RangeError('One position per ball is required.');
          action.positions.forEach((p, i) => {
            if (!Array.isArray(p) || p.length !== 3) throw new RangeError('A ball position needs three numbers.');
            // Physics may land a hair outside the bounds; keep the stored value valid.
            controls.balls[i].x = Math.min(BALL_BOUNDS.x.max, Math.max(BALL_BOUNDS.x.min, p[0]));
            controls.balls[i].y = Math.min(BALL_BOUNDS.y.max, Math.max(BALL_BOUNDS.y.min, p[1]));
            controls.balls[i].z = Math.min(BALL_BOUNDS.z.max, Math.max(BALL_BOUNDS.z.min, p[2]));
          });
          break;
        }
        case 'light-x': controls.lightX = action.value; break;
        case 'light-move': {
          const index = lightIndex(action.index);
          if (action.axis !== 'x' && action.axis !== 'y' && action.axis !== 'z') throw new RangeError('Unsupported light axis.');
          if (index === 0) {
            if (action.axis === 'x') controls.lightX = action.value;
            else if (action.axis === 'y') controls.lightY = action.value;
            else controls.lightZ = action.value;
          } else controls.extraLights[index - 1][action.axis] = action.value;
          break;
        }
        case 'light-intensity': {
          const index = lightIndex(action.index);
          if (index === 0) controls.lightIntensity = action.value;
          else controls.extraLights[index - 1].intensity = action.value;
          break;
        }
        case 'light-add': {
          const light = newExtraLight(controls.extraLights);
          if (!light) throw new RangeError('The scene already has the maximum number of lights.');
          controls.extraLights.push(light);
          break;
        }
        case 'light-remove': {
          const index = lightIndex(action.index);
          if (index === 0) throw new RangeError('The main light cannot be removed.');
          controls.extraLights.splice(index - 1, 1);
          break;
        }
        case 'camera-yaw': controls.cameraYawDeg = action.value; break;
        case 'mirror-mode': controls.mirrorMode = action.value; break;
        case 'wall-color': controls.wallColor = action.value; break;
        case 'wall-mode': controls.wallMode = action.value; break;
        case 'redirects': controls.maxRedirects = action.value; break;
        case 'view-mode': controls.viewMode = action.value; break;
        case 'reset': Object.assign(controls, initialControls()); break;
        default: throw new RangeError('Unsupported action type.');
      }
      validateControls(controls);
      const scene = createPreset(controls);
      validateScene(scene);
      publish({ ...view, controls, scene, sceneVersion: view.sceneVersion + 1, inspection: null,
        status: 'starting', message: 'Scene changed; computing a matching frame.' });
    },
    setInspection(inspection: Inspection | null): boolean {
      if (inspection && inspection.sceneVersion !== view.sceneVersion) return false;
      publish({ ...view, inspection });
      return true;
    },
    setStatus(status: ViewState['status'], message: string): void {
      if (status !== view.status || message !== view.message) publish({ ...view, status, message });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
