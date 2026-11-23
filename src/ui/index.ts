import type { UIActions, UIHandle } from '../contracts.ts';
import '../styles/main.css';

// Minimal bootstrap harness, not the finished AI 2 interface or diagram.
export function mountUI(root: HTMLElement, actions: UIActions): UIHandle {
  const title = document.createElement('h1');
  title.textContent = 'Follow a Pixel';
  const note = document.createElement('p');
  note.textContent = 'Development harness — full controls and explanatory diagram await AI 2.';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const canvasHost = document.createElement('div');
  canvasHost.className = 'canvas-host';
  const example = document.createElement('button');
  example.textContent = 'Inspect a computed mirror example';
  example.onclick = () => actions.inspectExample();
  const reset = document.createElement('button');
  reset.textContent = 'Reset';
  reset.onclick = () => actions.dispatch({ type: 'reset' });
  const inspection = document.createElement('pre');
  const credits = document.createElement('a');
  credits.href = './notices/credits.html';
  credits.textContent = 'Credits and limitations';
  canvasHost.onclick = (event) => {
    const rect = canvasHost.getBoundingClientRect();
    if (rect.width && rect.height) actions.inspectAt((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };
  root.replaceChildren(title, note, status, canvasHost, example, reset, inspection, credits);
  return {
    canvasHost,
    update(view) {
      status.textContent = `${view.status}: ${view.message}`;
      inspection.textContent = view.inspection ? JSON.stringify(view.inspection, null, 2) : 'Select a pixel once an actual frame is available.';
    },
    dispose() { canvasHost.onclick = null; example.onclick = null; reset.onclick = null; root.replaceChildren(); },
  };
}
