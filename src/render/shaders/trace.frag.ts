import {
  EPS,
  FAR,
  PARALLEL_EPS,
  MAX_OBJECTS,
  MAX_MATERIALS,
  MAX_REDIRECTS,
  MAX_EXTRA_LIGHTS,
} from '../constants';

/**
 * Options controlling which variant of the tracing shader is generated.
 */
export type FragmentSourceOptions = {
  /**
   * Compile the integration-test variant. It adds `uDebugMode` and raw
   * normal / object-id outputs. The production program is built with
   * `debug: false`, so none of that code exists in the shipped shader.
   */
  debug?: boolean;
};

/**
 * Build the tracing fragment shader.
 *
 * Design notes, and where this deliberately diverges from the original Metal
 * source (`LightTeachings/Shaders/RayTracer.metal`, commit 57260fe):
 *
 * - The original restarts its object loop with mutable indices on every
 *   reflection, so "nearest hit" and "bounce" are interleaved. Here each
 *   nearest-hit query runs to completion, and only then does the encounter
 *   loop choose one outgoing direction. Same optics, far easier to reason
 *   about and to match against a CPU reference.
 * - `raySphere` in the original accepts only `discriminant > 0.0`, which drops
 *   exact tangent rays. Contract v1 accepts `>= 0.0`.
 * - The original reads `scene.materials[currentHit.materialIndex - 1]` before
 *   confirming `currentHit.hit`, so miss records index with an unassigned
 *   field. Here every material fetch is inside a confirmed-hit branch.
 * - `sceneColoring` computes ambient and shadow terms before its final hit
 *   test. Here a miss returns sky immediately.
 * - Camera rotation came from Euler angles in `Rotations.metal`. Here the
 *   camera basis arrives as explicit uniforms from AI 3, so CPU and GPU cannot
 *   disagree about convention.
 *
 * Adapted mathematics: the analytic sphere and plane intersection forms follow
 * the standard quadratic / plane-equation derivations also used by the source.
 * Provenance is recorded in docs/handoffs/ai1.md.
 */
export function buildTraceFragmentSource(options: FragmentSourceOptions = {}): string {
  const debug = options.debug === true;

  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;

#define MAX_OBJECTS ${MAX_OBJECTS}
#define MAX_MATERIALS ${MAX_MATERIALS}
#define MAX_REDIRECTS ${MAX_REDIRECTS}
#define MAX_EXTRA_LIGHTS ${MAX_EXTRA_LIGHTS}

#define EPS ${glslFloat(EPS)}
#define FAR ${glslFloat(FAR)}
#define PARALLEL_EPS ${glslFloat(PARALLEL_EPS)}
#define PI 3.141592653589793

#define OBJECT_SPHERE 0
#define OBJECT_PLANE 1

#define MODE_MATTE 0
#define MODE_MIRROR 1

#define VIEW_BEAUTY 0
#define VIEW_HIT 1
#define VIEW_ALBEDO 2
${debug ? '\n#define DEBUG_VARIANT 1\n' : ''}
out vec4 fragColor;

// ---------------------------------------------------------------------------
// Uniforms. Explicit validated fields: no native struct packing is reproduced.
// ---------------------------------------------------------------------------

// xyz = sphere centre, or a point on the plane. w = sphere radius (planes: unused).
uniform vec4 uObjectA[MAX_OBJECTS];
// xyz = unit plane normal (spheres: unused). w = type code, 0 sphere / 1 plane.
uniform vec4 uObjectB[MAX_OBJECTS];
// Zero-based index into the material arrays.
uniform int uObjectMaterial[MAX_OBJECTS];

// Linear RGB. Never sRGB at this point in the pipeline.
uniform vec3 uAlbedo[MAX_MATERIALS];
// 0 matte / 1 mirror. Glass is not part of contract v1.
uniform int uMaterialMode[MAX_MATERIALS];

uniform int uObjectCount;
// NOTE: there is deliberately no uMaterialCount uniform. The shader only ever
// reaches a material through a confirmed hit's index, and packScene already
// rejects out-of-range indices on the CPU, so the count is never read here.
// Declaring it would be dead code that drivers legitimately strip, which in
// turn trips the renderer's missing-uniform link check.

uniform vec3 uCameraOrigin;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uTanHalfFov;

uniform vec3 uLightPosition;
uniform vec3 uLightColor;      // linear RGB
uniform float uLightIntensity;
// Extra point lights; only the first uExtraLightCount entries are read.
uniform vec3 uExtraLightPosition[MAX_EXTRA_LIGHTS];
uniform vec3 uExtraLightColor[MAX_EXTRA_LIGHTS];   // linear RGB
uniform float uExtraLightIntensity[MAX_EXTRA_LIGHTS];
uniform int uExtraLightCount;
uniform float uAmbient;

uniform vec3 uSkyBottom;       // linear RGB
uniform vec3 uSkyTop;          // linear RGB

uniform vec2 uResolution;      // drawing-buffer size in pixels
uniform int uViewMode;
uniform int uMaxRedirects;
${debug ? 'uniform int uDebugMode;   // test-only: 0 off, 1 normals, 2 ids\n' : ''}
// ---------------------------------------------------------------------------
// Hit record. Mirrors the shared Hit type, minus the string object id.
// ---------------------------------------------------------------------------

struct Hit {
  bool did;
  int objectIndex;
  int materialIndex;
  float t;
  vec3 point;
  vec3 outwardNormal;
  vec3 normal;        // always faces against the incoming direction
  bool frontFace;
};

Hit missRecord() {
  // Fully initialised. A miss must never carry a readable material index.
  Hit h;
  h.did = false;
  h.objectIndex = -1;
  h.materialIndex = -1;
  h.t = FAR;
  h.point = vec3(0.0);
  h.outwardNormal = vec3(0.0, 1.0, 0.0);
  h.normal = vec3(0.0, 1.0, 0.0);
  h.frontFace = true;
  return h;
}

// ---------------------------------------------------------------------------
// Intersections
// ---------------------------------------------------------------------------

Hit intersectSphere(vec3 origin, vec3 dir, vec3 centre, float radius,
                    float tMin, float tMax) {
  Hit h = missRecord();

  vec3 oc = origin - centre;
  float a = dot(dir, dir);
  float halfB = dot(oc, dir);
  float c = dot(oc, oc) - radius * radius;

  // Contract v1: a tangent ray (delta == 0) is a hit, unlike the Metal source.
  float delta = halfB * halfB - a * c;
  if (delta < 0.0) return h;

  float root = sqrt(delta);
  float t = (-halfB - root) / a;
  if (t <= tMin || t >= tMax) {
    // Far root: this is the exit point when the origin is inside the sphere.
    t = (-halfB + root) / a;
    if (t <= tMin || t >= tMax) return h;
  }

  h.did = true;
  h.t = t;
  h.point = origin + t * dir;
  h.outwardNormal = normalize(h.point - centre);
  h.frontFace = dot(dir, h.outwardNormal) < 0.0;
  h.normal = h.frontFace ? h.outwardNormal : -h.outwardNormal;
  return h;
}

Hit intersectPlane(vec3 origin, vec3 dir, vec3 pointOnPlane, vec3 unitNormal,
                   float tMin, float tMax) {
  Hit h = missRecord();

  float denom = dot(dir, unitNormal);
  if (abs(denom) < PARALLEL_EPS) return h;

  float t = dot(pointOnPlane - origin, unitNormal) / denom;
  if (t <= tMin || t >= tMax) return h;

  h.did = true;
  h.t = t;
  h.point = origin + t * dir;
  h.outwardNormal = unitNormal;
  h.frontFace = dot(dir, unitNormal) < 0.0;
  h.normal = h.frontFace ? unitNormal : -unitNormal;
  return h;
}

/**
 * Nearest hit across the active objects.
 * Exact distance ties resolve to the earlier array entry, because the
 * candidate must be strictly closer than the incumbent to replace it.
 */
Hit nearestHit(vec3 origin, vec3 dir, float tMin, float tMax) {
  Hit best = missRecord();
  float closest = tMax;

  for (int i = 0; i < MAX_OBJECTS; i++) {
    if (i >= uObjectCount) break;

    int kind = int(uObjectB[i].w + 0.5);
    Hit candidate;
    if (kind == OBJECT_PLANE) {
      candidate = intersectPlane(origin, dir, uObjectA[i].xyz, uObjectB[i].xyz,
                                 tMin, closest);
    } else {
      candidate = intersectSphere(origin, dir, uObjectA[i].xyz, uObjectA[i].w,
                                  tMin, closest);
    }

    if (candidate.did) {
      candidate.objectIndex = i;
      candidate.materialIndex = uObjectMaterial[i];
      best = candidate;
      closest = candidate.t;
    }
  }

  return best;
}

/** Any opaque blocker strictly between the shadow origin and the light. */
bool occluded(vec3 origin, vec3 dir, float distanceToLight) {
  float tMax = distanceToLight - EPS;
  if (tMax <= EPS) return false;
  return nearestHit(origin, dir, EPS, tMax).did;
}

// ---------------------------------------------------------------------------
// Shading
// ---------------------------------------------------------------------------

vec3 sky(vec3 dir) {
  float t = clamp(0.5 * (dir.y + 1.0), 0.0, 1.0);
  return mix(uSkyBottom, uSkyTop, t);
}

vec3 albedoOf(int materialIndex) {
  // Callers guarantee a confirmed hit; clamp defensively against bad uploads.
  int idx = clamp(materialIndex, 0, MAX_MATERIALS - 1);
  return uAlbedo[idx];
}

int modeOf(int materialIndex) {
  int idx = clamp(materialIndex, 0, MAX_MATERIALS - 1);
  return uMaterialMode[idx];
}

/** One point light's shadow-checked direct term; zero when facing away or blocked. */
vec3 directLight(Hit h, vec3 albedo, vec3 shadowOrigin, vec3 lightPosition, vec3 lightColor, float intensity) {
  vec3 delta = lightPosition - shadowOrigin;
  float distanceToLight = length(delta);
  vec3 L = delta / max(distanceToLight, EPS);

  float nDotL = max(dot(h.normal, L), 0.0);
  if (nDotL <= 0.0) return vec3(0.0);

  if (occluded(shadowOrigin, L, distanceToLight)) return vec3(0.0);

  return (albedo / PI) * lightColor * intensity * nDotL
       / max(distanceToLight * distanceToLight, 0.01);
}

vec3 shadeMatte(Hit h) {
  vec3 albedo = albedoOf(h.materialIndex);
  vec3 shadowOrigin = h.point + EPS * h.normal;

  // Ambient once, then the main light and each extra light add their own term.
  vec3 color = uAmbient * albedo
             + directLight(h, albedo, shadowOrigin, uLightPosition, uLightColor, uLightIntensity);
  for (int i = 0; i < MAX_EXTRA_LIGHTS; i++) {
    if (i >= uExtraLightCount) break;
    color += directLight(h, albedo, shadowOrigin, uExtraLightPosition[i], uExtraLightColor[i], uExtraLightIntensity[i]);
  }
  return color;
}

// ---------------------------------------------------------------------------
// Encounter loop. No recursion; a compile-time bound with a runtime budget.
// ---------------------------------------------------------------------------

vec3 traceLinear(vec3 origin, vec3 dir) {
  int budget = clamp(uMaxRedirects, 0, MAX_REDIRECTS);

  for (int encounter = 0; encounter <= MAX_REDIRECTS; encounter++) {
    Hit h = nearestHit(origin, dir, EPS, FAR);

    // Miss: return sky at once. Nothing below this line may read material data.
    if (!h.did) return sky(dir);

    if (modeOf(h.materialIndex) == MODE_MATTE) {
      return shadeMatte(h);
    }

    // Mirror. A matte surface is still shaded after the final redirect, but a
    // mirror that would need one more redirect terminates on the budget and
    // returns black. It never fabricates a sky sample.
    if (encounter >= budget) return vec3(0.0);

    vec3 reflected = normalize(dir - 2.0 * dot(dir, h.normal) * h.normal);
    origin = h.point + EPS * h.normal;
    dir = reflected;
  }

  return vec3(0.0);
}

// ---------------------------------------------------------------------------
// Display conversion. Exactly one tone map and one sRGB encode, per contract.
// ---------------------------------------------------------------------------

vec3 reinhard(vec3 c) {
  return c / (1.0 + c);
}

float linearToSrgbChannel(float c) {
  c = clamp(c, 0.0, 1.0);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 linearToSrgb(vec3 c) {
  return vec3(linearToSrgbChannel(c.r),
              linearToSrgbChannel(c.g),
              linearToSrgbChannel(c.b));
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

void main() {
  // gl_FragCoord has a bottom-left origin; the contract specifies integer pixel
  // coordinates from the TOP LEFT. For the pixel centre this reduces to:
  //   xTopLeft + 0.5 == gl_FragCoord.x
  //   yTopLeft + 0.5 == height - gl_FragCoord.y
  float width = uResolution.x;
  float height = uResolution.y;
  float xPlusHalf = gl_FragCoord.x;
  float yPlusHalf = height - gl_FragCoord.y;

  float sx = (2.0 * xPlusHalf / width - 1.0) * (width / height);
  float sy = 1.0 - 2.0 * yPlusHalf / height;

  vec3 dir = normalize(uCameraForward
                     + sx * uTanHalfFov * uCameraRight
                     + sy * uTanHalfFov * uCameraUp);
  vec3 origin = uCameraOrigin;

#ifdef DEBUG_VARIANT
  if (uDebugMode != 0) {
    Hit h = nearestHit(origin, dir, EPS, FAR);
    if (uDebugMode == 1) {
      // Raw face-forward normal, remapped to [0,1]. No tone map, no sRGB.
      vec3 n = h.did ? h.normal : vec3(0.0);
      fragColor = vec4(n * 0.5 + 0.5, 1.0);
      return;
    }
    // Object and material indices as exact small integers, plus a hit flag.
    float oid = h.did ? float(h.objectIndex) : -1.0;
    float mid = h.did ? float(h.materialIndex) : -1.0;
    fragColor = vec4((oid + 1.0) / 255.0, (mid + 1.0) / 255.0,
                     h.did ? 1.0 : 0.0, 1.0);
    return;
  }
#endif

  // Diagnostic modes inspect the FIRST hit only. They deliberately bypass
  // reflections and shadow shading, and must be labelled as first-hit
  // diagnostics in the UI, never as the beauty ray's final surface.
  if (uViewMode == VIEW_HIT) {
    Hit h = nearestHit(origin, dir, EPS, FAR);
    float v = h.did ? 1.0 : 0.0;    // exact white / exact black, no conversion
    fragColor = vec4(v, v, v, 1.0);
    return;
  }

  if (uViewMode == VIEW_ALBEDO) {
    Hit h = nearestHit(origin, dir, EPS, FAR);
    vec3 linear = h.did ? albedoOf(h.materialIndex) : vec3(0.0);
    fragColor = vec4(linearToSrgb(linear), 1.0);   // sRGB only, no tone map
    return;
  }

  vec3 linear = traceLinear(origin, dir);
  fragColor = vec4(linearToSrgb(reinhard(linear)), 1.0);
}
`;
}

/** Emit a float literal GLSL will always parse as a float. */
function glslFloat(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Non-finite shader constant: ${value}`);
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}
