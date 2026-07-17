# `@openlogo/runtime`

The evaluator: scoping, procedures, control forms, comprehensions, places/mutation, equality,
`return`/`stop`/`throw`, the cancellable execution budget, and the deterministic headless trace/event
stream.

- **Source root:** `src/` — public entry `src/index.ts`.
- **Owner:** [`@interpreter`](../../.github/agents/interpreter.agent.md).
- **Working rules:** [`runtime.instructions.md`](../../.github/instructions/runtime.instructions.md).
- **Spec:** [`execution-model.md`](../../spec/execution-model.md),
  [`commands.md`](../../spec/commands.md), [`data-structures.md`](../../spec/data-structures.md).
- **Depends on:** `@openlogo/core`, `@openlogo/parser`.
