import type { RenderFrame, Renderer, RendererHooks } from '../contracts';
import { DEBUG_OFF, MAX_MATERIALS, MAX_OBJECTS } from './constants';
import {
  ContextCreationError,
  collectUniformLocations,
  createContext,
  linkProgram,
  ProgramLinkError,
  ShaderCompileError,
} from './gl';
import { FULLSCREEN_TRIANGLE, FULLSCREEN_VERT } from './shaders/fullscreen.vert';
import { buildTraceFragmentSource } from './shaders/trace.frag';
import {
  clampRedirects,
  packCamera,
  packLight,
  packExtraLights,
  packScene,
  viewModeCode,
} from './uniforms';

export { ContextCreationError, ProgramLinkError, ShaderCompileError } from './gl';
export { SceneValidationError } from './uniforms';
export { buildTraceFragmentSource } from './shaders/trace.frag';
export { FULLSCREEN_VERT } from './shaders/fullscreen.vert';
export * from './constants';

/**
 * Options beyond the shared contract. The integration layer never needs these;
 * they exist for the renderer's own test harness.
 */
export type CreateRendererOptions = {
  /** Compile the debug shader variant exposing normals and object ids. */
  debug?: boolean;
  /** Keep the drawing buffer readable after a frame, for readPixels in tests. */
  preserveDrawingBuffer?: boolean;
};

/** The renderer contract plus the test-only surface. */
export type RendererInternals = Renderer & {
  /**
   * Test-only. 0 off, 1 face-forward normals, 2 object/material ids.
   * Throws unless the renderer was created with `debug: true`, so production
   * cannot accidentally reach diagnostic output.
   */
  setDebugMode(mode: number): void;
  /** Introspection for tests and error reporting. */
  readonly gl: WebGL2RenderingContext;
};

/**
 * Create the WebGL2 image renderer.
 *
 * Scope, per the shared ownership table: this module computes pixels and
 * nothing else. It owns no DOM beyond the supplied canvas, mutates no store,
 * runs no animation loop, and implements no CPU fallback. main.ts decides when to
 * call `draw`.
 *
 * @throws ContextCreationError when WebGL2 is unavailable.
 * @throws ShaderCompileError / ProgramLinkError with the driver log and the
 *         relevant source lines.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  hooks: RendererHooks,
  options: CreateRendererOptions = {},
): RendererInternals {
  const debug = options.debug === true;
  const gl = createContext(canvas, {
    preserveDrawingBuffer: options.preserveDrawingBuffer === true,
  });

  // --- Context loss -------------------------------------------------------
  // The browser keeps dispatching these until preventDefault is called, and
  // without it `restored` never fires. Every GL object is invalid after a loss,
  // so the program and buffers are rebuilt on restore.
  let contextLost = false;

  const onLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    resources = null;
    try {
      hooks.onContextLost();
    } catch {
      // A failing host hook must not break the renderer's own recovery.
    }
  };

  const onRestored = () => {
    contextLost = false;
    try {
      resources = createResources();
    } catch (error) {
      lastError = error as Error;
    }
    try {
      hooks.onContextRestored();
    } catch {
      /* see above */
    }
  };

  canvas.addEventListener('webglcontextlost', onLost as EventListener, false);
  canvas.addEventListener('webglcontextrestored', onRestored as EventListener, false);

  type Resources = {
    program: WebGLProgram;
    vao: WebGLVertexArrayObject;
    buffer: WebGLBuffer;
    uniforms: Map<string, WebGLUniformLocation>;
  };

  let lastError: Error | null = null;
  let debugMode = DEBUG_OFF;
  let disposed = false;
  let lastAspectWarning = '';

  /**
   * Detect a stretched image.
   *
   * The renderer computes its horizontal field from `frame.width / frame.height`
   * and has no control over CSS. If the host sizes the canvas element to a
   * different aspect ratio, the browser scales the drawing buffer to fit and
   * every sphere silently becomes an ellipse. The picture still looks
   * plausible, which is what makes it dangerous in a teaching app.
   *
   * Matching the two is the host's responsibility under the shared contract, so
   * this only reports; it never "corrects" the frame it was given. Reporting is
   * a console warning rather than a thrown error because a transient mismatch
   * during layout is normal and must not break rendering.
   */
  function checkAspect(width: number, height: number): void {
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;

    // Zero means the canvas is detached or not laid out yet: nothing to compare.
    if (!(cssWidth > 0) || !(cssHeight > 0)) return;

    const bufferAspect = width / height;
    const displayAspect = cssWidth / cssHeight;

    // 1% tolerance absorbs rounding in fractional CSS pixel sizes.
    if (Math.abs(bufferAspect - displayAspect) <= displayAspect * 0.01) {
      lastAspectWarning = '';
      return;
    }

    const signature = `${width}x${height}->${cssWidth}x${cssHeight}`;
    if (signature === lastAspectWarning) return; // warn once per distinct state
    lastAspectWarning = signature;

    const suggestedHeight = Math.max(1, Math.round(width / displayAspect));
    const suggestedWidth = Math.max(1, Math.round(height * displayAspect));
    console.warn(
      `[renderer] Drawing buffer ${width}x${height} (aspect ${bufferAspect.toFixed(3)}) does not ` +
        `match the canvas display size ${cssWidth}x${cssHeight} (aspect ${displayAspect.toFixed(3)}). ` +
        `The browser will stretch the image and spheres will render as ellipses. ` +
        `The rendered pixels are correct for the requested buffer; the host must size the ` +
        `buffer to the host aspect ratio. Try ${width}x${suggestedHeight} or ` +
        `${suggestedWidth}x${height}.`,
    );
  }

  function createResources(): Resources {
    const program = linkProgram(gl, FULLSCREEN_VERT, buildTraceFragmentSource({ debug }));

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) {
      gl.deleteProgram(program);
      throw new Error('Failed to allocate the fullscreen vertex array or buffer');
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const uniforms = collectUniformLocations(gl, program);

    // Verifying the link is not enough: a driver that silently dropped a
    // uniform would produce a plausible but wrong picture.
    const required = [
      'uObjectA', 'uObjectB', 'uObjectMaterial', 'uAlbedo', 'uMaterialMode',
      'uObjectCount', 'uCameraOrigin', 'uCameraForward',
      'uCameraRight', 'uCameraUp', 'uTanHalfFov', 'uLightPosition',
      'uLightColor', 'uLightIntensity', 'uExtraLightPosition', 'uExtraLightColor',
      'uExtraLightIntensity', 'uExtraLightCount', 'uAmbient', 'uSkyBottom', 'uSkyTop',
      'uResolution', 'uViewMode', 'uMaxRedirects',
    ];
    const missing = required.filter((name) => !uniforms.has(name));
    if (missing.length > 0) {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buffer);
      throw new ProgramLinkError(
        `the linked program is missing expected uniforms: ${missing.join(', ')}. ` +
          `This usually means the shader optimised them away because a code path ` +
          `is unreachable, or the driver renamed them.`,
      );
    }

    return { program, vao, buffer, uniforms };
  }

  let resources: Resources | null = createResources();

  function uniform(name: string): WebGLUniformLocation | null {
    return resources?.uniforms.get(name) ?? null;
  }

  function draw(frame: RenderFrame): void {
    if (disposed) {
      throw new Error('Renderer.draw was called after dispose()');
    }
    if (contextLost || gl.isContextLost()) {
      // Not an error: the host is told through onContextLost and should show
      // the fallback. Silently skipping avoids a flood of GL warnings.
      return;
    }
    if (!resources) {
      throw lastError ?? new Error('Renderer has no GPU resources and cannot draw');
    }

    const width = Math.max(1, Math.floor(frame.width));
    const height = Math.max(1, Math.floor(frame.height));
    checkAspect(width, height);

    // The drawing buffer size is owned by the host, but if it disagrees with
    // the frame the aspect-ratio maths in the shader would be wrong, so take
    // the frame as authoritative for the viewport.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const scene = packScene(frame.scene);
    const camera = packCamera(frame.camera);
    const light = packLight(frame.scene);
    const extraLights = packExtraLights(frame.scene);
    const view = viewModeCode(frame.options.viewMode);
    const redirects = clampRedirects(frame.options.maxRedirects);

    const { program, vao } = resources;
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.uniform4fv(uniform('uObjectA'), scene.objectA);
    gl.uniform4fv(uniform('uObjectB'), scene.objectB);
    gl.uniform1iv(uniform('uObjectMaterial'), scene.objectMaterial);
    gl.uniform3fv(uniform('uAlbedo'), scene.albedo);
    gl.uniform1iv(uniform('uMaterialMode'), scene.materialMode);
    gl.uniform1i(uniform('uObjectCount'), scene.objectCount);
    // scene.materialCount is validated during packing, not uploaded: see the
    // note in trace.frag.ts about the removed uMaterialCount uniform.

    gl.uniform3fv(uniform('uCameraOrigin'), camera.origin);
    gl.uniform3fv(uniform('uCameraForward'), camera.forward);
    gl.uniform3fv(uniform('uCameraRight'), camera.right);
    gl.uniform3fv(uniform('uCameraUp'), camera.up);
    gl.uniform1f(uniform('uTanHalfFov'), camera.tanHalfFov);

    gl.uniform3fv(uniform('uLightPosition'), light.position);
    gl.uniform3fv(uniform('uLightColor'), light.color);
    gl.uniform1f(uniform('uLightIntensity'), light.intensity);
    gl.uniform3fv(uniform('uExtraLightPosition'), extraLights.position);
    gl.uniform3fv(uniform('uExtraLightColor'), extraLights.color);
    gl.uniform1fv(uniform('uExtraLightIntensity'), extraLights.intensity);
    gl.uniform1i(uniform('uExtraLightCount'), extraLights.count);
    gl.uniform1f(uniform('uAmbient'), light.ambient);
    gl.uniform3fv(uniform('uSkyBottom'), light.skyBottom);
    gl.uniform3fv(uniform('uSkyTop'), light.skyTop);

    gl.uniform2f(uniform('uResolution'), width, height);
    gl.uniform1i(uniform('uViewMode'), view);
    gl.uniform1i(uniform('uMaxRedirects'), redirects);

    const debugLocation = uniform('uDebugMode');
    if (debugLocation) gl.uniform1i(debugLocation, debugMode);

    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
  }

  function setDebugMode(mode: number): void {
    if (!debug) {
      throw new Error(
        'setDebugMode requires createRenderer(..., { debug: true }). The production ' +
          'renderer does not compile diagnostic outputs.',
      );
    }
    debugMode = mode;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    canvas.removeEventListener('webglcontextlost', onLost as EventListener, false);
    canvas.removeEventListener('webglcontextrestored', onRestored as EventListener, false);

    if (resources && !gl.isContextLost()) {
      gl.deleteProgram(resources.program);
      gl.deleteVertexArray(resources.vao);
      gl.deleteBuffer(resources.buffer);
    }
    resources = null;
  }

  return {
    draw,
    dispose,
    setDebugMode,
    get gl() {
      return gl;
    },
  };
}

/** Capacities the host may want to display or assert against. */
export const RENDERER_LIMITS = {
  maxObjects: MAX_OBJECTS,
  maxMaterials: MAX_MATERIALS,
} as const;
