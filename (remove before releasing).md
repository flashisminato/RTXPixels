# Three account implementation guide

Use three AI chats to build three parts of one app. Give each chat its full matching brief. The briefs contain the same shared contract, so the accounts do not need access to this conversation.

The practical advantage is parallel implementation and review. Three accounts do not make the project automatically three times faster: integration, testing, and human understanding remain the main limits. Assign the person most comfortable running code and resolving errors to AI 3.

## Assign the people and accounts

| Person | Account | Owns | Must deliver |
|---|---|---|---|
| Person 1 | AI 1 | Image renderer | Actual ray-traced spheres, planes, reflections, and shadows |
| Person 2 | AI 2 | Interface and explanation | Controls, responsive layout, real ray diagram, and clear two-minute experience |
| Person 3 | AI 3 | Setup, reference math, integration, tests, deployment | Shared project, working assembled app, verified live release |

AI 3 has the broadest coordination role. Person 1 should take responsibility for graphics debugging, and Person 2 for newcomer testing and demo preparation, so Person 3 does not become responsible for every unfinished task.

## Start in this order

1. **Open Account 3 first.** Paste or attach `ai-3-integration-prompt.md`. Give it the new team repository or a new local project location. Tell it your intended hosting destination when known. The reference Light Teachings repository is read-only source material, not the team repository.
2. **Ask Account 3 to reach BOOTSTRAP READY.** The result must contain an actual starting project, exact baseline commit or portable files, shared types, and verified install/build instructions. A proposed folder tree is not enough.
3. **While it works, give Accounts 1 and 2 their briefs.** They may inspect source or design their assigned parts, but should wait for the actual baseline before creating project files. Do not let either create another starter app.
4. **Transfer the SAME bootstrap to Accounts 1 and 2.** Give both the repository link/access and exact commit. If Git is unavailable, give both the same baseline file bundle. Paste or attach the corresponding full prompt.
5. **Work in separate branches/checkouts.** Account 1 uses `feature/renderer`; Account 2 uses `feature/ui`; Account 3 develops its core and integrates into `main`. Separate accounts must not run independently against the same working directory.
6. **Every two hours, send handoffs to Account 3.** The handoff contains actual changed code/commit, tests, known failures, and requested interface changes. Account 3 integrates and returns the new main commit to the other two humans.

You may need to authorize repository access and publication in the relevant account. Do not send passwords, tokens, or personal credentials between chats. If an account cannot execute code, it must return complete owned files or a patch and explicitly mark testing unverified; run those files in the coding environment before accepting the handoff.

## What each person does each day

| Time | Person 1 and AI 1 | Person 2 and AI 2 | Person 3 and AI 3 |
|---|---|---|---|
| Day 1 first hour | Read rendering math; plan shader | Plan opening screen and experiment | Create the actual shared bootstrap and contract |
| Day 1 hours 1–4 | Shader, camera, sphere/plane geometry, shading | Layout, typed controls, keyboard basics | CPU intersections, reference tracing, state, first integration |
| Day 1 hours 4–6 | Mirrors and hard shadows | Pixel selection and real ray diagram | Connect image, controls, and inspector; compare CPU/GPU |
| Day 1 hours 6–8 | Fix renderer and resizing | Complete guided interaction | Integrate everything, fallback, smoke tests |
| Day 2 hours 0–2 | Fix core; glass only if approved | Explain real results; accessibility | Reference tests; coordinate any approved extension |
| Day 2 hours 2–4 | Performance and browser fixes | Two uncoached newcomer trials | Regression tests and cross-browser integration |
| Day 2 hours 4–6 | Graphics review, verified captures | Polish copy and demo | Production release, README, credits, link verification |
| Day 2 hours 6–8 | Release fixes and code rehearsal | Release fixes and two-minute explanation | Final live checks, submission artifacts, rollback copy |

This is two eight-hour working days per human, not 48 continuous hours per account. Stop generating extensions when they would consume testing time.

## Checkpoints that decide whether to cut scope

**Day 1 hour 2:** shared project builds; real baseline is distributed; each feature branch exists or has a named file baseline.

**Day 1 hour 4:** moving a control changes a computed image. If the GPU is blocked, use the CPU image while AI 1 fixes WebGL. Do not stop interface integration while waiting for polish.

**End of Day 1:** one app has a mirror, shadow, live controls, reset, and one pixel whose computed trace matches the image. Three independent screenshots do not pass this checkpoint.

**Day 2 hour 2:** remove glass if it is not tested in both tracers. The shared v1 contract intentionally excludes glass; enabling it requires a coordinated v2, not a unilateral new toggle.

**Day 2 hour 4:** freeze features. Preserve a functioning version and use remaining time for correctness, user comprehension, actual deployment, and submission materials.

## What to send between chats

At each handoff, ask the producing AI to provide:

```text
Account / role:
Branch and commit, or patch baseline:
Contract version:
Files changed:
Working behavior:
Checks actually run and outcomes:
Checks not run:
Known failures:
Requested change from another owner:
Next integration action:
Adapted source and required credits:
```

Send this report AND the actual accessible commit or changed files to AI 3. A prose report alone does not transfer an implementation. After integration, send the new main commit and changed shared files back to AI 1 and AI 2.

If using file transfers, send only the owner's changed files or a patch. Do not overwrite the whole project with a ZIP from an older baseline. AI 3 should keep a backup and check file changes before importing.

## Rules that prevent wasted work

- Only AI 3 changes shared types, package dependencies, the scene store, and startup wiring.
- AI 1 owns how pixels are computed. AI 2 owns how the computed result is explained. AI 3 connects them using the same scene and camera.
- UI development fixtures may exist in tests; the final product must use real trace events.
- Nobody adds an unapproved framework, renderer, backend, or new project structure.
- An AI can review another module and propose a patch, but its owner applies the implementation change unless ownership is explicitly transferred.
- A build passing is not proof that a mirror, shadow, or pixel explanation is correct. Require browser and numerical evidence.
- Each human must be able to explain their own portion. AI-assisted code that nobody can defend is unfinished work for this challenge.
- A public link, an uploaded demo, or passed tests must be real and verified; never accept an invented success report.

## Final acceptance

Open the live app without signing in. Move the target, move the light, inspect a mirror pixel, change the material, and reset. The image and explanation must change together. Test a narrow screen and a second actual device. Check visible credits and limitations. Prepare the live link, public source repository, project page, and demo video required by the current submission form.

The three matching prompt files are standalone. The original source review remains useful for deeper reasoning and source references, but it is not required to understand the division of work.
