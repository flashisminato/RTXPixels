import { MAX_REDIRECTS, type Mode, type ViewMode, type ViewState } from '../contracts.ts';
import type { UIActions, UIHandle } from '../contracts.ts';
import { CONTROL_RANGES } from '../scene/preset.ts';
import { createDiagram } from './diagram.ts';
import { SCHEMATIC_NOTE, buildExplanation } from './explain.ts';
import { renderMathPanel } from './math-panel.ts';
import { normalizedPoint, snapToStep, stepSelection } from './selection.ts';
import '../styles/main.css';

let mounts = 0;

/**
 * Product layout around an empty image host. The host has no padding or border;
 * the frame around it carries the outline. AI 3 inserts the image canvas.
 * The separate diagram canvas is not that host.
 */
export function mountUI(root: HTMLElement, actions: UIActions): UIHandle {
  const ns = `fap-${++mounts}`;
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  let disposed = false;
  let current: ViewState | null = null;
  let selection: { u: number; v: number } | null = null;
  let pixelSize = { width: 64, height: 64 };

  const shell = document.createElement('div');
  shell.className = 'app';

  const header = document.createElement('header');
  const title = document.createElement('h1');
  title.textContent = 'Follow a Pixel';
  const question = document.createElement('p');
  question.className = 'question';
  question.textContent = 'How does a game decide what a mirror shows?';
  header.append(title, question);

  const layout = document.createElement('div');
  layout.className = 'layout';
  const picture = document.createElement('section');
  picture.className = 'picture';
  const pictureTitle = document.createElement('h2');
  pictureTitle.textContent = 'The picture';
  const lead = document.createElement('p');
  lead.className = 'lead';
  lead.textContent = 'Move the colored object and watch its reflection. Then follow one pixel to see the bounce that chose its color.';
  const frame = document.createElement('div');
  frame.className = 'stage-frame';
  const canvasHost = document.createElement('div');
  canvasHost.className = 'canvas-host';
  canvasHost.tabIndex = 0;
  canvasHost.setAttribute('role', 'group');
  canvasHost.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
  canvasHost.setAttribute('aria-label', 'Scene picture. Click a pixel or press the arrow keys to move one pixel at a time.');
  const marker = document.createElement('div');
  marker.className = 'pixel-marker';
  marker.hidden = true;
  marker.setAttribute('aria-hidden', 'true');
  frame.append(canvasHost, marker);
  const pictureHelp = document.createElement('p');
  pictureHelp.className = 'picture-help';
  pictureHelp.id = `${ns}-picture-help`;
  pictureHelp.textContent = 'Click or tap a pixel. With the picture focused, the arrow keys move one pixel at a time.';
  canvasHost.setAttribute('aria-describedby', pictureHelp.id);
  const actionsRow = document.createElement('div');
  actionsRow.className = 'picture-actions';
  const example = document.createElement('button');
  example.type = 'button';
  example.className = 'button button-primary';
  example.textContent = 'Inspect a computed mirror example';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button button-secondary';
  reset.textContent = 'Reset';
  actionsRow.append(example, reset);
  const actionHelp = document.createElement('p');
  actionHelp.className = 'action-help';
  actionHelp.textContent = 'Inspect asks the current picture for a real mirror pixel. Reset restores the original object, light, camera, mirror, bounce limit, and full picture.';
  const status = document.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  const statusHelp = document.createElement('p');
  statusHelp.className = 'status-help';
  statusHelp.textContent = 'This line is the picture’s actual status. Starting means it is still computing. Ready and fallback are real pictures. An error means the picture is unavailable, and the schematic will not invent one.';
  picture.append(pictureTitle, lead, frame, pictureHelp, actionsRow, actionHelp, status, statusHelp);

  const controls = document.createElement('section');
  controls.className = 'controls';
  const controlsTitle = document.createElement('h2');
  controlsTitle.textContent = 'Try this first';
  const target = rangeControl(signal, `${ns}-target`, 'Move the colored object',
    'Slide it sideways and watch the reflection. The colored object does not rotate.', CONTROL_RANGES.targetX, value => {
      commitNumber(value, CONTROL_RANGES.targetX, current?.controls.targetX, snapped => actions.dispatch({ type: 'target-x', value: snapped }));
    });
  const mirror = radioControl(signal, `${ns}-mirror`, 'Center sphere',
    'Switching to flat color stops the reflection. The sphere does not rotate.', [
      { value: 'mirror', name: 'Shiny mirror', hint: 'Shows a reflection.' },
      { value: 'matte', name: 'Flat color', hint: 'Paint, with no bounce.' },
    ], value => {
      const mode = asMode(value);
      if (!mode || current?.controls.mirrorMode === mode) return;
      actions.dispatch({ type: 'mirror-mode', value: mode });
    });
  const camera = rangeControl(signal, `${ns}-camera`, 'Move the camera',
    'This steps the camera around the scene. The center sphere does not rotate, so there is no sphere-spin control.', CONTROL_RANGES.cameraYawDeg, value => {
      commitNumber(value, CONTROL_RANGES.cameraYawDeg, current?.controls.cameraYawDeg, snapped => actions.dispatch({ type: 'camera-yaw', value: snapped }));
    });
  const more = document.createElement('details');
  more.className = 'more';
  const moreSummary = document.createElement('summary');
  moreSummary.textContent = 'More controls';
  const moreHelp = document.createElement('p');
  moreHelp.className = 'more-help';
  moreHelp.textContent = 'Light position, how many mirror bounces to follow, and picture checks.';
  const light = rangeControl(signal, `${ns}-light`, 'Move the light',
    'Slide the light sideways to change which surfaces it reaches.', CONTROL_RANGES.lightX, value => {
      commitNumber(value, CONTROL_RANGES.lightX, current?.controls.lightX, snapped => actions.dispatch({ type: 'light-x', value: snapped }));
    });
  const redirects = rangeControl(signal, `${ns}-bounces`, 'Mirror bounces to follow',
    '0 does not follow a mirror. 4 is the maximum. A mirror that needs another bounce is left black; the next hit is not guessed.',
    { min: 0, max: MAX_REDIRECTS, step: 1 }, value => {
      commitNumber(value, { min: 0, max: MAX_REDIRECTS, step: 1 }, current?.controls.maxRedirects, snapped => actions.dispatch({ type: 'redirects', value: snapped }));
    });
  const viewMode = radioControl(signal, `${ns}-view`, 'What the picture shows',
    'The last two stop at the first surface. They are not the full picture’s reflection.', [
      { value: 'beauty', name: 'Full picture', hint: 'Reflections and shadows.' },
      { value: 'hit', name: 'First surface, hit or miss', hint: 'White or black. A diagnostic, not the reflected color.' },
      { value: 'albedo', name: 'First surface color', hint: 'The surface’s own color, or black on a miss.' },
    ], value => {
      const mode = asViewMode(value);
      if (!mode || current?.controls.viewMode === mode) return;
      actions.dispatch({ type: 'view-mode', value: mode });
    });
  more.append(moreSummary, moreHelp, light.wrap, redirects.wrap, viewMode.wrap);
  controls.append(controlsTitle, target.wrap, mirror.wrap, camera.wrap, more);
  layout.append(picture, controls);

  const explain = document.createElement('section');
  explain.className = 'explain';
  const explainTitle = document.createElement('h2');
  explainTitle.textContent = 'Pick a pixel to follow';
  const modeNote = document.createElement('p');
  modeNote.className = 'mode-note';
  const pixelLine = document.createElement('p');
  pixelLine.className = 'pixel-line';
  const summary = document.createElement('p');
  summary.className = 'summary';
  const direction = document.createElement('p');
  direction.className = 'direction-note';
  direction.textContent = 'The lines in the schematic walk from the camera into the scene. Physical light travels the opposite way, toward the camera.';
  const figure = document.createElement('figure');
  figure.className = 'schematic';
  const caption = document.createElement('figcaption');
  caption.textContent = SCHEMATIC_NOTE;
  const diagramCanvas = document.createElement('canvas');
  diagramCanvas.className = 'ray-diagram';
  figure.append(caption, diagramCanvas);
  const events = document.createElement('ol');
  events.className = 'events';
  events.setAttribute('aria-label', 'Computed steps for the selected pixel');
  events.hidden = true;
  const math = document.createElement('details');
  math.className = 'math';
  const mathSummary = document.createElement('summary');
  mathSummary.textContent = 'Explain the math';
  const mathBody = document.createElement('div');
  math.append(mathSummary, mathBody);
  explain.append(explainTitle, modeNote, pixelLine, summary, direction, figure, events, math);

  const footer = document.createElement('footer');
  footer.className = 'credits';
  const limits = document.createElement('p');
  limits.className = 'limits';
  limits.textContent = 'Version 1 computes spheres, planes, one light, hard shadows, and perfect mirrors, with at most four bounces. It does not compute glass, soft shadows, or light that bounces off matte surfaces. Ray tracing is an established technique, not our invention.';
  const credits = document.createElement('a');
  credits.href = './notices/credits.html';
  credits.textContent = 'Credits and limitations';
  footer.append(limits, credits);

  // Integration reads this single pre as JSON of the current inspection.
  const record = document.createElement('pre');
  record.className = 'inspection-record';
  record.hidden = true;
  record.setAttribute('aria-hidden', 'true');

  shell.append(header, layout, explain, footer, record);
  root.replaceChildren(shell);

  const diagram = createDiagram(diagramCanvas);

  function placeMarker(): void {
    if (!selection) {
      marker.hidden = true;
      return;
    }
    const hostRect = canvasHost.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    if (hostRect.width <= 0 || hostRect.height <= 0) return;
    marker.hidden = false;
    marker.style.left = `${hostRect.left - frameRect.left + selection.u * hostRect.width}px`;
    marker.style.top = `${hostRect.top - frameRect.top + selection.v * hostRect.height}px`;
  }

  const hostObserver = new ResizeObserver(() => placeMarker());
  hostObserver.observe(canvasHost);

  canvasHost.addEventListener('pointerdown', () => { canvasHost.focus({ preventScroll: true }); }, { signal });
  canvasHost.addEventListener('click', event => {
    const point = normalizedPoint(event.clientX, event.clientY, canvasHost.getBoundingClientRect());
    if (!point) return;
    selection = point;
    placeMarker();
    actions.inspectAt(point.u, point.v);
  }, { signal });
  canvasHost.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const next = stepSelection(selection, event.key, pixelSize.width, pixelSize.height);
    if (!next) return;
    event.preventDefault();
    selection = next;
    placeMarker();
    actions.inspectAt(next.u, next.v);
  }, { signal });
  example.addEventListener('click', () => actions.inspectExample(), { signal });
  reset.addEventListener('click', () => actions.dispatch({ type: 'reset' }), { signal });

  diagram.show(null, 'Pick a pixel to follow its computed path.');

  return {
    canvasHost,
    update(view) {
      if (disposed) return;
      current = view;
      status.textContent = `${view.status}: ${view.message}`;
      status.dataset.status = view.status;
      record.textContent = view.inspection ? JSON.stringify(view.inspection) : '';
      syncRange(target.input, target.output, view.controls.targetX, view.controls.targetX.toFixed(2));
      syncRange(light.input, light.output, view.controls.lightX, view.controls.lightX.toFixed(1));
      syncRange(camera.input, camera.output, view.controls.cameraYawDeg, `${Math.round(view.controls.cameraYawDeg)}°`);
      syncRange(redirects.input, redirects.output, view.controls.maxRedirects, String(view.controls.maxRedirects));
      syncRadios(mirror.inputs, view.controls.mirrorMode);
      syncRadios(viewMode.inputs, view.controls.viewMode);
      const matching = view.inspection && view.inspection.sceneVersion === view.sceneVersion ? view.inspection : null;
      if (matching && matching.pixel.width > 0 && matching.pixel.height > 0) {
        pixelSize = { width: matching.pixel.width, height: matching.pixel.height };
        selection = { u: (matching.pixel.x + 0.5) / matching.pixel.width, v: (matching.pixel.y + 0.5) / matching.pixel.height };
      } else selection = null;
      placeMarker();
      const explanation = buildExplanation(view);
      explain.dataset.stale = explanation.stale ? 'true' : 'false';
      explainTitle.textContent = explanation.heading;
      modeNote.textContent = explanation.modeNote;
      pixelLine.textContent = explanation.pixelLine;
      summary.textContent = explanation.summary;
      events.replaceChildren(...explanation.items.map(item => {
        const li = document.createElement('li');
        const itemTitle = document.createElement('h3');
        itemTitle.textContent = item.title;
        const detail = document.createElement('p');
        detail.textContent = item.detail;
        li.append(itemTitle, detail);
        return li;
      }));
      events.hidden = explanation.items.length === 0;
      renderMathPanel(mathBody, view);
      diagram.show(explanation.diagram, explanation.summary);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle.abort();
      hostObserver.disconnect();
      diagram.dispose();
      root.replaceChildren();
    },
  };
}

function commitNumber(
  value: number,
  range: { min: number; max: number; step: number },
  previous: number | undefined,
  dispatch: (snapped: number) => void,
): void {
  const snapped = snapToStep(value, range.min, range.max, range.step);
  if (snapped === null) return;
  if (previous !== undefined && Math.abs(snapped - previous) < 1e-9) return;
  dispatch(snapped);
}

function asMode(value: string): Mode | null {
  return value === 'mirror' || value === 'matte' ? value : null;
}

function asViewMode(value: string): ViewMode | null {
  return value === 'beauty' || value === 'hit' || value === 'albedo' ? value : null;
}

function syncRange(input: HTMLInputElement, output: HTMLElement, value: number, text: string): void {
  output.textContent = text;
  input.setAttribute('aria-valuetext', text);
  const parsed = Number(input.value);
  const unchanged = document.activeElement === input && Number.isFinite(parsed) && Math.abs(parsed - value) < 1e-9;
  if (!unchanged) input.value = String(value);
}

function syncRadios(inputs: HTMLInputElement[], value: string): void {
  for (const input of inputs) input.checked = input.value === value;
}

function rangeControl(
  signal: AbortSignal,
  id: string,
  label: string,
  help: string,
  range: { min: number; max: number; step: number },
  commit: (value: number) => void,
): { wrap: HTMLElement; input: HTMLInputElement; output: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = 'control';
  const head = document.createElement('div');
  head.className = 'control-head';
  const name = document.createElement('label');
  name.htmlFor = id;
  name.textContent = label;
  const output = document.createElement('span');
  output.className = 'control-value';
  head.append(name, output);
  const input = document.createElement('input');
  input.id = id;
  input.type = 'range';
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.addEventListener('input', () => commit(Number(input.value)), { signal });
  const note = document.createElement('p');
  note.className = 'control-help';
  note.textContent = help;
  wrap.append(head, input, note);
  return { wrap, input, output };
}

function radioControl(
  signal: AbortSignal,
  name: string,
  legend: string,
  help: string,
  choices: { value: string; name: string; hint: string }[],
  commit: (value: string) => void,
): { wrap: HTMLFieldSetElement; inputs: HTMLInputElement[] } {
  const wrap = document.createElement('fieldset');
  const caption = document.createElement('legend');
  caption.textContent = legend;
  wrap.append(caption);
  const inputs = choices.map(choice => {
    const id = `${name}-${choice.value}`;
    const label = document.createElement('label');
    label.className = 'choice';
    label.htmlFor = id;
    const input = document.createElement('input');
    input.id = id;
    input.type = 'radio';
    input.name = name;
    input.value = choice.value;
    input.addEventListener('change', () => { if (input.checked) commit(input.value); }, { signal });
    const text = document.createElement('span');
    const choiceName = document.createElement('span');
    choiceName.className = 'choice-name';
    choiceName.textContent = choice.name;
    const hint = document.createElement('span');
    hint.className = 'choice-hint';
    hint.textContent = choice.hint;
    text.append(choiceName, hint);
    label.append(input, text);
    wrap.append(label);
    return input;
  });
  const note = document.createElement('p');
  note.className = 'control-help';
  note.textContent = help;
  wrap.append(note);
  return { wrap, inputs };
}
