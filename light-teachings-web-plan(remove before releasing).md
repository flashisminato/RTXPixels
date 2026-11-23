# Light Teachings source review and two day web implementation plan

Build a small browser ray tracer that lets a visitor change a scene, select a pixel, and inspect the calculations that produced its color. Reproduce the source project's strongest visual effects—colored surfaces, moving hard shadows, and mirror reflections—with glass as a gated extension. Make the selected-pixel explanation the original contribution.

A complete Swift-to-JavaScript translation is not a credible two-day commitment. A focused implementation is credible for three people with working JavaScript skills, provided one person can debug a fragment shader and the team reserves time for integration. This plan assumes **two eight-hour working days per person: 48 person-hours total**, including testing and deployment. AI assistance can accelerate small modules; it does not remove the need to understand or test the mathematics.

Reviewed on 23 November 2026 at repository commit [`57260fe2a6badbc826271856bbcf6c8a2090de17`][commit]. The review covers the active Swift rendering and editing flow, shared data structures, active Metal shaders, dormant shader paths, sample scene, repository screenshots, and license. Findings about execution follow from source inspection; the native application was not built or run, and no browser performance measurements are claimed. The reference repository was downloaded into a separate inspection directory and left unmodified.

## What the original actually computes

The renderer draws a screen-covering strip of two triangles. Their fragment shader calculates scene geometry mathematically for each pixel. This is GPU ray tracing implemented in an ordinary graphics shader, not a mesh renderer with a reflection filter, and it does not invoke Metal's dedicated ray-tracing acceleration APIs in the active pipeline. [`Renderer.draw`][draw], [`vertexMain`][vertex], [`fragmentMain`][fragment]

The active sequence is:

1. SwiftUI controls edit a scene wrapper and emit an update description. `ContentView` forwards either a full scene replacement or a partial update to `RendererView`, then `Renderer` updates GPU scene data. [UI update routing][content]
2. `fragmentMain` constructs a perspective camera ray from pixel position, aspect ratio, field of view, camera position, and Euler rotation. It selects a shading model and shadow override. [Camera and model selection][fragment]
3. `RayTracer.sceneColoring` tests one scene bounding box; `rayScene` loops over analytic object intersections and tracks the closest hit. Reflective or transparent material flags can redirect the ray and restart traversal. [Traversal][traversal]
4. At the eventual ordinary surface, a ray toward a single point light tests visibility. The selected shading model calculates local light response. A miss uses a procedural sky or black. [Lighting and background][coloring]
5. An ACES-style fitted curve compresses brightness, then the result is converted to sRGB for display. [Tone mapping][tone], [sRGB conversion][srgb]

This is a **bounded, single-path ray tracer with direct lighting**. It does not implement diffuse global illumination, soft area-light shadows, caustics, or progressive Monte Carlo path tracing in the active render path. The presence of BRDF functions or a random-number generator does not establish those features. The random generator is used for optional camera jitter; the active draw loop has no previous-frame accumulation texture. [Tracing loop][traversal], [Jitter][fragment], [Draw loop][draw]

### Effects and their limits

| Visible behavior | Actual mechanism | Implication for the web app |
|---|---|---|
| Colored room and solid objects | Analytic intersections followed by material shading | Easy to reproduce with spheres and planes; boxes are optional |
| Sharp mirror image on a sphere | `reflect` redirects the viewing ray before final shading | Essential effect; implement actual secondary intersections |
| Distorted view through glass | `refract` and repeated scene traversal | Feasible only with controlled geometry and robust entry/exit handling |
| Hard shadow | One visibility ray to one point light | Essential, inexpensive, and easy to explain |
| Roughness and metalness | Cook–Torrance local BRDF in `BDRF.metal` | Changes direct highlights; does not create rough, blurred mirror reflections |
| Several render modes | BRDF, Phong, simple diffuse, hit mask, material color | Keep a small set of explanatory modes; defer full BRDF parity |
| Changing edges with anti-aliasing enabled | New subpixel jitter each frame | Do not copy this as temporal accumulation; it can shimmer without averaging |

Sources: [reflection and refraction branches][traversal], [lighting and shadows][coloring], [BRDF][brdf], [model dispatch][models], [camera jitter][fragment].

The supplied JSON has nine objects, nine materials, one mirror sphere, and one transparent sphere. It uses thin boxes for the room and a single light. This explains the repository's renderer screenshot, but the screenshot is a supplied artifact, not a freshly verified render. [Sample scene][sample], [Repository screenshot][screenshot]

### Features present in files but absent or narrower in the active path

- `fragment.metal` includes `RayTracer.metal`; its `RayMarcher.metal` include is commented out. `RayMarcher.metal` is itself commented code. Do not spend the deadline porting its signed-distance functions or constructive-solid-geometry operations. [Shader entry][fragment], [Dormant marcher][marcher]
- The active tracer supports sphere, box, plane, and cylinder intersections, but object IDs for rounded and outlined boxes both call ordinary `rayBox`. They do not produce those specialized shapes in this path. [Shape dispatch][dispatch]
- The UI's `availableObjects` exposes only sphere, box, and plane. Cylinder code existing in the repository does not mean it is available from the normal object picker. [Object availability][objects]
- The shared scene structure fixes capacity at 20 objects and 20 materials and contains one active light. That is a native packing choice, not a requirement for the web version. [Shared header][header]
- Xcode also lists `Archived Ideas` as a synchronized source group. Folder names alone therefore do not establish build exclusion; the decisive evidence is the active pipeline entry points and shader includes. [Xcode project][xcode], [Pipeline builder][pipeline]

## What to retain and what to redesign

The central learning mechanism should be: **a screen pixel is determined by where its viewing ray goes, including after a reflection**. Shadows can deepen the same idea by showing a second visibility query.

There are three assumptions to reject:

1. **A winning project's visual appearance makes a reproduction a strong entry.** The prior award establishes that this project won a different competition. It does not establish that a visually similar app meets your challenge's originality or two-minute-understanding criteria. The contribution should be an inspectable, computed explanation, not matching the screenshot.
2. **Line-by-line translation is the safest way to preserve behavior.** Here it would preserve intertwined traversal and material logic, native memory packing, and fragile edge cases. Preserve the intended geometry and optics; write a simpler browser architecture.
3. **Three people with AI assistants can deliver three independent chunks and merge at the end.** Camera conventions, scene layout, uniforms, and the ray inspector are shared contracts. Agree on them first and integrate during Day 1.

The earlier conversation's warning that using `Three.js.Raycaster` would automatically violate the rules was too categorical. The supplied rules allow open-source components, but require a mechanism implemented in your code and an explanation of component choices. Writing your own intersection and reflection functions makes the contribution clear. Three.js could still be used for display support; it is not necessary for this scope. This interpretation uses the rules quoted in your referenced conversation, not an independently verified current fairness policy.

### Proposed experience

Working title: **Follow a Pixel**. Opening question: **How does a game decide what a mirror shows?**

Show an original room palette, one mirror sphere, one colored sphere, a floor, and a movable light. Keep the first view ready to use. A visitor moves the colored sphere or camera and sees the mirror change. Selecting a pixel reveals the actual ray and intersection values in a separate diagram and short explanation.

Do not make “rotate the mirror sphere” the main control: rotating a perfectly uniform sphere does not change its geometry or reflection. Move the sphere or camera instead. A rotatable flat mirror would need a finite rectangle intersection and is a different, optional feature.

### Committed scope and optional fidelity

| Priority | Feature | Completion condition |
|---|---|---|
| Required | Perspective rays; spheres and planes | Aspect ratio, camera movement, nearest-hit behavior pass tests |
| Required | Colored room, matte surface shading, hard shadows | Moving a light changes brightness and shadow position correctly |
| Required | Perfect mirror sphere | Reflected objects move correctly; mirror follows the same scene data |
| Required | Pixel inspector | Computed hit sequence, normals, reflection direction, shadow result, and termination reason |
| Required | Controls and reset | Camera yaw, target position, light position, matte/mirror switch; bounded inputs |
| Required | Public static app | No visitor login, API key, download, or backend dependency |
| Required | Credits and limitations | Visible within the app, with source provenance in the repository |
| First extension | One glass sphere | Entry, exit, index of refraction, and total internal reflection pass tests |
| Later extension | AABB boxes | Robust parallel-axis and inside-origin tests; useful only after core is stable |
| Later extension | Cook–Torrance shading | Roughness clamped above zero; correct color space; clearly separate from mirror mode |
| Later extension | Four fixed subpixel samples | Average linear colors, then tone-map; disabled in exact-pixel inspection mode |
| Excluded | Full scene editor, cylinders, CSG, mesh imports, BVH, multiple lights, path tracing, caustics, accounts, AI chatbot | Do not put them on the two-day critical path |

Glass is a real part of the original appearance, so omitting it means **partial visual reproduction**, not full feature parity. If the three-person team already has shader experience, spend the allocated extension slot on glass. Otherwise deliver a stronger mirror explanation and state the limit plainly.

## File and function mapping

Paths in the first column are relative to the original `LightTeachings/` directory unless stated otherwise. The proposed files belong in a new repository.

| Original file and function | Responsibility | Proposed browser equivalent |
|---|---|---|
| `LightTeachingsApp.swift` | App/window and commands | `src/main.ts`: mount controls and canvas |
| `ContentView.swift`, `.onChange` handlers | Route state changes | `src/state/store.ts`: `updateScene`, `subscribe`, `reset` |
| `RendererSettings.swift`, `Structs/UpdateData.swift` | Observable scene, render size, changed item | `SceneState`, `sceneVersion`, dirty flag; avoid native update enums unless useful |
| `Views/RendererView.swift.makeNSView`, `MetalViewLayer.swift` | Native view bridge and drawing layer | `<canvas>` plus resize/context lifecycle in `src/render/webgl.ts` |
| `Renderer.init`, `attachToLayer`, `metalDisplayLink`, `draw` | GPU setup and frame submission | `createRenderer`, `requestAnimationFrame`, `renderIfDirty` |
| `Renderer.buildSceneBuffer`, `updateSceneBuffer`, `rebuildSceneBuffer` | Pack and refresh Metal scene data | `src/render/uniforms.ts`: validate and upload explicit typed arrays |
| `Builders/PipelineBuilder.swift.createPipeline` | Compile `vertexMain` and `fragmentMain` | `compileShader`, `linkProgram`, readable error surface |
| `Builders/SceneBuilder.swift.getScene`, `getNodeTree` | JSON decode and editor navigation | `src/scene/presets.ts`; optional validated JSON import later |
| `Builders/BoundingBoxBuilder.swift.fullBuild` | One bounding box around finite objects | Omit initially; loop over at most eight objects |
| `LightTeachings-Bridging-Header.h` | Shared geometry, materials, scene, hit structures | `src/core/types.ts` plus documented GLSL uniform fields |
| `Structs/SceneWrappers/*.swift` | Codable values and scene mutation | Plain typed objects, stable IDs, zero-based material indices |
| `Views/SceneTree.swift`, `Views/Editors/*.swift` | Selection and object/material/light controls | `src/ui/controls.ts`; fixed objects and focused controls first |
| `Views/Custom Edits/*.swift` | Numeric, enum, and switch widgets | Native range/number/select inputs with labels and validation |
| `MenuCommands/OpenFile.swift`, `SaveFile.swift` | Native file dialogs | Optional browser file input and JSON download; not required |
| `MenuCommands/Videos.swift` | External lessons | Original in-app guided experiment; credits may link to source lessons |
| `Shaders/vertex.metal.vertexMain` | Fullscreen geometry | `src/render/fullscreen.vert`: attribute-based fullscreen triangle |
| `Shaders/fragment.metal.fragmentMain` | Camera ray, render mode, tracer call | `src/render/trace.frag.main`, shared camera basis uniforms |
| `Shaders/Rotations.metal.Rotate.rotate` | Euler camera rotation | `src/core/camera.ts`: explicit look-at basis; avoid implicit matrix convention copying |
| `Shaders/RayTracer.metal.raySphere`, `rayPlane` | Analytic intersections | Matching `intersectSphere`, `intersectPlane` in TypeScript and GLSL |
| `rayBox`, `rayCylinder` | Other primitives | `intersectAabb` optional; omit cylinder |
| `rayBBox`, `rayScene` | Coarse culling, nearest hits, redirects | Separate `nearestHit`, `occluded`, `traceRay`; no global culling in MVP |
| `sceneColoring`, `getSkyColor`, `getColor` | Local shading, miss color, display conversion | `traceLinear`, `shadeMatte`, `sky`, `encodeDisplay` |
| `Shaders/Modelinator.metal.color`, `setShadowOverride` | Shading dispatch | Small `uViewMode` switch plus explicit shadow toggle |
| `Shaders/Models/SimpleShading.metal.color`, `Phong.metal.color` | Local diffuse/specular response | Lambert diffuse required; restrained Phong highlight optional |
| `Shaders/Models/BDRF.metal`: `distributionGGX`, `geometrySchlickGGX`, `geometrySmith`, `fresnelSchlick`, `color` | Microfacet shading | Optional `shadeCookTorrance`; preserve function provenance if adapting |
| `Shaders/Models/Hit.metal.color`, `HitColor.metal.color` | Hit and albedo diagnostics | First-hit mask and object-color modes; label their deliberate semantics |
| `Shaders/SRGB.metal`, `ToneMapping.metal` | Color conversion and tone mapping | `src/core/color.ts` and GLSL equivalents; one output conversion |
| `Shaders/Random.metal.setSeed`, `PCGHash`, `rnd2` | Per-frame jitter | Omit in core; fixed supersampling requires no temporal RNG |
| `Shaders/RayMarcher.metal`, repository `Archived Ideas/` | Alternate experiments | Reference only; no port |

Source anchors: [Swift routing][content], [Renderer setup and packing][renderer], [Pipeline][pipeline], [Scene builder][builder], [Header][header], [Geometry and traversal][raytracer], [Shader models][models].

## Source issues the rewrite should avoid

These are source-level observations and failure risks, not claims of crashes reproduced in the native app.

| Source behavior | Why a direct port is risky | Proposed correction |
|---|---|---|
| `raySphere` accepts only `discriminant > 0` | Exact tangent intersections are excluded | Accept nonnegative discriminant, with documented floating-point tolerance |
| `rayScene` reads `currentHit.materialIndex` before confirming `currentHit.hit` | Miss records do not consistently initialize that field | Return a fully initialized miss; fetch material only after a successful nearest hit |
| `sceneColoring` computes ambient and shadow data before its final hit check | Miss paths can read hit position, normal, or material data that was not assigned | Return sky immediately on miss |
| Reflection/refraction restart the object loop using mutable indices | Hard to reason about nearest hit, budgets, and order independence | Finish each nearest-hit query, then choose one outgoing direction |
| `rayBox` never sets `isInside` true and derives its normal from entry slabs | Inside-to-outside glass traversal can use the wrong normal | Track outward normal and `frontFace` explicitly; initially allow glass only on a sphere |
| Refraction has no explicit total-internal-reflection branch | A zero/invalid transmitted direction may be normalized | Compute the discriminant and reflect when transmission is impossible |
| Initial bounding-box miss restricts `rayScene` to planes | A later bounce from a plane can incorrectly remain restricted to planes | Re-evaluate acceleration per ray, or simply omit it at eight objects |
| Nearest transparent shadow blocker suppresses shadow | An opaque blocker farther toward the light may be missed | Core treats surfaces as opaque; glass extension searches all opaque blockers and documents approximate glass shadows |
| Material references are one-based; native arrays have fixed capacity | Zero-based JS arrays and unrestricted UI edits can disagree | Validate zero-based indices and object limits before upload |
| `buildSceneBuffer` copies 20 object/material strides although the sample arrays contain nine entries | Raw native memory copying requires assumptions that should not cross into the browser design | Upload explicit validated numeric arrays with active counts |
| BRDF roughness can reach zero; input/display color treatment is mixed | Singular highlights or inconsistent comparisons | Clamp roughness and define one linear-light pipeline |

Evidence: [sphere and box][intersections], [traversal and refraction][traversal], [ambient, shadows, and miss handling][coloring], [header capacities][header], [native packing][renderer], [sample arrays][sample], [BRDF][brdf].

## Browser architecture and shared contracts

Use **Vite, TypeScript, a WebGL2 fragment shader, and a small Canvas2D inspector**. Use the team's familiar UI framework only if it already speeds them up. WebGL2 supplies the graphics context; the analytic ray calculations remain your own GLSL code. [WebGL2 specification][webgl]

Keep two implementations of the small tracing core: GLSL for all image pixels, and TypeScript for one inspected pixel, unit tests, and a low-resolution fallback. The danger is disagreement between them; shared fixtures, camera basis, material definitions, and tolerance rules are required. Do not build a shader code generator within this deadline.

```text
controls → validated SceneState → packed uniforms → WebGL image
                    ↓
     selected framebuffer pixel → TypeScript trace → diagram + explanation
```

### Contract to freeze in the first hour

- World coordinates: Y up; initial camera looks toward positive Z. Compute `forward = normalize(target-position)`, `right = normalize(cross(worldUp, forward))`, and `up = cross(forward, right)`. Clamp camera elevation away from the pole.
- Use normalized ray directions. Scene dimensions stay within roughly ±10 units. Use a shared surface epsilon of `1e-4` initially, then test grazing rays; an import system supporting arbitrary scale would require a stronger policy.
- A hit contains `objectId`, `materialIndex`, `t`, `point`, `outwardNormal`, `frontFace`, and `normal` facing against the incoming ray. A miss has no valid material.
- Materials use a single `mode: matte | mirror | glass`. Do not expose conflicting independent “reflective” and “transparent” booleans. Colors are converted from UI sRGB to linear once.
- Set `MAX_OBJECTS = 8`, `MAX_MATERIALS = 8`, and `MAX_REDIRECTS = 4`. The first hit does not count as a redirect. A final matte hit after four redirects is still shaded.
- Start with five room planes and two spheres, or a simpler floor-and-backdrop preset. Controls cannot put the camera inside opaque room geometry or overlap glass with another object.
- Fixed presets are scene inputs, not stored rendered outputs. The image and explanation are recomputed on every relevant edit.
- Use flat uniform arrays with documented field meanings; query implementation limits on startup and test the compiled program. Do not port Swift's binary layouts or array memory copying.
- Store `sceneVersion`; discard stale inspector/fallback results when a new edit arrives. UI state is the single source of truth.

Use this explicit upload layout for the core rather than adapting native struct bytes:

| Browser uniform | Fields and meaning |
|---|---|
| `uObjectA[8]`, vec4 | XYZ = sphere center or point on plane; W = sphere radius, ignored for planes |
| `uObjectB[8]`, vec4 | XYZ = unit plane normal, ignored for spheres; W = type code 0 sphere / 1 plane |
| `uObjectMaterial[8]`, int | Zero-based material index |
| `uAlbedo[8]`, vec3 | Linear RGB color |
| `uMaterialMode[8]`, int | 0 matte / 1 mirror / 2 glass |
| `uIor[8]`, float | Glass index of refraction; ignored for other modes |
| Scalars and vectors | Active object/material counts; camera position/basis/FOV; light position/color/intensity; ambient strength; drawing-buffer size; view mode and redirect budget |

Cap FOV at 20–100 degrees and sphere radius at 0.1–1.5 units for the authored presets. Fill unused slots with safe values but iterate only the active count. If boxes are added, revise this contract explicitly and update both tracers and packing tests together.

Suggested interfaces:

```ts
type Ray = { origin: Vec3; direction: Vec3 };
type TraceResult = {
  linearColor: Vec3;
  events: TraceEvent[]; // intersections, redirects, shadow query, termination
  termination: 'surface' | 'sky' | 'budget';
};

nearestHit(scene, ray, tMin, tMax): Hit | null;
traceRay(scene, ray, maxRedirects): TraceResult;
render(scene, framebufferSize, viewMode): void;
inspectPixel(scene, pixelX, pixelY, framebufferSize): TraceResult;
```

For ordinary viewing, render one stable sample per pixel to the default framebuffer. No floating-point render target or accumulation extension is needed. If progressive accumulation is ever added later, use separate read/write targets, reset on scene/camera/size changes, and feature-detect floating-point renderability. That is outside the committed build. [Float render-target extension][float]

## Algorithm pseudocode

This is a new, simplified design, not a literal transcription of the original shader.

### Camera ray

Here `(px, py)` are integer pixel coordinates from the top left of the actual drawing buffer; GLSL `gl_FragCoord` has its origin at the bottom left, so convert consistently.

```text
cameraRay(px, py, width, height):
    sx = (2 * (px + 0.5) / width - 1) * width / height
    sy = 1 - 2 * (py + 0.5) / height
    scale = tan(verticalFovRadians / 2)
    D = normalize(forward + sx * scale * right + sy * scale * up)
    return Ray(cameraPosition, D)
```

Pointer selection must use the canvas content rectangle, then scale CSS coordinates into drawing-buffer coordinates and clamp to valid pixel indices. A selected pixel means the central sample of that pixel. If supersampling is added, inspection mode returns to one sample rather than claiming that one ray explains an average of four.

### Sphere and plane intersections

```text
intersectSphere(ray, center, radius, tMin, tMax):
    oc = ray.origin - center
    a = dot(D, D)
    halfB = dot(oc, D)
    c = dot(oc, oc) - radius * radius
    delta = halfB * halfB - a * c
    if delta < 0: return MISS
    t = (-halfB - sqrt(delta)) / a
    if t <= tMin or t >= tMax:
        t = (-halfB + sqrt(delta)) / a
        if t <= tMin or t >= tMax: return MISS
    P = O + t * D
    outward = normalize(P - center)
    frontFace = dot(D, outward) < 0
    N = frontFace ? outward : -outward
    return initialized hit record

intersectPlane(ray, pointOnPlane, unitNormal, tMin, tMax):
    denominator = dot(D, unitNormal)
    if abs(denominator) < 1e-6: return MISS
    t = dot(pointOnPlane - O, unitNormal) / denominator
    if t <= tMin or t >= tMax: return MISS
    return initialized hit with face-forward normal

nearestHit(scene, ray, tMin, tMax):
    best = MISS
    closest = tMax
    for each supported object:
        h = intersect(object, ray, tMin, closest)
        if h exists:
            best = h
            closest = h.t
    return best
```

Use a stable quadratic-root variant if cancellation appears in tests; with this small, bounded scene the straightforward version is a practical starting point. For near-zero discriminants, adopt the same tolerance in CPU and GPU code rather than independently rounding them.

### Mirrors, local shading, and shadows

```text
traceLinear(scene, ray, maxRedirects):
    events = []
    for encounter from 0 through maxRedirects inclusive:
        hit = nearestHit(scene, ray, EPS, FAR)
        if no hit:
            record sky termination
            return sky(ray.direction)

        record hit position, object, normal, incoming direction
        material = scene.materials[hit.materialIndex]

        if material.mode == MATTE:
            return shadeMatte(scene, hit, material)

        if encounter == maxRedirects:
            record budget termination
            return black  // explicit approximation, never invent a sky hit

        if material.mode == MIRROR:
            nextD = normalize(D - 2 * dot(D, hit.normal) * hit.normal)
            record reflection
        else:
            nextD = glassDirection(D, hit, material.ior)
            record refraction or total internal reflection

        side = dot(nextD, hit.outwardNormal) >= 0 ? 1 : -1
        nextO = hit.point + side * EPS * hit.outwardNormal
        ray = Ray(nextO, nextD)

shadeMatte(scene, hit, material):
    shadowOrigin = hit.point + EPS * hit.normal
    delta = light.position - shadowOrigin
    distance = length(delta)
    L = delta / max(distance, EPS)
    blocked = any opaque intersection of Ray(shadowOrigin, L)
              with EPS < t < distance - EPS
    record shadow segment and blocker, if any
    ambient = ambientStrength * material.linearAlbedo
    direct = material.linearAlbedo / PI
             * light.linearColor * light.intensity
             * max(dot(hit.normal, L), 0)
             / max(distance * distance, 0.01)
    return ambient + (blocked ? black : direct)
```

Core mirror mode is a perfect, untinted reflector. Local Phong highlights, if added, apply to matte materials; they are not a replacement for tracing the scene reflected in a mirror. Ambient light is a deliberate approximation, not computed interreflection.

Do not use GLSL recursion. Implement the encounter loop with a compile-time maximum and a user-selected lower budget. Keep the material lookup and all normal use after the successful-hit branch.

### Glass extension

Restrict the extension to one non-overlapping glass sphere in air. Track entry and exit with `frontFace`; a nested-medium stack is unnecessary under that restriction.

```text
glassDirection(D, hit, ior):
    N = hit.normal                       // faces against incoming D
    eta = hit.frontFace ? 1 / ior : ior
    cosI = clamp(dot(-D, N), 0, 1)
    k = 1 - eta * eta * (1 - cosI * cosI)
    if k < 0:
        return normalize(D - 2 * dot(D, N) * N)  // total internal reflection
    return normalize(eta * D + (eta * cosI - sqrt(max(k, 0))) * N)
```

Limit the IOR control to 1.0–2.4. This model bends a single ray and handles total internal reflection. It does **not** split energy into simultaneous Fresnel reflection and transmission, model absorption, or focus caustics. Label it “simplified refraction.” For shadows, skip the glass sphere and continue checking opaque blockers; say explicitly that glass light transport is approximated. Do not reuse the source's “nearest transparent hit means unshadowed” shortcut.

### Color and optional antialiasing

Compute light response in linear RGB. Tone-map once, then convert to display sRGB once. A simple Reinhard curve `c / (1 + c)` is sufficient for the core; an attributed ACES fit is a later fidelity option. Debug hit-mask output should bypass tone mapping so white really is white.

If four-sample antialiasing is added, trace fixed offsets `(0.25,0.25)`, `(0.75,0.25)`, `(0.25,0.75)`, `(0.75,0.75)` within each pixel; average linear radiance before display conversion. Browser multisampling of the fullscreen triangle will not solve analytic sphere-edge aliasing inside the fragment shader.

## UX and the two minute explanation

Use one large rendered image, three prominent controls, and a collapsible explanation. Keep advanced material settings out of the opening view.

| Visitor time | Interaction | What the app must communicate |
|---|---|---|
| 0–15 seconds | Drag the colored sphere's position slider | “Move this object. Watch its reflection move.” |
| 15–35 seconds | Click the mirror or choose “Inspect a mirror pixel” | Highlight the selected pixel and show which surface it first hits |
| 35–65 seconds | Step through Camera → Mirror → Object | Show the normal and outgoing direction with plain-language labels |
| 65–95 seconds | Move the light | The final surface gets brighter/darker; a blocker can remove direct light |
| 95–120 seconds | Toggle the mirror to matte or change the bounce budget | The image changes because the ray takes a different path, not because a stored picture is swapped |

The suggested times are design targets, not measured usability results. Test them with two people who have not seen the project; provide no spoken guidance.

The inspector should use a separate oblique schematic view. Drawing a viewing ray directly over its own camera image makes much of the line collapse into the selected pixel, which is poor teaching. Project the actual recorded 3D hit points into the schematic and label depth; do not substitute invented paths. A movable dot may animate along the computed segments, but the segments themselves must come from the tracer.

Show a compact event list such as “Camera → mirror sphere → blue wall → light visible,” with actual distances, `N·L`, and reflection-angle values behind an “Explain the math” toggle. Clearly say the algorithm traces backward from the camera; physical light travels toward the camera.

For accessibility, provide keyboard-operable sliders and buttons, visible focus, text alongside color-coded rays, and a numeric pixel selector. Use at least 44-pixel touch targets. Stack controls below the canvas on narrow screens. Avoid automatic camera movement and respect reduced-motion settings. Reset must restore a useful scene and selected pixel in one action.

## Two day team schedule

Person A owns the GPU renderer and GLSL. Person B owns state, controls, layout, and the ray diagram. Person C owns the TypeScript reference math, tests, integration, and deployment. All three agree on contracts; C is the merge coordinator, not the only person who understands the whole project.

Each row is a two-hour shared work block, totaling six person-hours. The schedule therefore totals **48 person-hours** and includes the final test and contingency time.

| Work block | Person A | Person B | Person C | Required integrated result |
|---|---|---|---|---|
| Day 1 hours 0–2 | Shared contract, fullscreen shader, camera rays | Shared contract, canvas shell, controls layout | Shared contract, repo/build setup, sphere/plane reference tests | Static shell deployed; shader compiles; everyone uses the same scene |
| Day 1 hours 2–4 | Sphere/plane closest-hit and matte shading | Connect live camera/object/light controls | CPU intersections, normals, camera fixtures | Editable, shaded scene on public preview URL |
| Day 1 hours 4–6 | Mirror loop and hard shadows | Pixel selection and diagram from real events | CPU reflection/shadows, GPU debug comparisons | One selected pixel agrees with its displayed image |
| Day 1 hours 6–8 | Fix graphics edge cases; tune preset | Guided flow, reset, responsive layout | Integrate, browser smoke tests, CPU fallback | Complete mirror demonstration works end to end |
| Day 2 hours 0–2 | Glass only if Day 1 gate passed; otherwise fix core | Inspector labels, keyboard support, comprehension refinements | Glass reference tests or unresolved core tests | Extension passes its gate or is removed from visible UI |
| Day 2 hours 2–4 | Performance tuning and selected-pixel parity | Two uncoached user trials; fix confusing interactions | Browser/device matrix, regression checks | Feature freeze; no unexplained mismatch |
| Day 2 hours 4–6 | Cross-review math and limitations | Final visual polish, project page and demo capture | Production deployment, link and build verification | Release candidate, public repo, credits, demo draft |
| Day 2 hours 6–8 | Fix release blockers and rehearse code explanation | Fix release blockers and rehearse product explanation | Fresh-device smoke test, submission checks, rollback preparation | Stable final link and required submission materials |

### Gates and scope cuts

- **End of Day 1 hour 4:** a changed input must produce a computed image on the public preview. If the shader is still blocked, A and C pair on it while B continues UI. Use the CPU renderer at low resolution as the immediate fallback.
- **End of Day 1:** mirror, shadow, state updates, and one real inspected pixel must all work together. If not, remove glass, boxes, BRDF, and antialiasing from Day 2.
- **End of Day 2 hour 2:** glass must pass entry/exit/TIR fixtures in both implementations. If not, remove its selector and glass preset. A hidden broken feature still creates maintenance risk; keep it out of the release path.
- **End of Day 2 hour 4:** freeze features. Remaining time is for correctness, comprehension, public-link verification, and submission artifacts.

Use short branches by file ownership and merge every two hours. Each AI-assisted task should name allowed files, the shared types, expected numerical fixtures, and the behaviors it must not change. Require its owner to explain the geometry, the miss case, the self-intersection offset, and its tests before merging. Keep a factual AI-use/contribution log if the competition asks for it; never claim generated or adapted code was written unaided.

## Tests and acceptance criteria

These are tests to implement during the build; they have not been run against a web app in this research task.

| Test | Fixture or action | Expected result |
|---|---|---|
| Sphere nearest root | O=(0,0,-3), D=(0,0,1), sphere center 0, radius 1 | t=2; point=(0,0,-1); outward normal=(0,0,-1) |
| Sphere inside exit | O=(0,0,0), same D and sphere | t=1; `frontFace=false`; face-forward normal=(0,0,-1) |
| Tangent | O=(1,0,-3), same D and sphere | t=3; accepted under documented tolerance |
| Sphere miss | O=(2,0,-3), same D and sphere | Miss; no material lookup |
| Plane | O=(0,1,0), D=(0,-1,0), plane y=0 | t=1; parallel ray returns miss |
| Reflection | D=(1,-1,0)/sqrt(2), N=(0,1,0) | R=(1,1,0)/sqrt(2); unit length; equal angles |
| Closest-hit order | Two overlapping-in-view spheres; reverse object array | Same nearest geometry and color, except explicitly defined exact ties |
| Shadow segment | Surface y=0, light y=3; blocker y=1 versus y=5 | Near blocker shadows; object beyond light does not |
| Self-intersection | Ray leaves its mirror surface at normal and grazing angles | No immediate spurious same-surface hit or shadow acne |
| Budget | Two facing reflective surfaces | Guaranteed termination; inspector reports budget, not a fabricated surface |
| Empty scene | No objects | Sky or black; no invalid array access or NaNs |
| Camera/selection parity | Center, corners, resize, browser zoom, high-DPI display | CPU-selected ray corresponds to the same GPU pixel |
| Glass normal incidence | Ray through sphere center; IOR 1.5 | Entry and exit stay collinear |
| Glass oblique entry | Air to glass, 30° incidence, IOR 1.5 | Refracted angle about 19.47° to the normal |
| Total internal reflection | Glass to air at 50°, IOR 1.5 | Reflects; critical angle is about 41.81°; no zero direction |
| Glass shadow approximation | Glass before an opaque blocker | Opaque blocker still detected |
| Input validity | Zero radius, NaN, extreme FOV, invalid material index | Reject or clamp before upload; informative UI state |

Use unit assertions around `1e-5` for ordinary unit-scale CPU fixtures; compare GPU numeric diagnostics around `1e-3` where appropriate. Avoid silhouette pixels and exact ties when asserting CPU/GPU agreement. Those require separate boundary tests.

For GPU integration tests, a debug shader can encode object ID, normal, or depth into RGBA8; read back a small number of chosen pixels. A byte-level object-ID check and known-normal colors can catch camera, index, and orientation errors without demanding a floating-point framebuffer. Do readbacks in tests, not continuously in the interaction loop. [WebGL synchronization guidance][best]

Visual acceptance should include independently specified scene behavior rather than pixel equality with the source screenshot: moving a target moves its reflection; moving the light moves its shadow; a selected ray terminates on the surface whose color is shown; a normal at the top of a sphere points up. Capture screenshots at a fixed scene, size, and sample count for regression review, with tolerance for browser differences.

Browser checks: current desktop Chrome/Edge, Safari on macOS, and Firefox where available, plus one actual phone. Record browser/device names and observed limits. A mobile viewport in desktop developer tools is useful but does not verify mobile GPU behavior.

Performance targets, to measure rather than promise: aim for at least 30 frames/s during dragging at 640×360 on the team's ordinary laptop, input feedback within 100 ms, and no persistent allocations in the render loop. Start with one sample and lower the drawing buffer to 480×270 or 320×180 if needed. Render on demand while idle. Resolution scaling is a standard WebGL performance tradeoff. [WebGL guidance][best]

If WebGL2 is unavailable or context creation fails, use the TypeScript tracer to compute a 160×90 Canvas2D preview in short chunks, cancel stale work, and retain all controls and inspection. Label it “Low-resolution mode.” Do not claim real-time fallback performance before measurement. Handle context loss by pausing and restoring resources, or switching to fallback rather than leaving a blank canvas.

## Deployment and submission

Use a new repository and static hosting such as GitHub Pages. Deploy the empty shell during the first work block, not at the end. The deliverable does not need an account system, database, server, or AI API.

The production workflow should install locked dependencies, run math tests and type checks, build with Vite, and publish `dist`. For a GitHub Pages project URL, set Vite's `base` to the repository subpath. `vite preview` is for local verification, not production hosting. Follow the current official deployment guide rather than copying an old workflow version. [Vite static deployment][deploy]

Before submission, open the production URL in a logged-out/private browser and on a second device. Check fresh loading, asset paths, sliders, pixel selection, reset, context fallback, credits, and mobile layout. Bundle required assets locally; avoid runtime CDN dependencies and remotely fetched lessons for the core interaction. Keep the deployment available through judging and preserve the last good release for rollback.

The rules quoted in the referenced conversation call for a live link, public repository, project page, and short demo video. Prepare all four. Verify the organizer's current form, Terms, and fairness policy before submission; an MIT license does not itself establish competition eligibility. The quoted deadline is 25 November at 23:59 AoE. If that date is the intended 2026 deadline, it corresponds to **26 November 2026 at 19:59 in Singapore**. Confirm it against the actual submission form and set an internal cutoff earlier.

## Attribution and originality

The repository README identifies **Kia Preston (pkncoder)**. Its MIT notice is exactly **“Copyright (c) 2025 Kia”**. The official award page names **Alexander Preston**. Preserve the repository's author credit and copyright notice as published; do not silently rewrite the notice to match the award article. [Repository README][readme], [MIT license][license], [Official award page][award]

For copied or adapted substantial source portions, retain the complete upstream MIT text in a third-party notice file and distribute it with the app's source/build notices. Identify the exact upstream commit and adapted functions. Credit alone is not a substitute for retaining the license notice. The repo's resource list and shader comments also identify earlier sources, including Demofox, LearnOpenGL, and Inigo Quilez; check and preserve relevant notices when directly adapting their code. [License][license], [Resource list][resources], [BRDF provenance][brdf], [Cylinder provenance][intersections]

Suggested in-app credit:

> Inspired by Light Teachings by Kia Preston (pkncoder). This independent browser project explores ray-traced reflections through an interactive pixel inspector. See Credits for source references, adapted components, and licenses.

The Credits page should distinguish **inspiration**, **code adaptations**, **dependencies**, and **your team's additions**. If shader functions were translated from the original, say so specifically; do not describe the engine as wholly original. Use your own name, layout, scene design, explanatory text, examples, screenshots, and demo video. Link to the original videos rather than reusing them as your teaching content.

The defensible original contribution is the complete experimental loop: change a scene → inspect a pixel → see the computed ray and shadow decision → predict and test the next change. A polished mirror effect without that loop would reproduce the appearance while missing the educational opportunity.

[commit]: https://github.com/pkncoder/Light-Teachings/tree/57260fe2a6badbc826271856bbcf6c8a2090de17
[readme]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/README.md
[renderer]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Renderer.swift#L38-L195
[draw]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Renderer.swift#L205-L294
[vertex]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/vertex.metal#L5-L21
[fragment]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/fragment.metal#L1-L86
[content]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/ContentView.swift#L54-L74
[traversal]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/RayTracer.metal#L206-L357
[coloring]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/RayTracer.metal#L364-L413
[tone]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/ToneMapping.metal#L5-L18
[srgb]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/SRGB.metal#L18-L39
[brdf]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/Models/BDRF.metal#L5-L78
[models]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/Modelinator.metal#L25-L73
[sample]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/scenes/objects.json
[screenshot]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/Assets/RealTimeRenderer.png
[marcher]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/RayMarcher.metal
[dispatch]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/RayTracer.metal#L223-L255
[objects]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Structs/Objects.swift#L48-L56
[header]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/LightTeachings-Bridging-Header.h#L6-L107
[xcode]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings.xcodeproj/project.pbxproj#L100-L126
[pipeline]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Builders/PipelineBuilder.swift
[builder]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Builders/SceneBuilder.swift
[raytracer]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/RayTracer.metal
[intersections]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LightTeachings/Shaders/RayTracer.metal#L21-L187
[webgl]: https://registry.khronos.org/webgl/specs/latest/2.0/
[float]: https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float
[best]: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
[deploy]: https://vite.dev/guide/static-deploy.html
[license]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/LICENSE
[award]: https://www.congressionalappchallenge.us/25-oh09/
[resources]: https://github.com/pkncoder/Light-Teachings/blob/57260fe2a6badbc826271856bbcf6c8a2090de17/RESOURCES.md
