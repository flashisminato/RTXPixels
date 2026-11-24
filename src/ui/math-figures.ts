import type { ViewMode } from '../contracts.ts';
import type { DisplayStep, HitStep, PixelStep, ReflectStep, ShadeStep } from './math-model.ts';

/**
 * Textbook-style SVG figures for the "Explain the math" panel.
 *
 * Visual language (deliberately close to classic graphics-course figures):
 * white paper, light-gray planes, black 1.4 px strokes, red for the ray being
 * followed, periwinkle for the shadow ray, dashed gray construction lines,
 * bold upright labels for vectors and italic serif labels for scalars.
 * Figures are schematic: angles in the bounce and shading figures are drawn
 * true to the computed values; long distances are not to scale (captions say so).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Same values and meanings as src/styles/tokens.css (SVG attributes cannot read CSS variables). */
export const COLORS = {
  ink: '#171717',        // geometry, surfaces, normals
  guide: '#9ca3af',      // construction: dashed lines, dimensions, inactive geometry
  plane: '#ecece9',      // physical planes (grayscale shading is allowed inside illustrations)
  grid: '#e0e0dc',
  ray: '#d52232',        // signal: the followed camera ray D, the selected pixel, selected intersections
  rayTint: '#f7d6d9',
  science: '#245ba7',    // secondary rays: reflected R and shadow ray L
  bulb: '#fbf7e8',
} as const;
const MATH_FONT = "'FAP Math', 'Latin Modern Math', 'STIX Two Math', serif";
const SANS_FONT = "'Inter', system-ui, -apple-system, sans-serif";

/**
 * SVG cannot ask the math font for its italic the way MathML does (the browser
 * would fake a slant), so italic and bold runs are mapped to Unicode's
 * mathematical alphanumeric characters, which FAP Math draws in true Latin
 * Modern shapes. Figure labels then match the equations exactly.
 */
function mathAlphabet(text: string, style: 'italic' | 'bold'): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (style === 'italic' && ch === 'h') out += '\u210e'; // Planck constant: the math-italic h
    else if (c >= 65 && c <= 90) out += String.fromCodePoint((style === 'bold' ? 0x1d400 : 0x1d434) + c - 65);
    else if (c >= 97 && c <= 122) out += String.fromCodePoint((style === 'bold' ? 0x1d41a : 0x1d44e) + c - 97);
    else if (c >= 0x3b1 && c <= 0x3c9) out += String.fromCodePoint((style === 'bold' ? 0x1d6c2 : 0x1d6fc) + c - 0x3b1);
    else if (c >= 0x391 && c <= 0x3a9 && style === 'bold') out += String.fromCodePoint(0x1d6a8 + c - 0x391);
    else out += ch;
  }
  return out;
}

type Attrs = Record<string, string | number>;
export type Pt = { x: number; y: number };
/** Rich label: plain strings, or styled runs. b = bold upright (vectors), i = italic (scalars). */
export type Run = string | { t: string; b?: boolean; i?: boolean; sub?: boolean; sup?: boolean };

let figureCounter = 0;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Array<SVGElement | string> = []): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  for (const child of children) element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return element;
}

export const pt = (x: number, y: number): Pt => ({ x, y });
export const plus = (a: Pt, b: Pt): Pt => pt(a.x + b.x, a.y + b.y);
export const times = (a: Pt, s: number): Pt => pt(a.x * s, a.y * s);
export const between = (a: Pt, b: Pt, f: number): Pt => pt(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
export const unit = (a: Pt): Pt => { const l = Math.hypot(a.x, a.y) || 1; return pt(a.x / l, a.y / l); };
export const perp = (a: Pt): Pt => pt(-a.y, a.x);
const rad = (deg: number): number => deg * Math.PI / 180;
const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/** One figure: an SVG with its own arrowhead markers and drawing helpers. Shared by every figure in the document. */
export class Figure {
  readonly root: SVGSVGElement;
  private readonly id: string;
  private readonly layer: SVGGElement;

  constructor(width: number, height: number, label: string) {
    this.id = `mf${++figureCounter}`;
    this.root = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label, class: 'math-figure' });
    const defs = svg('defs');
    for (const [name, color] of Object.entries({ ink: COLORS.ink, ray: COLORS.ray, science: COLORS.science, guide: COLORS.guide })) {
      defs.append(svg('marker', {
        id: `${this.id}-${name}`, viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
      }, [svg('path', { d: 'M0,0.6 L10,5 L0,9.4 L2.6,5 z', fill: color })]));
    }
    const gradient = svg('radialGradient', { id: `${this.id}-sphere`, cx: '36%', cy: '32%', r: '72%' }, [
      svg('stop', { offset: '0%', 'stop-color': '#ffffff' }),
      svg('stop', { offset: '55%', 'stop-color': '#e6e8e7' }),
      svg('stop', { offset: '100%', 'stop-color': '#c4c8c6' }),
    ]);
    defs.append(gradient);
    this.layer = svg('g');
    this.root.append(defs, this.layer);
  }

  sphereFill(): string { return `url(#${this.id}-sphere)`; }

  add<T extends SVGElement>(element: T): T { this.layer.append(element); return element; }

  line(a: Pt, b: Pt, o: { color?: string; width?: number; dash?: string; arrow?: 'ink' | 'ray' | 'science' | 'guide'; start?: boolean } = {}): SVGLineElement {
    const attrs: Attrs = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: o.color ?? COLORS.ink, 'stroke-width': o.width ?? 1.4, 'stroke-linecap': 'round' };
    if (o.dash) attrs['stroke-dasharray'] = o.dash;
    if (o.arrow) attrs['marker-end'] = `url(#${this.id}-${o.arrow})`;
    if (o.arrow && o.start) attrs['marker-start'] = `url(#${this.id}-${o.arrow})`;
    return this.add(svg('line', attrs));
  }

  arrow(a: Pt, b: Pt, kind: 'ink' | 'ray' | 'science' | 'guide' = 'ink', width = 1.5, dash?: string): SVGLineElement {
    const color = kind === 'ray' ? COLORS.ray : kind === 'science' ? COLORS.science : kind === 'guide' ? COLORS.guide : COLORS.ink;
    return this.line(a, b, { color, width, arrow: kind, dash });
  }

  path(d: string, o: { stroke?: string; fill?: string; width?: number; dash?: string; arrow?: 'ink' | 'ray' | 'science' | 'guide' } = {}): SVGPathElement {
    const attrs: Attrs = { d, stroke: o.stroke ?? COLORS.ink, fill: o.fill ?? 'none', 'stroke-width': o.width ?? 1.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
    if (o.dash) attrs['stroke-dasharray'] = o.dash;
    if (o.arrow) attrs['marker-end'] = `url(#${this.id}-${o.arrow})`;
    return this.add(svg('path', attrs));
  }

  polygon(points: Pt[], fill: string, stroke: string = COLORS.ink, opacity = 1): SVGPolygonElement {
    return this.add(svg('polygon', {
      points: points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
      fill, 'fill-opacity': opacity, stroke, 'stroke-width': 1.4, 'stroke-linejoin': 'round',
    }));
  }

  rect(x: number, y: number, w: number, h: number, fill: string, stroke: string = COLORS.ink, extra: Attrs = {}): SVGRectElement {
    return this.add(svg('rect', { x, y, width: w, height: h, fill, stroke, 'stroke-width': 1.4, ...extra }));
  }

  circle(c: Pt, r: number, fill: string, stroke: string = COLORS.ink, width = 1.4): SVGCircleElement {
    return this.add(svg('circle', { cx: c.x, cy: c.y, r, fill, stroke, 'stroke-width': width }));
  }

  dot(c: Pt, color: string = COLORS.ink, r = 3.4): SVGCircleElement {
    return this.add(svg('circle', { cx: c.x, cy: c.y, r, fill: color }));
  }

  /** Angle arc centred at c from angle a0 to a1 (degrees, screen coordinates, clockwise positive). */
  arc(c: Pt, radius: number, a0: number, a1: number, color: string = COLORS.ink): SVGPathElement {
    const p0 = plus(c, times(pt(Math.cos(rad(a0)), Math.sin(rad(a0))), radius));
    const p1 = plus(c, times(pt(Math.cos(rad(a1)), Math.sin(rad(a1))), radius));
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return this.path(`M${p0.x},${p0.y} A${radius},${radius} 0 ${large} ${sweep} ${p1.x},${p1.y}`, { stroke: color, width: 1.1 });
  }

  /** Short hatch marks under a surface line, the textbook "solid material" notation. */
  hatch(a: Pt, b: Pt, spacing = 13, depth = 10): void {
    const dir = unit(pt(b.x - a.x, b.y - a.y));
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const down = pt(-dir.y, dir.x); // left-hand normal: below a left-to-right line
    for (let s = spacing / 2; s < length; s += spacing) {
      const p = plus(a, times(dir, s));
      this.line(p, plus(p, plus(times(down, depth), times(dir, -depth * 0.7))), { color: COLORS.guide, width: 1 });
    }
  }

  /** Dimension line with end ticks and a centred label, offset from the measured segment. */
  dimension(a: Pt, b: Pt, offset: number, label: Run[], color: string = COLORS.ink): void {
    const n = times(unit(perp(pt(b.x - a.x, b.y - a.y))), offset);
    const a2 = plus(a, n); const b2 = plus(b, n);
    this.line(a2, b2, { color, width: 1 });
    const tick = times(unit(n), 5);
    this.line(plus(a2, tick), plus(a2, times(tick, -1)), { color, width: 1 });
    this.line(plus(b2, tick), plus(b2, times(tick, -1)), { color, width: 1 });
    const mid = between(a2, b2, 0.5);
    const away = times(unit(n), 12);
    this.math(plus(mid, away), label, { anchor: 'middle', color, size: 15 });
  }

  /** Mathematical label in serif: runs control bold (vectors), italic (scalars), sub/superscripts. */
  math(at: Pt, runs: Run[], o: { anchor?: 'start' | 'middle' | 'end'; color?: string; size?: number } = {}): SVGTextElement {
    const text = svg('text', {
      x: at.x, y: at.y, 'text-anchor': o.anchor ?? 'start', 'dominant-baseline': 'middle',
      fill: o.color ?? COLORS.ink, 'font-family': MATH_FONT, 'font-size': o.size ?? 17,
    });
    let shift = 0;
    for (const run of runs) {
      const r = typeof run === 'string' ? { t: run } : run;
      const target = r.sub ? 0.32 : r.sup ? -0.42 : 0;
      const glyphs = r.b ? mathAlphabet(r.t, 'bold') : r.i ? mathAlphabet(r.t, 'italic') : r.t;
      const span = svg('tspan', {}, [glyphs]);
      if (target !== shift) { span.setAttribute('dy', `${(target - shift).toFixed(2)}em`); shift = target; }
      if (r.sub || r.sup) span.setAttribute('font-size', '72%');
      // Bold and italic come from the glyphs themselves (mathAlphabet), never synthesized.
      text.append(span);
    }
    return this.add(text);
  }

  /** Plain words in the sans face, as in the reference figures. */
  words(at: Pt, value: string, o: { anchor?: 'start' | 'middle' | 'end'; color?: string; size?: number; weight?: number } = {}): SVGTextElement {
    return this.add(svg('text', {
      x: at.x, y: at.y, 'text-anchor': o.anchor ?? 'start', 'dominant-baseline': 'middle',
      fill: o.color ?? COLORS.ink, 'font-family': SANS_FONT, 'font-size': o.size ?? 13, 'font-weight': o.weight ?? 400,
    }, [value]));
  }

  /** Outline light bulb, after the classic ray-tracing diagram. */
  bulb(c: Pt): void {
    for (let a = -150; a <= -30; a += 30) {
      const d = pt(Math.cos(rad(a)), Math.sin(rad(a)));
      this.line(plus(c, times(d, 15)), plus(c, times(d, 21)), { color: COLORS.ink, width: 1.2 });
    }
    this.circle(c, 11, COLORS.bulb, COLORS.ink, 1.4);
    this.rect(c.x - 5.5, c.y + 9, 11, 7, '#ffffff', COLORS.ink, { rx: 1.5 });
  }

  /** Small red "x" marking where a shadow ray is stopped. */
  cross(c: Pt, size = 6): void {
    this.line(pt(c.x - size, c.y - size), pt(c.x + size, c.y + size), { color: COLORS.ray, width: 2.2 });
    this.line(pt(c.x - size, c.y + size), pt(c.x + size, c.y - size), { color: COLORS.ray, width: 2.2 });
  }
}

// Label shorthands.
const B = (t: string, sub?: string): Run[] => sub ? [{ t, b: true }, { t: sub, sub: true }] : [{ t, b: true }];
const I = (t: string): Run => ({ t, i: true });

// ---------------------------------------------------------------------------
// Figure 1: from a pixel to a ray
// ---------------------------------------------------------------------------

export function pixelToRayFigure(p: PixelStep): SVGSVGElement {
  const f = new Figure(780, 340, `Figure: pixel (${p.x}, ${p.y}) of a ${p.width} by ${p.height} image mapped onto the camera's sensor plane, and the camera ray through it.`);

  // Image space (left): a 16 x 9 sketch of the pixel grid, origin top-left.
  const cols = 16, rows = 9, cell = 17;
  const ox = 46, oy = 88;
  const w = cols * cell, h = rows * cell;
  f.rect(ox, oy, w, h, COLORS.plane);
  for (let c = 1; c < cols; c++) f.line(pt(ox + c * cell, oy), pt(ox + c * cell, oy + h), { color: COLORS.grid, width: 1 });
  for (let r = 1; r < rows; r++) f.line(pt(ox, oy + r * cell), pt(ox + w, oy + r * cell), { color: COLORS.grid, width: 1 });
  f.rect(ox, oy, w, h, 'none');
  f.arrow(pt(ox, oy), pt(ox + w + 34, oy));
  f.arrow(pt(ox, oy), pt(ox, oy + h + 34));
  f.math(pt(ox + w + 42, oy), [I('x')]);
  f.math(pt(ox, oy + h + 46), [I('y')], { anchor: 'middle' });
  f.math(pt(ox - 6, oy - 14), ['(0, 0)'], { anchor: 'end', size: 15 });
  f.dot(pt(ox, oy), COLORS.ink, 3);
  f.math(pt(ox + w + 6, oy + h + 16), ['(', I('W'), ', ', I('H'), ')'], { size: 15 });
  f.dot(pt(ox + w, oy + h), COLORS.ink, 3);

  const col = clamp(Math.floor(p.x / p.width * cols), 0, cols - 1);
  const row = clamp(Math.floor(p.y / p.height * rows), 0, rows - 1);
  f.rect(ox + col * cell, oy + row * cell, cell, cell, COLORS.rayTint, 'none');
  f.rect(ox + col * cell - 3, oy + row * cell - 3, cell + 6, cell + 6, 'none', COLORS.ray, { 'stroke-dasharray': '3 2.5', 'stroke-width': 1.2 });
  const pc = pt(ox + col * cell + cell / 2, oy + row * cell + cell / 2);
  f.dot(pc, COLORS.ray, 3.2);
  const labelRight = col < cols / 2;
  f.math(pt(pc.x + (labelRight ? 16 : -16), pc.y + (row < rows - 2 ? 20 : -18)),
    ['(', I('x'), ' + ½, ', I('y'), ' + ½)'], { anchor: labelRight ? 'start' : 'end', color: COLORS.ray, size: 15 });
  f.words(pt(ox + w / 2, oy + h + 74), 'Image space', { anchor: 'middle', size: 14 });
  f.words(pt(ox + w / 2, oy + h + 92), 'pixels, origin at the top left', { anchor: 'middle', size: 12, color: '#555' });

  // Camera space (right): oblique sketch of r, u, f and the sensor at depth 1.
  const E = pt(452, 272);
  const rDir = unit(pt(0.97, 0.24));
  const uDir = pt(0, -1);
  const fDir = unit(pt(0.84, -0.54));
  const centre = plus(E, times(fDir, 170));
  const hb = 64;                            // drawn half-height = k
  const ha = hb * p.width / p.height;       // drawn half-width = (W/H) k
  const scale = hb / p.k;                   // pixels per camera-space unit on the sensor
  const corner = (sr: number, su: number): Pt => plus(centre, plus(times(rDir, sr * ha), times(uDir, su * hb)));

  f.arrow(E, plus(E, times(rDir, 232)));
  f.arrow(E, plus(E, times(uDir, 214)));
  f.polygon([corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)], COLORS.plane, COLORS.ink, 0.93);
  // The axis from the camera to the sensor centre lies in front of the sensor.
  f.line(E, centre, { color: COLORS.ink, width: 1.4 });
  f.line(corner(-1, 0), corner(1, 0), { color: COLORS.guide, width: 1, dash: '4 3' });
  f.line(corner(0, 1), corner(0, -1), { color: COLORS.guide, width: 1, dash: '4 3' });
  f.line(centre, plus(centre, times(fDir, 150)), { color: COLORS.ink, width: 1.2, dash: '5 4' });
  f.dot(centre, COLORS.ink, 3);
  f.math(plus(centre, pt(8, 14)), ['(0, 0, 1)'], { size: 14 });
  f.words(plus(corner(1, -1), pt(-10, -14)), 'Sensor', { anchor: 'end', size: 13 });

  // Half-height k on the right edge.
  const rTop = corner(1, 1), rMid = corner(1, 0);
  f.line(plus(rMid, pt(10, 0)), plus(rTop, pt(10, 0)), { color: COLORS.ink, width: 1 });
  f.line(plus(rMid, pt(6, 0)), plus(rMid, pt(14, 0)), { color: COLORS.ink, width: 1 });
  f.line(plus(rTop, pt(6, 0)), plus(rTop, pt(14, 0)), { color: COLORS.ink, width: 1 });
  f.math(plus(between(rMid, rTop, 0.5), pt(18, 0)), [I('k')], { size: 16 });

  const sensorPoint = plus(centre, plus(times(rDir, p.sx * p.k * scale), times(uDir, p.sy * p.k * scale)));
  f.rect(sensorPoint.x - 7, sensorPoint.y - 7, 14, 14, 'none', COLORS.ray, { 'stroke-dasharray': '3 2.5', 'stroke-width': 1.1 });
  const rayDir = unit(pt(sensorPoint.x - E.x, sensorPoint.y - E.y));
  f.line(E, sensorPoint, { color: COLORS.ray, width: 1.8 });
  const rayEnd = plus(sensorPoint, times(rayDir, 112));
  f.line(sensorPoint, rayEnd, { color: COLORS.ray, width: 1.6, dash: '5 4', arrow: 'ray' });
  f.dot(sensorPoint, COLORS.ray, 3.4);
  f.math(plus(rayEnd, pt(6, -8)), B('D'), { color: COLORS.ray, size: 18 });
  // Callout: the point's coordinates sit below the sensor, joined by a dashed leader,
  // because the arc, the ray and the axes leave no free side around the point itself.
  const bottomEdgeY = corner(-1, -1).y + (sensorPoint.x - corner(-1, -1).x) * (rDir.y / rDir.x);
  const callout = pt(sensorPoint.x, bottomEdgeY + 30);
  f.line(sensorPoint, pt(callout.x, callout.y - 10), { color: COLORS.ray, width: 1, dash: '2 3' });
  f.math(callout, ['(', I('s'), { t: 'x', sub: true, i: true }, I('k'), ', ', I('s'), { t: 'y', sub: true, i: true }, I('k'), ', 1)'],
    { anchor: 'middle', color: COLORS.ray, size: 14 });

  f.math(plus(E, plus(times(rDir, 232), pt(8, 6))), B('r'), { size: 18 });
  f.math(plus(E, pt(-8, -214)), B('u'), { anchor: 'end', size: 18 });
  f.math(plus(centre, plus(times(fDir, 150), pt(6, -6))), B('f'), { size: 18 });
  f.words(plus(centre, plus(times(fDir, 150), pt(-4, -24))), 'viewing direction', { anchor: 'end', size: 12, color: '#555' });
  f.dot(E, COLORS.ink, 4);
  f.math(plus(E, pt(-10, 16)), B('O'), { anchor: 'end', size: 17 });
  f.words(plus(E, pt(-10, 34)), 'camera', { anchor: 'end', size: 12, color: '#555' });
  f.words(pt(600, 330), 'Camera space', { anchor: 'middle', size: 14 });

  // Red arc: the pixel is carried onto the sensor.
  const c1 = pt(pc.x + 70, Math.max(10, pc.y - 150));
  const c2 = pt(sensorPoint.x - 170, Math.max(10, sensorPoint.y - 150));
  const end = plus(sensorPoint, pt(-10, -6));
  const start = pt(pc.x + 4, pc.y - 6);
  f.path(`M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`, { stroke: COLORS.ray, width: 1.6, arrow: 'ray' });
  // Label the arc a third of the way along, clear of the camera axes.
  const t = 0.3, u = 1 - t;
  const onArc = pt(u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
    u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y);
  f.words(plus(onArc, pt(-6, -14)), 'pixel → sensor', { anchor: 'end', color: COLORS.ray, size: 13 });
  return f.root;
}

// ---------------------------------------------------------------------------
// Figure 2: where the ray meets the surface
// ---------------------------------------------------------------------------

export function intersectionFigure(hit: HitStep): SVGSVGElement {
  return hit.sphere ? sphereFigure(hit) : planeFigure(hit);
}

function sphereFigure(hit: HitStep): SVGSVGElement {
  const s = hit.sphere!;
  const f = new Figure(780, 250, `Figure: the ray from O meets the ${hit.name}, a sphere of radius ${s.radius}, at distance t = ${hit.t.toFixed(3)}.`);
  const C = pt(560, 140);
  const R = 92;
  const b = clamp(s.impact / s.radius, 0, 0.97);
  const yRay = C.y - b * R;
  const half = R * Math.sqrt(1 - b * b);
  const near = pt(C.x - half, yRay);
  const far = pt(C.x + half, yRay);
  const foot = pt(C.x, yRay);
  const inside = s.root === 'far';
  const O = inside ? pt(C.x - half * 0.4, yRay) : pt(92, yRay);
  const P = inside ? far : near;

  f.circle(C, R, f.sphereFill(), COLORS.ink, 1.4);
  // Perpendicular from the centre to the ray: its foot is at t = -h.
  f.line(C, foot, { color: COLORS.guide, width: 1, dash: '4 3' });
  f.path(`M${foot.x - 8},${foot.y} L${foot.x - 8},${foot.y + 8} L${foot.x},${foot.y + 8}`, { stroke: COLORS.guide, width: 1 });
  // Radius.
  const radiusEnd = plus(C, times(pt(Math.cos(rad(40)), Math.sin(rad(40))), R));
  f.line(C, radiusEnd, { color: COLORS.ink, width: 1.1, dash: '5 3' });
  f.math(plus(between(C, radiusEnd, 0.55), pt(8, -10)), [I('R')], { size: 16 });
  f.dot(C);
  f.math(plus(C, pt(-10, 18)), B('C'), { anchor: 'end' });

  // The ray: red to the hit, dotted through the far side.
  f.line(O, P, { color: COLORS.ray, width: 1.9 });
  if (!inside) {
    f.line(P, far, { color: COLORS.guide, width: 1.1, dash: '2 3' });
    f.circle(far, 3.2, '#ffffff', COLORS.guide, 1.2);
    f.math(plus(far, pt(10, -12)), [I('t'), { t: '2', sub: true }], { color: '#555', size: 15 });
  }
  f.arrow(O, plus(O, pt(48, 0)), 'ray', 2);
  f.math(plus(O, pt(24, -16)), B('D'), { anchor: 'middle', color: COLORS.ray, size: 17 });
  f.dot(O);
  f.math(plus(O, pt(-6, 18)), B('O'), { anchor: 'end' });

  // Normal at the hit.
  const n = unit(pt(P.x - C.x, P.y - C.y));
  const normalEnd = plus(P, times(n, 46));
  f.arrow(P, normalEnd, 'ink', 1.6);
  f.math(plus(normalEnd, pt(n.x < 0 ? -8 : 8, -4)), B('N'), { anchor: n.x < 0 ? 'end' : 'start' });
  f.dot(P, COLORS.ray, 3.8);
  f.math(plus(P, pt(inside ? 8 : -18, inside ? 18 : 22)), B('P'), { anchor: inside ? 'start' : 'end', color: COLORS.ray });

  // t = -h -/+ sqrt(delta), drawn as two measured segments along the ray.
  f.dimension(O, foot, -58, [{ t: '−', i: false }, I('h')]);
  f.dimension(P, foot, inside ? -30 : 30, ['√', { t: 'Δ', i: false }]);
  return f.root;
}

function planeFigure(hit: HitStep): SVGSVGElement {
  const p = hit.plane!;
  const f = new Figure(780, 250, `Figure: the ray from O meets the ${hit.name}, a plane, at distance t = ${hit.t.toFixed(3)}.`);
  const y0 = 186;
  const a = pt(150, y0), b = pt(650, y0);
  f.rect(a.x, y0, b.x - a.x, 18, COLORS.plane, 'none');
  f.line(a, b, { width: 1.8 });
  f.hatch(a, b);
  const P = pt(450, y0);
  const alpha = Math.acos(clamp(Math.abs(p.denominator), 0, 1)); // angle from the normal
  const back = pt(-Math.sin(alpha), -Math.cos(alpha));
  const length = Math.min(250, (y0 - 26) / Math.max(Math.cos(alpha), 1e-3));
  const O = plus(P, times(back, length));
  f.line(O, P, { color: COLORS.ray, width: 1.9 });
  const dir = times(back, -1);
  f.arrow(O, plus(O, times(dir, 46)), 'ray', 2);
  f.math(plus(O, plus(times(dir, 22), times(perp(dir), 16))), B('D'), { anchor: 'middle', color: COLORS.ray, size: 17 });
  f.dot(O);
  f.math(plus(O, pt(-10, 0)), B('O'), { anchor: 'end' });

  const P0 = pt(250, y0);
  f.line(O, P0, { color: COLORS.guide, width: 1, dash: '4 3' });
  f.dot(P0);
  f.math(plus(P0, pt(0, 30)), B('P', '0'), { anchor: 'middle' });

  f.arrow(P, pt(P.x, y0 - 86), 'ink', 1.6);
  f.math(pt(P.x + 10, y0 - 92), B('n'));
  f.dot(P, COLORS.ray, 3.8);
  f.math(plus(P, pt(14, 18)), B('P'), { color: COLORS.ray });
  f.dimension(O, P, -22, [I('t')]);
  f.words(pt(b.x, y0 + 34), `${hit.name} (drawn edge-on)`, { anchor: 'end', size: 12, color: '#555' });
  return f.root;
}

// ---------------------------------------------------------------------------
// Figure 3: the mirror bounce
// ---------------------------------------------------------------------------

export function reflectionFigure(r: ReflectStep): SVGSVGElement {
  const f = new Figure(780, 260, `Figure: mirror bounce at the center sphere. Incidence ${r.thetaI.toFixed(1)} degrees equals reflection ${r.thetaR.toFixed(1)} degrees.`);
  const P = pt(390, 204);
  // A slice of the sphere under its tangent plane.
  const sphereR = 330;
  const sc = pt(P.x, P.y + sphereR);
  const span = 0.62;
  const left = plus(sc, times(pt(-Math.sin(span), -Math.cos(span)), sphereR));
  const right = plus(sc, times(pt(Math.sin(span), -Math.cos(span)), sphereR));
  f.path(`M${left.x},${left.y} A${sphereR},${sphereR} 0 0 1 ${right.x},${right.y} L${right.x},260 L${left.x},260 Z`, { fill: f.sphereFill(), stroke: 'none' });
  f.path(`M${left.x},${left.y} A${sphereR},${sphereR} 0 0 1 ${right.x},${right.y}`, { width: 1.4 });
  f.line(pt(150, P.y), pt(630, P.y), { color: COLORS.guide, width: 1.1, dash: '6 4' });
  f.words(pt(632, P.y - 12), 'tangent plane at P', { anchor: 'end', size: 12, color: '#555' });

  const top = pt(P.x, P.y - 158);
  f.arrow(P, top, 'ink', 1.6);
  f.math(pt(top.x + 10, top.y + 4), B('N'));

  const L = 170;
  const ti = rad(r.thetaI), tr = rad(r.thetaR);
  const start = plus(P, times(pt(-Math.sin(ti), -Math.cos(ti)), L));
  const out = plus(P, times(pt(Math.sin(tr), -Math.cos(tr)), L));
  f.line(start, between(start, P, 0.5), { color: COLORS.ray, width: 1.9, arrow: 'ray' });
  f.line(between(start, P, 0.48), P, { color: COLORS.ray, width: 1.9 });
  f.line(P, out, { color: COLORS.science, width: 1.9, arrow: 'science' });
  f.math(plus(between(start, P, 0.42), pt(-16, -4)), B('D'), { anchor: 'end', color: COLORS.ray, size: 18 });
  f.math(plus(between(P, out, 0.62), pt(14, -4)), B('R'), { color: COLORS.science, size: 18 });

  f.arc(P, 52, -90 - r.thetaI, -90);
  f.arc(P, 60, -90, -90 + r.thetaR);
  const li = plus(P, times(pt(Math.cos(rad(-90 - r.thetaI / 2)), Math.sin(rad(-90 - r.thetaI / 2))), 80));
  const lr = plus(P, times(pt(Math.cos(rad(-90 + r.thetaR / 2)), Math.sin(rad(-90 + r.thetaR / 2))), 88));
  f.math(li, [{ t: 'θ', i: true }, { t: 'i', i: true, sub: true }], { anchor: 'middle', size: 17 });
  f.math(lr, [{ t: 'θ', i: true }, { t: 'r', i: true, sub: true }], { anchor: 'middle', size: 17 });
  f.dot(P, COLORS.ray, 3.8);
  f.math(plus(P, pt(10, 18)), B('P'), { color: COLORS.ray });
  return f.root;
}

// ---------------------------------------------------------------------------
// Figure 4: shadow ray and shading
// ---------------------------------------------------------------------------

export function shadingFigure(s: ShadeStep): SVGSVGElement {
  const facesAway = s.rawNDotL <= 0;
  const f = new Figure(780, facesAway ? 230 : 270, facesAway
    ? `Figure: the ${s.surface.name} faces away from the light, so the shadow ray points into the surface itself.`
    : `Figure: shadow ray from P toward the light at angle ${s.phiDeg.toFixed(1)} degrees from the normal; ${s.blocked ? `blocked by the ${s.blockerName}` : 'nothing in the way'}.`);
  const y0 = facesAway ? 140 : 214;
  const a = pt(140, y0), b = pt(640, y0);
  f.rect(a.x, y0, b.x - a.x, 18, COLORS.plane, 'none');
  f.line(a, b, { width: 1.8 });
  f.hatch(a, b);
  f.words(pt(a.x, y0 + 36), `${s.surface.name} (matte), drawn edge-on`, { size: 12, color: '#555' });

  const P = pt(330, y0);
  const top = pt(P.x, y0 - (facesAway ? 112 : 140));
  f.arrow(P, top, 'ink', 1.6);
  f.math(pt(top.x - 10, top.y + 4), B('N'), { anchor: 'end' });

  const phi = rad(s.phiDeg);
  const dir = pt(Math.sin(phi), -Math.cos(phi));
  if (facesAway) {
    // The light is behind the tangent plane: phi > 90 degrees, drawn at its true angle.
    const light = plus(P, times(dir, 250));
    f.line(P, plus(light, times(dir, -24)), { color: COLORS.science, width: 1.8, dash: '5 4', arrow: 'science' });
    f.cross(plus(P, times(dir, 16)), 5);
    f.bulb(light);
    f.words(plus(light, pt(-4, -34)), 'light, behind the surface', { anchor: 'middle', size: 12.5, color: '#333' });
    f.math(plus(between(P, light, 0.62), pt(0, -16)), B('L'), { anchor: 'middle', color: COLORS.science, size: 18 });
    f.arc(P, 48, -90, -90 + s.phiDeg);
    const lp = plus(P, times(pt(Math.cos(rad(-90 + s.phiDeg * 0.42)), Math.sin(rad(-90 + s.phiDeg * 0.42))), 70));
    f.math(lp, [{ t: 'φ', i: true }, ` = ${s.phiDeg.toFixed(1)}° > 90°`], { size: 15 });
  } else {
    const reach = Math.min(232, (y0 - 34) / Math.max(dir.y * -1, 0.2));
    const light = plus(P, times(dir, reach));
    const stopAt = s.blocked && !s.selfBlocked ? clamp((s.blockerT ?? 0) / s.distance, 0.25, 0.7) : 1;
    const stop = between(P, light, stopAt);
    if (s.blocked && !s.selfBlocked) {
      const blocker = plus(stop, times(dir, 24));
      f.circle(blocker, 24, f.sphereFill(), COLORS.ink, 1.3);
      f.line(P, stop, { color: COLORS.science, width: 1.9 });
      f.line(plus(blocker, times(dir, 24)), plus(light, times(dir, -24)), { color: COLORS.guide, width: 1.1, dash: '4 4' });
      f.cross(stop, 5.5);
      f.words(plus(blocker, pt(30, 2)), `blocked by the ${s.blockerName}`, { size: 12.5, color: '#333' });
    } else {
      f.line(P, plus(light, times(dir, -24)), { color: COLORS.science, width: 1.9, arrow: 'science' });
    }
    f.bulb(light);
    f.words(plus(light, pt(28, -2)), 'light', { size: 13 });
    f.math(plus(between(P, light, 0.55), plus(times(perp(dir), 16), pt(0, 0))), B('L'), { anchor: 'middle', color: COLORS.science, size: 18 });
    // Measure d on the open side of the ray, away from the normal.
    // Start a little up the ray so the offset line never dips below the surface.
    f.dimension(plus(P, times(dir, 34)), plus(light, times(dir, -18)), 40, [I('d')]);
    f.arc(P, 46, -90, -90 + s.phiDeg);
    const lp = plus(P, times(pt(Math.cos(rad(-90 + s.phiDeg / 2)), Math.sin(rad(-90 + s.phiDeg / 2))), 64));
    f.math(lp, [{ t: 'φ', i: true }], { anchor: 'middle', size: 17 });
  }
  f.dot(P, COLORS.ray, 3.8);
  f.math(plus(P, pt(-12, 20)), B('P'), { anchor: 'end', color: COLORS.ray });
  return f.root;
}

// ---------------------------------------------------------------------------
// Figure 5: from light energy to a screen color
// ---------------------------------------------------------------------------

const srgb = (c: number): number => { const x = clamp(c, 0, 1); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };

export function displayCurve(mode: ViewMode, c: number): number {
  if (mode === 'hit') return clamp(c, 0, 1);
  if (mode === 'albedo') return srgb(c);
  return srgb(Math.max(0, c) / (1 + Math.max(0, c)));
}

export function displayFigure(d: DisplayStep): SVGSVGElement {
  const f = new Figure(780, 250, `Figure: display curve for the ${d.mode} view, with the pixel's red, green and blue values marked; final color bytes ${d.bytes.join(', ')}.`);
  const x0 = 74, y0 = 206, pw = 360, ph = 168;
  const maxC = Math.max(...d.linear, 0);
  const xMax = d.mode === 'beauty' ? Math.max(2, Math.ceil(maxC * 1.25 * 2) / 2) : 1;
  const X = (c: number): number => x0 + c / xMax * pw;
  const Y = (v: number): number => y0 - v * ph;

  const step = xMax <= 1 ? 0.25 : xMax <= 3 ? 0.5 : 1;
  for (let c = step; c <= xMax + 1e-9; c += step) {
    f.line(pt(X(c), y0), pt(X(c), y0 - ph), { color: COLORS.grid, width: 1 });
    f.math(pt(X(c), y0 + 16), [String(Number(c.toFixed(2)))], { anchor: 'middle', size: 12.5 });
  }
  for (let v = 0.25; v <= 1 + 1e-9; v += 0.25) {
    f.line(pt(x0, Y(v)), pt(x0 + pw, Y(v)), { color: COLORS.grid, width: 1 });
    f.math(pt(x0 - 8, Y(v)), [String(v)], { anchor: 'end', size: 12.5 });
  }
  f.math(pt(x0 - 8, y0 + 4), ['0'], { anchor: 'end', size: 12.5 });
  f.arrow(pt(x0, y0), pt(x0 + pw + 22, y0));
  f.arrow(pt(x0, y0), pt(x0, y0 - ph - 22));
  f.math(pt(x0 + pw + 28, y0), [I('c')], { size: 16 });
  f.words(pt(x0 + pw + 28, y0 + 18), 'linear', { size: 11.5, color: '#555' });
  f.words(pt(x0 + 8, y0 - ph - 24), 'display value', { size: 12, color: '#555' });

  const sample = (fn: (c: number) => number): string => {
    let dpath = '';
    for (let i = 0; i <= 160; i++) {
      const c = xMax * i / 160;
      dpath += `${i === 0 ? 'M' : 'L'}${X(c).toFixed(1)},${Y(fn(c)).toFixed(1)}`;
    }
    return dpath;
  };
  if (d.mode === 'beauty') {
    f.path(sample(c => c / (1 + c)), { stroke: COLORS.ink, width: 1.3, dash: '5 4' });
    f.math(pt(X(xMax) - 4, Y(xMax / (1 + xMax)) + 16), [I('c'), ' / (1 + ', I('c'), ')'], { anchor: 'end', size: 14 });
  }
  f.path(sample(c => displayCurve(d.mode, c)), { stroke: COLORS.ink, width: 1.8 });
  const curveLabel: Run[] = d.mode === 'beauty' ? ['sRGB(', I('c'), ' / (1 + ', I('c'), '))'] : d.mode === 'albedo' ? ['sRGB(', I('c'), ')'] : [I('c')];
  f.math(pt(X(xMax) - 4, Y(displayCurve(d.mode, xMax)) - 14), curveLabel, { anchor: 'end', color: COLORS.ink, size: 14 });

  const channelColors = ['#d23b3b', '#2f9a44', '#3b63d2'];
  // Legend box first, so it sits behind its entries.
  f.rect(x0 + pw - 182, y0 - 76, 176, 66, '#ffffff', COLORS.grid, { 'fill-opacity': 0.92, rx: 3 });
  ['R', 'G', 'B'].forEach((name, i) => {
    const c = clamp(d.linear[i], 0, xMax);
    const point = pt(X(c), Y(d.encoded[i]));
    f.line(pt(point.x, y0), point, { color: channelColors[i], width: 1, dash: '2 3' });
    f.line(pt(x0, point.y), point, { color: channelColors[i], width: 1, dash: '2 3' });
    f.circle(point, 4.2, channelColors[i], '#ffffff', 1.2);
    // Legend (bottom right of the plot, under the curves) instead of crowded point labels.
    const ly = y0 - 62 + i * 19;
    const lx = x0 + pw - 168;
    f.circle(pt(lx, ly), 4.2, channelColors[i], '#ffffff', 1.2);
    f.words(pt(lx + 10, ly), name, { size: 12, weight: 650, color: channelColors[i] });
    f.math(pt(lx + 26, ly), [I('c'), ` = ${d.linear[i].toFixed(4)} → ${d.encoded[i].toFixed(3)}`], { size: 13.5 });
  });

  // Final swatch.
  const sx = 520, sy = 42, size = 124;
  f.rect(sx, sy, size, size, `rgb(${d.bytes.join(',')})`, COLORS.ink, { rx: 3 });
  f.words(pt(sx + size / 2, sy + size + 20), 'displayed color', { anchor: 'middle', size: 12.5, color: '#555' });
  f.math(pt(sx + size / 2, sy + size + 42), ['(', I('R'), ', ', I('G'), ', ', I('B'), `) = (${d.bytes.join(', ')})`], { anchor: 'middle', size: 15 });
  return f.root;
}
