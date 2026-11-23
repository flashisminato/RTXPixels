# Contribution, AI-use and source record

## What exists at this checkpoint

- The human supplied the project objective, exact shared v1 interfaces/mathematical agreement, ownership boundaries and integration brief.
- AI 3 created the local Vite/TypeScript bootstrap, original scene, CPU math, immutable validated store, rendering orchestration, low-resolution fallback, numerical/integration/browser tests and documentation.
- AI 3 created the minimal renderer/UI/style stubs only in the bootstrap commit. This merge selects AI 1's existing real renderer over that stub without editing AI 1's source/tests/handoff. UI/style files remain unchanged.
- Two internal read-only agent audits reviewed CPU semantics and state/lifecycle behavior. Concrete findings led to regression tests and fixes. They were not the separate human accounts' handoffs or user testing.
- AI 1's real renderer and tests are integrated from team main commit 2746fb1; the implementation was previously merged in PR #1. AI 3 connected it to the core and added combined browser/parity checks. AI 2's finished feature code and human first-user feedback have not arrived. Do not claim the team application is finished.

The code and documentation were AI-assisted. Numerical and browser claims are based on executed checks listed in verification.md, not solely on generated code. Humans remain responsible for review, eligibility, source licensing decisions and final submission.

## Reference and reuse

Inspiration: **Light Teachings by Kia Preston (pkncoder)**.
Reference snapshot: https://github.com/pkncoder/Light-Teachings/tree/57260fe2a6badbc826271856bbcf6c8a2090de17

AI 3 did not fetch, copy or adapt substantial upstream source/functions. The CPU implementation was written against the supplied mathematical contract. Thus no upstream source code is bundled in this checkpoint and no adapted-function entries are claimed.

AI 1's handoff reports read-only inspection of the reference and independently implemented standard mathematical formulas, with no copied code. Its existing provenance record is retained unchanged in docs/handoffs/ai1.md. The repository's separate MIT notice, previously in main's README, is preserved verbatim in the combined README.

For any incoming adaptation, record: source URL, exact commit, file/function, nature of adaptation, owning account and notice location. Preserve the **complete upstream MIT text** and its original `Copyright (c) 2025 Kia` notice. Do not rename the author or infer ownership of copied code. Inspiration-only credit is not a substitute for the license when actual code is copied.

## Honest claims

Our intended contribution is the interactive explanation and original experiment, not inventing ray tracing. This is not a pixel-for-pixel native-app reproduction. The current checkpoint combines the real WebGL renderer with CPU inspection/fallback, validated by standalone renderer tests and sampled integrated parity checks. It is not a finished explanatory UI or a claim of universal GPU equivalence. Glass and other deferred effects are absent. Source is delivered to the existing team repository; no deployment or competition submission is part of this merge.
