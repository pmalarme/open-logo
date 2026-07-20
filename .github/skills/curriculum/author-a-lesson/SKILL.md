---
name: author-a-lesson
description: >-
  How @curriculum authors a lesson/exercise for a learner level in @openlogo/edu — objectives, a
  worked example, graded exercises, and a runnable solution validated against the runtime. Use for
  curriculum, levels, lessons, exercises. Grounded in spec/educational-model.md's 8 levels.
created: 2026-07-17T00:00
updated: 2026-07-20T00:00
---

## Purpose

Provide the progression that makes OpenLogo learnable — each lesson introduces one idea, builds on the
last, and every example actually runs.

## Procedure

1. **Pick the level** from `spec/educational-model.md`: L1 movement, L2 repetition, L3 variables, L4
   conditions, L5 procedures, L6 geometry/math, L7 data (7a lists/7b dicts/7c records), L8 algorithms
   (8a recursion/8b comprehensions). Only use primitives available at/below that level's profile.
2. **State one objective** and the prerequisite level(s).
3. **Worked example** in canonical OpenLogo (`shared/spec-fidelity`) — lowercase keywords, correct
   profile. Keep it minimal (KISS).
4. **Graded exercises:** ramp from guided to open; for each, include a **runnable reference solution**.
5. **Culminate in a recognizable object:** make the final graded exercise (with its runnable solution)
   a challenge that composes what was just taught into a motivating object a learner wants to
   reproduce — not an abstract geometry drill. It generalizes per concept; for example, L1 movement
   and turns can compose basic shapes into a house (square/rectangle body + triangle roof, door,
   windows); L2 `repeat` can compose repeated triangle tiers into a tree (trunk + tiers). Teach the
   parts first, then compose them.
6. **Validate every example + solution against the runtime** (`shared/conformance-fixture`) so lessons
   can never drift from real behavior; wire them into CI.
7. **Add teaching hooks:** expected misconceptions (from `@geometry-teacher`) and staged hints (from
   `@ai-tutor`) for the exercise.

## Critical rules

- Never use a primitive/profile above the lesson's level.
- Every code sample is executable and validated — no illustrative-but-broken snippets.
- One new concept per lesson; reuse prior levels rather than re-teaching.

## Checklist
- [ ] Level + objective + prerequisites explicit; profile-appropriate primitives only.
- [ ] Worked example + graded exercises, each with a runnable solution.
- [ ] Final graded challenge composes a recognizable, motivating object (e.g. house, tree) — not an abstract drill.
- [ ] All samples validated against the runtime in CI.
- [ ] Misconception + hint hooks attached.
