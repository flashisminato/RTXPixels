/**
 * Thin WebGL2 helpers: context acquisition, shader compilation with readable
 * diagnostics, and program linking. Nothing here knows about ray tracing.
 */

/** Error carrying the shader info log and the offending source lines. */
export class ShaderCompileError extends Error {
  readonly stage: 'vertex' | 'fragment';
  readonly infoLog: string;
  readonly annotatedSource: string;

  constructor(stage: 'vertex' | 'fragment', infoLog: string, source: string) {
    super(
      `WebGL2 ${stage} shader failed to compile.\n` +
        `${infoLog.trim()}\n\n` +
        `${annotate(infoLog, source)}`,
    );
    this.name = 'ShaderCompileError';
    this.stage = stage;
    this.infoLog = infoLog;
    this.annotatedSource = annotate(infoLog, source);
  }
}

export class ProgramLinkError extends Error {
  readonly infoLog: string;

  constructor(infoLog: string) {
    super(`WebGL2 program failed to link.\n${infoLog.trim()}`);
    this.name = 'ProgramLinkError';
    this.infoLog = infoLog;
  }
}

export class ContextCreationError extends Error {
  constructor(detail: string) {
    super(
      `Could not create a WebGL2 context: ${detail}. ` +
        `This app needs WebGL2; the integration layer should fall back to the ` +
        `CPU renderer rather than showing an empty canvas.`,
    );
    this.name = 'ContextCreationError';
  }
}

/**
 * Pull the line numbers out of a driver info log and quote those lines of
 * source with a few neighbours. Drivers report "ERROR: 0:137: ..." and a bare
 * line number is useless when the shader is generated.
 */
function annotate(infoLog: string, source: string): string {
  const lines = source.split('\n');
  const reported = new Set<number>();

  for (const match of infoLog.matchAll(/(?:ERROR|WARNING):\s*\d+:(\d+)/gi)) {
    const lineNumber = Number(match[1]);
    if (Number.isFinite(lineNumber)) reported.add(lineNumber);
  }

  if (reported.size === 0) {
    return lines
      .slice(0, 40)
      .map((text, i) => `${String(i + 1).padStart(4)} | ${text}`)
      .join('\n');
  }

  const wanted = new Set<number>();
  for (const line of reported) {
    for (let i = line - 3; i <= line + 3; i++) {
      if (i >= 1 && i <= lines.length) wanted.add(i);
    }
  }

  const sorted = [...wanted].sort((a, b) => a - b);
  const out: string[] = [];
  let previous = 0;
  for (const n of sorted) {
    if (previous !== 0 && n !== previous + 1) out.push('     ...');
    const marker = reported.has(n) ? '>' : ' ';
    out.push(`${marker}${String(n).padStart(4)} | ${lines[n - 1]}`);
    previous = n;
  }
  return out.join('\n');
}

export type ContextOptions = {
  /** Test harnesses need readPixels to be reliable after a frame. */
  preserveDrawingBuffer?: boolean;
};

export function createContext(
  canvas: HTMLCanvasElement,
  options: ContextOptions = {},
): WebGL2RenderingContext {
  const attributes: WebGLContextAttributes = {
    alpha: false,
    antialias: false, // Browser MSAA cannot fix analytic sphere edges anyway.
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: options.preserveDrawingBuffer === true,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false,
  };

  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null;
  } catch (cause) {
    throw new ContextCreationError(String((cause as Error)?.message ?? cause));
  }

  if (!gl) {
    const hasWebGL1 = Boolean(canvas.getContext('webgl'));
    throw new ContextCreationError(
      hasWebGL1
        ? 'this browser exposes WebGL1 but not WebGL2'
        : 'getContext("webgl2") returned null',
    );
  }

  return gl;
}

export function compileShader(
  gl: WebGL2RenderingContext,
  stage: 'vertex' | 'fragment',
  source: string,
): WebGLShader {
  const type = stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER;
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`gl.createShader(${stage}) returned null`);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const infoLog = gl.getShaderInfoLog(shader) ?? '(no info log)';
    gl.deleteShader(shader);
    throw new ShaderCompileError(stage, infoLog, source);
  }

  return shader;
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertexShader = compileShader(gl, 'vertex', vertexSource);
  let fragmentShader: WebGLShader;
  try {
    fragmentShader = compileShader(gl, 'fragment', fragmentSource);
  } catch (error) {
    gl.deleteShader(vertexShader);
    throw error;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error('gl.createProgram() returned null');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.bindAttribLocation(program, 0, 'aClipPosition');
  gl.linkProgram(program);

  // Shaders can be released as soon as the program holds a reference.
  gl.detachShader(program, vertexShader);
  gl.detachShader(program, fragmentShader);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const infoLog = gl.getProgramInfoLog(program) ?? '(no info log)';
    gl.deleteProgram(program);
    throw new ProgramLinkError(infoLog);
  }

  return program;
}

/**
 * Resolve every uniform the program actually kept after optimisation.
 * Array uniforms are stored under both `name` and `name[0]` depending on the
 * driver, so normalise to the bare name.
 */
export function collectUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): Map<string, WebGLUniformLocation> {
  const locations = new Map<string, WebGLUniformLocation>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;

  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const location = gl.getUniformLocation(program, info.name);
    if (!location) continue;
    locations.set(info.name, location);
    const bare = info.name.replace(/\[0\]$/, '');
    if (bare !== info.name) locations.set(bare, location);
  }

  return locations;
}
