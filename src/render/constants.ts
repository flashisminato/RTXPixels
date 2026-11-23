/**
 * Renderer constants.
 *
 * Shared numeric rules come from AI 3's `src/contracts.ts` and are re-exported
 * here, so CPU and GPU can never silently disagree about EPS, FAR or capacity.
 * Only GPU-specific packing codes are defined locally.
 */
export {
  EPS,
  FAR,
  MAX_MATERIALS,
  MAX_OBJECTS,
  MAX_REDIRECTS,
  PLANE_PARALLEL_THRESHOLD as PARALLEL_EPS,
} from '../contracts.ts';

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

/**
 * Test-only shader output channels. Production never sets a value other than 0,
 * and the production program does not even compile the code that reads them.
 */
export const DEBUG_OFF = 0;
export const DEBUG_NORMAL = 1;
export const DEBUG_IDS = 2;
