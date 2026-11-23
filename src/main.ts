import { mountUI } from './ui/index.ts';
import { createRenderer } from './render/index.ts';
import { initialView } from './state/index.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application root is missing.');
const view = initialView();
const ui = mountUI(root, {
  dispatch() { ui.update(view); },
  inspectAt() { ui.update(view); },
  inspectExample() { ui.update(view); },
});
const canvas = document.createElement('canvas');
ui.canvasHost.append(canvas);
try {
  createRenderer(canvas, { onContextLost() {}, onContextRestored() {} });
} catch (error) {
  view.message = error instanceof Error ? error.message : String(error);
}
ui.update(view);
