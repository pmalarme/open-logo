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

## Testing: two different things hide a timing defect

The immediate scheduler is the default (`run-controller.ts`'s `options?.scheduler ?? IMMEDIATE_SCHEDULER`).
It drains playback inside `run()`, so `drawnEventCount` is always the whole stream. Which hazard you
face depends on what your oracle reads:

- **An oracle that reads playback progress needs a paced scheduler.** Anything about a
  *partially-drawn* picture, or delivery before playback settles, is unobservable under the immediate
  default — `#985/#976: a click DELIVERED before its handler registers reports zero invocations`
  delivers one click before registration and observes `false`, then after `drain()` a *second* click
  returns `true` as the non-zero control. Adapt that helper's pattern from
  `run-controller-interaction.test.mjs` — **there is no shared module**. It does not model
  cancellation (its canceller is a no-op), but it *does* single-step: `step()` runs one queued
  callback, added by #1039 when a two-ended test proved defeatable by a mutant that agrees with the
  predicate at both ends and disagrees in between.
- **An oracle that reads tick ordering can be defeated by fixture slack, under any scheduler.** A
  program with ticks to spare after the event you order against lets a clamped and an unclamped
  delivery land on different-but-both-valid ticks with identical observable order. Measured on the
  `#976` answered-read sweep, same immediate scheduler in both arms: `askThenOnKeySource` with no
  trailing wait dies under a `readFloor = 0` mutant (leads 1/2/3/5 violate, lead 0 insensitive),
  while the `wait 5` variant stays green. `trailingWaitTicks` defaults to `0` for this reason — pass
  it only when a test genuinely needs slack.
- **A surviving mutant proves only that the test does not discriminate.** Fixture slack is one
  diagnosis; the others are that the mutation never reached the built artifact, that it hit the wrong
  guard, or that the assertion is weak. Confirm the mutation landed in `dist/` before reading
  anything into a green suite.
