import type { ViewState } from '../contracts.ts';
import { createPreset, initialControls } from '../scene/preset.ts';

export function initialView(): ViewState {
  return { sceneVersion: 1, scene: createPreset(), controls: initialControls(),
    inspection: null, status: 'starting', message: 'Bootstrap only: renderer and CPU tracer are not implemented yet.' };
}
