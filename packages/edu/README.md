# `@openlogo/edu`

The education layer: learner levels/curriculum, the deterministic meta-commands
`explain`/`why`/`hint`/`debug`, the geometry standard library (discoverable `.logo` source) and its
reasoning, and — once the Tutor (AI) profile lands (saga #573) — the AI tutor (Socratic,
offline-degrading) behind a provider-neutral adapter.

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
consumes. It has no authoring API, no runtime, and no AI; a
`Lesson` is just data:

- `objective` — the single idea the lesson teaches, tied to a `LearnerLevel` (`"1"`–`"6"`,
  `"7a"`/`"7b"`/`"7c"`, `"8a"`/`"8b"`, matching `spec/educational-model.md`'s 8 progressive
  levels).
- `workedExamples` — one or more annotated, runnable OpenLogo snippets the learner can read.
- `exercisePrompt` — what the learner tries next, changing one thing at a time.

Consumers that load lesson content from an untyped source (e.g. JSON) can validate it with the
exported `isLesson`/`isWorkedExample`/`isLearnerLevel` type guards. Do not invent a competing
lesson-content shape elsewhere in the codebase — extend this contract instead.

## Curriculum content: Level 1 through Level 5

`src/lessons/` holds the first authored curriculum content, built on top of the read-only
`Lesson` contract above:

- `lessons/level-1.ts` — the Level 1 lesson ("Leaving a mark") + graded exercises, covering
  turtle position/heading/pen/color/width and `forward`/`back`/`right`/`left`/`pen_up`/
  `pen_down`/`clear_screen`/`home` (`spec/educational-model.md:39-64`). The open challenge
  follows the compose-a-recognizable-object rule (`spec/educational-model.md`,
  `.github/skills/curriculum/author-a-lesson/SKILL.md`): a house — a square body and a triangle
  roof, each with a door and two windows — with every side of the square and roof typed out one
  at a time, since `repeat` is not introduced until Level 2.
- `lessons/level-2.ts` — the Level 2 lesson ("One side, repeated") + graded exercises, covering
  `repeat` as an effects-only block and `repcount`, including the canonical square worked
  example (`spec/educational-model.md:66-87`). The graded exercises follow the same
  compose-a-recognizable-object rule: a guided change to the square, the triangle pattern as
  practice, then a tree (a trunk plus repeated triangle tiers, each tier the exact same `repeat`
  body) as the open challenge, and a further "taller tree" exercise that changes only the
  repeat count — the payoff moment for why `repeat` matters, since growing the tree by hand
  would mean retyping every tier.
- `lessons/level-3.ts` — the Level 3 lessons + graded exercises. "One name, many places" covers
  the `:name` variable idiom, `=` and worded `set ... to` assignment, and `==` comparison
  (`spec/educational-model.md:89-121`); its worked examples reproduce the spec's `:size` square
  verbatim, and its exercises introduce `:size` into a fixed square, resize it once with the
  worded form, then reuse the single `:size` name across a resizable house's walls and roof
  together, so one change resizes the whole shape. "Where a name is born decides how long it
  lives" ([#829](https://github.com/pmalarme/open-logo/issues/829)) then teaches saga
  [#819](https://github.com/pmalarme/open-logo/issues/819)'s scoping ruling at the point it first
  matters: `spec/execution-model.md:607-615`'s born-inside / born-outside contrast, where the same
  loop body prints `1 1 1 1` or `1 2 3 4` depending only on which side of the `repeat` the first
  assignment sits. Its exercises ramp from moving that one line, to growing four sides with a name
  that outlives each turn, to a snail's shell that only winds outward for the same reason.
- `lessons/level-4.ts` — the Level 4 lesson ("A condition must already be true or false") +
  graded exercises, covering `if … else`, the comparisons `==`/`!=`/`<`/`>`/`<=`/`>=`, the boolean
  combinators `and`/`or`/`not`, and a worded predicate such as `is between`
  (`spec/educational-model.md:123-154`). The first worked example reproduces the spec's
  `:sides == 4` color-choice program verbatim; the graded exercises follow the same
  compose-a-recognizable-object rule: a guided single-operator change (`==` to `!=`), a practice
  single-operator change (`!=` to `>=`) on the same shape and value, then a challenge that
  reuses Level 3's house and colors it with one condition on `:size`.
- `lessons/level-5.ts` — the Level 5 lessons + graded exercises. "`define` names a reusable idea;
  `return` hands back its answer" covers `define … end` procedures, parameters as variables scoped
  to the procedure, `return` for reporters, and the procedure boundary
  (`spec/educational-model.md:156-203`). The first two worked examples reproduce the spec's
  `polygon` and `double` examples verbatim — `polygon` is always built up from `repeat`, never
  handed over as an opaque primitive — and two more show the boundary itself: the names a
  procedure sets are its own automatically, and an input is the procedure's to change without the
  caller seeing it. The graded exercises ramp from a single-line change to the lesson's `polygon`
  call (guided), to a new `triangle` procedure that calls `polygon` (practice), to composing
  `spec/examples/06-geometry.logo`'s `polygon` → `triangle` → `house` chain and calling `house`
  twice to build a small street (challenge) — procedure reuse, not recursion; Heritage's
  `to … end`/`output` spellings are mentioned in prose only, taught after `define`/`return`.
  "`global` shares one value with every procedure"
  ([#829](https://github.com/pmalarme/open-logo/issues/829)) then teaches the one way through that
  boundary — `global name = value` — with exercises ramping from a one-word fix, to a procedure
  given an input *and* a shared total, to a staircase that reports how far it climbed. Under saga
  [#819](https://github.com/pmalarme/open-logo/issues/819)'s ruling a procedure's variables are
  private automatically, so `local` — which survives as a way to deliberately *shadow* a visible
  name (`spec/execution-model.md:501-506`) — is no longer taught at this level: shadowing only
  means something once a learner has met `global`, which makes it a later, narrower idea. A test
  in `level-5.test.mjs` pins that absence so it cannot be reintroduced by accident.
- `lessons/exercise.ts` — the `Exercise` contract: a graded exercise additive to `Lesson`
  (`lessonId`, a `LearnerLevel`, a `"guided" | "practice" | "challenge"` difficulty, a prompt,
  and a runnable `referenceSolution`). `Lesson` itself only carries a single `exercisePrompt`
  string, so `Exercise` is a separate, non-invasive contract rather than a change to `lesson.ts`.
- `lessons/registry.ts` — aggregates every level's lessons/exercises into flat `LESSONS`/
  `EXERCISES` lists, plus `getLessonsByLevel`/`getExercisesByLevel`/`getExercisesByLesson`/
  `findLessonById`/`findExerciseById` helpers.
- `lessons/built-in-names.test.mjs` — the built-in-names curriculum audit
  ([#843](https://github.com/pmalarme/open-logo/issues/843)), kept as a test rather than a one-off
  report. See [Naming rules for lesson authors](#naming-rules-for-lesson-authors) below.

## Naming rules for lesson authors

The maintainer ruling behind [`spec/grammar.md`](../../spec/grammar.md#keywords-primitives-and-built-in-names)
is one sentence: **a program may not declare a built-in name, and a program may bind a value to any
name.** For lesson content that splits cleanly in two.

- **Declaring** — `define`, the heritage `to`, `struct`, and the first operand of `alias` — must use
  a name OpenLogo does not already own. Under the ruling, a worked example or reference solution
  that writes `define forward`, `define count`, or `define fd` raises `ol-reserved-word`, whatever
  the spelling and whatever profiles are claimed. `grid`, `axes`, and `measure` are renderer-backed
  overlays and are owned too; the derived Geometry standard library — `polygon`, `star`, `circle`,
  `arc`, `area`, `perimeter` — is OpenLogo source and stays free, which is what keeps
  `spec/educational-model.md`'s "Learners build `polygon` from `repeat`" true. The meta-commands
  `explain`, `why`, `hint`, `debug`, and `challenge` are owned as well, so no lesson may define one.
  Identifiers are case-insensitive (`spec/grammar.md:13`), so `define FD` is `define fd`.
- **Binding** — `:name = value`, `set … to`, `make`, `local`, parameters, `for`/`map`/`filter`/
  `reduce` binders, destructuring names, struct field names, and dictionary keys — accepts **any**
  name. `:end = 1`, `local count`, and `{ value: 1 }` are conforming programs. A lesson must never
  teach that these names are forbidden, because they are not: only declaring a callable with one is.

Every worked example and reference solution is both **executed** against `@openlogo/runtime` and
**statically checked** with `@openlogo/parser`'s `check()` in this package's tests, so lesson content
can drift neither from real execution behavior nor from the naming rules. The two gates are
genuinely different: for a **procedure** declaration, `ol-reserved-word` is a semantic diagnostic
produced only by `check()`, so a lesson that declared a procedure named after a built-in would run
cleanly through an execution-only test. (The runtime's own phase-1 registration guard does raise it
for some `struct` collisions, so the hole is not total — but a procedure declaration, which is what
Level 5 teaches, falls straight through it.)

Note the rule above is enforced twice over, by two independent derivations. `check()` rejects a
built-in name at the declaration slots, and `built-in-names.test.mjs`'s own `builtInKind()` reads
the same rule off `@openlogo/parser`'s registries — the keyword list under every profile, every
primitive table, and every Heritage alias — without consulting the checker at all. A curriculum name
is reported the moment either one calls it owned, so a regression in either is caught. That second
derivation is also what held lesson content to the finished rule while the checker was catching up:
before [#838](https://github.com/pmalarme/open-logo/issues/838), `check()` consulted neither the
Turtle & Rendering nor the Educational table, so `define forward` and `define hint` were accepted.

Each authored level adds its own `lessons/level-N.ts` module and extends the registry
additively — no shared file needs an ever-growing literal, and no level uses a concept from a later
level (`spec/educational-model.md:37`'s discovery guardrail).
