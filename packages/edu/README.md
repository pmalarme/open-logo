# `@openlogo/edu`

The education layer: learner levels/curriculum, the deterministic meta-commands
`explain`/`why`/`hint`/`debug`, the geometry standard library (discoverable `.logo` source) and its
reasoning, and the AI tutor (Socratic, offline-degrading) behind a provider-neutral adapter.

- **Source root:** `src/` — public entry `src/index.ts`; geometry stdlib as validated `.logo` source.
- **Owners:** [`@geometry-teacher`](../../.github/agents/geometry-teacher.agent.md) +
  [`@ai-tutor`](../../.github/agents/ai-tutor.agent.md) +
  [`@curriculum`](../../.github/agents/curriculum.agent.md).
- **Working rules:** [`edu.instructions.md`](../../.github/instructions/edu.instructions.md).
- **Spec:** [`educational-model.md`](../../spec/educational-model.md),
  [`geometry-module.md`](../../spec/geometry-module.md), [`ai-tutor.md`](../../spec/ai-tutor.md).
- **Depends on:** `@openlogo/runtime`, `@openlogo/core`.
