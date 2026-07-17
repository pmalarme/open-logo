---
name: progressive-hints
description: >-
  How @ai-tutor delivers staged, Socratic hints over @geometry-teacher / @curriculum signals in
  @openlogo/edu — never spoilers by default, deterministic offline baseline, AI behind a
  provider-neutral adapter. Use for hint/explain/why/challenge behavior and tutor safety.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Coach discovery, don't hand out answers. The tutor asks the next good question and escalates only as
needed — and works offline first, with AI as an optional enhancement.

## Procedure

1. **Read** `spec/ai-tutor.md` and `spec/educational-model.md`. The meta-commands `explain`/`why`/
   `hint`/`debug` are **deterministic, offline, template-based, arity 0, no full solutions**; `hint` is
   **progressive**.
2. **Consume structured signals** from `@geometry-teacher`/`@curriculum` (concepts, misconceptions);
   don't re-derive the math.
3. **Stage the hints:** (1) restate the goal / ask a question → (2) point at the relevant concept →
   (3) narrow to the specific line/value → never the finished answer by default.

   ```text
   hint 1: How many sides should this shape have?
   hint 2: What turning angle brings the turtle back to its start?
   hint 3: For 5 sides, each turn is 360 / 5 — compare that to your right value.
   ```

4. **`challenge` + Socratic guardrails** (Tutor (AI) profile) go through the **provider-neutral adapter**;
   when offline or no provider, **degrade to the deterministic Educational baseline**.
5. **Modes:** learner mode hides solutions; teacher mode may reveal — explicit and overridable.
6. **Safety:** prompt-injection tests, privacy, and no-spoiler defaults are acceptance criteria
   (`@testing` covers them).

## Critical rules

- Never volunteer a full solution in learner mode; hints escalate one step at a time.
- Deterministic baseline must work with no AI provider present.
- AI is pluggable behind the neutral adapter — no hard dependency on any one provider.

## Checklist
- [ ] Meta-commands deterministic, offline, arity 0, no full solutions.
- [ ] Hints staged (question → concept → specifics); signals reused, not recomputed.
- [ ] AI behind the adapter; offline degrades to baseline.
- [ ] Prompt-injection + privacy + no-spoiler tests pass.
