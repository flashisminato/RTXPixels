import coreSource from '../core/index.ts?raw';
import vectorSource from '../core/vector.ts?raw';
// Imported from the shader module itself, not src/render/index.ts: integration
// tests replace that module with stubs exporting only createRenderer.
import { buildTraceFragmentSource } from '../render/shaders/trace.frag.ts';
import { extractFunction, type Lang } from './source-extract.ts';

/**
 * Chapter 4, "Implementation": the code that produces chapters 1–3, shown as it
 * runs. The CPU listings come from the tracer's source text (Vite ?raw import of
 * src/core); the GPU listings from the exact GLSL the renderer compiles. Code is
 * set in <code class="listing">, never <pre>: integration tests rely on the
 * document's single <pre> being the inspection record.
 */

type Part = { lang: Lang; source: string; path: string; functions: string[] };
type Section = { id: string; title: string; implements: string; cpu: Part; gpu: Part };

const glsl = buildTraceFragmentSource();
const CORE = 'src/core/index.ts';
const SHADER = 'src/render/shaders/trace.frag.ts (generated GLSL)';

export const SOURCE_SECTIONS: Section[] = [
  { id: 'listing-4-1', title: 'From a pixel to a ray', implements: 'section 3.1 (the screen coordinates, the camera frame and the ray direction)',
    cpu: { lang: 'ts', source: coreSource, path: CORE, functions: ['makeCameraBasis', 'makeCameraRay'] },
    gpu: { lang: 'glsl', source: glsl, path: SHADER, functions: ['main'] } },
  { id: 'listing-4-2', title: 'Finding the nearest surface', implements: 'the intersection sections of chapter 3 (the sphere quadratic and the plane solve)',
    cpu: { lang: 'ts', source: coreSource, path: CORE, functions: ['nearestHit'] },
    gpu: { lang: 'glsl', source: glsl, path: SHADER, functions: ['intersectSphere', 'intersectPlane', 'nearestHit'] } },
  { id: 'listing-4-3', title: 'Bounces, shadows and shading', implements: 'the mirror bounce, the shadow test and the shading law, and how a path ends',
    cpu: { lang: 'ts', source: coreSource + '\n' + vectorSource, path: `${CORE}, src/core/vector.ts`, functions: ['trace', 'reflect'] },
    gpu: { lang: 'glsl', source: glsl, path: SHADER, functions: ['traceLinear', 'shadeMatte', 'occluded'] } },
  { id: 'listing-4-4', title: 'Display encoding', implements: 'the tone curve, sRGB encoding and 8-bit rounding',
    cpu: { lang: 'ts', source: coreSource, path: CORE, functions: ['encodeDisplay'] },
    gpu: { lang: 'glsl', source: glsl, path: SHADER, functions: ['reinhard', 'linearToSrgbChannel', 'linearToSrgb'] } },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string | null, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

/** Numbered code lines; comments set in graphite. */
function codeBlock(text: string): HTMLElement {
  const code = el('code', 'listing');
  let inBlock = false;
  for (const line of text.split('\n')) {
    const span = el('span', 'line');
    let rest = line;
    while (rest.length) {
      if (inBlock) {
        const end = rest.indexOf('*/');
        const piece = end < 0 ? rest : rest.slice(0, end + 2);
        span.append(el('span', 'c', piece));
        rest = end < 0 ? '' : rest.slice(end + 2);
        inBlock = end < 0;
        continue;
      }
      const lineComment = rest.indexOf('//');
      const blockComment = rest.indexOf('/*');
      const next = [lineComment, blockComment].filter(i => i >= 0).sort((a, b) => a - b)[0];
      if (next === undefined) { span.append(rest); break; }
      if (next > 0) span.append(rest.slice(0, next));
      if (next === lineComment) { span.append(el('span', 'c', rest.slice(next))); break; }
      rest = rest.slice(next);
      inBlock = true;
    }
    code.append(span, '\n');
  }
  return code;
}

function listing(label: string, part: Part, kind: string): HTMLElement {
  const blocks = part.functions.map(name => extractFunction(part.source, name, part.lang) ?? `// ${name}: not found in ${part.path}`);
  const text = blocks.join('\n\n');
  const lines = text.split('\n').length;
  const figure = el('figure', 'listing-fig');
  const details = el('details', null);
  details.append(
    el('summary', null, el('b', null, `${label}. `), `${kind}: `, el('code', 'fn-names', part.functions.join(', ')), el('span', 'listing-meta', ` · ${lines} lines`)),
    codeBlock(text),
  );
  figure.append(details, el('figcaption', null, part.path));
  return figure;
}

/** Build chapter 4's body (static: the source does not change with the pixel). */
export function buildSourceChapter(): HTMLElement[] {
  return SOURCE_SECTIONS.map((section, i) => {
    const box = el('section', 'source-step');
    box.id = section.id;
    box.append(
      el('h3', null, el('span', 'math-step-no', `4.${i + 1}`), section.title),
      el('p', 'source-lead', `Implements ${section.implements}. The CPU version produces every number in chapters 2 and 3; the GPU version draws Figure 1.1.`),
      listing(`Listing 4.${i + 1}a`, section.cpu, 'CPU reference, TypeScript'),
      listing(`Listing 4.${i + 1}b`, section.gpu, 'GPU shader, GLSL'),
    );
    return box;
  });
}
