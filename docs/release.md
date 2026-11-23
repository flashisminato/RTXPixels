# Release gates and actual-demo guide

## Current usable demonstration

1. Run `npm ci`, `npm run dev`, open the printed local URL.
2. Read the development-harness status. WebGL2 renders the room, target, mirror and hard shadows at a cap of 640×360; unavailable/lost graphics uses the capped 160×90 CPU fallback. Both fit the host aspect.
3. Select **Inspect a computed mirror example**. The default pixel is (286,180) at 640×360 or (71,45) at 160×90; read the actual mirror → target hit sequence and shadow event.
4. Click another pixel. The JSON inspection is real computation for the displayed drawing-buffer pixel, not a canned explanation.
5. Activate Reset with keyboard or pointer; the preset is restored and sceneVersion advances. Resize; normalized selection is preserved and recomputed.

The harness has no real sliders or diagram yet. Do not demonstrate pretend controls. Browser integration tests drive UIActions directly only as test instrumentation. After AI 2's interface lands, moving lightX from −3 to +4 is a measured example of the same reflected target point changing from ambient-only to directly lit.

## Before a public team release

- AI 1's renderer is integrated unchanged; receive AI 2's real UI and review its owned-file handoff and provenance.
- Integrate the actual explanation; run the full control/inspection experiment and owner cross-reviews. Test-only action capture is not a finished control interface.
- Extend the passing sampled CPU/GPU center/corner/resize/high-DPI diagnostics to intended judging hardware and browsers.
- Verify full keyboard selection, accessibility, reset, first-hit diagnostic labels, graphics failure and fallback using the real modules.
- Collect actual first-user feedback; test another device and at least the intended judging browsers.
- Run fresh `npm ci`, `npm run check`, `npm run test:renderer`, `npm run test:browser`; preserve a known-good commit/tag.
- Review actual incoming source reuse and add complete upstream notices as required; approve team-source licensing rather than assuming it.
- Team source repository: https://github.com/flashisminato/Ray-Tracking. Preserve its existing visibility and use only authorized delivery branches. Never push to pkncoder/Light-Teachings.
- Obtain the chosen static-host account/destination and authorization. Build/publish `dist`; verify actual root/subpath assets, credits, reload and private-browser behavior at the real URL.
- Identify the organizer/event and check live rules, AI-use disclosure, eligibility, deadline and link requirements. None were supplied, so none are verified.

## Project-page draft grounded in current implementation

**Title:** Follow a Pixel

**Question:** How does a game decide what a mirror shows?

**Implemented now:** An original analytic sphere/plane scene, AI 1's real WebGL2 image, a bounded CPU mirror tracer, hard-shadow decisions, real per-pixel events, first-hit diagnostics, validated scene controls, reset/versioning, and a cancelable low-resolution fallback. The combined implementation has sampled CPU/GPU parity tests.

**Not yet integrated:** The complete educational UI/diagram, user feedback and public deployment.

**Credit:** Inspired by Light Teachings by Kia Preston (pkncoder). No upstream source copied/adapted by AI 3; verify incoming reuse separately. Ray tracing is established computer graphics, not our invention.

The team source repository is real; no live app or submission URL is claimed. Replace this draft's limitations only when the corresponding implementation and verification actually exist.
