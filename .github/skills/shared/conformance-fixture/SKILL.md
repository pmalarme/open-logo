---
name: conformance-fixture
description: >-
  How to author stack-neutral OpenLogo conformance fixtures that map .logo source to expected
  events and diagnostics. Use whenever you add or change a language/turtle feature. These fixtures
  are the primary proof of correctness in the Definition of Done.
created: 2025-06-01T00:00
updated: 2025-06-01T00:00
---

## Purpose

Prove behavior against the spec with **implementation-independent** fixtures: a `.logo` program plus
the exact trace/events and/or `ol-*` diagnostics it must produce. Any conforming implementation
should pass them, so they outlive toolchain choices.

## Where they live

`tests/conformance/<profile>/<feature>/` — e.g. `tests/conformance/turtle-rendering/forward/`.
Group by the owning profile so a runner can select "minimal conformance" (Core + Turtle & Rendering).

## Fixture shape

Each fixture is a pair: the source and its expected result. Keep results **deterministic** (no
timing/frames; assert semantic events and final state).

```
forward.logo
──────────────
forward 100

forward.expected.json
──────────────
{
  "profiles": ["core-language", "turtle-rendering"],
  "events": [
    { "seq": 1, "kind": "instruction",
      "source-span": { "document": "forward.logo", "start": [1, 1], "end": [1, 12] } },
    { "seq": 2, "kind": "move",
      "source-span": { "document": "forward.logo", "start": [1, 1], "end": [1, 12] },
      "payload": { "from": [0, 0], "to": [0, 100], "heading": 0 } },
    { "seq": 3, "kind": "draw-segment",
      "source-span": { "document": "forward.logo", "start": [1, 1], "end": [1, 12] },
      "payload": { "from": [0, 0], "to": [0, 100], "color": "black", "width": 1 } }
  ],
  "turtle": { "x": 0, "y": 100, "heading": 0 },
  "diagnostics": []
}
```

Events use the normative envelope — `seq`, `kind`, `source-span`, optional `turtle-id`, `payload` —
and registered `kind` values (`instruction`, `move`, `draw-segment`, …) from
`spec/execution-model.md`. Coordinate exact payloads with `@interpreter` and `@turtle-engine`; do not
invent event shapes here.

## Negative fixtures

For invalid programs, assert the **exact diagnostic** (see `shared/diagnostics`). Note diagnostics use
`source_span` (underscore) while events use `source-span` (hyphen) — match the spec exactly:

```
missing-arg.logo        →  forward
missing-arg.expected.json →
{ "diagnostics": [ { "code": "ol-not-enough-inputs", "stage": "semantic", "severity": "error",
    "source_span": { "document": "missing-arg.logo", "start": [1, 1], "end": [1, 8] },
    "params": { "callable": "forward", "expected": 1, "actual": 0 } } ],
  "events": [] }
```

Include did-you-mean cases where `spec/error-model.md` defines them (e.g. `forwrd` → suggests `forward`).

## Procedure

1. Read the owning spec section and the C3 row; enumerate the observable outcomes (events, final
   state, diagnostics) and the error cases.
2. Write one **minimal** positive fixture per behavior and one per documented error.
3. Assert semantics, not frames: `repeat 10000 [ forward 1 ]` checks stability/budget/event count,
   not animation.
4. Keep fixtures small and readable; a learner should recognize the program.
5. Run them in CI; extend (never weaken) existing fixtures when behavior grows.

## Checklist
- [ ] Positive + negative fixtures for the feature.
- [ ] Event/field names match the `@openlogo/core` registry.
- [ ] Deterministic; no timing assertions.
- [ ] Correct `profiles` tag so profile-scoped runs pick it up.
- [ ] `ol-*` codes/spans asserted for every error case.
