---
applyTo: "packages/runtime/**"
---

# `@openlogo/runtime` — working rules

Scoped rules for files under `packages/runtime/`. Read the always-on
[team agreement](openlogo-team.instructions.md) and the
[architecture](../../docs/architecture.md) first.

**Owner:** [`@interpreter`](../agents/interpreter.agent.md) ·
**Skills:** [implement-a-primitive](../skills/interpreter/implement-a-primitive/SKILL.md),
[diagnostics](../skills/shared/diagnostics/SKILL.md),
[conformance-fixture](../skills/shared/conformance-fixture/SKILL.md)

## Responsibility
Execute the AST. Owns the **evaluator**, **scoping**, **procedure** registration/calls, **control
forms** (`if`/`while`/`repeat`/`forever`/`for`), **comprehensions** (`map`/`filter`/`reduce`),
**places/mutation**, **equality**, `return`/`stop`/`throw`, and the **cancellable execution budget**.
Emits the deterministic, headless **trace/event stream**.

## Spec (normative)
- [`spec/execution-model.md`](../../spec/execution-model.md) — evaluation, scoping, state, safety, events.
- [`spec/commands.md`](../../spec/commands.md) — primitive behavior/signatures.
- [`spec/data-structures.md`](../../spec/data-structures.md) — places/mutation (Data profile).

## Source layout
- `packages/runtime/src/index.ts` — the only public entry (run/step, event stream, cancellation).
- Keep evaluation deterministic; no wall-clock, no randomness outside the seeded rules.

## Boundaries
- Depends on **`@openlogo/core`** (values, diagnostics, events) and **`@openlogo/parser`** (AST).
- **No rendering or animation** — emit trace events; `@openlogo/robot` turns them into pictures.
- Runaway programs (`repeat 10000 [ forward 1 ]`) stay within the budget and cancel promptly.

## Conventions
- Every observable effect is a registered trace event; every error is a registered `ol-*` diagnostic.
- Extend the conformance fixtures with each primitive/behavior; keep them green.
