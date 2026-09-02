---
applyTo: "packages/studio/**"
---

# `@openlogo/studio` — working rules (the browser app)

Scoped rules for files under `packages/studio/`. Read the always-on
[team agreement](openlogo-team.instructions.md) and the
[architecture](../../docs/architecture.md) first.

**Owner:** [`@learner-experience`](../agents/learner-experience.agent.md) ·
**Skills:** [studio-ui](../skills/learner-experience/studio-ui/SKILL.md),
[studio-run-loop](../skills/learner-experience/studio-run-loop/SKILL.md)

## Responsibility
**This is the OpenLogo UI that runs in a browser.** A TypeScript **web app** that hosts the code
editor/REPL, the **Canvas** turtle view, the diagnostics UI, and the lesson/tutor pane, with
Run/Stop/Reset/Step, persistence, and accessibility. It **composes** the other packages — it owns
presentation and interaction, never language logic.

## Spec (normative)
- [`spec/rendering.md`](../../spec/rendering.md) — the **Canvas target** is the live browser surface;
  its execution controls (run/pause/step/reset/speed/overlays/export), keyboard operability, and the
  textual state description are normative for Turtle & Rendering.
- [`spec/tooling.md`](../../spec/tooling.md) — LSP-style editor integration (semantic tokens, diagnostics,
  completion, hover, code actions) the studio surfaces.
- [`spec/interaction-events.md`](../../spec/interaction-events.md) — input/UI events (later profile).

## Source layout
- `packages/studio/src/index.ts` — app entry (mounts the browser UI).
- Split a **headless controller** (`run-controller.ts`, state model) from the **view/DOM** so the
  controller is testable without a browser; host `@openlogo/turtle`'s Canvas in the turtle pane.

## Boundaries
- Composes **`@openlogo/parser`** (highlight/LSP/check), **`@openlogo/runtime`** (execute),
  **`@openlogo/turtle`** (Canvas), **`@openlogo/edu`** (lessons/tutor), **`@openlogo/core`** (diagnostics).
- **No private interpreter or renderer.** If a package doesn't expose what you need, file it to that owner.

## Conventions
- Run/Stop/Reset/Step go through the runtime **execution budget**; Stop truly cancels.
- Diagnostics render inline at their `source_span` with did-you-mean; never raw stack traces.
- Every control is keyboard-operable and screen-reader-labeled; honor reduced-motion.
- Follow the team agreement's clean-code naming rule (no abbreviations, self-explaining identifiers) — see
  [`openlogo-team.instructions.md` §10](openlogo-team.instructions.md#10-conventions).

## Testing: a timing test needs no slack ticks

- The immediate scheduler (the default — `run-controller.ts`'s `options?.scheduler ?? IMMEDIATE_SCHEDULER`)
  drains playback inside `run()`, so `drawnEventCount` is always the whole stream. A test that must
  observe a **partially-drawn** picture needs a paced scheduler — copy `createHandDrivenScheduler`
  from `run-controller-interaction.test.mjs`; **there is no shared helper yet**, so it is defined
  locally in each file that needs one.
- **Pacing is not what makes an ordering defect visible — fixture shape is.** A program with ticks to
  spare after the event you order against lets a clamped and an unclamped delivery land on
  different-but-both-valid ticks with identical observable order. `askThenOnKeySource` defaults to no
  trailing wait for exactly this reason; pass `trailingWaitTicks` only when a test needs slack.
- **Prove it by mutation, not by scheduler choice**: if forcing the guard off leaves the test green,
  the fixture has slack. Measured on #985's flagship ordering test — same immediate scheduler, the
  variant with no trailing wait dies under the mutant while the variant with `wait 5` stays green.
