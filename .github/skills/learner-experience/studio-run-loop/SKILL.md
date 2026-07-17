---
name: studio-run-loop
description: >-
  How @learner-experience wires the studio Run/Stop/Reset/Step loop in @openlogo/studio to the runtime
  execution budget and turtle event stream — cancellation, budget, deterministic reset. Use for the
  execution controls and their integration with the engine. Pairs with the studio-ui skill.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Make running OpenLogo feel immediate and safe: code runs, draws live, and **Stop always stops** — even
for a runaway program — without the studio ever owning language logic.

## Procedure

1. **Read** `spec/execution-model.md` (execution budget, cancellation) and the turtle event contract
   (`turtle-engine/turtle-event-contract`).
2. **Drive execution through `@openlogo/runtime`.** Run submits source and streams trace events; the
   studio renders turtle frames from `@openlogo/turtle` as they arrive. Never embed an interpreter.
3. **Stop = cancel the budget.** Cancellation must promptly halt `repeat 10000 [ forward 1 ]`; verify
   with a headless controller test, not just a manual click.
4. **Reset** returns turtle + canvas + run state to the initial state deterministically; **Step**
   advances one event for debugging.
5. **Keep it in a headless controller** (`run-controller.ts`) separate from the view so `@testing` can
   assert run/stop/reset/step transitions without a browser.
6. **Surface diagnostics** inline at their spans as they arrive (`shared/diagnostics`); never show raw
   errors or stack traces.

## Critical rules

- The studio composes the engine — no private evaluation, no private rendering.
- Stop/cancel and the execution budget are acceptance criteria, not nice-to-haves.
- Controller is headless-testable; view is thin.

## Checklist
- [ ] Run/Stop/Reset/Step go through the runtime budget + event stream.
- [ ] Stop cancels a runaway loop (covered by a headless test).
- [ ] Reset is deterministic; Step advances one event.
- [ ] Diagnostics inline at spans; controller/view split.
