/**
 * Extract one named function, with the comment block directly above it, from
 * TypeScript or GLSL source text. Pure (unit-tested against the real sources):
 * chapter 4 shows the code that actually runs, never a copy.
 */

export type Lang = 'ts' | 'glsl';

function signature(name: string, lang: Lang): RegExp {
  return lang === 'ts'
    ? new RegExp(`(^|\\n)[ \\t]*(export\\s+)?(async\\s+)?function\\s+${name}\\s*[<(]`)
    : new RegExp(`(^|\\n)[ \\t]*[A-Za-z_]\\w*\\s+${name}\\s*\\(`);
}

/** Index just past the brace that closes the one at `open`, skipping strings and comments. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      for (i++; i < src.length && src[i] !== quote; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Start of the comment block (/** … *\/ or // lines) immediately above `at`. */
function leadingComment(src: string, at: number): number {
  let start = at;
  for (;;) {
    const before = src.slice(0, start).replace(/[ \t]*\n?$/, '');
    const blockEnd = before.endsWith('*/') ? before.length : -1;
    if (blockEnd >= 0) {
      const open = before.lastIndexOf('/*');
      if (open < 0) return start;
      const lineStart = before.lastIndexOf('\n', open) + 1;
      if (before.slice(lineStart, open).trim() !== '') return start;
      start = lineStart;
      continue;
    }
    const lineStart = before.lastIndexOf('\n') + 1;
    if (before.slice(lineStart).trimStart().startsWith('//')) { start = lineStart; continue; }
    return start;
  }
}

export function extractFunction(src: string, name: string, lang: Lang): string | null {
  const m = signature(name, lang).exec(src);
  if (!m) return null;
  const sigStart = m.index + m[1].length;
  // The body's brace: the first '{' after the parameter list closes.
  let paren = src.indexOf('(', sigStart), depth = 0, i = paren;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) break;
  }
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  const end = matchBrace(src, open);
  if (end < 0) return null;
  const start = leadingComment(src, sigStart);
  return dedent(src.slice(start, end));
}

function dedent(text: string): string {
  const lines = text.replace(/^\n+/, '').split('\n');
  const indents = lines.filter(l => l.trim()).map(l => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map(l => l.slice(cut)).join('\n');
}
