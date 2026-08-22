---
name: conformance-fixture
description: >-
  How to author stack-neutral OpenLogo conformance fixtures that map .logo source to expected
  events and diagnostics. Use whenever you add or change a language/turtle feature. These fixtures
  are the primary proof of correctness in the Definition of Done — and a fixture `description` is
  never validated by anything, so every claim in it must be measured, not inferred.
created: 2025-06-01T00:00
updated: 2026-08-22T00:00
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
  "description": "forward 100 from the origin at heading 0 moves the turtle to (0, 100), drawing the segment",
  "profiles": ["core-language", "turtle-rendering"],
  "execute": true,
  "events": [
    { "seq": 0, "kind": "instruction",
      "source_span": { "document": "forward.logo", "start": [1, 1], "end": [1, 12] } },
    { "seq": 1, "kind": "move",
      "source_span": { "document": "forward.logo", "start": [1, 1], "end": [1, 12] },
      "payload": { "from": [0, 0], "to": [0, 100], "heading": 0 } },
    { "seq": 2, "kind": "draw-segment",
      "source_span": { "document": "forward.logo", "start": [1, 1], "end": [1, 12] },
      "payload": { "from": [0, 0], "to": [0, 100], "color": "black", "width": 1 } }
  ],
  "diagnostics": []
}
```

**The harness reads only the keys it knows** — `description`, `profiles`, `expect`, `execute`,
`check`, `style`, `executeOptions`, `events`, `diagnostics`. Any other top-level key is **silently
dropped, not rejected**, so an assertion written in an invented field (a `turtle` final-state block,
say) looks like proof and asserts nothing. Assert final turtle state through the `events` stream.
Measured: no fixture in the corpus carries a top-level key outside that list.

Events use the normative envelope — `seq`, `kind`, `source_span`, optional `turtle_id`, `payload` —
and registered `kind` values (`instruction`, `move`, `draw-segment`, …) from
`spec/execution-model.md`. Coordinate exact payloads with `@interpreter` and `@turtle-engine`; do not
invent event shapes here.

**`execute` is an opt-in flag (default `false`).** Set `"execute": true` only once the fixture's
program is genuinely execution-valid — this asks the harness to run it through
`@openlogo/runtime`'s `execute()` and capture the real trace/event stream, instead of the
parse-only default (which always yields `events: []`). Most of the existing parse-focused corpus
does not set this flag and must stay that way.

## Negative fixtures

For invalid programs, assert the **exact diagnostic** (see `shared/diagnostics`). Diagnostics use
`source_span` (underscore) — the same field name events use, so there is one convention throughout
the fixture contract:

```
missing-arg.logo        →  forward
missing-arg.expected.json →
{ "diagnostics": [ { "code": "ol-not-enough-inputs", "stage": "semantic", "severity": "error",
    "source_span": { "document": "missing-arg.logo", "start": [1, 1], "end": [1, 8] },
    "params": { "callable": "forward", "expected": 1, "actual": 0 } } ],
  "events": [] }
```

Include did-you-mean cases where `spec/error-model.md` defines them (e.g. `forwrd` → suggests `forward`).

## A fixture `description` is an unverified claim

`description` is **never validated**. The harness reads it, prints it, and compares nothing — so a
confident falsehood there passes every gate and misleads every later reader. That matters more here
than it sounds: descriptions in this corpus are long, they carry the *reasoning* for a decision, and
later slices cite them as settled fact (several record "this was escalated to the maintainer" or "a
widening ruling should relax this"). A false one propagates.

It is not the only unchecked thing in an `.expected.json`, and knowing the others keeps you from
writing an assertion that quietly asserts nothing:

- A **diagnostic `message`** is deliberately excluded from comparison — diagnostic identity is
  `code` + `params` and prose is presentation (`spec/error-model.md`), so wording may differ from a
  fixture's without failing.
- An **unknown top-level key** is dropped rather than rejected (see "Fixture shape" above).

What *is* proven: `events` and `diagnostics` are diffed item-by-item, and every `kind`, `code`, and
`profiles` tag is validated against the `@openlogo/core` registries.

So:

- **Measure, don't infer.** Any factual assertion in a description — about what the harness does,
  what another stage reports, why a case is omitted — must come from a run you actually did. If you
  are describing behaviour you did not execute, either execute it or write that you did not.
- **Be hardest on descriptions that justify an absence.** Prose explaining why a fixture was *not*
  written is exactly the claim nothing can contradict, because the case it describes is not in the
  corpus. A session once declined dict/record fixtures on a "lossy serialisation" premise it had
  inferred from `JSON.stringify` in a scratch probe rather than read from the harness — the harness
  in fact unwraps `OLDict`/`OLRecord` and deep-compares contents, so the premise was false and the
  fixtures were addable. Only the non-author reviewer caught it (issue #859).
- **Cite, don't restate.** Prefer pointing at the spec section, harness function, or issue that
  settles a claim over paraphrasing it — a pointer stays true when the thing it points at changes,
  and a paraphrase silently stops being true. The same applies to numbers: see
  [`shared/definition-of-done`](../definition-of-done/SKILL.md)'s "Derived counts in prose".

**Mechanically validating description prose is not tractable and is not attempted.** This is a
stated, known-ungated surface: the safeguard is this instruction plus reviewer attention, which is
what caught it last time.

### Two probe traps that manufacture false premises

Both of these return a *clean-looking* result rather than an error, which is why they end up written
down as fact:

- **`check()` takes a `ProgramNode`; `execute()` takes source text.** Hand `check()` the source
  string instead of `parse(source, document).ast` and it reports **zero diagnostics** — a clean,
  confident, entirely false negative, with no error to warn you (measured: `check("define count …")`
  returns `[]`, while `check(parse(…).ast)` correctly reports `ol-reserved-word`).
- **Sanity-assert every harness before recording a result.** Feed it a case you *know* must fail
  (`define count` must raise `ol-reserved-word`) and confirm it does. A probe that returns "nothing"
  is an **unproven** result, not a negative one.

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
- [ ] `execute: true` set once (and only once) the fixture's program is execution-valid.
- [ ] Deterministic; no timing assertions.
- [ ] Correct `profiles` tag so profile-scoped runs pick it up.
- [ ] `ol-*` codes/spans asserted for every error case.
- [ ] Every factual claim in each `description` was **measured, not inferred** — especially one that
      justifies why a fixture is absent — and each probe behind it was sanity-asserted.
