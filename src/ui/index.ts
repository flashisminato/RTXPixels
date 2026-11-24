import { MAX_LIGHTS, MAX_REDIRECTS, type Axis, type LightAxis, type Mode, type Vec3, type ViewMode, type ViewState } from '../contracts.ts';
import type { UIActions, UIHandle } from '../contracts.ts';
import { BALL_BOUNDS, BALL_COLORS, CONTROL_RANGES, EXTRA_LIGHT_TINTS, MAX_BALLS, WALL_COLORS, targetPositionIsFree } from '../scene/preset.ts';
import { createPhysicsDriver } from './physics-driver.ts';
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
  title.textContent = 'RTXPixel';
  const question = document.createElement('p');
  question.className = 'question';
  question.textContent = 'Real-time ray-tracing interactive environment in WebGL';
  const abstract = document.createElement('p');
  abstract.className = 'abstract';
  abstract.textContent = 'Ever wondered why RTX makes the lighting in games look so real? Use RTXPixel to find out! Click any pixel you like to see how light and the camera work together. With an adjustable surface finish and light positions, you can watch how the math—and the color—changes in real time!';
  header.className = 'front';
  header.append(title, question, abstract);

  const picture = chapter('ch-1', '1', 'The picture');
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
  // The live status stays for screen readers and the test hooks, but is not shown.
  const status = document.createElement('p');
  status.className = 'status visually-hidden';
  status.setAttribute('role', 'status');

  const controls = document.createElement('section');
  controls.className = 'controls';
  controls.setAttribute('aria-label', 'Parameters');
  const controlsTitle = document.createElement('h3');
  controlsTitle.textContent = 'Parameters';
  // The colored ball moves along x, y and z, coloured like the gizmo's arrows.
  const targetRanges = { x: CONTROL_RANGES.targetX, y: CONTROL_RANGES.targetY, z: CONTROL_RANGES.targetZ } as const;
  const targetValue = (axis: Axis): number | undefined =>
    current ? (axis === 'x' ? current.controls.targetX : axis === 'y' ? current.controls.targetY : current.controls.targetZ) : undefined;
  /** Move the colored ball along one axis, unless that would put it inside the mirror ball. */
  const moveTarget = (axis: Axis, value: number): void => {
    if (!current) return;
    const range = targetRanges[axis];
    commitNumber(Math.min(range.max, Math.max(range.min, value)), range, targetValue(axis), snapped => {
      const next: Vec3 = [current!.controls.targetX, current!.controls.targetY, current!.controls.targetZ];
      next[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] = snapped;
      if (targetPositionIsFree(next)) actions.dispatch({ type: 'target-move', axis, value: snapped });
    });
  };
  const target = document.createElement('fieldset');
  target.className = 'xyz';
  const targetLegend = document.createElement('legend');
  targetLegend.textContent = 'Move the colored object';
  target.append(targetLegend);
  const targetAxes = (['x', 'y', 'z'] as const).map(axis => {
    const control = compactRange(signal, `${ns}-target-${axis}`, `${axis}${axis === 'y' ? ' (height)' : axis === 'z' ? ' (depth)' : ' (sideways)'}`, targetRanges[axis], value => moveTarget(axis, value));
    control.wrap.classList.add(`axis-${axis}`);
    target.append(control.wrap);
    return control;
  });
  const targetHint = document.createElement('p');
  targetHint.className = 'control-help';
  targetHint.textContent = 'Or click it in Figure 2.1 and drag the red, green or blue arrow.';
  target.append(targetHint);
  const targetWrap = { wrap: target };
  const mirror = radioControl(signal, `${ns}-mirror`, 'Center sphere',
    'Switching to flat color stops the reflection. The sphere does not rotate.', [
      { value: 'mirror', name: 'Shiny mirror', hint: 'Shows a reflection.' },
      { value: 'matte', name: 'Flat color', hint: 'Paint, with no bounce.' },
    ], value => {
      const mode = asMode(value);
      if (!mode || current?.controls.mirrorMode === mode) return;
      actions.dispatch({ type: 'mirror-mode', value: mode });
    });
  // The back wall: its paint, and whether it is painted or a mirror.
  const wallFinish = radioControl(signal, `${ns}-wall`, 'Back wall',
    'As a mirror, the wall and the center sphere reflect each other, up to four bounces. A mirror shows what it reflects, so its color only appears when ray tracing is off.', [
      { value: 'matte', name: 'Paint', hint: 'A flat wall in the color below.' },
      { value: 'mirror', name: 'Mirror', hint: 'Reflects the room, and the sphere in it.' },
    ], value => {
      const mode = asMode(value);
      if (!mode || current?.controls.wallMode === mode) return;
      actions.dispatch({ type: 'wall-mode', value: mode });
    });
  const wallColor = swatchControl(signal, `${ns}-wallcolor`, 'Wall color',
    WALL_COLORS.map(c => ({ name: c.name, color: cssColor(c.albedo) })), index => {
      if (current?.controls.wallColor === index) return;
      actions.dispatch({ type: 'wall-color', value: index });
    });
  const camera = rangeControl(signal, `${ns}-camera`, 'Move the camera',
    'This steps the camera around the scene. The center sphere does not rotate, so there is no sphere-spin control.', CONTROL_RANGES.cameraYawDeg, value => {
      commitNumber(value, CONTROL_RANGES.cameraYawDeg, current?.controls.cameraYawDeg, snapped => actions.dispatch({ type: 'camera-yaw', value: snapped }));
    });
  // Ray tracing on is the full picture (up to four mirror bounces, a shadow ray per
  // light); off shades only the first surface with direct light, like a rasterizer.
  const rayTracing = radioControl(signal, `${ns}-raytracing`, 'Ray tracing',
    'Switch it off to see what a game draws without ray tracing, then back on to see what it adds.', [
      { value: 'beauty', name: 'On', hint: 'Mirror reflections and a shadow from every light.' },
      { value: 'raster', name: 'Off', hint: 'Each surface lit directly: no shadows, and the mirror shows no reflection.' },
    ], value => {
      const mode = asViewMode(value);
      if (!mode || current?.controls.viewMode === mode) return;
      if (mode === 'beauty' && current && current.controls.maxRedirects !== MAX_REDIRECTS) actions.dispatch({ type: 'redirects', value: MAX_REDIRECTS });
      actions.dispatch({ type: 'view-mode', value: mode });
    });

  // ---- Lights: add up to MAX_LIGHTS point lights, move each in 3D and set its strength.
  const lightsHelp = document.createElement('p');
  lightsHelp.className = 'panel-help';
  lightsHelp.textContent = 'Every light casts its own hard shadow. Add a colored light, move it in 3D, and change how strong it is.';
  const lightList = document.createElement('div');
  lightList.className = 'light-list';
  const addLight = document.createElement('button');
  addLight.type = 'button';
  addLight.className = 'add-light';
  addLight.textContent = '+ Add a light';
  addLight.addEventListener('click', () => {
    if ((current?.controls.extraLights.length ?? 0) < MAX_LIGHTS - 1) actions.dispatch({ type: 'light-add' });
  }, { signal });
  type LightCard = { ranges: Record<LightAxis | 'intensity', { input: HTMLInputElement; output: HTMLElement }> };
  let lightCards: LightCard[] = [];
  let lightLayout = '';
  let lightCardsLifecycle: AbortController | null = null;

  function lightValues(view: ViewState, index: number): { x: number; y: number; z: number; intensity: number } {
    if (index === 0) return { x: view.controls.lightX, y: view.controls.lightY, z: view.controls.lightZ, intensity: view.controls.lightIntensity };
    return view.controls.extraLights[index - 1];
  }

  function buildLightCards(view: ViewState): void {
    lightCardsLifecycle?.abort();
    lightCardsLifecycle = new AbortController();
    const cardSignal = AbortSignal.any([signal, lightCardsLifecycle.signal]);
    const tints = [null, ...view.controls.extraLights.map(light => light.tint)];
    lightCards = tints.map((tint, index) => {
      const card = document.createElement('fieldset');
      card.className = 'light-card';
      const legend = document.createElement('legend');
      const swatch = document.createElement('span');
      swatch.className = 'light-swatch';
      swatch.style.background = cssColor(tint === null ? [1, 0.94, 0.84] : EXTRA_LIGHT_TINTS[tint]);
      legend.append(swatch, index === 0 ? 'Light 1 · main' : `Light ${index + 1} · ${TINT_NAMES[tint!] ?? 'extra'}`);
      card.append(legend);
      const id = `${ns}-light${index}`;
      const axis = (key: LightAxis, label: string, range: { min: number; max: number; step: number }) =>
        compactRange(cardSignal, `${id}-${key}`, label, range, value => {
          if (!current) return;
          commitNumber(value, range, lightValues(current, index)[key], snapped => actions.dispatch({ type: 'light-move', index, axis: key, value: snapped }));
        });
      const ranges = {
        x: axis('x', 'Sideways (x)', CONTROL_RANGES.lightX),
        y: axis('y', 'Height (y)', CONTROL_RANGES.lightY),
        z: axis('z', 'Depth (z)', CONTROL_RANGES.lightZ),
        intensity: compactRange(cardSignal, `${id}-intensity`, 'Intensity', CONTROL_RANGES.lightIntensity, value => {
          if (!current) return;
          commitNumber(value, CONTROL_RANGES.lightIntensity, lightValues(current, index).intensity,
            snapped => actions.dispatch({ type: 'light-intensity', index, value: snapped }));
        }),
      };
      card.append(ranges.x.wrap, ranges.y.wrap, ranges.z.wrap, ranges.intensity.wrap);
      if (index > 0) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button button-secondary remove-light';
        remove.textContent = `Remove light ${index + 1}`;
        remove.addEventListener('click', () => actions.dispatch({ type: 'light-remove', index }), { signal: cardSignal });
        card.append(remove);
      }
      lightList.append(card);
      return { ranges };
    });
  }

  function syncLights(view: ViewState): void {
    const layout = view.controls.extraLights.map(light => light.tint).join(',');
    if (layout !== lightLayout || lightCards.length === 0) {
      lightLayout = layout;
      lightList.replaceChildren();
      buildLightCards(view);
      lightList.append(addLight);
    }
    const count = view.controls.extraLights.length + 1;
    lightsTab.textContent = `Lights · ${count}`;
    addLight.disabled = count >= MAX_LIGHTS;
    addLight.textContent = count >= MAX_LIGHTS ? `All ${MAX_LIGHTS} lights are in use` : '+ Add a light';
    lightCards.forEach((card, index) => {
      const values = lightValues(view, index);
      if (!values) return;
      syncRange(card.ranges.x.input, card.ranges.x.output, values.x, values.x.toFixed(1));
      syncRange(card.ranges.y.input, card.ranges.y.output, values.y, values.y.toFixed(1));
      syncRange(card.ranges.z.input, card.ranges.z.output, values.z, values.z.toFixed(1));
      syncRange(card.ranges.intensity.input, card.ranges.intensity.output, values.intensity, String(Math.round(values.intensity)));
    });
  }

  // ---- Balls: up to MAX_BALLS added balls, each with its own paint and finish.
  // They drop in from the air (see physics-driver.ts) and can be moved in Figure 2.1.
  const ballsHelp = document.createElement('p');
  ballsHelp.className = 'panel-help';
  ballsHelp.textContent = `Add up to ${MAX_BALLS} balls. Each drops in from the air, bounces and settles. Give it a color, or make it a mirror. Click a ball in Figure 2.1 to move it with the x, y and z arrows.`;
  const ballList = document.createElement('div');
  ballList.className = 'light-list ball-list';
  const addBall = document.createElement('button');
  addBall.type = 'button';
  addBall.className = 'add-ball';
  addBall.textContent = '+ Add a ball';
  addBall.addEventListener('click', () => {
    if ((current?.controls.balls.length ?? 0) < MAX_BALLS) actions.dispatch({ type: 'ball-add' });
  }, { signal });
  type BallCard = { finish: HTMLInputElement[]; colors: HTMLInputElement[] };
  let ballCards: BallCard[] = [];
  let ballLayout = '';
  let ballCardsLifecycle: AbortController | null = null;
  function syncBalls(view: ViewState): void {
    const layout = view.controls.balls.map(b => b.n).join(',');
    if (layout !== ballLayout || (ballCards.length === 0 && view.controls.balls.length > 0)) {
      ballLayout = layout;
      ballCardsLifecycle?.abort();
      ballCardsLifecycle = new AbortController();
      const cardSignal = AbortSignal.any([signal, ballCardsLifecycle.signal]);
      ballList.replaceChildren();
      ballCards = view.controls.balls.map((ball, index) => {
        const card = document.createElement('fieldset');
        card.className = 'light-card ball-card';
        const legend = document.createElement('legend');
        legend.textContent = `Ball ${ball.n}`;
        card.append(legend);
        const finish = radioControl(cardSignal, `${ns}-ball${ball.n}-finish`, 'Finish', '', [
          { value: 'matte', name: 'Paint', hint: '' },
          { value: 'mirror', name: 'Mirror', hint: '' },
        ], value => {
          const mode = asMode(value);
          if (mode && current?.controls.balls[index]?.mode !== mode) actions.dispatch({ type: 'ball-mode', index, value: mode });
        });
        finish.wrap.querySelector('.control-help')?.remove();
        finish.wrap.classList.add('compact-choices');
        const colors = swatchControl(cardSignal, `${ns}-ball${ball.n}-color`, 'Color',
          BALL_COLORS.map(c => ({ name: `Ball ${ball.n} ${c.name}`, color: cssColor(c.albedo) })), color => {
            if (current?.controls.balls[index]?.color !== color) actions.dispatch({ type: 'ball-color', index, value: color });
          });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button button-secondary remove-light';
        remove.textContent = `Remove ball ${ball.n}`;
        remove.addEventListener('click', () => actions.dispatch({ type: 'ball-remove', index }), { signal: cardSignal });
        card.append(colors.wrap, finish.wrap, remove);
        ballList.append(card);
        return { finish: finish.inputs, colors: colors.inputs };
      });
      ballList.append(addBall);
    }
    const count = view.controls.balls.length;
    ballsTab.textContent = `Balls · ${count}`;
    addBall.disabled = count >= MAX_BALLS;
    addBall.textContent = count >= MAX_BALLS ? `All ${MAX_BALLS} balls are in the room` : '+ Add a ball';
    view.controls.balls.forEach((ball, i) => {
      if (!ballCards[i]) return;
      syncRadios(ballCards[i].finish, ball.mode);
      syncRadios(ballCards[i].colors, String(ball.color));
    });
  }

  // ---- Parameters as a full-width tabbed panel under the picture. Each tab lays its
  // controls out across the width instead of stacking every option in one column.
  // DOM order of the range inputs stays: object x, camera, main light x, ...
  const tabList = document.createElement('div');
  tabList.className = 'param-tabs';
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', 'Parameter groups');
  const tabs: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  function tabPanel(key: string, label: string, children: HTMLElement[], help?: HTMLElement): HTMLButtonElement {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'param-tab';
    tab.id = `${ns}-tab-${key}`;
    tab.setAttribute('role', 'tab');
    tab.textContent = label;
    const panel = document.createElement('div');
    panel.className = `param-panel param-panel-${key}`;
    panel.id = `${ns}-panel-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    tab.setAttribute('aria-controls', panel.id);
    const grid = document.createElement('div');
    grid.className = 'param-grid';
    grid.append(...children);
    panel.append(...(help ? [help] : []), grid);
    tab.addEventListener('click', () => selectTab(tabs.indexOf(tab)), { signal });
    tabs.push(tab);
    panels.push(panel);
    tabList.append(tab);
    return tab;
  }
  function selectTab(index: number, focus = false): void {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[i].hidden = !selected;
    });
    if (focus) tabs[index].focus();
  }
  tabList.addEventListener('keydown', event => {
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const next = event.key === 'ArrowRight' ? (at + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(next, true);
  }, { signal });
  tabPanel('object', 'Object', [targetWrap.wrap, mirror.wrap, wallFinish.wrap, wallColor.wrap]);
  tabPanel('camera', 'Camera', [camera.wrap]);
  const lightsTab = tabPanel('lights', 'Lights · 1', [lightList], lightsHelp);
  const ballsTab = tabPanel('balls', 'Balls · 0', [ballList], ballsHelp);
  ballList.append(addBall);
  tabPanel('picture', 'Picture', [rayTracing.wrap]);
  selectTab(0);
  const controlsHead = document.createElement('div');
  controlsHead.className = 'controls-head';
  controlsHead.append(controlsTitle);
  controls.append(controlsHead, tabList, ...panels);

  const explain = document.createElement('section');
  explain.className = 'explain';
  const explainTitle = document.createElement('h3');
  explainTitle.className = 'explain-title';
  explainTitle.textContent = 'Pick a pixel to follow';
  // The direct answer: the pixel's coordinates and why it has its color, in one paragraph.
  const answer = document.createElement('p');
  answer.className = 'summary';
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
  events.id = `${ns}-steps`;
  events.setAttribute('aria-label', 'Computed steps for the selected pixel');
  events.hidden = true;
  // The step-by-step trace stays hidden until the reader asks for it.
  let stepsOpen = false;
  const stepsButton = document.createElement('button');
  stepsButton.type = 'button';
  stepsButton.className = 'button button-secondary explain-more';
  stepsButton.setAttribute('aria-controls', events.id);
  stepsButton.hidden = true;
  const syncSteps = (): void => {
    const any = events.childElementCount > 0;
    stepsButton.hidden = !any;
    events.hidden = !any || !stepsOpen;
    stepsButton.textContent = stepsOpen ? 'Show less' : 'Explain more';
    stepsButton.setAttribute('aria-expanded', String(stepsOpen));
  };
  stepsButton.addEventListener('click', () => {
    stepsOpen = !stepsOpen;
    syncSteps();
    if (stepsOpen) restartAnimation(events, 'is-opening');
  }, { signal });
  const math = document.createElement('div');
  math.className = 'math';
  const mathBody = document.createElement('div');
  math.append(mathBody);
  explain.append(explainTitle, answer, direction, figure, stepsButton, events);


  // Integration reads this single pre as JSON of the current inspection.
  const record = document.createElement('pre');
  record.className = 'inspection-record';
  record.hidden = true;
  record.setAttribute('aria-hidden', 'true');

  // ---- Chapter 1: the picture as Figure 1.1, parameters beside it, pixel selector below.
  const pictureFigure = document.createElement('figure');
  pictureFigure.className = 'fig fig-picture';
  const pictureCaption = document.createElement('figcaption');
  pictureCaption.append(figureLabel('Figure 1.1'));
  pictureFigure.append(frame, pictureCaption);
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
  picture.append(pictureFigure, inspectRow, status, controls);

  // ---- Chapter 2: following one pixel.
  const follow = chapter('ch-2', '2', 'Follow one pixel');
  follow.append(explain);

  // ---- Chapter 3: the mathematics.
  const mathematics = chapter('ch-3', '3', 'The mathematics');
  const mathLead = document.createElement('p');
  mathLead.className = 'chapter-lead';
  mathLead.textContent = 'The same calculation, written out as equations, for the pixel you selected. Every figure and number is recomputed from the scene above.';
  mathematics.append(mathLead, math);

  const doc = document.createElement('main');
  doc.className = 'doc';
  // The implementation and the limits and credits live in the README.
  const chapters = [picture, follow, mathematics];
  doc.append(...chapters);
  const toc = tableOfContents(chapters);
  shell.append(header, toc.nav, doc, record);
  root.replaceChildren(shell);

  // Figure 2.1's handles move the real objects, through the same snapping and
  // ranges as the sliders, so the picture, the answer and the math follow.
  const clampTo = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, value));
  const lightRange = { x: CONTROL_RANGES.lightX, y: CONTROL_RANGES.lightY, z: CONTROL_RANGES.lightZ } as const;
  const ballRanges = {
    x: { ...BALL_BOUNDS.x, step: 0.05 }, y: { ...BALL_BOUNDS.y, step: 0.05 }, z: { ...BALL_BOUNDS.z, step: 0.05 },
  } as const;
  // Balls fall, bounce and settle; the driver runs only while something moves.
  const physics = createPhysicsDriver(action => actions.dispatch(action), prefersReducedMotion);
  const ballIndexOf = (id: string): number => current ? current.controls.balls.findIndex(b => `ball-${b.n}` === id) : -1;
  const diagram = createDiagram(diagramHost, {
    moveObject(id, axis, value) {
      if (id === 'target') { moveTarget(axis, value); return; }
      const index = ballIndexOf(id);
      if (index < 0 || !current) return;
      const range = ballRanges[axis];
      commitNumber(clampTo(value, range), range, current.controls.balls[index][axis], snapped => actions.dispatch({ type: 'ball-move', index, axis, value: snapped }));
    },
    grab(id, held) {
      const ball = current?.controls.balls[ballIndexOf(id)];
      if (ball) physics.hold(ball.n, held);
    },
    moveCamera(yaw) {
      commitNumber(clampTo(yaw, CONTROL_RANGES.cameraYawDeg), CONTROL_RANGES.cameraYawDeg, current?.controls.cameraYawDeg, snapped => actions.dispatch({ type: 'camera-yaw', value: snapped }));
    },
    moveLight(index, axis, value) {
      if (!current || index > current.controls.extraLights.length) return;
      const range = lightRange[axis];
      commitNumber(clampTo(value, range), range, lightValues(current, index)[axis], snapped => actions.dispatch({ type: 'light-move', index, axis, value: snapped }));
    },
    pickPicture(u, v) {
      selection = { u, v };
      placeMarker();
      actions.inspectAt(u, v);
    },
  });
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'button button-secondary replay-path';
  replay.textContent = 'Replay the path';
  // Visibility, not display: showing or hiding it must not shift the page under a drag.
  replay.style.visibility = 'hidden';
  replay.addEventListener('click', () => diagram.replay(), { signal });
  // Puts the whole figure back: the 3D view, the scene (camera, lights, object,
  // mirror, bounces, view mode) and the selected pixel.
  const resetFigure = document.createElement('button');
  resetFigure.type = 'button';
  resetFigure.className = 'button button-secondary reset-figure';
  resetFigure.textContent = 'Reset';
  resetFigure.setAttribute('aria-label', 'Reset Figure 2.1: view, scene and selected pixel');
  resetFigure.addEventListener('click', () => {
    diagram.resetView();
    selection = null;
    shownPixel = '';
    placeMarker();
    actions.clearInspection?.();
    actions.dispatch({ type: 'reset' });
  }, { signal });
  const figureTools = document.createElement('div');
  figureTools.className = 'figure-tools';
  const figureHint = document.createElement('p');
  figureHint.className = 'figure-hint';
  figureHint.textContent = 'Drag the camera, a light or the colored object. Click a surface to follow its pixel. Drag empty space to turn the view; double-click to reset it.';
  figureTools.append(replay, resetFigure, figureHint);
  figure.append(figureTools);
  // The path plays when a new pixel is chosen, not when the same pixel is recomputed.
  let shownPixel = '';

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
  const bufferAspect = (): number => { const size = bufferSize(); return size.width / size.height; };
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
      (['x', 'y', 'z'] as const).forEach((axis, i) => {
        const value = axis === 'x' ? view.controls.targetX : axis === 'y' ? view.controls.targetY : view.controls.targetZ;
        syncRange(targetAxes[i].input, targetAxes[i].output, value, value.toFixed(2));
      });
      syncLights(view);
      syncBalls(view);
      physics.sync(view);
      syncRange(camera.input, camera.output, view.controls.cameraYawDeg, `${Math.round(view.controls.cameraYawDeg)}°`);
      syncRadios(mirror.inputs, view.controls.mirrorMode);
      syncRadios(wallFinish.inputs, view.controls.wallMode);
      syncRadios(wallColor.inputs, String(view.controls.wallColor));
      syncRadios(rayTracing.inputs, view.controls.viewMode);
      // While a changed scene is being recomputed (each physics frame, each drag
      // step), keep the selected pixel and its last explanation on screen instead
      // of flashing back to "pick a pixel" for one frame.
      if (!view.inspection && selection && view.status === 'starting') return;
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
      if (answer.textContent !== explanation.answer) {
        answer.textContent = explanation.answer;
        if (matching) restartAnimation(answer, 'is-new');
      }
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
      syncSteps();
      renderMathPanel(mathBody, view, {
        inspectAt(u, v) { selection = { u, v }; placeMarker(); actions.inspectAt(u, v); },
      });
      const pixelKey = matching ? `${matching.pixel.x},${matching.pixel.y}` : '';
      const animate = pixelKey !== '' && pixelKey !== shownPixel;
      if (pixelKey) shownPixel = pixelKey;
      if (animate) restartAnimation(marker, 'is-new');
      replay.style.visibility = !explanation.diagram || prefersReducedMotion() ? 'hidden' : 'visible';
      diagram.show(explanation.diagram, explanation.summary, view.scene, {
        objects: [
          { id: 'target', x: view.controls.targetX, y: view.controls.targetY, z: view.controls.targetZ, ranges: targetRanges },
          ...view.controls.balls.map(b => ({ id: `ball-${b.n}`, x: b.x, y: b.y, z: b.z, ranges: ballRanges })),
        ],
        camera: { yawDeg: view.controls.cameraYawDeg, range: CONTROL_RANGES.cameraYawDeg },
        lights: [0, ...view.controls.extraLights.map((_, i) => i + 1)].map(i => {
          const l = lightValues(view, i);
          return { x: l.x, y: l.y, z: l.z };
        }),
        lightRanges: lightRange,
      }, { animate, aspect: matching ? matching.pixel.width / matching.pixel.height : bufferAspect() });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle.abort();
      hostObserver.disconnect();
      toc.dispose();
      physics.dispose();
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
  return value === 'beauty' || value === 'raster' ? value : null;
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
  wrap.append(head, input);
  if (help) {
    const note = document.createElement('p');
    note.className = 'control-help';
    note.textContent = help;
    wrap.append(note);
  }
  return { wrap, input, output };
}

const TINT_NAMES = ['blue', 'pink', 'green'];

/** Linear RGB to a CSS sRGB color, for the light swatches. */
function cssColor(linear: Vec3): string {
  const encode = (c: number) => Math.round(255 * Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  return `rgb(${linear.map(encode).join(' ')})`;
}

/** A range control without a help line, for the dense per-light cards. */
function compactRange(
  signal: AbortSignal,
  id: string,
  label: string,
  range: { min: number; max: number; step: number },
  commit: (value: number) => void,
): { wrap: HTMLElement; input: HTMLInputElement; output: HTMLElement } {
  const control = rangeControl(signal, id, label, '', range, commit);
  control.wrap.classList.add('control-compact');
  control.wrap.querySelector('.control-help')?.remove();
  return control;
}

/** Replay a one-shot CSS animation class on an element. */
function restartAnimation(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth; // force a style flush so the animation starts again
  el.classList.add(className);
}

function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** A row of color chips that behave as one radio group (keyboard: arrow keys). */
function swatchControl(
  signal: AbortSignal,
  name: string,
  legend: string,
  choices: { name: string; color: string }[],
  commit: (index: number) => void,
): { wrap: HTMLFieldSetElement; inputs: HTMLInputElement[] } {
  const wrap = document.createElement('fieldset');
  wrap.className = 'swatches';
  const caption = document.createElement('legend');
  caption.textContent = legend;
  const row = document.createElement('div');
  row.className = 'swatch-row';
  const inputs = choices.map((choice, index) => {
    const label = document.createElement('label');
    label.className = 'swatch';
    label.title = choice.name;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(index);
    input.setAttribute('aria-label', choice.name);
    input.addEventListener('change', () => { if (input.checked) commit(index); }, { signal });
    const chip = document.createElement('span');
    chip.className = 'swatch-chip';
    chip.style.background = choice.color;
    label.append(input, chip);
    row.append(label);
    return input;
  });
  wrap.append(caption, row);
  return { wrap, inputs };
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
