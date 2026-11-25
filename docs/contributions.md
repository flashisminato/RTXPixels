# Provenance notes

## Reference and reuse

Inspiration: **Light Teachings by Kia Preston (pkncoder)**.
Reference snapshot: https://github.com/pkncoder/Light-Teachings/tree/57260fe2a6badbc826271856bbcf6c8a2090de17

No upstream source code or functions are copied or adapted in this repository. The CPU tracer and the WebGL renderer implement standard ray-tracing mathematics (camera rays, sphere and plane intersection, perfect reflection, Lambertian point-light shading with hard shadows, Reinhard tone mapping and sRGB encoding) written for this project. The "ray tracing off" view follows the general idea of the reference's simple shading model (direct light at the first surface) with this project's own code and lighting law.

For any future adaptation, record the source URL, exact commit, file and function, the nature of the adaptation, and where the notice lives. Preserve the **complete upstream MIT text** and its original `Copyright (c) 2025 Kia` notice. Inspiration-only credit is not a substitute for the license when code is copied.

## Honest claims

The contribution is the interactive explanation and the original scene, not ray tracing itself, which is an established technique. This is not a pixel-for-pixel reproduction of the reference app. CPU/GPU agreement is checked by sampled pixel comparisons in headless Chrome, not on every GPU and driver. Glass, soft shadows and indirect light are not computed.
