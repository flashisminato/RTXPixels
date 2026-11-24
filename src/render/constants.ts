/**
 * Renderer-local constants. These MUST stay numerically identical to the CPU
 * reference (src/core/**) and to the shared contract v1.
 * If the two ever differ, this file is wrong, not the contract.
 */

/** Shared surface epsilon. Ray self-intersection offset and tMin. */
export const EPS = 1e-4;

/** Far clip for all queries. */
export const FAR = 1000;

/** Plane "ray is parallel" rejection threshold on |dot(D, N)|. */
export const PARALLEL_EPS = 1e-6;

/** Contract v1 capacities. Raising these requires a coordinated contract bump. */
export const MAX_OBJECTS = 8;
export const MAX_MATERIALS = 8;

/** Extra point lights beyond the main one (contract MAX_LIGHTS - 1). */
export const MAX_EXTRA_LIGHTS = 3;

/** Hard ceiling on the encounter loop compiled into the shader. */
export const MAX_REDIRECTS = 4;

/** Object type codes packed into uObjectB.w. */
export const OBJECT_SPHERE = 0;
export const OBJECT_PLANE = 1;

/** Material mode codes packed into uMaterialMode[]. Glass (2) is not in v1. */
export const MODE_MATTE = 0;
export const MODE_MIRROR = 1;

/** View mode codes packed into uViewMode. */
export const VIEW_BEAUTY = 0;
export const VIEW_HIT = 1;
export const VIEW_ALBEDO = 2;
/** Ray tracing off: first surface, direct light only (no shadows, no bounces). */
export const VIEW_RASTER = 3;

/**
 * Test-only shader output channels. Production never sets a value other than 0.
 * Used by the integration tests; not reachable from the UI.
 */
export const DEBUG_OFF = 0;
export const DEBUG_NORMAL = 1;
export const DEBUG_IDS = 2;
