import type { ViewState } from '../contracts.ts';
import { buildMathStory, type HitStep, type MathStory, type ReflectStep, type ShadeStep } from './math-model.ts';
import { displayFigure, intersectionFigure, pixelToRayFigure, reflectionFigure, shadingFigure } from './math-figures.ts';
import {
  cases, cdot, comma, degrees, eq, frac, hadamard, implies, inline, math, mi, minus, mn, mo, mtext, mu, norm, num, paren,
  plus, row, space, sqrt, sub, sup, tuple, v, vs, type MNode,
} from './mathml.ts';

/**
 * "Explain the math": textbook figures plus the actual equations, with this
 * pixel's numbers substituted. Renders into the existing <details> body.
 *
 * Every symbol, in equations AND in the surrounding sentences, is real MathML,
 * so vectors are bold upright, scalars italic, and subscripts are subscripts.
 * MathML elements are created fresh for each use: a DOM node can only live in
 * one place, so reusing one would silently move it out of an earlier equation.
 */

const MATCH_TOLERANCE = 1e-9;

// --- notation (each call returns NEW elements) ---------------------------------

const s = (name: string, script: string): Element => sub(mi(name), script.length > 1 ? mu(script) : mi(script));
const half = (): Element => frac(mn('1'), mn('2'));
const dotted = (a: MNode, b: MNode): Element => row(a, cdot(), b);
const sq = (base: MNode): Element => sup(base, mn('2'));
const fn = (name: string, arg: MNode): Element => row(mu(name), mo('\u2061'), paren(arg));
const eps = (): Element => mi('\u03b5');
const theta = (script: string): Element => sub(mi('\u03b8'), mi(script));
// The prime glyph is already raised; superscripting it again floats it away from its base.
const prime = (base: MNode, marks = '\u2032'): Element => row(base, mo(marks, { lspace: '0', rspace: '0' }));
/** Unary minus: prefix form, so it hugs its operand ("−h", not "− h"). */
const neg = (operand: MNode): Element => row(mo('\u2212', { form: 'prefix', lspace: '0', rspace: '0' }), operand);
const tenTo = (exponent: number): Element => sup(mn('10'), row(minus(), mn(String(Math.abs(exponent)))));

/** Inline-math shorthands for prose. */
const V = (letter: string, script?: string): Element => inline(script ? vs(letter, script) : v(letter));
const S = (name: string, script?: string): Element => inline(script ? s(name, script) : mi(name));
const X = (...children: MNode[]): Element => inline(...children);

type Prose = Array<string | Element>;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string | null, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const child of children) el.append(child);
  return el;
}

const para = (className: string, ...parts: Prose): HTMLParagraphElement => element('p', className, ...parts);

function check(error: number | null, what: Prose): HTMLElement | null {
  if (error === null || !Number.isFinite(error)) return null;
  return error < MATCH_TOLERANCE
    ? para('math-check', '✓ Matches the ', ...what, ' the tracer recorded.')
    : para('math-check math-check-bad', 'Differs from the recorded ', ...what, ` by ${error.toExponential(1)}.`);
}

type SectionParts = { title: string; figure?: SVGSVGElement; caption?: Prose; lead?: Prose; equations: Element[]; notes?: Array<HTMLElement | null> };

class Sections {
  private section = 0;
  private figure = 0;
  readonly nodes: HTMLElement[] = [];

  add(parts: SectionParts): void {
    const box = element('section', 'math-step');
    box.append(element('h3', null, element('span', 'math-step-no', String(++this.section)), parts.title));
    if (parts.lead) box.append(para('math-lead', ...parts.lead));
    if (parts.figure) {
      const fig = element('figure', 'math-fig');
      fig.append(parts.figure);
      if (parts.caption) fig.append(element('figcaption', null, element('b', null, `Figure ${++this.figure}. `), ...parts.caption));
      box.append(fig);
    }
    const eqs = element('div', 'math-eqs');
    eqs.append(...parts.equations);
    box.append(eqs);
    for (const note of parts.notes ?? []) if (note) box.append(note);
    this.nodes.push(box);
  }
}

// --- sections ----------------------------------------------------------------

function pixelSection(out: Sections, story: MathStory): void {
  const p = story.pixel;
  const b = p.basis;
  const sxTerm = (): Element => row(s('s', 'x'), mi('k'), v('r'));
  const syTerm = (): Element => row(s('s', 'y'), mi('k'), v('u'));
  const sum = (): Element => row(v('f'), plus(), sxTerm(), plus(), syTerm());
  const up = (): Element => tuple([0, 1, 0], 0);
  out.add({
    title: 'From a pixel to a ray',
    lead: ['The pixel’s center is carried onto a sensor one unit in front of the camera. The ray from the camera ', V('O'), ' through that point, with unit direction ', V('D'), ', is the one we follow.'],
    figure: pixelToRayFigure(p),
    caption: ['Image space (left) and camera space (right). The red arc carries the pixel center onto the sensor; the red line is the camera ray. The sensor’s half-height is ', S('k'), ' and its half-width ', X(paren(row(mi('W'), mo('/', { lspace: '0', rspace: '0' }), mi('H'))), mi('k')), '.'],
    equations: [
      math('s x',
        s('s', 'x'), eq(), row(paren(row(frac(row(mn('2'), paren(row(mi('x'), plus(), half()))), mi('W')), minus(), mn('1'))), cdot(), frac(mi('W'), mi('H'))),
        eq(), row(paren(row(frac(row(mn('2'), paren(row(mn(String(p.x)), plus(), half()))), mn(String(p.width))), minus(), mn('1'))), cdot(), frac(mn(String(p.width)), mn(String(p.height)))),
        eq(), num(p.sx, 4)),
      math('s y',
        s('s', 'y'), eq(), row(mn('1'), minus(), frac(row(mn('2'), paren(row(mi('y'), plus(), half()))), mi('H'))),
        eq(), row(mn('1'), minus(), frac(row(mn('2'), paren(row(mn(String(p.y)), plus(), half()))), mn(String(p.height)))),
        eq(), num(p.sy, 4)),
      math('camera basis',
        v('f'), eq(), frac(row(mu('target'), minus(), v('O')), norm(row(mu('target'), minus(), v('O')))), eq(), tuple(b.forward), comma(), space(1),
        v('r'), eq(), frac(row(up(), mo('\u00d7'), v('f')), norm(row(up(), mo('\u00d7'), v('f')))), eq(), tuple(b.right), comma(), space(1),
        v('u'), eq(), row(v('f'), mo('\u00d7'), v('r')), eq(), tuple(b.up)),
      math('half field of view',
        mi('k'), eq(), fn('tan', frac(sub(mi('\u03b8'), mu('fov')), mn('2'))), eq(), fn('tan', degrees(p.fovYDeg / 2)), eq(), num(p.k, 4)),
      math('ray direction', v('D'), eq(), frac(sum(), norm(sum())), eq(), tuple(p.direction, 4)),
    ],
    notes: [
      para('math-note', 'The camera sits at ', V('O'), ' = ', X(tuple(b.origin)), '. Pixel centers sit at half-integers. Image ', S('y'), ' grows downward, so ', S('s', 'y'), ' flips it to point up.'),
      check(p.directionError, ['ray direction ', V('D')]),
    ],
  });
}

function hitSection(out: Sections, hit: HitStep, afterBounce: boolean): void {
  const notes: Array<HTMLElement | null> = [];
  let equations: Element[];
  if (hit.sphere) {
    const sp = hit.sphere;
    const near = sp.root === 'near';
    equations = [
      math('sphere equation',
        sq(norm(row(v('O'), plus(), mi('t'), v('D'), minus(), v('C')))), eq(), sq(mi('R')), comma(), space(1.4),
        mtext('with'), space(0.5), dotted(v('D'), v('D')), eq(), mn('1')),
      math('quadratic terms',
        mi('h'), eq(), dotted(paren(row(v('O'), minus(), v('C'))), v('D')), eq(), num(sp.h), comma(), space(1),
        mi('c'), eq(), row(sq(norm(row(v('O'), minus(), v('C')))), minus(), sq(mi('R'))), eq(), num(sp.c), comma(), space(1),
        mi('\u0394'), eq(), row(sq(mi('h')), minus(), mi('c')), eq(), num(sp.delta, 4)),
      math('distance along the ray',
        mi('t'), eq(), row(neg(mi('h')), near ? minus() : plus(), sqrt(mi('\u0394'))), eq(),
        row(num(-sp.h), near ? minus() : plus(), num(Math.sqrt(Math.max(sp.delta, 0)), 4)), eq(), num(hit.t)),
      math('hit point and normal',
        v('P'), eq(), row(v('O'), plus(), mi('t'), v('D')), eq(), tuple(hit.point), comma(), space(1),
        v('N'), eq(), frac(row(v('P'), minus(), v('C')), mi('R')), eq(), tuple(hit.normal)),
    ];
    notes.push(near
      ? para('math-note', 'Two roots: ', X(sub(mi('t'), mn('1')), eq(), num(sp.tNear)), ' where the ray enters and ', X(sub(mi('t'), mn('2')), eq(), num(sp.tFar)), ' where it leaves. The nearer one is the visible surface.')
      : para('math-note', 'The ray starts inside the sphere, so the near root is behind it and the far root ', X(mi('t'), eq(), num(sp.tFar)), ' is used.'));
  } else if (hit.plane) {
    const pl = hit.plane;
    equations = [
      math('plane equation', dotted(v('n'), paren(row(v('O'), plus(), mi('t'), v('D'), minus(), sub(v('P'), mn('0'))))), eq(), mn('0')),
      math('distance along the ray',
        mi('t'), eq(), frac(dotted(paren(row(sub(v('P'), mn('0')), minus(), v('O'))), v('n')), dotted(v('D'), v('n'))),
        eq(), frac(num(pl.numerator), num(pl.denominator)), eq(), num(hit.t)),
      math('hit point and normal',
        v('P'), eq(), row(v('O'), plus(), mi('t'), v('D')), eq(), tuple(hit.point), comma(), space(1),
        v('N'), eq(), tuple(hit.normal)),
    ];
    notes.push(para('math-note', X(dotted(v('D'), v('n')), mo('<'), mn('0')), ' means the ray travels against the normal, onto the front of the surface. If ', X(row(mo('|'), dotted(v('D'), v('n')), mo('|')), mo('<'), tenTo(-6)), ' the ray runs parallel and misses.'));
  } else {
    equations = [math('hit point', v('P'), eq(), tuple(hit.point))];
  }
  notes.push(check(hit.tError, ['distance ', S('t')]));
  out.add({
    title: afterBounce ? `The bounced ray meets the ${hit.name}` : `The ray meets the ${hit.name}`,
    lead: afterBounce
      ? ['The same nearest-surface search runs again from the bounce point along ', V('R'), '. Here ', V('O'), ' is the bounce point and ', V('D'), ' is ', V('R'), '.']
      : ['Every surface is tested, and the nearest hit with ', X(eps(), mo('<'), mi('t')), ' wins. Here it is the ', hit.name, ', at distance ', X(mi('t'), eq(), num(hit.t)), '.'],
    figure: intersectionFigure(hit),
    caption: hit.sphere
      ? ['The ray meets the ', hit.name, '. The dashed perpendicular from ', V('C'), ' lands at ', X(mi('t'), eq(), neg(mi('h'))), '; the hit lies ', X(sqrt(mi('\u0394'))), ' before it. The distance from ', V('O'), ' is not to scale; the half-chord ', X(sqrt(mi('\u0394'))), ' is.']
      : ['The ray meets the ', hit.name, ', drawn edge-on. ', V('P', '0'), ' is any point on the plane and ', V('n'), ' its unit normal.'],
    equations,
    notes,
  });
}

function reflectSection(out: Sections, r: ReflectStep): void {
  out.add({
    title: 'The mirror bounce',
    lead: ['A perfect mirror sends the ray out at the same angle it came in, measured from the normal ', V('N'), '. The color comes from wherever the bounced ray ', V('R'), ' goes next.'],
    figure: reflectionFigure(r),
    caption: ['Bounce at ', V('P'), ': incoming ', V('D'), ', normal ', V('N'), ', outgoing ', V('R'), '. Angles are drawn at their computed size.'],
    equations: [
      math('reflection formula', v('R'), eq(), row(v('D'), minus(), mn('2'), paren(dotted(v('D'), v('N'))), v('N'))),
      math('reflection numbers', dotted(v('D'), v('N')), eq(), num(r.dDotN, 4), space(1), implies(), space(1), v('R'), eq(), tuple(r.outgoing, 4)),
      math('angle equality',
        theta('i'), eq(), fn('arccos', row(minus(), dotted(v('D'), v('N')))), eq(), degrees(r.thetaI), comma(), space(1),
        theta('r'), eq(), fn('arccos', dotted(v('R'), v('N'))), eq(), degrees(r.thetaR), space(1), implies(), space(1),
        theta('i'), eq(), theta('r')),
      math('next ray origin', prime(v('O')), eq(), row(v('P'), plus(), eps(), v('N')), comma(), space(1), eps(), eq(), tenTo(-4)),
    ],
    notes: [
      para('math-note', 'The tiny step ', S('\u03b5'), ' off the surface keeps the bounced ray from hitting the mirror it just left.'),
      check(r.outgoingError, ['outgoing direction ', V('R')]),
    ],
  });
}

function shadeSection(out: Sections, sh: ShadeStep): void {
  const toLight = (): Element => row(vs('L', 'pos'), minus(), sub(v('P'), mi('s')));
  const visibility: Prose = sh.blocked
    ? [X(mi('V'), eq(), mn('0')), sh.selfBlocked ? `: the ray toward the light runs into the ${sh.surface.name} itself` : `: the ${sh.blockerName} is in the way`,
      ...(sh.blockerT !== null ? [' at ', X(mi('t'), eq(), num(sh.blockerT))] : []), ', closer than the light at ', X(mi('d'), eq(), num(sh.distance)), '.']
    : [X(mi('V'), eq(), mn('1')), ': no object lies between ', V('P'), ' and the light, so nothing with ', X(eps(), mo('<'), mi('t'), mo('<'), mi('d')), ' was found.'];
  out.add({
    title: `Is the light visible? Shading the ${sh.surface.name}`,
    lead: ['A shadow ray goes from the surface toward the single point light. If anything blocks it, only the small ambient term ', X(mi('a'), v('\u03c1')), ' remains.'],
    figure: shadingFigure(sh),
    caption: sh.rawNDotL <= 0
      ? ['The ', sh.surface.name, ' faces away from the light: ', X(dotted(v('N'), v('L')), mo('<'), mn('0')), ', so ', V('L'), ' points into the surface and the direct term is zero.']
      : ['Shadow ray from ', V('P'), ' toward the light. ', X(dotted(v('N'), v('L')), eq(), fn('cos', mi('\u03c6'))), ' measures how directly the surface faces it. Distance not to scale.'],
    equations: [
      math('shadow ray',
        sub(v('P'), mi('s')), eq(), row(v('P'), plus(), eps(), v('N')), comma(), space(1),
        mi('d'), eq(), norm(toLight()), eq(), num(sh.distance), comma(), space(1),
        v('L'), eq(), frac(toLight(), mi('d')), eq(), tuple(sh.toLight)),
      math('facing term', dotted(v('N'), v('L')), eq(), fn('cos', mi('\u03c6')), eq(), num(sh.rawNDotL, 4), space(1),
        paren(row(mi('\u03c6'), eq(), degrees(sh.phiDeg)))),
      math('shading formula',
        v('c'), eq(), row(mi('a'), v('\u03c1'), plus(), mi('V'), space(0.2),
          frac(row(paren(row(v('\u03c1'), hadamard(), vs('c', 'L'))), mi('I'), space(0.2), fn('max', row(dotted(v('N'), v('L')), comma(), mn('0')))),
            fn('max', row(sq(mi('d')), comma(), mn('0.01')))))),
      math('shading numbers',
        v('c'), eq(), row(num(sh.ambient, 2), tuple(sh.albedo), plus(), mn(String(sh.visibility)), cdot(),
          frac(row(paren(row(tuple(sh.albedo), hadamard(), tuple(sh.lightColor, 2))), cdot(), mn(String(sh.intensity)), cdot(), num(sh.nDotL, 4)),
            num(Math.max(sh.distanceSquared, 0.01), 3))),
        eq(), tuple(sh.color, 4)),
    ],
    notes: [
      para('math-note', ...visibility),
      para('math-note', S('a'), ' ambient strength, ', V('\u03c1'), ' surface color, ', V('c', 'L'), ' and ', S('I'), ' light color and intensity; ', X(hadamard()),
        ' multiplies channel by channel. This is Lambert’s cosine law with inverse-square falloff.'),
      check(sh.colorError, ['linear color ', V('c')]),
    ],
  });
}

function endSection(out: Sections, story: MathStory): void {
  const end = story.end;
  if (end.reason === 'sky') {
    out.add({
      title: 'The ray escapes: sky',
      lead: ['Nothing is hit, so the color comes from a vertical sky gradient, picked by the height ', S('D', 'y'), ' of the ray’s direction.'],
      equations: [
        math('sky blend factor', s('t', 's'), eq(), fn('clamp', row(row(half(), paren(row(s('D', 'y'), plus(), mn('1')))), comma(), mn('0'), comma(), mn('1'))), eq(), num(end.ts, 4)),
        math('sky color', v('c'), eq(), row(paren(row(mn('1'), minus(), s('t', 's'))), vs('c', 'bottom'), plus(), s('t', 's'), vs('c', 'top')), eq(), tuple(end.color, 4)),
      ],
      notes: [check(Math.max(...end.color.map((c, i) => Math.abs(c - story.display.linear[i]))), ['sky color ', V('c')])],
    });
  } else if (end.reason === 'budget') {
    out.add({
      title: 'The bounce limit ends the path',
      lead: [`This mirror would need bounce ${end.used + 1}, but the limit is ${end.limit}. The tracer stops and returns black rather than guessing what the next bounce would show.`],
      equations: [math('budget', mtext('bounces used'), eq(), mn(String(end.used)), mo('\u2265'), mtext('limit'), eq(), mn(String(end.limit)), space(1), implies(), space(1), v('c'), eq(), tuple([0, 0, 0], 0))],
    });
  } else if (end.reason === 'diagnostic') {
    out.add({
      title: end.mode === 'hit' ? 'Diagnostic view: hit or miss' : 'Diagnostic view: first surface color',
      lead: ['Diagnostic views stop at the first surface. They skip bounces, shadows and lighting on purpose.'],
      equations: [end.mode === 'hit'
        ? math('hit view', v('c'), eq(), cases([[tuple([1, 1, 1], 0), mtext('if the ray hits a surface')], [tuple([0, 0, 0], 0), mtext('otherwise')]]), eq(), tuple(end.color, 0))
        : math('albedo view', v('c'), eq(), v('\u03c1'), eq(), tuple(end.color))],
    });
  }
}

function displaySection(out: Sections, story: MathStory): void {
  const d = story.display;
  const equations: Element[] = [];
  if (d.mode === 'beauty') {
    equations.push(math('tone mapping', prime(v('c')), eq(), frac(v('c'), row(mn('1'), plus(), v('c'))), eq(), tuple(d.toneMapped!, 4)));
  }
  // A fresh element per use: the same node cannot sit in two table cells.
  const input = (): Element => d.mode === 'beauty' ? prime(mi('c')) : mi('c');
  if (d.mode !== 'hit') {
    equations.push(math('sRGB encoding', prime(mi('c'), '\u2033'), eq(), cases([
      [row(mn('12.92'), mo('\u2062'), input()), row(mtext('if'), space(0.4), input(), mo('\u2264'), mn('0.0031308'))],
      [row(mn('1.055'), sup(input(), frac(mn('1'), mn('2.4'))), minus(), mn('0.055')), mtext('otherwise')],
    ])));
  }
  const final = (): Element => d.mode === 'hit' ? mi('c') : prime(mi('c'), '\u2033');
  equations.push(math('bytes', mu('byte'), eq(), fn('round', row(mn('255'), mo('\u2062'), final())), space(1), implies(), space(1),
    paren(row(mi('R'), comma(), mi('G'), comma(), mi('B'))), eq(), paren(row(mn(String(d.bytes[0])), comma(), mn(String(d.bytes[1])), comma(), mn(String(d.bytes[2]))))));
  out.add({
    title: 'From light to a screen color',
    lead: d.mode === 'beauty'
      ? ['Light values can exceed 1, so each channel is compressed with ', X(frac(mi('c'), row(mn('1'), plus(), mi('c')))), ', encoded for the screen (sRGB), then rounded to an 8-bit number.']
      : d.mode === 'albedo' ? ['The surface color is encoded for the screen (sRGB) without tone mapping.'] : ['The hit view shows pure white or black, with no conversion.'],
    figure: displayFigure(d),
    caption: ['Display curve (red) with this pixel’s red, green and blue values marked, and the resulting color. The equations apply to each channel ', S('c'), ' separately.'],
    equations,
  });
}

// --- entry point ---------------------------------------------------------------

/** Latest view waiting to be drawn while the surrounding <details> is closed. */
const pending = new WeakMap<HTMLElement, ViewState | null>();

/**
 * Render the math panel for the current view. Safe to call on every update:
 * while the "Explain the math" disclosure is closed, nothing is built (only the
 * latest view is remembered), and the panel is drawn when it is opened.
 */
export function renderMathPanel(container: HTMLElement, view: ViewState | null): void {
  const details = container.closest('details');
  if (details && !details.open) {
    pending.set(container, view);
    if (!container.dataset.mathLazy) {
      container.dataset.mathLazy = 'true';
      details.addEventListener('toggle', () => {
        if (!details.open || !pending.has(container)) return;
        const latest = pending.get(container) ?? null;
        pending.delete(container);
        draw(container, latest);
      });
    }
    return;
  }
  pending.delete(container);
  draw(container, view);
}

function draw(container: HTMLElement, view: ViewState | null): void {
  const result = buildMathStory(view);
  const inspection = view?.inspection;
  const key = result.kind === 'story'
    ? `${result.story.sceneVersion}:${inspection!.pixel.x},${inspection!.pixel.y}:${result.story.mode}:${result.story.maxRedirects}`
    : result.kind;
  // Cache on the container itself, so a remounted UI (hot reload, tests) never reuses a stale key.
  if (container.dataset.mathKey === key && container.firstChild) return;
  container.dataset.mathKey = key;

  const paper = element('div', 'math-paper');
  if (result.kind !== 'story') {
    paper.append(para('math-lead', result.kind === 'stale'
      ? 'The scene changed. The numbers return when the new picture is ready.'
      : 'Pick a pixel in the picture. Every figure and equation here is then filled in with that pixel’s computed values.'));
    container.replaceChildren(paper);
    return;
  }

  const story = result.story;
  paper.append(para('math-legend',
    `Pixel (${story.pixel.x}, ${story.pixel.y}), picture version ${story.sceneVersion}. Bold letters such as `, V('D'), ' and ', V('N'),
    ' are vectors; italic letters such as ', S('t'), ' and ', S('d'), ' are numbers. ', X(dotted(v('A'), v('B'))), ' is the dot product and ', X(norm(v('v'))), ' a length.'));

  const sections = new Sections();
  pixelSection(sections, story);
  let reflectIndex = 0;
  story.hits.forEach((hit, i) => {
    hitSection(sections, hit, i > 0);
    const r = story.reflects[reflectIndex];
    if (r && r.order === hit.order + 1) { reflectSection(sections, r); reflectIndex++; }
  });
  if (story.shade) shadeSection(sections, story.shade);
  endSection(sections, story);
  displaySection(sections, story);
  paper.append(...sections.nodes);
  container.replaceChildren(paper);
}
