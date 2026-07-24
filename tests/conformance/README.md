# Conformance fixtures

Stack-neutral proof of correctness for OpenLogo. Each fixture maps a `.logo` source to the exact
trace **events** and `ol-*` **diagnostics** it must produce, so any conforming implementation — this
one or a future rewrite — can be checked against the same corpus. Conformance is the primary
Definition-of-Done gate (see `.github/skills/shared/conformance-fixture/SKILL.md` and
`docs/adr/0007-conformance-harness.md`).

## Layout

```text
tests/conformance/<profile>/<feature>/<feature>.logo
tests/conformance/<profile>/<feature>/<feature>.expected.json
```

Group fixtures by the owning profile (`core-language`, `turtle-rendering`, …) so a run can target one
profile or the whole DAG. The runner discovers every `*.expected.json` and pairs it with the sibling
`.logo` of the same stem.

## Fixture shape

`<feature>.expected.json`:

```json
{
  "description": "human-readable intent",
  "profiles": ["core-language"],
  "events": [{ "seq": 0, "kind": "instruction", "source_span": {}, "payload": {} }],
  "diagnostics": [{ "code": "ol-not-enough-inputs", "source_span": {}, "stage": "semantic" }]
}
```

- **Events and diagnostics both use `source_span` (underscore)** — one field-name convention
  throughout the fixture contract, matching the `TraceEvent`/`Diagnostic` envelopes in
  `@openlogo/core`. `kind` values come from the `@openlogo/core` event registry.
- **Diagnostics** use `code`, `source_span` (underscore), `params`, `stage`, `severity`.
- **`execute` (optional, default `false`)** opts a fixture into execution. When `false` (or
  absent), `produce()` stays parse-only — it calls `@openlogo/parser`'s `parse()` and always
  returns `events: []`, exactly as the existing parse-focused corpus expects (many of those
  fixtures are not execution-valid). When `true`, `produce()` calls `@openlogo/runtime`'s
  `execute()` instead, which parses internally and also walks the AST, so `events` and
  `diagnostics` reflect real execution. Only opt a fixture in once its source is genuinely
  execution-valid.
- **`check` (optional, default `false`)** opts a fixture into semantic checking. When `true`,
  `produce()` calls `parse()` and, if parsing produced no diagnostic, feeds the resulting AST and
  the fixture's `profiles` to `@openlogo/parser`'s `check()` (issue #116), returning the
  semantic/style diagnostics it found — `events` stays `[]`. `check` and `execute` are mutually
  exclusive per fixture; `check` takes precedence if both are set. Diagnostics from `check()` use
  `stage: "semantic"` (or `"parse"`/`ol-style-*` where applicable), same C10 shape as everywhere
  else.
- **`executeOptions` (optional, object)** — only valid alongside `"execute": true` when `"check"`
  is not also `true` (since `check` takes precedence and short-circuits before `execute()` ever
  runs, see above) — is
  forwarded verbatim as `@openlogo/runtime`'s `execute()` third argument (`ExecuteOptions`:
  `instructionBudget`, `recursionDepthLimit`, `signal`). It exists so a fixture can deterministically
  trigger the execution-safety gates (`ol-limit`, `spec/execution-model.md:551-557`) with a small,
  hand-reviewable budget/depth instead of the large production defaults (1,000,000
  instructions / 500 call frames), which would make an exact-diff fixture impractically large.
  `signal`, when present, must be a plain `{ "aborted": boolean }` object — the only shape JSON can
  express and the only shape `execute()` needs (it just reads `signal.aborted`); a fixture can
  therefore only assert the already-cancelled-before-start case, not cancellation mid-run.
  Setting `executeOptions` without `"execute": true`, or alongside `"check": true`, is rejected —
  either would otherwise silently do nothing (parse-only fixtures never call `execute()`, and
  `check:true` fixtures never reach the `execute()` branch either), masking a fixture-author typo.
  See
  `tests/conformance/core-language/execution/forever-instruction-budget-limit.expected.json`,
  `recursion-depth-limit.expected.json`, and `cancelled-before-start.expected.json` for examples.
- Keep results **deterministic**: assert semantic events and final state, never timing or frames.

The harness validates every `kind`, `code`, and `profiles` tag against the `@openlogo/core`
registries, so a fixture can never assert an off-contract shape.

## Graph fixtures: asserting reference identity and cycles (`$id` / `$ref`)

`events`/`diagnostics` are compared with plain JSON deep-equality by default. JSON alone cannot
express two things `spec/execution-model.md` now requires of effect-event payloads and of
`print`/`show` rendering:

1. Effect-event payloads are **point-in-time snapshots** (transitive/recursive capture) of mutable
   program values at emission time — not live references — and MUST preserve alias/cycle topology
   via **snapshot-local reference identity**, terminating via a whole-capture memo.
2. Rendering a value's printed form (`print`/`throw`/`show`) MUST terminate on cyclic or shared
   structure via a **whole-render identity memo** (not just current-path cycle detection), so
   repeated/self-referential structure gets bounded placeholder treatment instead of infinite
   recursion or host stack overflow (tied to `spec/error-model.md`'s `ol-limit` guardrail).

Neither claim — "these two positions are the same underlying reference" or "this structure
contains itself" — can be written as plain JSON. To make both provable, an `expected` `events` or
`diagnostics` item may tag any node (list, dict, record, or even a primitive) with one of two
markers:

**Dict/record contents:** an actual value that is an `OLDict` or `OLRecord` runtime instance is
unwrapped into a plain key→value object (dict keys via their canonical string form; record fields
via their declared spelling) before the comparator recurses into it — a fixture writes the expected
shape as a plain JSON object either way (e.g. `{"tom": 8, "sophie": 6}` for a dict, `{"x": 1, "y":
2}` for a `point` record), and its exact contents are genuinely deep-compared, including through
`$id`/`$ref` aliasing (the identity binding tracks the original `OLDict`/`OLRecord` reference, not
the unwrapped view, so two positions holding the same live dict/record still resolve as the same
reference).

- `{"$id": "<label>", "$value": <expected-shape-of-the-first-occurrence>}` — marks the **first**
  occurrence of a reference and gives it a fixture-local `label` (any string, unique within the
  fixture — a second `$id` reusing the same `label`, anywhere later in the fixture, is itself a
  fixture error the harness reports, never silently accepted: this holds whether the second `$id`'s
  actual reference turns out to be a different object than the first (a genuine label collision)
  or turns out to be the exact same one the first `$id` already bound (a fixture that should have
  used `$ref` for the repeat instead of redeclaring `$id`). The harness compares `$value`
  structurally/recursively as usual, then remembers which **actual** reference occupied this
  position under `label`. Tagging a primitive with `$id` is allowed for readability, but since JS
  primitives compare by value, not reference, it only asserts the value matches — it does not
  register or require any alias binding.
- `{"$ref": "<label>"}` — asserts that this position holds **the same actual reference** as the
  `$id` earlier bound to `label` (identity, i.e. `===` on the runtime value — not "an equal but
  distinct copy"). A fixture can use this both ways: to prove sharing/aliasing *was* preserved
  (matching `$ref`s), and — because the harness also rejects any *unexpected* aliasing it wasn't
  told about — to prove two positions are independent clones when the fixture leaves them
  untagged (or gives them different `$id` labels) while the actual runtime output reuses one
  reference for both, or a plain untagged position reuses a reference already bound to some
  `$id`. Either case is reported as a mismatch, so accidental sharing/cloning bugs surface exactly
  like any other event/diagnostic mismatch.

`$id`/`$ref` labels are scoped to a single `events` item or a single `diagnostics` item — never
shared across two different items, and never across the `events`/`diagnostics` streams. Per
`spec/execution-model.md`'s effect-event snapshot rule, each event (or diagnostic) is an
independently captured, sealed snapshot: the spec guarantees alias/cycle identity WITHIN one
event's payload, but makes no identity guarantee ACROSS two different events. A `$ref` naming an
`$id` declared in a different fixture item is therefore an undefined reference — the harness
reports it as a clean mismatch, not a silent (and false) cross-item resolution.

A cycle is simply a `$ref` that resolves back to an ancestor `$id` still being compared — the
harness registers the `$id` binding *before* recursing into `$value`, so a self-referential
`$ref` inside that same `$value` resolves correctly instead of recursing forever.

Example — a self-referential list (`:l = [1 2]`, then `add :l to :l`, per
`spec/data-structures.md`'s `add` semantics) printed with `print :l`:

```json
{
  "events": [
    {
      "seq": 0,
      "kind": "print",
      "source_span": {},
      "payload": {
        "values": [{ "$id": "l", "$value": [1, 2, { "$ref": "l" }] }]
      }
    }
  ]
}
```

Example — an acyclic but *shared* sub-list appearing twice (`:a = [1 2]`, `:s = (list :a :a)`,
`print :s`) proving the snapshot did **not** collapse the repeated structure and did preserve the
sharing:

```json
{
  "events": [
    {
      "seq": 0,
      "kind": "print",
      "source_span": {},
      "payload": {
        "values": [
          [{ "$id": "a", "$value": [1, 2] }, { "$ref": "a" }]
        ]
      }
    }
  ]
}
```

Fixtures with **no** `$id`/`$ref` marker anywhere are entirely unaffected: the harness detects
markers up front and only takes the identity-aware comparison path when at least one is present,
so the existing marker-free corpus keeps comparing exactly as before (plain recursive
deep-equality) — this extension is purely additive and fully backward compatible.

**Implementation-status note:** the exact placeholder text/shape `printedForm` emits for a
repeated/cyclic reference is left implementation-defined by `spec/execution-model.md` (it gives
"an ellipsis or a repeated-reference marker" as an example, not a mandated literal). This corpus
and the reference runtime currently render it as the literal `...` (see `CYCLIC_PLACEHOLDER` in
`packages/runtime/src/evaluate.ts`); a future spec clarification may pin this down more precisely,
at which point both the runtime and any fixture asserting rendered text would need to move
together.

## Running

```bash
npm run conformance                 # full DAG
node scripts/conformance.mjs --profile core-language   # one profile + its dependencies
```

The runner is headless, exits non-zero on any mismatch, and reports the offending `seq`/`code` with a
readable diff. `npm run conformance` builds `@openlogo/core` first (`preconformance`), so it is
self-contained on a fresh checkout.

## Harness self-tests

Fixtures under `_harness-selftest/` carry `"expect": "mismatch"` and assert output that execution can
never produce. They prove the runner **detects and reports** a mismatch — a correctly detected
mismatch is a pass — so every run exercises both the matching and the mismatching path while the gate
stays green. They are not profile fixtures and always run.

## M1 status

`@openlogo/runtime` now exposes a minimal `execute(source, document)` entry point (issue #90):
it parses the source and emits one `instruction` start event per top-level statement — the
generic per-statement marker every evaluator slice builds on — but implements no evaluation
semantics yet (no arithmetic, variables, control flow, procedures, comprehensions, or `print`).
`produce()` is parse-only by default; a fixture opts into calling `execute()` with
`"execute": true` (see "Fixture shape" above). The corpus grows one behavior at a time as each
evaluator slice (issues #93-#105) lands, adding positive and negative fixtures per feature.

`@openlogo/parser` now also exposes a `check(program, options)` entry point (issue #116): the
Layer-2/Layer-3 static-analysis skeleton that epic #108's six rule slices (#117 unknown-command,
#111 arity, #113 name/place, #114 control-flow, #112 type/field, #115 style) extend one at a time.
It consults `options.profiles` (default Core Language only) for name/form visibility but
implements no rule yet, so every document currently checks clean. A fixture opts into calling it
with `"check": true` (see "Fixture shape" above).
