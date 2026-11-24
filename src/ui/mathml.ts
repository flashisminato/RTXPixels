import type { Vec3 } from '../contracts.ts';

/**
 * Minimal MathML builder for the "Explain the math" panel.
 *
 * Native MathML Core (Chrome 109+, Safari, Firefox) typesets fractions, roots,
 * sub/superscripts and stretchy delimiters with no runtime dependency.
 * Conventions follow standard textbook notation:
 *   - vectors and colors: bold upright (via Unicode mathematical bold)
 *   - scalars: italic (MathML's automatic single-letter italic)
 *   - true minus sign U+2212, centered dot for the dot product, double bars for norms
 */

const NS = 'http://www.w3.org/1998/Math/MathML';

export type MNode = Element | string;

function node(tag: string, attrs: Record<string, string> | null, children: MNode[]): Element {
  const element = document.createElementNS(NS, tag);
  if (attrs) for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  for (const child of children) element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return element;
}

export const row = (...children: MNode[]): Element => node('mrow', null, children);
export const mi = (name: string): Element => node('mi', null, [name]);
/** Upright identifier: multi-letter names, units and labels. */
export const mu = (name: string): Element => node('mi', { mathvariant: 'normal' }, [name]);
export const mo = (op: string, attrs: Record<string, string> | null = null): Element => node('mo', attrs, [op]);
export const mn = (value: string): Element => node('mn', null, [value]);
export const mtext = (text: string): Element => node('mtext', null, [text]);
export const sub = (base: MNode, script: MNode): Element => node('msub', null, [wrap(base), wrap(script)]);
export const sup = (base: MNode, script: MNode): Element => node('msup', null, [wrap(base), wrap(script)]);
export const frac = (numerator: MNode, denominator: MNode): Element => node('mfrac', null, [wrap(numerator), wrap(denominator)]);
export const sqrt = (...children: MNode[]): Element => node('msqrt', null, children);
export const space = (em = 0.6): Element => node('mspace', { width: `${em}em` }, []);

function wrap(child: MNode): Element {
  return typeof child === 'string' ? mi(child) : child;
}

const BOLD_UPPER = 0x1d400;
const BOLD_LOWER = 0x1d41a;
const BOLD_GREEK: Record<string, string> = { ρ: '\u{1d6d2}', θ: '\u{1d6c9}' };

/** Bold upright vector symbol: v('D') renders 𝐃. */
export function v(letter: string): Element {
  const code = letter.codePointAt(0)!;
  let glyph = letter;
  if (letter >= 'A' && letter <= 'Z') glyph = String.fromCodePoint(BOLD_UPPER + code - 65);
  else if (letter >= 'a' && letter <= 'z') glyph = String.fromCodePoint(BOLD_LOWER + code - 97);
  else if (BOLD_GREEK[letter]) glyph = BOLD_GREEK[letter];
  return node('mi', null, [glyph]);
}

/** Vector with an upright subscript label, e.g. vs('c', 'L') renders 𝐜_L. */
export const vs = (letter: string, label: string): Element => sub(v(letter), label.length > 1 ? mu(label) : mi(label));

/**
 * Delimiters stretch only around tall content (fractions, roots, tables).
 * Latin Modern's stretch variants are wider than its base glyphs, so stretching
 * single-line content left visible gaps inside the brackets.
 */
export function fenced(open: string, inner: MNode, close: string): Element {
  const content = wrap(inner);
  const tall = ['mfrac', 'msqrt', 'mroot', 'mtable'].includes(content.localName) || !!content.querySelector('mfrac, msqrt, mroot, mtable');
  const attrs = { stretchy: tall ? 'true' : 'false', lspace: '0', rspace: '0' };
  return row(mo(open, attrs), content, mo(close, { ...attrs }));
}
export const paren = (inner: MNode): Element => fenced('(', inner, ')');
export const norm = (inner: MNode): Element => fenced('\u2016', inner, '\u2016');

export const eq = (): Element => mo('=');
export const plus = (): Element => mo('+');
export const minus = (): Element => mo('\u2212');
export const cdot = (): Element => mo('\u22c5');
export const times = (): Element => mo('\u00d7');
export const hadamard = (): Element => mo('\u2299');
export const implies = (): Element => mo('\u21d2');
export const approx = (): Element => mo('\u2248');
export const comma = (): Element => mo(',', { separator: 'true' });

/** Number with a true minus sign and fixed decimals. */
export function num(value: number, digits = 3): Element {
  if (!Number.isFinite(value)) return mtext('unavailable');
  const rounded = Number(value.toFixed(digits));
  const text = Math.abs(rounded).toFixed(digits);
  return rounded < 0 ? row(mo('\u2212', { form: 'prefix' }), mn(text)) : mn(text);
}

/** Coordinate triple: (x, y, z). */
export function tuple(value: Vec3, digits = 3): Element {
  // Not stretchy: Latin Modern's stretch variants are wider than the base glyph,
  // which left visible gaps inside single-line tuples.
  const open = mo('(', { lspace: '0', rspace: '0', stretchy: 'false' });
  const close = mo(')', { lspace: '0', rspace: '0', stretchy: 'false' });
  return row(open, num(value[0], digits), comma(), num(value[1], digits), comma(), num(value[2], digits), close);
}

/** Scientific notation with a true minus and times sign, e.g. 3.6 x 10^-16. */
export function sci(value: number, digits = 1): Element {
  if (value === 0) return mn('0');
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / 10 ** exponent;
  const exp = exponent < 0 ? row(mo('\u2212', { form: 'prefix', lspace: '0', rspace: '0' }), mn(String(-exponent))) : mn(String(exponent));
  return row(num(mantissa, digits), mo('\u00d7'), sup(mn('10'), exp));
}


export function degrees(value: number, digits = 1): Element {
  return row(num(value, digits), mo('\u00b0', { lspace: '0', rspace: '0' }));
}

/** A display-mode equation. `label` becomes the accessible name. */
export function math(label: string, ...children: MNode[]): Element {
  const element = node('math', { display: 'block' }, [row(...children)]);
  element.setAttribute('aria-label', label);
  return element;
}

/** Inline (text-style) math, for symbols inside sentences and captions. */
export function inline(...children: MNode[]): Element {
  return node('math', null, [row(...children)]);
}

/** Piecewise definition with a stretchy left brace. */
export function cases(rows: Array<[MNode, MNode]>): Element {
  const table = node('mtable', { columnalign: 'left', columnspacing: '1.2em' },
    rows.map(([value, condition]) => node('mtr', null, [node('mtd', null, [wrap(value)]), node('mtd', null, [wrap(condition)])])));
  return row(mo('{', { stretchy: 'true' }), table);
}
