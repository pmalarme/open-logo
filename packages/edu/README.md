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

## Curriculum content: Level 1 and Level 2

`src/lessons/` holds the first authored curriculum content, built on top of the read-only
`Lesson` contract above:

- `lessons/level-1.ts` — the Level 1 lesson ("Leaving a mark") + graded exercises, covering
  turtle position/heading/pen/color/width and `forward`/`back`/`right`/`left`/`pen_up`/
  `pen_down`/`clear_screen`/`home` (`spec/educational-model.md:37-58`).
- `lessons/level-2.ts` — the Level 2 lesson ("One side, repeated") + graded exercises, covering
  `repeat` as an effects-only block and `repcount`, including the canonical square worked
  example (`spec/educational-model.md:64-85`). The graded exercises follow a recognizable-goal
  ramp (issue #354): a guided change to the square, the triangle pattern as practice, then a
  house (a square body, a triangle roof, a door, and two windows, composed from L1 primitives)
  as the open challenge, and a further "two houses" exercise that reuses the whole house
  pattern inside `repeat 2 [ ... ]` — the payoff moment for why `repeat` matters, since drawing
  a second house by hand would mean retyping every line.
- `lessons/exercise.ts` — the `Exercise` contract: a graded exercise additive to `Lesson`
  (`lessonId`, a `LearnerLevel`, a `"guided" | "practice" | "challenge"` difficulty, a prompt,
  and a runnable `referenceSolution`). `Lesson` itself only carries a single `exercisePrompt`
  string, so `Exercise` is a separate, non-invasive contract rather than a change to `lesson.ts`.
- `lessons/registry.ts` — aggregates every level's lessons/exercises into flat `LESSONS`/
  `EXERCISES` lists, plus `getLessonsByLevel`/`getExercisesByLevel`/`getExercisesByLesson`/
  `findLessonById`/`findExerciseById` helpers.

Every worked example and reference solution is executed against `@openlogo/runtime` in this
package's tests, so lesson content can never drift from real execution behavior. Later levels
(Level 3 onward) add their own `lessons/level-N.ts` module and extend the registry additively —
no shared file needs an ever-growing literal, and no level uses a concept from a later level
(`spec/educational-model.md:35`'s discovery guardrail).
