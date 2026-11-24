import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractFunction } from '../../src/ui/source-extract.ts';

const core = readFileSync(new URL('../../src/core/index.ts', import.meta.url), 'utf8');
const vector = readFileSync(new URL('../../src/core/vector.ts', import.meta.url), 'utf8');

test('extracts real CPU tracer functions whole: balanced braces, signature to closing brace', () => {
  for (const name of ['makeCameraBasis', 'makeCameraRay', 'nearestHit', 'trace', 'encodeDisplay']) {
    const code = extractFunction(core, name, 'ts');
    assert.ok(code, `${name} not found`);
    assert.match(code!, new RegExp(`function ${name}\\s*\\(`));
    assert.ok(code!.trimEnd().endsWith('}'), `${name} must end at its closing brace`);
    const opens = (code!.match(/\{/g) ?? []).length, closes = (code!.match(/\}/g) ?? []).length;
    assert.equal(opens, closes, `${name}: unbalanced braces`);
  }
  // nearestHit must not swallow the next function.
  assert.doesNotMatch(extractFunction(core, 'nearestHit', 'ts')!, /function sky/);
  assert.match(extractFunction(vector, 'reflect', 'ts')!, /2 \* dot\(direction, normal\)/);
});

test('keeps the comment block directly above a function', () => {
  const traceCode = extractFunction(core, 'trace', 'ts')!;
  assert.match(traceCode.split('\n')[0], /^\/\//, 'the explanatory comment above trace() is included');
});

test('GLSL: picks the definition (not a call), skips braces in comments and strings', () => {
  const glsl = `#version 300 es
// Nearest hit. Braces in comments { are ignored }.
Hit nearestHit(vec3 o, vec3 d) {
  Hit best = missRecord();
  for (int i = 0; i < 8; i++) { if (i > 2) break; }
  return best;
}
vec3 shade(Hit h) { Hit n = nearestHit(h.point, h.normal); return vec3(0.0); }`;
  const code = extractFunction(glsl, 'nearestHit', 'glsl')!;
  assert.match(code, /^\/\/ Nearest hit/);
  assert.match(code, /return best;\n\}$/);
  assert.doesNotMatch(code, /vec3 shade/);
  assert.equal(extractFunction(glsl, 'missing', 'glsl'), null);
  const tricky = 'function f(a) {\n  const s = "}{";\n  /* } */\n  return `${a}}`;\n}\nfunction g() {}';
  assert.equal(extractFunction(tricky, 'f', 'ts'), 'function f(a) {\n  const s = "}{";\n  /* } */\n  return `${a}}`;\n}');
});
