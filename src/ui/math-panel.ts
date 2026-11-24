import type { ViewState } from '../contracts.ts';
import { buildMathStory, dot, type HitStep, type MathStory, type ReflectStep, type ShadeStep } from './math-model.ts';
import { displayFigure, intersectionFigure, pixelToRayFigure, reflectionFigure, shadingFigure } from './math-figures.ts';
import {
  approx, cases, cdot, comma, degrees, eq, frac, hadamard, implies, inline, math, mi, minus, mn, mo, mtext, mu, norm, num, paren,
  plus, row, sci, space, sqrt, sub, sup, tuple, v, vs, type MNode,
} from './mathml.ts';
import { planeDigits, rootDigits, sphereDigits } from './precision.ts';

/**
 * Chapter 3, "The mathematics": one section per computation, each following the
 * same editorial sequence (docs/design/editorial-ui-brief.md §5.6):
 *
 *   purpose (with its assumptions) · figure · caption · Law (numbered) ·
 *   Derivation ▸ · With this pixel's numbers · Result and interpretation
 *
 * Every number comes from math-model.ts (read from the published inspection or
 * recomputed from the same scene). Every symbol, in equations and in sentences,
 * is MathML. Elements are created fresh for each use: a DOM node can live in one
 * place only, so reusing one would silently move it out of an earlier equation.
 */

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
const tenTo = (exponent: number): Element => sup(mn('10'), neg(mn(String(Math.abs(exponent)))));
const slash = (): Element => mo('/', { lspace: '0', rspace: '0' });
/** A set or interval delimiter that never stretches (single-line content). */
const fence = (ch: string): Element => mo(ch, { stretchy: 'false', lspace: '0', rspace: '0' });
const yhat = (): Element => row(fence('('), mn('0'), comma(), mn('1'), comma(), mn('0'), fence(')'));

/** Mark an equation term so it links to the figure element with the same data-ref. */
function ref<T extends Element>(name: string, el: T): T {
  el.setAttribute('data-ref', name);
  el.classList.add('ref');
  return el;
}

const V = (letter: string, script?: string): Element => inline(script ? vs(letter, script) : v(letter));
const S = (name: string, script?: string): Element => inline(script ? s(name, script) : mi(name));
const X = (...children: MNode[]): Element => inline(...children);

type Prose = Array<string | Element>;
/** One line of a derivation: [left side or null to continue, relation, right side]. */
type DerivationRow = [MNode | null, MNode, MNode];

/** Build a derivation aligned on its relation signs (see .derivation in main.css). */
function derivationGrid(rows: DerivationRow[]): HTMLElement {
  const grid = element('div', 'derivation');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Derivation, one step per line');
  const cell = (className: string, content: MNode | null) => {
    const div = element('div', className);
    if (content !== null) div.append(inline(content));
    return div;
  };
  for (const [left, rel, right] of rows) grid.append(cell('d-lhs', left), cell('d-rel', rel), cell('d-rhs', right));
  return grid;
}
const aligned = (rows: DerivationRow[]): DerivationRow[] => rows;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string | null, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const child of children) el.append(child);
  return el;
}
const para = (className: string, ...parts: Prose): HTMLParagraphElement => element('p', className, ...parts);

// --- blocks ---------------------------------------------------------------------

type Block =
  | { kind: 'law'; equations: Array<[string, Element]> }          // [accessible name, math row]
  | { kind: 'derive'; steps: DerivationRow[]; note?: Prose }
  | { kind: 'numbers'; equations: Element[] }
  | { kind: 'result'; text: Prose; interpretation: Prose };

type SectionParts = { title: string; purpose: Prose; figure?: SVGSVGElement; caption?: Prose; blocks: Block[] };

/**
 * Which derivations the reader has opened, per chapter container and section
 * title. The chapter is rebuilt whenever the scene changes (including window
 * resizes), so this keeps an opened derivation open across rebuilds.
 */
const openDerivations = new WeakMap<HTMLElement, Set<string>>();

class Chapter {
  private section = 0;
  private title = '';
  private figure = 0;
  private equation = 0;
  readonly nodes: HTMLElement[] = [];

  constructor(private readonly number: string, private readonly opened: Set<string>) {}

  /** A numbered display equation: (3.k) set in the right-hand column. */
  private numbered(label: string, content: Element): HTMLElement {
    const no = `${this.number}.${++this.equation}`;
    const box = element('div', 'eq');
    box.id = `eq-${no.replace('.', '-')}`;
    box.append(math(label, content), element('span', 'eq-no', `(${no})`));
    return box;
  }

  add(parts: SectionParts): void {
    this.title = parts.title;
    const box = element('section', 'math-step');
    box.append(element('h3', null, element('span', 'math-step-no', `${this.number}.${++this.section}`), parts.title));
    box.append(para('math-lead', ...parts.purpose));
    if (parts.figure) {
      const fig = element('figure', 'math-fig');
      fig.append(parts.figure);
      if (parts.caption) fig.append(element('figcaption', null, element('b', null, `Figure ${this.number}.${++this.figure}. `), ...parts.caption));
      box.append(fig);
    }
    for (const block of parts.blocks) {
      const node = this.block(block);
      if (node) box.append(node);
    }
    this.nodes.push(box);
  }

  private block(b: Block): HTMLElement | null {
    const label = (text: string) => element('span', 'blk-label', text);
    switch (b.kind) {
      case 'law': {
        const div = element('div', 'blk blk-law', label('Law'));
        for (const [name, content] of b.equations) div.append(this.numbered(name, content));
        return div;
      }
      case 'derive': {
        const details = element('details', 'blk blk-derive');
        const key = this.title;
        details.open = this.opened.has(key);
        details.addEventListener('toggle', () => { if (details.open) this.opened.add(key); else this.opened.delete(key); });
        details.append(element('summary', null, label('Derivation'), element('span', 'blk-hint', 'show each step')));
        const body = element('div', 'blk-body');
        body.append(derivationGrid(b.steps));
        if (b.note) body.append(para('math-note', ...b.note));
        details.append(body);
        return details;
      }
      case 'numbers': {
        const div = element('div', 'blk blk-numbers', label('With this pixel’s numbers'));
        const eqs = element('div', 'math-eqs');
        eqs.append(...b.equations);
        div.append(eqs);
        return div;
      }
      case 'result': {
        const div = element('div', 'blk blk-result', label('Result'));
        div.append(para('result-text', ...b.text), para('math-note interpretation', ...b.interpretation));
        return div;
      }
    }
  }
}

// --- words from numbers ----------------------------------------------------------

const side = (value: number, neg: string, pos: string, zero: string, tol = 0.02): string =>
  Math.abs(value) < tol ? zero : value < 0 ? neg : pos;
const deg = (cosine: number): number => Math.acos(Math.min(1, Math.max(-1, cosine))) * 180 / Math.PI;

// --- sections --------------------------------------------------------------------

function pixelSection(ch: Chapter, story: MathStory): void {
  const p = story.pixel;
  const b = p.basis;
  const sum = (): Element => row(v('f'), plus(), ref('s', s('s', 'x')), ref('k', mi('k')), v('r'), plus(), ref('s', s('s', 'y')), ref('k', mi('k')), v('u'));
  const ndcX = (): Element => row(frac(row(mn('2'), paren(row(mi('x'), plus(), half()))), mi('W')), minus(), mn('1'));
  const ndcY = (): Element => row(mn('1'), minus(), frac(row(mn('2'), paren(row(mi('y'), plus(), half()))), mi('H')));
  const across = dot(p.direction, b.right), upward = dot(p.direction, b.up);
  ch.add({
    title: 'From a pixel to a ray',
    purpose: ['Each pixel defines one ray. Its center is carried onto a sensor one unit in front of the camera ', V('O'), '; the unit direction ', V('D'), ' through that point is the ray we follow. Pixels are square, so the horizontal coordinate is stretched by the aspect ratio ', X(mi('W'), mo('/'), mi('H')), ', and the camera frame ', V('r'), ', ', V('u'), ', ', V('f'), ' is orthonormal.'],
    figure: pixelToRayFigure(p),
    caption: ['Image space (left) and camera space (right). The red arc carries the pixel center onto the sensor; the red line is the camera ray. The sensor’s half-height is ', S('k'), ' and its half-width ', X(paren(row(mi('W'), mo('/', { lspace: '0', rspace: '0' }), mi('H'))), mi('k')), '.'],
    blocks: [
      { kind: 'law', equations: [
        ['screen coordinates', row(s('s', 'x'), eq(), row(paren(ndcX()), cdot(), frac(mi('W'), mi('H'))), comma(), space(1.4), s('s', 'y'), eq(), ndcY())],
        ['ray direction', row(ref('D', v('D')), eq(), frac(sum(), norm(sum())), comma(), space(1.4), ref('k', mi('k')), eq(), fn('tan', frac(sub(mi('\u03b8'), mu('fov')), mn('2'))))],
      ] },
      { kind: 'derive', steps: aligned([
        [mtext('pixel center'), mo('='), paren(row(mi('x'), plus(), half(), comma(), mi('y'), plus(), half()))],
        [s('u', 'ndc'), mo('='), row(ndcX(), space(0.6), mo('\u2208'), space(0.3), paren(row(neg(mn('1')), comma(), mn('1'))))],
        [s('v', 'ndc'), mo('='), row(ndcY(), space(0.6), mtext('(image y points down, so it is flipped)'))],
        [s('s', 'x'), mo('='), row(s('u', 'ndc'), cdot(), frac(mi('W'), mi('H'))), ],
        [v('f'), mo('='), frac(row(mu('target'), minus(), v('O')), norm(row(mu('target'), minus(), v('O'))))],
        [v('r'), mo('='), frac(row(yhat(), mo('\u00d7'), v('f')), norm(row(yhat(), mo('\u00d7'), v('f'))))],
        [v('u'), mo('='), row(v('f'), mo('\u00d7'), v('r'))],
        [mtext('sensor point'), mo('='), row(v('f'), plus(), mi('k'), paren(row(s('s', 'x'), v('r'), plus(), s('s', 'y'), v('u'))))],
        [v('D'), mo('='), frac(mtext('sensor point'), norm(mtext('sensor point')))],
      ]) },
      { kind: 'numbers', equations: [
        math('s x', s('s', 'x'), eq(), row(paren(row(frac(row(mn('2'), paren(row(mn(String(p.x)), plus(), half()))), mn(String(p.width))), minus(), mn('1'))), cdot(), frac(mn(String(p.width)), mn(String(p.height)))), eq(), num(p.sx, 4)),
        math('s y', s('s', 'y'), eq(), row(mn('1'), minus(), frac(row(mn('2'), paren(row(mn(String(p.y)), plus(), half()))), mn(String(p.height)))), eq(), num(p.sy, 4)),
        math('camera basis', ref('f', v('f')), eq(), tuple(b.forward), comma(), space(1), ref('r', v('r')), eq(), tuple(b.right), comma(), space(1), ref('u', v('u')), eq(), tuple(b.up)),
        math('half field of view', ref('k', mi('k')), eq(), fn('tan', degrees(p.fovYDeg / 2)), eq(), num(p.k, 4)),
      ] },
      { kind: 'result', text: [V('D'), ' = ', X(tuple(p.direction, 4)), ', leaving ', V('O'), ' = ', X(tuple(b.origin)), '.'],
        interpretation: ['The ray points ', side(across, 'left of', 'right of', 'neither left nor right of'), ' and ', side(upward, 'below', 'above', 'level with'),
          ' the view axis, ', X(degrees(deg(dot(p.direction, b.forward)))), ' away from it.'] },
    ],
  });
}

function hitSection(ch: Chapter, hit: HitStep, afterBounce: boolean): void {
  const blocks: Block[] = [];
  // What each solve takes for granted, said once in the lead paragraph.
  const given: Prose = hit.sphere
    ? [' Because ', V('D'), ' has unit length, the quadratic below starts with ', X(sq(mi('t'))), ', and only hits with ', X(mi('t'), mo('>'), eps()), ', in front of the ray’s origin, count.']
    : hit.plane ? [' The plane is given by a point ', V('P', '0'), ' on it and its unit normal ', V('n'), '.'] : [];
  if (hit.sphere) {
    const sp = hit.sphere;
    const near = sp.root === 'near';
    // Printed precision at which the substitutions below reproduce their printed results (precision.ts).
    const shown = sphereDigits(sp, hit.t);
    const k = shown.digits;
    const oc = (): Element => paren(row(v('O'), minus(), v('C')));
    blocks.push(
      { kind: 'law', equations: [['ray meets sphere', row(sq(norm(row(v('O'), plus(), mi('t'), ref('D', v('D')), minus(), ref('C', v('C'))))), eq(), sq(ref('radius', mi('R'))))]] },
      { kind: 'derive', steps: aligned([
        [sq(norm(row(oc(), plus(), mi('t'), v('D')))), mo('='), sq(mi('R'))],
        [row(sq(mi('t')), paren(dotted(v('D'), v('D'))), plus(), mn('2'), mi('t'), paren(dotted(v('D'), oc())), plus(), sq(norm(oc())), minus(), sq(mi('R'))), mo('='), mn('0')],
        [row(sq(mi('t')), plus(), mn('2'), mi('h'), mi('t'), plus(), mi('c')), mo('='), mn('0')],
        [ref('h', mi('h')), mo('='), dotted(oc(), v('D'))],
        [mi('c'), mo('='), row(sq(norm(oc())), minus(), sq(mi('R')))],
        [mi('t'), mo('='), row(row(neg(mi('h')), mo('\u00b1'), sqrt(row(sq(mi('h')), minus(), mi('c')))), eq(), row(neg(ref('h', mi('h'))), mo('\u00b1'), ref('delta', sqrt(mi('\u0394')))))],
      ]), note: ['If ', X(mi('\u0394'), mo('<'), mn('0')), ' the line misses the sphere; if ', X(mi('\u0394'), eq(), mn('0')), ' it grazes it; the nearest root greater than ', S('\u03b5'), ' is the visible hit.'] },
      { kind: 'numbers', equations: [
        math('quadratic terms', ref('h', mi('h')), eq(), num(sp.h, k), comma(), space(1), mi('c'), eq(), num(sp.c, k), comma(), space(1), mi('\u0394'), eq(), row(sq(mi('h')), minus(), mi('c')), shown.exact[0] ? eq() : approx(), num(sp.delta, 4)),
        math('distance', mi('t'), eq(), row(neg(ref('h', mi('h'))), near ? minus() : plus(), ref('delta', sqrt(mi('\u0394')))), eq(), row(num(-sp.h, k), near ? minus() : plus(), ref('delta', num(Math.sqrt(Math.max(sp.delta, 0)), rootDigits(k)))), shown.exact[1] ? eq() : approx(), num(hit.t)),
        math('hit point and normal', ref('P', v('P')), eq(), row(v('O'), plus(), mi('t'), v('D')), eq(), tuple(hit.point), comma(), space(1), ref('N', v('N')), eq(), frac(row(v('P'), minus(), ref('C', v('C'))), ref('radius', mi('R'))), eq(), tuple(hit.normal)),
      ] },
      { kind: 'result', text: ['The ray meets the ', hit.name, ' at ', V('P'), ' = ', X(tuple(hit.point)), ', ', X(mi('t'), eq(), num(hit.t)), ' along the ray.'],
        interpretation: near
          ? [X(mi('\u0394'), eq(), num(sp.delta, 3), mo('>'), mn('0')), ': the line crosses the sphere twice, entering at ', X(sub(mi('t'), mn('1')), eq(), num(sp.tNear)), ' and leaving at ', X(sub(mi('t'), mn('2')), eq(), num(sp.tFar)), '. The entry point is the surface the camera sees.']
          : ['The ray starts inside the sphere, so the entry root lies behind it; the exit root ', X(mi('t'), eq(), num(sp.tFar)), ' is used.'] },
    );
  } else if (hit.plane) {
    const pl = hit.plane;
    const shown = planeDigits(pl, hit.t);
    blocks.push(
      { kind: 'law', equations: [['ray meets plane', row(dotted(v('n'), paren(row(v('O'), plus(), mi('t'), v('D'), minus(), sub(v('P'), mn('0'))))), eq(), mn('0'))]] },
      { kind: 'derive', steps: aligned([
        [row(dotted(v('n'), v('O')), plus(), mi('t'), paren(dotted(v('n'), v('D'))), minus(), dotted(v('n'), sub(v('P'), mn('0')))), mo('='), mn('0')],
        [mi('t'), mo('='), frac(dotted(v('n'), paren(row(sub(v('P'), mn('0')), minus(), v('O')))), dotted(v('n'), v('D')))],
      ]), note: ['If ', X(row(mo('|'), dotted(v('n'), v('D')), mo('|')), mo('<'), tenTo(-6)), ' the ray runs parallel to the plane and misses it.'] },
      { kind: 'numbers', equations: [
        math('distance', mi('t'), eq(), frac(num(pl.numerator, shown.digits), num(pl.denominator, shown.digits)), shown.exact[0] ? eq() : approx(), num(hit.t)),
        math('hit point', v('P'), eq(), row(v('O'), plus(), mi('t'), v('D')), eq(), tuple(hit.point), comma(), space(1), v('N'), eq(), tuple(hit.normal)),
      ] },
      { kind: 'result', text: ['The ray meets the ', hit.name, ' at ', V('P'), ' = ', X(tuple(hit.point)), '.'],
        interpretation: [X(dotted(v('D'), v('n')), eq(), num(pl.denominator, shown.digits), mo('<'), mn('0')), ': the ray travels against the normal, so it arrives at the front of the surface.'] },
    );
  }
  ch.add({
    title: afterBounce ? `The bounced ray meets the ${hit.name}` : `The ray meets the ${hit.name}`,
    purpose: afterBounce
      ? ['The same nearest-surface search runs again from the bounce point, along ', V('R'), '. Here ', V('O'), ' is the bounce point and ', V('D'), ' is ', V('R'), '.', ...given]
      : ['Every surface is tested; the nearest hit in front of the camera decides what this pixel sees.', ...given],
    figure: intersectionFigure(hit),
    caption: hit.sphere
      ? ['The dashed perpendicular from ', V('C'), ' lands at ', X(mi('t'), eq(), neg(mi('h'))), '; the hit lies ', X(sqrt(mi('\u0394'))), ' before it. The distance from ', V('O'), ' is not to scale; the half-chord ', X(sqrt(mi('\u0394'))), ' is.']
      : ['The ', hit.name, ', drawn edge-on. ', V('P', '0'), ' is a point of the plane and ', V('n'), ' its unit normal.'],
    blocks,
  });
}

function reflectSection(ch: Chapter, r: ReflectStep): void {
  const perpPart = (): Element => row(paren(dotted(v('D'), v('N'))), v('N'));
  const turn = deg(dot(r.incoming, r.outgoing));
  ch.add({
    title: 'The mirror bounce',
    purpose: ['A perfect, untinted mirror keeps the part of ', V('D'), ' along the surface and reverses the part along the normal ', V('N'), ', which faces the incoming ray (', X(dotted(v('D'), v('N')), mo('<'), mn('0')), '). The color comes from wherever the bounced ray ', V('R'), ' goes next.'],
    figure: reflectionFigure(r),
    caption: ['Bounce at ', V('P'), ': incoming ', V('D'), ', normal ', V('N'), ', outgoing ', V('R'), '. Angles are drawn at their computed size.'],
    blocks: [
      { kind: 'law', equations: [['law of reflection', row(ref('R', v('R')), eq(), row(ref('D', v('D')), minus(), mn('2'), paren(dotted(ref('D', v('D')), ref('N', v('N')))), ref('N', v('N'))))]] },
      { kind: 'derive', steps: aligned([
        [v('D'), mo('='), row(sub(v('D'), mo('\u2225')), plus(), sub(v('D'), mo('\u22a5'))), ],
        [sub(v('D'), mo('\u22a5')), mo('='), perpPart()],
        [v('R'), mo('='), row(sub(v('D'), mo('\u2225')), minus(), sub(v('D'), mo('\u22a5'))), ],
        [null, mo('='), row(v('D'), minus(), mn('2'), perpPart())],
        [dotted(v('R'), v('N')), mo('='), row(neg(dotted(v('D'), v('N'))), space(0.6), implies(), space(0.6), theta('r'), eq(), theta('i'))],
      ]), note: ['Because only the normal part changes sign, ', X(norm(v('R')), eq(), norm(v('D')), eq(), mn('1')), ', and the angles to the normal are equal.'] },
      { kind: 'numbers', equations: [
        math('reflection numbers', dotted(v('D'), v('N')), eq(), num(r.dDotN, 4), space(1), implies(), space(1), v('R'), eq(), tuple(r.outgoing, 4)),
        math('angles', ref('theta-i', theta('i')), eq(), fn('arccos', neg(dotted(v('D'), v('N')))), eq(), degrees(r.thetaI), comma(), space(1), ref('theta-r', theta('r')), eq(), fn('arccos', dotted(v('R'), v('N'))), eq(), degrees(r.thetaR)),
        math('next ray origin', prime(v('O')), eq(), row(v('P'), plus(), eps(), v('N')), comma(), space(1), eps(), eq(), tenTo(-4)),
      ] },
      { kind: 'result', text: [V('R'), ' = ', X(tuple(r.outgoing, 4)), ', with ', X(theta('i'), eq(), theta('r'), eq(), degrees(r.thetaI)), '.'],
        interpretation: ['The ray is turned through ', X(degrees(turn)), ' = ', X(mn('180'), mo('\u00b0', { lspace: '0' }), minus(), mn('2'), theta('i')), '. The tiny step ', S('\u03b5'), ' off the surface keeps the new ray from hitting the mirror it just left.'] },
    ],
  });
}

function shadeSection(ch: Chapter, sh: ShadeStep): void {
  const toLight = (): Element => row(vs('L', 'pos'), minus(), sub(v('P'), mi('s')));
  const interpretation: Prose = sh.visibility === 0
    ? [sh.selfBlocked ? `The ${sh.surface.name} faces away from the light, so the shadow ray runs into the object itself. ` : `The ${sh.blockerName} blocks the light. `,
      'Only the ambient term ', X(mi('a'), v('\u03c1')), ' remains, which is why this point is dark.']
    : ['The light arrives ', X(degrees(sh.phiDeg)), ' from the normal, so it contributes ', X(fn('cos', mi('\u03c6')), eq(), num(sh.nDotL, 3)), ' of its full strength, divided by ', X(sq(mi('d')), eq(), num(sh.distanceSquared, 2)), '.'];
  ch.add({
    title: `Is the light visible? Shading the ${sh.surface.name}`,
    purpose: [
      sh.extraLights.length > 0
        ? `A shadow ray goes from the surface toward each of the ${sh.extraLights.length + 1} point lights; the law shows the main light, and the others add their own terms the same way. `
        : 'A shadow ray goes from the surface toward the point light. ',
      'A blocked light adds nothing (', X(mi('V'), eq(), mn('0')), ', so shadows are hard), leaving only the ambient term ', X(mi('a'), v('\u03c1')),
      ', which stands in for light bouncing between surfaces. The surface is matte: it reflects ', X(v('\u03c1'), slash(), mi('\u03c0')),
      ' of the arriving light in every direction. ', X(hadamard()), ' multiplies colors channel by channel, and ', X(sq(mi('d'))), ' is clamped at 0.01 to avoid dividing by zero.'],
    figure: shadingFigure(sh),
    caption: sh.rawNDotL <= 0
      ? ['The ', sh.surface.name, ' faces away from the light: ', X(dotted(v('N'), v('L')), mo('<'), mn('0')), ', so ', V('L'), ' points into the surface and the direct term is zero.']
      : ['Shadow ray from ', V('P'), ' toward the light. ', X(dotted(v('N'), v('L')), eq(), fn('cos', mi('\u03c6'))), ' measures how directly the surface faces it. Distance not to scale.'],
    blocks: [
      { kind: 'law', equations: [['shading', row(v('c'), eq(), row(mi('a'), v('\u03c1'), plus(), mi('V'), space(0.2),
        frac(row(paren(row(v('\u03c1'), hadamard(), vs('c', 'L'))), mi('I'), space(0.2), fn('max', row(ref('phi', dotted(ref('N', v('N')), ref('L', v('L')))), comma(), mn('0')))),
          row(mi('\u03c0'), mo('\u2062'), space(0.2), fn('max', row(sq(ref('d', mi('d'))), comma(), mn('0.01')))))))]] },
      { kind: 'derive', steps: aligned([
        [v('L'), mo('='), frac(toLight(), mi('d')), ],
        [mi('E'), mo('='), frac(row(mi('I'), space(0.2), fn('max', row(dotted(v('N'), v('L')), comma(), mn('0')))), sq(mi('d')))],
        [sub(v('c'), mu('direct')), mo('='), row(mi('V'), space(0.2), frac(v('\u03c1'), mi('\u03c0')), hadamard(), vs('c', 'L'), space(0.2), mi('E'))],
        [v('c'), mo('='), row(mi('a'), v('\u03c1'), plus(), sub(v('c'), mu('direct')))],
      ]), note: ['The irradiance ', S('E'), ' follows the cosine law and the inverse-square law; ', X(mn('1'), slash(), mi('\u03c0')), ' is the Lambertian normalization.'] },
      { kind: 'numbers', equations: [
        math('shadow ray', ref('d', mi('d')), eq(), norm(toLight()), eq(), num(sh.distance), comma(), space(1), ref('L', v('L')), eq(), tuple(sh.toLight), comma(), space(1),
          ref('phi', dotted(v('N'), v('L'))), eq(), num(sh.rawNDotL, 4), comma(), space(1), mi('V'), eq(), mn(String(sh.visibility))),
        math('shading numbers', v('c'), eq(), row(num(sh.ambient, 2), tuple(sh.albedo), plus(), mn(String(sh.visibility)), cdot(),
          frac(row(paren(row(tuple(sh.albedo), hadamard(), tuple(sh.lightColor, 2))), cdot(), mn(String(sh.intensity)), cdot(), num(sh.nDotL, 4)),
            row(mi('\u03c0'), cdot(), num(Math.max(sh.distanceSquared, 0.01), 3))))),
        // Each extra light adds its own shadow-checked term with the same law.
        ...sh.extraLights.map(e => math(`light ${e.index + 1} term`, sub(v('c'), mu(`light ${e.index + 1}`)), eq(),
          row(mn(String(e.visibility)), cdot(),
            frac(row(paren(row(tuple(sh.albedo), hadamard(), tuple(e.lightColor, 2))), cdot(), mn(String(e.intensity)), cdot(), num(e.nDotL, 4)),
              row(mi('\u03c0'), cdot(), num(Math.max(e.distanceSquared, 0.01), 3)))),
          eq(), tuple(e.direct, 4))),
        math('shading result', v('c'), eq(), tuple(sh.color, 4)),
      ] },
      { kind: 'result', text: ['Linear color ', V('c'), ' = ', X(tuple(sh.color, 4)), ', with ', X(mi('V'), eq(), mn(String(sh.visibility))),
        ...(sh.blocked ? [' (blocked', ...(sh.blockerT !== null ? [' at ', X(mi('t'), eq(), num(sh.blockerT))] : []), ').'] : [' (light visible).'])],
        interpretation },
    ],
  });
}

function endSection(ch: Chapter, story: MathStory): void {
  const end = story.end;
  if (end.reason === 'sky') {
    const err = Math.max(...end.color.map((c, i) => Math.abs(c - story.display.linear[i])));
    ch.add({
      title: 'The ray escapes: sky',
      purpose: ['Nothing is hit, so the color comes from a vertical sky gradient, chosen by the height ', S('D', 'y'), ' of the ray’s direction.'],
      blocks: [
        { kind: 'law', equations: [['sky', row(v('c'), eq(), row(paren(row(mn('1'), minus(), s('t', 's'))), vs('c', 'bottom'), plus(), s('t', 's'), vs('c', 'top')), comma(), space(1.4),
          s('t', 's'), eq(), fn('clamp', row(half(), paren(row(s('D', 'y'), plus(), mn('1'))), comma(), mn('0'), comma(), mn('1'))))]] },
        { kind: 'numbers', equations: [math('sky numbers', s('t', 's'), eq(), num(end.ts, 4), comma(), space(1), v('c'), eq(), tuple(end.color, 4))] },
        { kind: 'result', text: [V('c'), ' = ', X(tuple(end.color, 4)), '.'], interpretation: ['The ray points ', end.direction[1] > 0 ? 'upward' : 'downward', ', so the color lies ', X(num(end.ts * 100, 0)), '% of the way from the horizon color to the zenith color.'] },
      ],
    });
  } else if (end.reason === 'budget') {
    ch.add({
      title: 'The bounce limit ends the path',
      purpose: [`This mirror would need bounce ${end.used + 1}, but the limit is ${end.limit}. The tracer stops and returns black rather than guessing what the next bounce would show.`],
      blocks: [
        { kind: 'law', equations: [['budget', row(mtext('bounces used'), mo('\u2265'), mtext('limit'), space(0.6), implies(), space(0.6), v('c'), eq(), tuple([0, 0, 0], 0))]] },
        { kind: 'result', text: [V('c'), ' = ', X(tuple([0, 0, 0], 0)), '.'], interpretation: ['Raise the bounce limit in the parameters to see what the mirror reflects.'] },
      ],
    });
  } else if (end.reason === 'diagnostic') {
    ch.add({
      title: end.mode === 'hit' ? 'Diagnostic view: hit or miss' : 'Diagnostic view: first surface color',
      purpose: ['Diagnostic views stop at the first surface. They skip bounces, shadows and lighting on purpose.'],
      blocks: [
        { kind: 'law', equations: [[end.mode, end.mode === 'hit'
          ? row(v('c'), eq(), cases([[tuple([1, 1, 1], 0), mtext('if the ray hits a surface')], [tuple([0, 0, 0], 0), mtext('otherwise')]]))
          : row(v('c'), eq(), v('\u03c1'), space(0.6), mtext('of the first surface'))]] },
        { kind: 'result', text: [V('c'), ' = ', X(tuple(end.color, end.mode === 'hit' ? 0 : 3)), '.'], interpretation: ['This is not the color the full picture shows; switch the view back to see it.'] },
      ],
    });
  }
}

function displaySection(ch: Chapter, story: MathStory): void {
  const d = story.display;
  const input = (): Element => d.mode === 'beauty' ? prime(mi('c')) : mi('c');
  const law: Array<[string, Element]> = [];
  if (d.mode === 'beauty') law.push(['tone mapping', row(prime(mi('c')), eq(), frac(mi('c'), row(mn('1'), plus(), mi('c'))))]);
  if (d.mode !== 'hit') law.push(['sRGB encoding', row(prime(mi('c'), '\u2033'), eq(), cases([
    [row(mn('12.92'), mo('\u2062'), input()), row(mtext('if'), space(0.4), input(), mo('\u2264'), mn('0.0031308'))],
    [row(mn('1.055'), sup(input(), frac(mn('1'), mn('2.4'))), minus(), mn('0.055')), mtext('otherwise')],
  ]))]);
  const final = (): Element => d.mode === 'hit' ? mi('c') : prime(mi('c'), '\u2033');
  law.push(['quantization', row(mu('byte'), eq(), fn('round', row(mn('255'), mo('\u2062'), final())))]);
  const numbers: Element[] = [];
  if (d.mode === 'beauty') numbers.push(math('tone mapped', prime(v('c')), eq(), tuple(d.toneMapped!, 4)));
  numbers.push(math('encoded', prime(v('c'), d.mode === 'hit' ? '' : '\u2033'), eq(), tuple(d.encoded, 4)));
  ch.add({
    title: 'From light to a screen color',
    purpose: d.mode === 'beauty'
      ? ['Lighting is computed in linear color, where values can exceed 1, and converted once, at the end: each channel is compressed into ', X(row(fence('['), mn('0'), comma(), mn('1'), fence(')'))), ' by Reinhard’s curve, encoded for the screen, then rounded to an 8-bit number.']
      : d.mode === 'albedo' ? ['The surface color is encoded for the screen (sRGB) without tone mapping.'] : ['The hit view shows pure white or black, with no conversion.'],
    figure: displayFigure(d),
    caption: ['Display curve with this pixel’s red, green and blue values marked, and the resulting color. The equations apply to each channel ', S('c'), ' separately.'],
    blocks: [
      { kind: 'law', equations: law },
      { kind: 'numbers', equations: numbers },
      { kind: 'result', text: [X(paren(row(mi('R'), comma(), mi('G'), comma(), mi('B'))), eq(), paren(row(mn(String(d.bytes[0])), comma(), mn(String(d.bytes[1])), comma(), mn(String(d.bytes[2]))))), '.'],
        interpretation: ['This is the color of the pixel in Figure 1.1.'] },
    ],
  });
}

// --- entry point -------------------------------------------------------------------

/** Direct manipulation callbacks supplied by the interface (index.ts). */
export type MathInteraction = { inspectAt(u: number, v: number): void };

const latestView = new WeakMap<HTMLElement, ViewState | null>();

/**
 * Bidirectional highlighting: pointing at an equation term or a figure element
 * marks every element with the same data-ref in that section (P5).
 */
function enableLinking(container: HTMLElement): void {
  if (container.dataset.linking) return;
  container.dataset.linking = 'true';
  const toggle = (target: EventTarget | null, on: boolean) => {
    const el = target instanceof Element ? target.closest('[data-ref]') : null;
    const section = el?.closest('.math-step');
    if (!el || !section) return;
    const name = el.getAttribute('data-ref');
    section.querySelectorAll(`[data-ref="${name}"]`).forEach(n => n.classList.toggle('is-linked', on));
  };
  container.addEventListener('pointerover', e => toggle(e.target, true));
  container.addEventListener('pointerout', e => toggle(e.target, false));
}

/**
 * Figure 3.1's image-space grid as a handle: drag, or use the arrow keys (one
 * grid cell per press), to select a pixel. Listeners and pointer capture live on
 * the persistent container because the figure is rebuilt on every change.
 */
function enablePixelDrag(container: HTMLElement, interact: MathInteraction): void {
  if (container.dataset.pixelDrag) return;
  container.dataset.pixelDrag = 'true';
  let pointer: number | null = null;
  const grid = () => container.querySelector<SVGElement>('[data-drag="pixel-grid"]');
  const pick = (e: PointerEvent) => {
    const g = grid();
    if (!g) return;
    const r = g.getBoundingClientRect();
    const clamp = (x: number) => Math.min(1 - 1e-9, Math.max(0, x));
    interact.inspectAt(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  };
  container.addEventListener('pointerdown', e => {
    if (!(e.target instanceof Element) || !e.target.closest('[data-drag="pixel-grid"]')) return;
    pointer = e.pointerId;
    container.setPointerCapture(e.pointerId);
    grid()?.focus({ preventScroll: true });
    e.preventDefault();
    pick(e);
  });
  container.addEventListener('pointermove', e => { if (pointer === e.pointerId) pick(e); });
  const end = (e: PointerEvent) => { if (pointer === e.pointerId) { pointer = null; container.releasePointerCapture?.(e.pointerId); } };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);
  container.addEventListener('keydown', e => {
    if (!(e.target instanceof Element) || e.target.getAttribute('data-drag') !== 'pixel-grid') return;
    const pixel = latestView.get(container)?.inspection?.pixel;
    if (!pixel) return;
    const cell = { x: Math.max(1, Math.round(pixel.width / 16)), y: Math.max(1, Math.round(pixel.height / 9)) };
    const step: Record<string, [number, number]> = { ArrowLeft: [-cell.x, 0], ArrowRight: [cell.x, 0], ArrowUp: [0, -cell.y], ArrowDown: [0, cell.y] };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    const x = Math.min(pixel.width - 1, Math.max(0, pixel.x + d[0]));
    const y = Math.min(pixel.height - 1, Math.max(0, pixel.y + d[1]));
    interact.inspectAt((x + 0.5) / pixel.width, (y + 0.5) / pixel.height);
  });
}

/** Whether the reader has asked to see every step of chapter 3 ("Explain more"). */
const expandedMath = new WeakMap<HTMLElement, boolean>();

/** Latest view waiting to be drawn while a surrounding <details> is closed. */
const pending = new WeakMap<HTMLElement, ViewState | null>();
const scheduled = new WeakMap<HTMLElement, number>();

/**
 * Render chapter 3 for the current view. Safe on every update: identical views
 * are skipped, rapid changes (arrow keys) are coalesced into one render per
 * frame, and inside a closed <details> nothing is built until it opens.
 */
export function renderMathPanel(container: HTMLElement, view: ViewState | null, interact?: MathInteraction): void {
  latestView.set(container, view);
  enableLinking(container);
  if (interact) enablePixelDrag(container, interact);
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
  pending.set(container, view);
  if (scheduled.has(container)) return;
  scheduled.set(container, requestAnimationFrame(() => {
    scheduled.delete(container);
    const latest = pending.get(container) ?? null;
    pending.delete(container);
    draw(container, latest);
  }));
}

function draw(container: HTMLElement, view: ViewState | null): void {
  const result = buildMathStory(view);
  const inspection = view?.inspection;
  const expanded = expandedMath.get(container) ?? false;
  const key = result.kind === 'story'
    ? `${result.story.sceneVersion}:${inspection!.pixel.x},${inspection!.pixel.y}:${result.story.mode}:${result.story.maxRedirects}:${expanded}`
    : result.kind;
  if (container.dataset.mathKey === key && container.firstChild) return;
  container.dataset.mathKey = key;

  const paper = element('div', 'math-paper');
  if (result.kind !== 'story') {
    paper.append(para('math-lead', result.kind === 'stale'
      ? 'The scene changed. The numbers return when the new picture is ready.'
      : 'Pick a pixel in Figure 1.1. Every figure and equation in this chapter is then filled in with that pixel’s computed values.'));
    container.replaceChildren(paper);
    return;
  }

  const story = result.story;

  let opened = openDerivations.get(container);
  if (!opened) { opened = new Set(); openDerivations.set(container, opened); }
  const ch = new Chapter('3', opened);
  pixelSection(ch, story);
  let reflectIndex = 0;
  story.hits.forEach((hit, i) => {
    hitSection(ch, hit, i > 0);
    const r = story.reflects[reflectIndex];
    if (r && r.order === hit.order + 1) { reflectSection(ch, r); reflectIndex++; }
  });
  if (story.shade) shadeSection(ch, story.shade);
  endSection(ch, story);
  displaySection(ch, story);
  // Collapsed, the chapter shows only its last step, the pixel's final color, as
  // the "Simplified result". "Explain more" reveals every step, numbered.
  const more = element('button', 'button button-secondary math-more', expanded ? 'Show less' : 'Explain more');
  more.type = 'button';
  more.setAttribute('aria-expanded', String(expanded));
  more.addEventListener('click', () => {
    expandedMath.set(container, !expanded);
    draw(container, latestView.get(container) ?? null);
    // Expanding brings the steps in one after another (CSS; off under reduced motion).
    if (!expanded) container.querySelector('.math-paper')?.classList.add('is-opening');
    container.querySelector<HTMLButtonElement>('.math-more')?.focus({ preventScroll: true });
  });
  if (expanded) {
    paper.append(para('math-legend',
      `Pixel (${story.pixel.x}, ${story.pixel.y}). Bold letters such as `, V('D'), ' and ', V('N'),
      ' are vectors; italic letters such as ', S('t'), ' and ', S('d'), ' are numbers; ', X(dotted(v('A'), v('B'))), ' is the dot product and ', X(norm(v('v'))), ' a length.'));
    paper.append(...ch.nodes, more);
  } else {
    const last = ch.nodes[ch.nodes.length - 1];
    last.classList.add('math-simple');
    last.querySelector('h3')?.replaceChildren('Simplified result');
    paper.append(last, more);
  }
  const keepFocus = document.activeElement instanceof Element && container.contains(document.activeElement)
    ? document.activeElement.getAttribute('data-drag') : null;
  container.replaceChildren(paper);
  if (keepFocus) container.querySelector<SVGElement>(`[data-drag="${keepFocus}"]`)?.focus({ preventScroll: true });
}

