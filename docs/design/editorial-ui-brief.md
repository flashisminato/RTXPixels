# Brief: redesign the interface as Interactive Mathematical Editorialism

> **How to use this document.** It is written as a prompt. Give it, unchanged, to
> whoever implements the interface (a person or an AI account). Every section
> says *where* to change, *how*, and shows *what the change looks like*. Work in
> the phases of §7 and stop at each acceptance gate.

Requested by the human team lead. The interface files (`src/ui/**`,
`src/styles/**`, `tests/ui/**`) belong to AI 2; the redesign is delivered on
branch `feature/editorial-ui` for AI 2 to review.

---

## 0. Your role and the rules you must not break

You are redesigning the interface of **Follow a Pixel**, a browser ray tracer that
answers *"How does a game decide what a mirror shows?"*. Turn it from a dark
app-style page into an **interactive scientific monograph**: a white, typeset
document whose figures, equations and numbers are live.

You own only `src/ui/**`, `src/styles/**`, `tests/ui/**`. Do **not** edit
`src/contracts.ts`, `src/core/**`, `src/state/**`, `src/main.ts`, `src/render/**`,
`index.html`, `package.json` or tests outside `tests/ui/`.

These integration hooks are used by other people's tests and code. Keep every one:

| Hook | Who relies on it | Rule |
|---|---|---|
| `mountUI(root, actions)` → `{ canvasHost, update, dispose }` | `main.ts` (AI 3) | Same signature. `canvasHost` is empty when returned, has class `canvas-host`, **no padding or border**. |
| First `<canvas>` in the document is the image canvas | AI 3 browser tests (`document.querySelector('canvas')`) | Never place another `<canvas>` before `.canvas-host`. Prefer SVG for figures. |
| `.canvas-host > canvas` | AI 3, AI 1 tests | Keep the class; the host must stay clickable and accept inline `width` / `aspect-ratio` overrides. |
| First `[role=status]` shows exactly `` `${status}: ${message}` `` | AI 3 tests (`startsWith('ready:')`) | Any other live region must come later in the DOM or use `aria-live` without `role=status`. |
| Exactly one `<pre>`, hidden, containing `JSON.stringify(inspection)` | AI 3 tests (`locator('pre')`, strict) | **Code listings must not use `<pre>`** (use `<code class="listing">`). |
| Buttons named exactly *Inspect a computed mirror example* and *Reset* | AI 3 tests | Restyle freely; keep the accessible names. |
| `explain.ts` exports `buildExplanation, project, screenMapper, incidenceDegrees, reflectionDegrees, SCHEMATIC_NOTE, CANVAS_LABEL`; `selection.ts` exports | AI 2 tests | Extend, never rename or change their results. |
| No runtime network requests | Plan: offline after load | Bundle every font locally. No CDN. |
| UI never imports from `src/render/index.ts` | AI 3 lifecycle tests replace that module with stubs exporting only `createRenderer` | Import the specific submodule (e.g. `src/render/shaders/trace.frag.ts`). Learned in P6: importing through the index broke 2 of AI 3's tests. |
| Figures are rebuilt on every update | Everything interactive | Put listeners and pointer capture on persistent hosts, restore focus after a rebuild, persist open disclosures. |

---

## 1. What the plan's interface sections already ask for (audit)

Sources: *Light Teachings source review*, section **UX and the two minute explanation**,
and the **AI 2 brief** (teaching and interaction requirements).

| Requirement | Current interface | Verdict |
|---|---|---|
| One large rendered image, at most three prominent controls, advanced settings expandable | Picture + three controls + *More controls* disclosure | Keep |
| Two-minute sequence: move object → inspect mirror pixel → step Camera → Mirror → Object → move light → toggle matte / bounces | All controls exist; sequence not signposted | Signpost it as numbered chapters |
| Separate oblique schematic from recorded 3D points, labelled as schematic, depth labelled | Dark Canvas2D wireframe (`diagram.ts`) | Restyle as a textbook SVG figure |
| Compact event list with distances, `N·L`, reflection angles | Numbered dark cards | Restyle as a numbered derivation |
| Equations behind *Explain the math* | White math panel inside `<details>` (merged PR #3) | Promote to its own chapter |
| Say the algorithm traces backward; light travels forward | Present as a sentence | Keep, set as a definition |
| Sky / budget / blocked-shadow states explained, never guessed | Present | Keep |
| Keyboard sliders, visible focus, text beside colour, **numeric pixel selector**, 44 px targets, stacking on narrow screens, reduced motion, reset | All except the **numeric pixel selector** | Add the selector |

What exists today, top to bottom: header and question; *The picture* (canvas host,
pixel ring marker, help text, two buttons, status line); *Try this first* controls
column (object X, mirror/matte, camera yaw, *More controls*: light X, bounces, view
mode); *Why this pixel is that color* (mode note, pixel line, summary, direction
note, dark schematic, event cards, *Explain the math*); footer with limits and credits.

---

## 2. Gap between the current interface and the design specification

| Spec | Today | Change |
|---|---|---|
| §2 White paper, carbon text, one meaning per accent | Dark navy theme, decorative pastel accents | New token set (§4); recolour every element by meaning |
| §3 Sans text, Computer Modern math, Plex Mono code | `system-ui`; STIX math; no code | Bundle Inter, IBM Plex Mono, Latin Modern Math |
| §4 Continuous document, chapter index, 760–920 px column, numbered figures and equations | Two-column app grid, cards | Chapter layout with a sticky index; figures may bleed wider |
| §5 Precise vector diagrams from real coordinates | Math figures already SVG; schematic is a dark canvas | Schematic becomes SVG; unified stroke and label style |
| §6 Nine-step explanation per operation | Math panel has figure, equations, numbers, check | Add equation numbers, derivation disclosure, interpretation, labelled definitions/results |
| §7 Manipulate inside figures; linked highlighting | Controls only in the side column | Drag the pixel, the object and the light in figures; equation ⇄ figure highlights |
| §8 Shared state; expose intermediates; show source | Shared state already; no source view | Add CPU (TypeScript) and GPU (GLSL) listings per operation |
| §9 Lightweight document navigation; no big CTAs | Large pill buttons | Text buttons, compact sliders |

---

## 3. Target structure

Front matter and five chapters. The chapter index is a narrow sticky column on wide
screens and an inline list on narrow screens.

```
Follow a Pixel                                   (title block, no hero)
How does a game decide what a mirror shows?      (subtitle)
One-paragraph abstract.

§1  The picture
    Figure 1  The computed scene (the canvas host)          [status line as caption]
    Parameters  object x · centre sphere · camera  (+ More parameters)
§2  Follow one pixel
    Pixel selector  x [   ]  y [   ]   Inspect a computed mirror example   Reset
    Definition  The ray is traced backward, from the camera into the scene.
    Figure 2  Schematic of the computed path (SVG, oblique, draggable object/light)
    Steps 2.1 … 2.n  the recorded events, as a derivation
§3  The mathematics           (former "Explain the math", now a chapter)
    3.1 From a pixel to a ray        Figure 3, equations (3.1)–(3.5)
    3.2 The ray meets a surface      Figure 4, equations …
    3.3 The mirror bounce            …
    3.4 Is the light visible?        …
    3.5 How the path ends            …
    3.6 From light to screen color   …
§4  Implementation            (source listings: CPU TypeScript, GPU GLSL)
§5  Limits and credits
```

---

## 4. Design system

### 4.1 Colour: every accent has one meaning

| Token | Value | Meaning, and only this |
|---|---|---|
| `--paper` | `#FFFFFF` | Page background |
| `--paper-2` | `#F5F5F3` | Secondary surfaces: figure plates, parameter panel, code |
| `--ink` | `#171717` | Text, geometry, surfaces, normals |
| `--graphite` | `#62666B` | Secondary text, captions, units |
| `--construction` | `#9CA3AF` | Construction lines, grids, dimension lines, inactive geometry |
| `--signal` | `#D52232` | The followed camera ray **𝐃**, the selected pixel, selected intersections **𝐏** |
| `--science` | `#245BA7` | Secondary rays: reflected **𝐑** and the shadow ray **𝐋** |
| `--verified` | `#167438` | A recomputed value matching the tracer (and only that) |
| `--caution` | `#8A5A00` | Fallback / starting status text |

Grayscale shading is allowed **inside** physical illustrations (sphere curvature).
No gradients, glass, heavy shadows or rounded cards anywhere else.

### 4.2 Typography

| Role | Face | Size / weight |
|---|---|---|
| Text, headings, controls | Inter (variable, bundled) | body 17 px / 1.6; h1 40/600; chapter h2 26/600; section h3 19/600 |
| Mathematics | Latin Modern Math (Computer Modern), native MathML | display 1.15 em; inline 1.02 em |
| Code, computed numbers in tables | IBM Plex Mono (bundled) | 14 px |

Conventions: scalars italic, vectors bold upright, functions upright (`tan`, `max`),
true minus `−`, numbered equations `(3.4)` right-aligned, aligned `=` in derivations.

### 4.3 Space and rules

A 4 px grid: `--s1: 4px … --s8: 64px`. Related equation lines are 4–8 px apart; separate
ideas are 32–48 px apart. Use 1 px rules (`--rule: #E4E4E0`), never boxed cards.

**Example: `src/styles/tokens.css`**

```css
:root {
  --paper: #ffffff; --paper-2: #f5f5f3; --ink: #171717; --graphite: #62666b;
  --construction: #9ca3af; --signal: #d52232; --science: #245ba7; --verified: #167438;
  --rule: #e4e4e0; --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s6: 24px; --s8: 32px;
  --column: 840px; --font-text: 'Inter', system-ui, sans-serif;
  --font-math: 'FAP Math', 'Latin Modern Math', 'STIX Two Math', math;
  --font-code: 'IBM Plex Mono', ui-monospace, monospace;
}
```

---

## 5. Where to change, how, and what it looks like

### 5.1 Fonts: `src/styles/fonts/` and `src/styles/fonts.css` (new)

*How.* Copy the Latin subsets of Inter (variable) and IBM Plex Mono (400, 500) from
their OFL packages; subset Latin Modern Math to the glyphs the panel uses while
**keeping its OpenType MATH table**, and rename the subset (`FAP Math`) as the
font licence expects for modified fonts. Ship licence texts next to the files.
Use `font-display: swap`.

*Decision recorded.* The specification names KaTeX or MathJax. The interface keeps
**native MathML** with a Computer Modern font instead. It produces the same
typesetting, stays selectable and accessible, adds no runtime JavaScript, and needs
no `package.json` change (owned by AI 3). Switch to KaTeX only if a browser target
lacks MathML Core.

### 5.2 Theme: `src/styles/main.css`

*How.* Replace every hard-coded dark colour with tokens; delete card backgrounds and
pastel accents; rules instead of boxes.

*Like this.*

```css
/* before */ .events li { background: #172430; border-radius: 10px; }
/* after  */ .steps li { border-top: 1px solid var(--rule); padding: var(--s3) 0; }
```

### 5.3 Document structure: `src/ui/index.ts`

*How.* Build chapters as `<section id="ch-1" aria-labelledby=…>` with numbered `<h2>`;
add a `<nav class="toc">` with anchor links and a scroll-spy (`IntersectionObserver`)
that sets `aria-current="true"` on the visible chapter. Keep every hook in §0.

*Like this.*

```ts
const chapter = section('ch-2', '2', 'Follow one pixel');
chapter.append(definition('The ray is traced backward, from the camera into the scene. Physical light travels the other way.'));
```

### 5.4 Numeric pixel selector (missing from the plan's checklist)

*How.* Two `<input type="number">` fields (x, y) bound to the published inspection's
pixel and the drawing-buffer size. On change, call `actions.inspectAt((x + 0.5)/W,
(y + 0.5)/H)`. Keep the click and arrow-key paths.

### 5.5 Schematic: `src/ui/diagram.ts`

*How.* Draw the same `DiagramPlan` from `explain.ts` as SVG instead of a dark canvas.
Use `project()` and `screenMapper()` unchanged. Colour by meaning: path segments of
the camera ray in `--signal`, reflected and shadow segments in `--science`, normals in
`--ink`, construction in `--construction`. Label with serif math (𝐏₁, 𝐍, 𝐑).

### 5.6 Mathematics chapter: `src/ui/math-panel.ts`, `math-figures.ts`

*How.* Render the panel as chapter 3, not inside `<details>`. Number equations per
section. Each section follows the specification's nine steps:

```
3.3 The mirror bounce
  purpose ─ figure ─ caption ─ governing law (3.9) ─ derivation ▸ ─ numbers ─ result ─ interpretation ─ ✓ check
```

*Like this (equation numbering).*

```ts
numbered('3.9', math('reflection', v('R'), eq(), row(v('D'), minus(), mn('2'), paren(dotted(v('D'), v('N'))), v('N'))));
```

### 5.7 Linked highlighting (§7 of the spec)

*How.* Give corresponding equation terms and figure elements the same
`data-ref` (`delta`, `h`, `t`, `N`, `R`, `theta-i`, `phi`, `d`). On `pointerenter`
/ `focus` of either, add `is-linked` to every element with that `data-ref` in the
same section.

*Like this.*

```ts
term('delta', sqrt(mi('Δ')))          // equation side
f.dimension(P, foot, 30, label, { ref: 'delta' })   // figure side
```

Hovering √Δ in equation (3.8) highlights the half-chord in Figure 4, and the reverse.

### 5.8 Direct manipulation (§7)

| Figure | Drag | Dispatches |
|---|---|---|
| Fig. 3, image-space grid | the selected pixel | `actions.inspectAt(u, v)` |
| Fig. 2, schematic | the coloured sphere along x | `{ type: 'target-x', value }` (snapped to the control step) |
| Fig. 2, schematic | the light along x | `{ type: 'light-x', value }` |

All handles are keyboard operable (arrow keys) and show their value as text.

### 5.9 Source listings: `src/ui/source-view.ts` (new), chapter 4

*How.* Import the CPU tracer source with Vite's `?raw` (`src/core/index.ts?raw`) and
take the GPU source from `buildTraceFragmentSource()`. Extract named functions
(`nearestHit`, `trace`, `intersectSphere`, `shadeMatte`, …) and show them in
`<code class="listing">` inside a `<figure>`, never `<pre>`. Link each listing to its
equations (*"implements (3.6)–(3.8)"*).

---

## 6. Interaction and motion

Recalculate everything from the shared `ViewState` on each update; no number may
be stored separately from it. Transitions are limited to 120–180 ms opacity or
colour changes that show *what changed*. Honour `prefers-reduced-motion`. Every
pointer interaction has a keyboard equivalent and a text readout.

---

## 7. Phases and acceptance gates

Run after **every** phase: `npm run typecheck`, `npm test`, `node --test "tests/ui/*.test.ts"`,
`npm run build`, `npm run test:browser` (must match `main`: the same three
`fitBuffer` failures and nothing new), a real-control journey through every
control, and visual review at 1280 px and 390 px.

| Phase | Scope | Accept when |
|---|---|---|
| P1 Foundations | Tokens, fonts, light theme; no structural change | Every hook in §0 passes; text contrast ≥ 4.5:1; no network requests for fonts |
| P2 Editorial structure | Chapters, index with scroll-spy, reading column, numbered figures, subordinate controls, numeric pixel selector | Keyboard reaches every control in reading order; no horizontal scroll at 390 px |
| P3 Follow one pixel | SVG schematic; steps as derivation | Schematic built only from `DiagramPlan`; first `<canvas>` is still the image |
| P4 Mathematics | Chapter 3 with numbered equations, derivations, interpretations | All checks still green; numbers unchanged versus `math-model` tests |
| P5 Reactive | Drag pixel / object / light; linked highlighting | Drags dispatch real actions; keyboard equivalents exist |
| P6 Transparency | CPU and GPU listings | Listings come from the real sources, not copies; still one `<pre>` |
| P7 Handoff | Notes for AI 2, screenshots, honest limits | Branch pushed; nothing claimed that was not run |

---

## 8. Implementation record (branch `feature/editorial-ui`)

| Phase | Commit summary | Notes |
|---|---|---|
| P1 Foundations | Tokens, bundled fonts, paper theme | *FAP Math* = Latin Modern Math 1.959 subset with its OpenType MATH table (195 KB), renamed per the GUST Font License; Inter variable; IBM Plex Mono 400/500. Licences and a derivation README beside the files. |
| P2 Structure | Chapters, index with scroll-spy, numeric pixel selector, numbering | Scroll-spy handles the page-bottom and clicked-chapter edge cases. |
| P3 Follow one pixel | SVG schematic (Figure 2.1), derivation-style steps | Spheres are exact projected ellipses (semi-axes R√eig(LLᵀ)); scored label placement; legible minimum figure width on phones. |
| P4 Mathematics | Laws, assumptions, derivations, numbers, results, checks | Equations numbered (3.k) in a grid column; derivations aligned with an HTML grid of inline MathML. |
| P5 Reactive | Drag pixel / object / light; linked highlighting | All drags have keyboard equivalents and ARIA slider semantics. |
| P6 Transparency | Chapter 4 listings from the real CPU and GPU source | `?raw` import of `src/core`; GLSL from `buildTraceFragmentSource()`. |

**Deviations from the specification, and why**

- **Native MathML instead of KaTeX/MathJax.** Same typesetting with a Computer Modern font, selectable and accessible, no runtime script, no `package.json` change (AI 3 owns it). Browsers without MathML Core would need KaTeX.
- **Derivation alignment uses CSS grid, not `mtable`.** Measured in Chrome: `text-align` is ignored inside MathML table cells, and making the cells flex boxes collapses the table.
- **Delimiters stretch only around tall content.** Latin Modern's stretch variants are wider than its base glyphs and left gaps in single-line brackets.
- **Figures scroll inside their frame on narrow screens** (minimum ~600 px) rather than shrinking labels below ~9 px.

**Still open (not in the interface's ownership)**

- `fitBuffer` floors the drawing-buffer height (640×359 on many hosts). On this branch AI 3's browser suite passes 10/10 only because the test viewport's host now floors to 360. The `Math.round` fix is still needed in `src/core/frame.ts`.
- Safari, Firefox and phone hardware are not verified; MathML rendering differs most across engines.
