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
  controller is testable without a browser; host `@openlogo/robot`'s Canvas in the turtle pane.

## Boundaries
- Composes **`@openlogo/parser`** (highlight/LSP/check), **`@openlogo/runtime`** (execute),
  **`@openlogo/robot`** (Canvas), **`@openlogo/edu`** (lessons/tutor), **`@openlogo/core`** (diagnostics).
- **No private interpreter or renderer.** If a package doesn't expose what you need, file it to that owner.

## Conventions
- Run/Stop/Reset/Step go through the runtime **execution budget**; Stop truly cancels.
- Diagnostics render inline at their `source_span` with did-you-mean; never raw stack traces.
- Every control is keyboard-operable and screen-reader-labeled; honor reduced-motion.
