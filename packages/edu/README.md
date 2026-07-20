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

## Lesson contract

`src/lesson.ts` exports the read-only, data-only `Lesson` type — the **single source of
truth** the studio lesson pane ([#127](https://github.com/pmalarme/open-logo/issues/127))
consumes. It has no authoring API, no runtime, and no AI (those land in later slices); a
`Lesson` is just data:

- `objective` — the single idea the lesson teaches, tied to a `LearnerLevel` (`"1"`–`"6"`,
  `"7a"`/`"7b"`/`"7c"`, `"8a"`/`"8b"`, matching `spec/educational-model.md`'s 8 progressive
  levels).
- `workedExamples` — one or more annotated, runnable OpenLogo snippets the learner can read.
- `exercisePrompt` — what the learner tries next, changing one thing at a time.

Consumers that load lesson content from an untyped source (e.g. JSON) can validate it with the
exported `isLesson`/`isWorkedExample`/`isLearnerLevel` type guards. Do not invent a competing
lesson-content shape elsewhere in the codebase — extend this contract instead.
