---
name: studio-ui
description: >-
  How to build the OpenLogo studio UI in @openlogo/studio — a single state model, the editor / turtle
  / diagnostics / lesson panes, the Run/Stop/Reset loop over the runtime budget, and accessibility.
  Use for any studio/editor/REPL/UI work. Compose the other packages; never reimplement them.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

The studio is where a learner writes OpenLogo and watches it run. It **composes** parser, runtime,
robot, and edu behind one coherent, accessible UI — it owns presentation and interaction, not
language logic.

## Architecture

- **Single state model:** `{ source, runState (idle|running|stopped), diagnostics[], turtleFrame,
  lesson, replHistory }`. All panes render from it; interactions produce state transitions.
- **Panes:** code **editor**, **turtle view** (Canvas from `@openlogo/robot`), **diagnostics**,
  **lesson/tutor** pane (content from `@openlogo/edu`), and a **REPL**.
- **Controller / view split:** put run orchestration and state in a headless controller
  (`run-controller.ts`) so `@testing` can drive it without a browser; keep rendering in the view.

## Contracts you consume (don't reinvent)

- **Highlighting + LSP** from `@openlogo/parser` (tokens, hover, completion) — see
  `language-designer/syntax-highlighting`.
- **Diagnostics** (`ol-*`) from `@openlogo/core`: render each inline at its `source_span` with the
  learner message and did-you-mean; never show raw stack traces.
- **Events + rendering** from `@openlogo/runtime`/`@openlogo/robot`: drive the turtle view and
  stepping from the deterministic event stream.
- **Teaching** from `@openlogo/edu`: surface `explain`/`why`/`hint`/`debug` and tutor output in the
  lesson pane — pull the text, don't author it here.

## The run loop

`Run` executes via `@openlogo/runtime` under its **execution budget**; `Stop` cancels through the
same budget (must halt `repeat 10000 [ forward 1 ]` promptly); `Reset` clears turtle + canvas to the
initial state; `Step` advances one event for debugging. Wire these to the runtime API, not a private
interpreter.

## Accessibility (acceptance, not polish)

Every control keyboard-operable and screen-reader-labeled; honor **reduced motion**; provide the
**non-visual description** of the drawing from `@openlogo/robot`; diagnostics reachable and announced.
Follows [`spec/rendering.md`](../../../../spec/rendering.md).

## Procedure

1. Add the interaction to the controller + state model; keep it headless-testable.
2. Compose the relevant package API; surface its output in the right pane.
3. Add a component/controller test (`@testing`) and a11y checks.
4. If you need behavior a package doesn't expose, file it to that package's owner — don't fork logic.

## Checklist
- [ ] State-model-driven; controller/view split; headless-testable.
- [ ] Diagnostics inline at spans with did-you-mean; no raw errors.
- [ ] Run/Stop/Reset/Step go through the runtime budget; Stop truly cancels.
- [ ] Keyboard + screen-reader + reduced-motion covered.
- [ ] Composes packages; no reimplemented language/render logic.
