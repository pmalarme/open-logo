---
name: vertical-slice
description: >-
  The backbone workflow for building one OpenLogo language feature end to end across the
  @openlogo/* packages. Use whenever you implement a command, control form, reporter, or turtle
  behavior. Covers grammar → AST → runtime + events → render/UI → tests → teaching → docs.
created: 2025-06-01T00:00
updated: 2025-06-01T00:00
---

## Purpose

Deliver one feature as a thin, working, end-to-end **vertical slice** instead of a horizontal layer.
A slice touches every package it needs and lands green, so the product is always demonstrable.

## When to use

Any time you pick up a feature issue (e.g. "`forward` moves the turtle", "`repeat`", "`define …
end`"). Follow the spec's profile DAG: **Core Language → Turtle & Rendering** first, then optional
profiles with their dependencies.

## Procedure

### Step 1 — Ground in the spec
Open the exact normative sections for the feature and copy the canonical signature/behavior into
the issue/PR description. Sources: `spec/commands.md` (C3 matrix), `spec/grammar.md`,
`spec/execution-model.md`, `spec/error-model.md`, `spec/rendering.md`. If the spec is ambiguous,
stop and raise it with `@product-owner` — do not guess.

### Step 2 — Syntax (`@openlogo/parser`)
Add/confirm grammar + reserved words, then tokens → reader → AST node. Keep the grammar the single
syntactic source of truth. Apply `shared/spec-fidelity`.

### Step 3 — Behavior (`@openlogo/core` + `@openlogo/runtime`)
Add value/type support and any `ol-*` diagnostic to `@openlogo/core` (see `shared/diagnostics`),
then implement evaluation in `@openlogo/runtime`. Emit the deterministic **trace/event(s)** for the
feature. Keep runtime headless and reproducible.

### Step 4 — Output (`@openlogo/turtle` and/or `@openlogo/studio`)
If the feature draws or moves, consume the events in `@openlogo/turtle` and render (Canvas). If it
touches the learner loop, surface it in `@openlogo/studio` (Run/Stop/Reset, diagnostics).

### Step 5 — Prove it (`tests/conformance/` + integration)
Add stack-neutral fixtures (`shared/conformance-fixture`) mapping source → expected events/
diagnostics, plus an integration test through the real pipeline. Extend, never weaken, existing fixtures.

### Step 6 — Teaching hooks (`@openlogo/edu`)
Where the feature introduces a concept, add/adjust the `explain`/`why`/`hint` templates, curriculum
mapping, and (for shapes) geometry reasoning.

### Step 7 — Docs (`docs/` + READMEs)
Update the reference/tutorial and runnable examples in the **same PR** (`@documentation`). No drift.

### Step 8 — Close out
Run `shared/definition-of-done`, then hand the slice to `shared/review-gate` — an agent that did
**not** author it runs the independent pre-merge review and records a pass verdict (reviewer ≠
author). Open one PR with the declared write-set. Do not self-merge — a human merges by default, or a
maintainer-delegated `@orchestrator` only on that non-author PASS.

## Worked example — the walking skeleton

`forward 100` end to end: tokenize `forward` + number → AST call → runtime evaluates, updates
turtle pose, emits `move`/`line` events → `@openlogo/turtle` draws the segment on Canvas →
`@openlogo/studio` Run button shows it → conformance fixture asserts the two events and final pose →
docs show the snippet. That one slice exercises every package boundary; build it first.

## Checklist
- [ ] Cited the exact spec section(s); no invented behavior.
- [ ] Grammar, AST, runtime, events, and (if visual) rendering all updated.
- [ ] Canonical vocabulary only (`shared/spec-fidelity`).
- [ ] Conformance + integration tests added and green.
- [ ] Teaching hooks + docs updated in the same PR.
- [ ] Independent review gate passed — `shared/review-gate`, reviewer ≠ author.
- [ ] One PR, declared write-set, shared files serialized.
