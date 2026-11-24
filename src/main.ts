import type { RenderFrame, Renderer, UIActions } from './contracts.ts';
import { findMirrorExample, fitBuffer, inspectNormalized, makeFrame, normalizedPixel } from './core/frame.ts';
import { drawFallback } from './fallback/index.ts';
import { createRenderer } from './render/index.ts';
import { createStore } from './state/index.ts';
import { mountUI } from './ui/index.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application root is missing.');
const store = createStore();
let renderer: Renderer | null = null;
let canvas = makeCanvas();
let activeFrame: RenderFrame | null = null;
let selected: { u: number; v: number } | null = null;
let fallbackReason: string | null = null;
let generation = 0;
let scheduled = 0;
let work: AbortController | null = null;
let disposed = false;

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function makeCanvas(): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.setAttribute('aria-label', 'Computed ray-traced scene; select a pixel to inspect it');
  element.style.cssText = 'display:block;width:100%;height:100%;visibility:hidden';
  return element;
}

const actions: UIActions = {
  dispatch(action) {
    const before = store.getSnapshot().sceneVersion;
    try { store.dispatch(action); }
    catch (error) {
      const context = store.getSnapshot().sceneVersion === before ? 'Control rejected' : 'Control changed, but updating the view failed';
      store.setStatus('error', `${context}: ${message(error)}`);
    }
  },
  inspectAt(u, v) {
    try {
      normalizedPixel(u, v, 1, 1); // Validate even if no frame has finished yet.
      selected = { u, v };
      if (activeFrame) store.setInspection(inspectNormalized(activeFrame, u, v));
    } catch (error) { store.setStatus('error', `Selection rejected: ${message(error)}`); }
  },
  clearInspection() {
    selected = null;
    if (store.getSnapshot().inspection) store.setInspection(null);
  },
  inspectExample() {
    if (!activeFrame) {
      store.setStatus(store.getSnapshot().status, 'Wait for the current computed frame, then inspect the example.');
      return;
    }
    const example = findMirrorExample(activeFrame);
    if (!example) {
      store.setStatus(store.getSnapshot().status, 'No first-hit mirror pixel was found on the search grid. Reset the scene and try again.');
      return;
    }
    const { pixel } = example.inspection;
    selected = { u: (pixel.x + 0.5) / pixel.width, v: (pixel.y + 0.5) / pixel.height };
    store.setInspection(example.inspection);
    store.setStatus(store.getSnapshot().status, `${backendMessage()} ${example.reflectedTarget
      ? 'Selected a computed mirror → target path.'
      : 'Selected a real first hit on the mirror object; no mirror → target path was found with the current options.'}`);
  },
};
const ui = mountUI(root, actions);
ui.canvasHost.append(canvas);

function invalidate() {
  generation++;
  work?.abort();
  work = null;
  activeFrame = null;
  canvas.style.visibility = 'hidden';
  if (store.getSnapshot().inspection) store.setInspection(null);
}
function requestRender() {
  if (disposed) return;
  try {
    invalidate();
    store.setStatus('starting', 'Computing the current scene; inspection resumes when the matching image is ready.');
  } finally {
    // A faulty UI subscriber must not leave a changed scene paired with an old image.
    if (!scheduled) scheduled = requestAnimationFrame(() => { scheduled = 0; void draw(); });
  }
}
function activateFallback(reason: string) {
  invalidate();
  fallbackReason = reason;
  const previous = renderer;
  renderer = null;
  try { previous?.dispose(); }
  catch (error) { fallbackReason += ` Renderer cleanup also failed: ${message(error)}`; }
  // A WebGL canvas cannot become a 2D canvas. Replace only our image canvas;
  // the host, UI listeners and AI 2's separate diagram canvas survive.
  const replacement = makeCanvas();
  canvas.replaceWith(replacement);
  canvas = replacement;
}
function backendMessage(): string {
  return fallbackReason ? `CPU fallback: ${fallbackReason}` : 'WebGL frame drawn; inspector uses the same scene and camera.';
}
function present(frame: RenderFrame) {
  activeFrame = frame;
  canvas.style.visibility = 'visible';
  canvas.dataset.sceneVersion = String(frame.sceneVersion);
  store.setStatus(fallbackReason ? 'fallback' : 'ready', backendMessage());
  if (selected) store.setInspection(inspectNormalized(frame, selected.u, selected.v));
}
async function draw() {
  const ticket = generation;
  try {
    const bounds = ui.canvasHost.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      store.setStatus('starting', 'Waiting for a visible canvas host.');
      return;
    }
    const size = fitBuffer(bounds.width, bounds.height, window.devicePixelRatio || 1,
      fallbackReason ? 160 : 640, fallbackReason ? 90 : 360);
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    const frame = makeFrame(store.getSnapshot(), canvas.width, canvas.height);
    const isCurrent = () => !disposed && ticket === generation && frame.sceneVersion === store.getSnapshot().sceneVersion;
    if (renderer) {
      try { renderer.draw(frame); }
      catch (error) {
        activateFallback(`WebGL draw failed: ${message(error)}`);
        requestRender();
        return;
      }
      if (isCurrent()) present(frame);
      return;
    }
    work = new AbortController();
    const completed = await drawFallback(canvas, frame, { signal: work.signal, isCurrent });
    if (completed && isCurrent()) { work = null; present(frame); }
  } catch (error) {
    if (ticket === generation && !disposed) {
      activeFrame = null;
      canvas.style.visibility = 'hidden';
      store.setStatus('error', `Unable to display this frame: ${message(error)}`);
    }
  }
}

const webglCanvas = canvas;
try {
  renderer = createRenderer(canvas, {
    onContextLost() {
      if (disposed || canvas !== webglCanvas) return;
      activateFallback('Graphics context lost. Using local CPU calculation; reload to retry WebGL.');
      requestRender();
    },
    onContextRestored() {
      // Ignore events from a detached/disposed WebGL canvas after switching to CPU.
      if (!disposed && canvas === webglCanvas && renderer) requestRender();
    },
  });
} catch (error) { activateFallback(message(error)); }
let lastVersion = store.getSnapshot().sceneVersion;
const unsubscribe = store.subscribe(view => {
  if (view.sceneVersion !== lastVersion) {
    lastVersion = view.sceneVersion;
    requestRender();
  }
  ui.update(view);
});
const observer = new ResizeObserver(requestRender);
observer.observe(ui.canvasHost);
window.addEventListener('resize', requestRender);
ui.update(store.getSnapshot());
requestRender();

function dispose() {
  if (disposed) return;
  disposed = true;
  work?.abort();
  cancelAnimationFrame(scheduled);
  observer.disconnect();
  unsubscribe();
  window.removeEventListener('resize', requestRender);
  window.removeEventListener('pagehide', onPageHide);
  try { renderer?.dispose(); }
  finally { ui.dispose(); }
}
function onPageHide(event: PageTransitionEvent) { if (!event.persisted) dispose(); }
window.addEventListener('pagehide', onPageHide);
if (import.meta.hot) import.meta.hot.dispose(dispose);
