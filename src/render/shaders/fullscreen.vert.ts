/**
 * Fullscreen vertex stage.
 *
 * Three vertices covering clip space. The original Metal path (`vertexMain`)
 * used a strip of two triangles; a single oversized triangle does the same job
 * with no shared edge, which removes the diagonal seam risk entirely.
 *
 * This stage carries NO ray logic. Every ray is constructed per fragment from
 * the camera basis uniforms supplied by AI 3, so the GPU never invents its own
 * rotation convention.
 */
export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
precision highp float;

in vec2 aClipPosition;

void main() {
  gl_Position = vec4(aClipPosition, 0.0, 1.0);
}
`;

/**
 * Clip-space positions for the covering triangle.
 * (-1,-1), (3,-1), (-1,3) covers the whole [-1,1] square.
 */
export const FULLSCREEN_TRIANGLE = new Float32Array([
  -1, -1,
  3, -1,
  -1, 3,
]);
