import { MAX_REDIRECTS, type Mode, type ViewMode, type ViewState } from '../contracts.ts';
import type { UIActions, UIHandle } from '../contracts.ts';
import { CONTROL_RANGES } from '../scene/preset.ts';
import { createDiagram } from './diagram.ts';
import { SCHEMATIC_NOTE, buildExplanation } from './explain.ts';
import { renderMathPanel } from './math-panel.ts';
import { buildSourceChapter } from './source-view.ts';
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
  const abstract = document.createElement('p');
  abstract.className = 'abstract';
  abstract.textContent = 'This document ray traces a small room and lets you follow the ray behind any pixel: where it lands, how it bounces off the mirror, whether the light reaches it, and how that becomes a color. Every figure, equation and number is recomputed live from the same scene you control.';
  header.className = 'front';
  header.append(title, question, abstract);

  const picture = chapter('ch-1', '1', 'The picture');
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

  const controls = document.createElement('aside');
  controls.className = 'controls';
  controls.setAttribute('aria-label', 'Parameters');
  const controlsTitle = document.createElement('h3');
  controlsTitle.textContent = 'Parameters';
  const controlsHint = document.createElement('p');
  controlsHint.className = 'controls-hint';
  controlsHint.textContent = 'Try this first: move the colored object and watch its reflection.';
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
  controls.append(controlsTitle, controlsHint, target.wrap, mirror.wrap, camera.wrap, more);

  const explain = document.createElement('section');
  explain.className = 'explain';
  const explainTitle = document.createElement('h3');
  explainTitle.className = 'explain-title';
  explainTitle.textContent = 'Pick a pixel to follow';
  const modeNote = document.createElement('p');
  modeNote.className = 'mode-note';
  const pixelLine = document.createElement('p');
  pixelLine.className = 'pixel-line';
  const summary = document.createElement('p');
  summary.className = 'summary';
  // Backward tracing is the chapter's governing definition, so it is set as one.
  const direction = definition('2.1', 'Backward tracing.',
    'The ray is followed from the camera into the scene, the opposite way to physical light, which travels from the light toward the camera. The lines in Figure 2.1 walk in that computational direction.');
  const figure = document.createElement('figure');
  figure.className = 'schematic';
  const caption = document.createElement('figcaption');
  caption.append(figureLabel('Figure 2.1'), SCHEMATIC_NOTE);
  // An SVG host, not a canvas: the image canvas stays the first <canvas> in the page.
  const diagramHost = document.createElement('div');
  diagramHost.className = 'ray-diagram';
  figure.append(caption, diagramHost);
  const events = document.createElement('ol');
  events.className = 'events';
  events.setAttribute('aria-label', 'Computed steps for the selected pixel');
  events.hidden = true;
  // Chapter 3 is part of the document, not hidden behind a toggle; only the
  // long derivations inside it use progressive disclosure.
  const math = document.createElement('div');
  math.className = 'math';
  const mathBody = document.createElement('div');
  math.append(mathBody);
  explain.append(explainTitle, modeNote, pixelLine, summary, direction, figure, events);

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

  // ---- Chapter 1: the picture as Figure 1.1, parameters beside it, pixel selector below.
  const pictureFigure = document.createElement('figure');
  pictureFigure.className = 'fig fig-picture';
  const pictureCaption = document.createElement('figcaption');
  pictureCaption.append(figureLabel('Figure 1.1'), 'The scene, ray traced live on the GPU (WebGL2) at up to 640 × 360 pixels. ', pictureHelp);
  pictureFigure.append(frame, pictureCaption);
  const stageGrid = document.createElement('div');
  stageGrid.className = 'stage-grid';
  stageGrid.append(pictureFigure, controls);
  const pixelSelect = document.createElement('fieldset');
  pixelSelect.className = 'pixel-select';
  const pixelLegend = document.createElement('legend');
  pixelLegend.textContent = 'Pixel';
  const pixelX = pixelInput(`${ns}-px`, 'x', 'Pixel column x, counted from the left');
  const pixelY = pixelInput(`${ns}-py`, 'y', 'Pixel row y, counted from the top');
  pixelSelect.append(pixelLegend, pixelX.label, pixelX.input, pixelY.label, pixelY.input);
  const inspectRow = document.createElement('div');
  inspectRow.className = 'inspect-row';
  inspectRow.append(pixelSelect, actionsRow);
  picture.append(lead, stageGrid, inspectRow, actionHelp, status, statusHelp);

  // ---- Chapter 2: following one pixel.
  const follow = chapter('ch-2', '2', 'Follow one pixel');
  follow.append(explain);

  // ---- Chapter 3: the mathematics.
  const mathematics = chapter('ch-3', '3', 'The mathematics');
  const mathLead = document.createElement('p');
  mathLead.className = 'chapter-lead';
  mathLead.textContent = 'The same calculation, written out as equations, for the pixel you selected. Every figure and number is recomputed from the scene above.';
  mathematics.append(mathLead, math);

  // ---- Chapter 4: the implementation, as it runs.
  const implementation = chapter('ch-4', '4', 'Implementation');
  const implLead = document.createElement('p');
  implLead.className = 'chapter-lead';
  implLead.textContent = 'The same mathematics is implemented twice: a CPU reference tracer in TypeScript, which produces every number in chapters 2 and 3, and the GPU shader in GLSL, which draws Figure 1.1. Both are shown exactly as they run, extracted from the source, not copied. The project’s browser tests check that the two agree pixel by pixel.';
  implementation.append(implLead, ...buildSourceChapter());

  // ---- Chapter 5: limits and credits.
  const colophon = chapter('ch-5', '5', 'Limits and credits');
  colophon.append(footer);

  const doc = document.createElement('main');
  doc.className = 'doc';
  const chapters = [picture, follow, mathematics, implementation, colophon];
  doc.append(...chapters);
  const toc = tableOfContents(chapters);
  shell.append(header, toc.nav, doc, record);
  root.replaceChildren(shell);

  // Figure 2.1's handles move the real objects, through the same snapping as the sliders.
  const diagram = createDiagram(diagramHost, (kind, x) => {
    if (kind === 'target') commitNumber(x, CONTROL_RANGES.targetX, current?.controls.targetX, snapped => actions.dispatch({ type: 'target-x', value: snapped }));
    else commitNumber(x, CONTROL_RANGES.lightX, current?.controls.lightX, snapped => actions.dispatch({ type: 'light-x', value: snapped }));
  });

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
  const bufferSize = (): { width: number; height: number } => {
    const image = canvasHost.querySelector('canvas');
    return image && image.width > 0 && image.height > 0 ? { width: image.width, height: image.height } : pixelSize;
  };
  const commitPixel = (): void => {
    const { width, height } = bufferSize();
    const x = Math.round(Number(pixelX.input.value));
    const y = Math.round(Number(pixelY.input.value));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    selection = { u: (cx + 0.5) / width, v: (cy + 0.5) / height };
    placeMarker();
    actions.inspectAt(selection.u, selection.v);
  };
  pixelX.input.addEventListener('change', commitPixel, { signal });
  pixelY.input.addEventListener('change', commitPixel, { signal });
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
      const size = bufferSize();
      syncPixel(pixelX.input, matching ? matching.pixel.x : null, size.width - 1);
      syncPixel(pixelY.input, matching ? matching.pixel.y : null, size.height - 1);
      const explanation = buildExplanation(view);
      explain.dataset.stale = explanation.stale ? 'true' : 'false';
      explainTitle.textContent = explanation.heading;
      modeNote.textContent = explanation.modeNote;
      pixelLine.textContent = explanation.pixelLine;
      summary.textContent = explanation.summary;
      events.replaceChildren(...explanation.items.map(item => {
        const li = document.createElement('li');
        li.dataset.kind = item.kind;
        const itemTitle = document.createElement('h3');
        // Each step names the kind of computation it records, as a derivation would.
        const kind = document.createElement('span');
        kind.className = 'step-kind';
        kind.textContent = STEP_KIND[item.kind];
        itemTitle.append(kind, item.title);
        const detail = document.createElement('p');
        detail.textContent = item.detail;
        li.append(itemTitle, detail);
        return li;
      }));
      events.hidden = explanation.items.length === 0;
      renderMathPanel(mathBody, view, {
        inspectAt(u, v) { selection = { u, v }; placeMarker(); actions.inspectAt(u, v); },
      });
      diagram.show(explanation.diagram, explanation.summary, view.scene,
        { targetX: view.controls.targetX, lightX: view.controls.lightX, ranges: { targetX: CONTROL_RANGES.targetX, lightX: CONTROL_RANGES.lightX } });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle.abort();
      hostObserver.disconnect();
      toc.dispose();
      diagram.dispose();
      root.replaceChildren();
    },
  };
}

const STEP_KIND: Record<string, string> = { hit: 'Intersection', reflect: 'Reflection', shadow: 'Visibility', end: 'Result' };

function chapter(id: string, number: string, title: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'chapter';
  section.id = id;
  const heading = document.createElement('h2');
  heading.id = `${id}-title`;
  const no = document.createElement('span');
  no.className = 'chapter-no';
  no.textContent = number;
  heading.append(no, title);
  section.setAttribute('aria-labelledby', heading.id);
  section.dataset.chapter = number;
  section.dataset.title = title;
  section.append(heading);
  return section;
}

function figureLabel(text: string): HTMLElement {
  const label = document.createElement('b');
  label.className = 'figure-label';
  label.textContent = `${text}. `;
  return label;
}

function definition(number: string, term: string, text: string): HTMLElement {
  const box = document.createElement('p');
  box.className = 'definition';
  const label = document.createElement('span');
  label.className = 'definition-label';
  label.textContent = `Definition ${number}`;
  const name = document.createElement('b');
  name.textContent = ` ${term} `;
  box.append(label, name, text);
  return box;
}

function pixelInput(id: string, symbol: string, name: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement('label');
  label.htmlFor = id;
  label.className = 'math-symbol';
  label.textContent = symbol;
  const input = document.createElement('input');
  input.id = id;
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = '0';
  input.step = '1';
  input.setAttribute('aria-label', name);
  return { label, input };
}

function syncPixel(input: HTMLInputElement, value: number | null, max: number): void {
  input.max = String(Math.max(0, max));
  if (document.activeElement === input) return;
  input.value = value === null ? '' : String(value);
}

/** Chapter index with a scroll-spy that marks the chapter being read. */
function tableOfContents(chapters: HTMLElement[]): { nav: HTMLElement; dispose(): void } {
  const nav = document.createElement('nav');
  nav.className = 'toc';
  nav.setAttribute('aria-label', 'Chapters');
  const list = document.createElement('ol');
  const links = new Map<string, HTMLAnchorElement>();
  for (const section of chapters) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#${section.id}`;
    const no = document.createElement('span');
    no.className = 'toc-no';
    no.textContent = section.dataset.chapter ?? '';
    link.append(no, section.dataset.title ?? '');
    item.append(link);
    list.append(item);
    links.set(section.id, link);
  }
  nav.append(list);
  // The chapter being read is the last one whose top has passed 30% of the
  // viewport (the first chapter before any has). Checked once per frame.
  // Two edge cases: a chapter chosen in the index stays current while it is on
  // screen; at the very bottom of the page, short final chapters can never
  // reach the line, so the last chapter in view wins.
  let frame = 0;
  let pinned: HTMLElement | null = null;
  const mark = (): void => {
    frame = 0;
    const view = window.innerHeight;
    const line = view * 0.3;
    if (pinned) {
      const top = pinned.getBoundingClientRect().top;
      if (top < -8 || top > view * 0.9) pinned = null;
    }
    const atBottom = window.scrollY + view >= document.documentElement.scrollHeight - 4;
    const current = pinned
      ?? (atBottom ? chapters.filter(section => section.getBoundingClientRect().top < view * 0.85).at(-1) : null)
      ?? chapters.filter(section => section.getBoundingClientRect().top <= line).at(-1)
      ?? chapters[0];
    for (const [id, link] of links) {
      if (id === current.id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  };
  const schedule = (): void => { if (!frame) frame = requestAnimationFrame(mark); };
  nav.addEventListener('click', event => {
    const link = (event.target as Element).closest('a');
    const id = link?.getAttribute('href')?.slice(1);
    const section = chapters.find(candidate => candidate.id === id);
    if (section) { pinned = section; schedule(); }
  });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  schedule();
  return {
    nav,
    dispose: () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
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
