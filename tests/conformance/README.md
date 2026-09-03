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
- **`description` is never validated.** The harness reads it and compares nothing, so a wrong
  description passes every check and misleads every later reader — and descriptions in this corpus
  are cited by later slices as settled fact. Measure what you assert, be hardest on prose justifying
  why a fixture is *absent*, and prefer pointing at the spec section or harness function that
  settles a claim over paraphrasing it. Its one-time neighbour in this list, a diagnostic `message`,
  is no longer unchecked (see below); **unknown top-level keys still are** — any such key is
  silently dropped rather than rejected, so an assertion written in an invented field asserts
  nothing. (Keys *inside* an expected diagnostic are now rejected by name.) See
  `.github/skills/shared/conformance-fixture/SKILL.md`.
- **Diagnostics** use `code`, `source_span` (underscore), `params`, `stage`, `severity` — all
  required and always compared — plus an optional `message`. **Any other key is rejected by name**,
  so a misspelled `mesage` fails the fixture instead of loading clean and asserting nothing.
- **`compareMessages` (optional, default `false`)** is the per-fixture opt-in that makes an expected
  diagnostic's `message` load-bearing (issue #1025). Both directions are fixture errors, which is
  what makes "present but ignored" impossible rather than merely cleaned up once:
  - a `message` **without** the flag is rejected — it would be compared against nothing;
  - the flag **without** any `message` is rejected — it asserts nothing, the same way
    `executeOptions` without `"execute": true` does.

  Inside an opted-in fixture the grain is per diagnostic: only those that carry a `message` have
  their prose asserted, so a fixture can pin one sentence and leave its siblings free.

  **Opt in only where the spec fixes the words.** The default is what `spec/error-model.md:255-260`
  asks for — "diagnostic identity is `code` plus `params`; prose is presentation" — and `:262-264`
  positively permits a template author to "reorder, inflect, or soften" a message, so most learner
  wording is presentation a conforming implementation may change. Freezing it would make this corpus
  resist a change the spec allows. `ol-reserved-word` is the case this exists for: `:125` prescribes
  the sentence *and* makes *keyword*, *primitive* and *alias* a MUST NOT inside it — a MUST NOT no
  harness can enforce without reading the text, and one that shipped violated twice (#751, #871)
  while the corpus stayed green. Today the only fixtures that opt in are the built-in-name ones
  (every live `message` in the corpus is an `ol-reserved-word`), plus the harness self-test below.
  Deliberately no count here: a number in prose is an assertion no gate re-checks, and this one was
  already stale once.

  `_harness-selftest/detects-message-mismatch` pins that the opt-in actually bites. **Do not combine
  `expect: "mismatch"` with a `message` anywhere else**: a self-test that exists to prove some
  *other* mismatch is detected would then be able to pass on prose while its real subject regresses.
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
- **`style` (optional, default `false`)** opts a `check` fixture into `check()`'s Layer-3 style
  lints (`ol-style-*`, issue #115) by passing `{ style: true }`. It is only meaningful alongside
  `"check": true`; every other check fixture stays Layer-2-only, so adding style rules never
  regresses the existing check corpus.
- **`executeOptions` (optional, object)** — only valid alongside `"execute": true` when `"check"`
  is not also `true` (since `check` takes precedence and short-circuits before `execute()` ever
  runs, see above) — is forwarded verbatim as `@openlogo/runtime`'s `execute()` third argument
  (`ExecuteOptions`). The harness allow-lists the **JSON-expressible** keys and rejects anything
  else by name, so a typo (`hostinput`, a stray `budget`) fails the fixture instead of loading
  clean and being silently ignored by `execute()`. Setting `executeOptions` without
  `"execute": true`, or alongside `"check": true`, is rejected for the same reason — either would
  otherwise silently do nothing (parse-only fixtures never call `execute()`, and `check:true`
  fixtures never reach the `execute()` branch either), masking a fixture-author typo. The
  allow-listed keys are:
  - **`instructionBudget`** / **`recursionDepthLimit`** (numbers) let a fixture deterministically
    trigger the execution-safety gates (`ol-limit`, `spec/execution-model.md`'s "Execution safety")
    with a small, hand-reviewable cap instead of the production defaults
    (`DEFAULT_INSTRUCTION_BUDGET` / `DEFAULT_RECURSION_DEPTH_LIMIT`, exported from
    `@openlogo/runtime`), which would make an exact-diff fixture impractically large. See
    `core-language/execution/forever-instruction-budget-limit.expected.json` and
    `recursion-depth-limit.expected.json`.
  - **`signal`** must be a plain `{ "aborted": boolean }` object — the only shape JSON can express
    and the only shape `execute()` needs (it just reads `signal.aborted`); a fixture can therefore
    only assert the already-cancelled-before-start case, not cancellation mid-run. See
    `core-language/execution/cancelled-before-start.expected.json`.
  - **`learnerLevel`** (string) is the learner's active curriculum level from
    `spec/educational-model.md`'s level table, threaded onto every `TutorContext.level` the run
    builds for the Educational meta-commands. `execute()` substitutes its default
    (`DEFAULT_LEARNER_LEVEL`) only when the option is **omitted**, so a value outside the level set
    is forwarded as written rather than corrected — the harness checks the type, not the vocabulary.
  - **`hostInput`** (object) is the host side of a headless run. It carries **two independent
    fields that are different mechanisms**, so read them separately:
    - **`hostInput.responses`** (array of strings) — the scripted answers this run's `input` reads
      consume. A **FIFO queue drawn from in order by every `input` call**, wherever it occurs (top
      level, a procedure body, a loop, a handler block). Each entry is the **raw text a learner
      would have typed**, which `input` then classifies per `spec/interaction-events.md`'s
      number-vs-word rule — so write `"42"`, not `42`; the harness rejects a bare JSON number
      precisely because it would look like proof of the number branch while skipping the parse that
      branch is about. With no answer left, a read takes the only other ending the spec allows and
      the program is cancelled with `ol-limit`. See `interaction-events/input/`.
    - **`hostInput.events`** (array) — a **tick-scheduled** list of the key presses, clicks, and
      named events a host would have delivered, so `on_key`/`on_click`/`when` handlers can be proven
      to fire, and to fire in the normative same-tick order. Each entry is a plain object with a
      finite numeric `tick` and a discriminated `kind`: `{ "tick": n, "kind": "key", "key": "x" }`,
      `{ "tick": n, "kind": "click" }`, or `{ "tick": n, "kind": "event", "event": "go" }`. No other
      field is permitted on an entry and unknown `kind`s are rejected, so a per-entry typo cannot
      mask a delivery that never happens. Entries may be listed in any order (they are stably sorted
      by `tick`). See `interaction-events/dispatch/` and
      `interaction-events/README.md`.

    Like `signal`, both fields can only express a **static** script fixed before the run starts, not
    input that reacts to what the program has done — that stays a unit-test concern.
  - **`randomSeed`** (number, issue #865) pins the seed the run's shared `random`/`randomize`
    generator starts from, in place of `execute()`'s own `Date.now()` fallback — so a fixture whose
    program uses `random` has a stable expected event stream at all, instead of being unusable. An
    explicit `(randomize seed)` in the program still takes precedence over it, since this is a host
    default rather than an override. Note what one fixture still cannot express: the property
    `randomSeed` creates is that two runs sharing a seed *agree*, and a fixture is one source to one
    expected stream, so cross-run determinism stays a unit-test concern
    (`packages/runtime/src/random-randomize.test.mjs`).
  - **Function-valued options are rejected as unknown keys**, with the offending key named in the
    error, rather than silently dropped: JSON cannot express a function, so
    `executeOptions.tutorTemplates` (the injectable Educational template) and `hostInput.read` (the
    live `input` reader) are fixture-author mistakes. Do not try to write them; use
    `hostInput.responses` for scripted answers and cover the reactive seams with unit tests in
    `packages/runtime/src/`.
- Keep results **deterministic**: assert semantic events and final state, never timing or frames.

### `profiles` gates an executed fixture, it does not merely select it

`profiles` is the fixture's **active conformance profile set**. It decides whether the fixture runs
under a given `--profile` pass — and, for an `"execute": true` fixture, it is also **enforced**
(issue #790). The harness statically detects which optional profiles the source actually uses
(`scripts/profile-detection.mjs`, the same detector the examples gate applies to
`spec/examples/*.logo`) and fails the fixture as off-contract when the declared set — expanded to its
dependency closure, so `"geometry"` already covers `"data"` — does not cover them.

It used to only select: `profiles` never reached `execute()`, so a fixture whose source used Sprites
forms passed with `"sprites"` deleted from its array, and the declaration was documentation rather
than enforcement. Correcting that surfaced 8 fixtures under `core-language/execution/` that executed
`:nums[i]` while claiming Core alone — Data by `spec/conformance.md:269`, "only Data-claiming
implementations execute the list case".

The gate applies to **executed** fixtures only, and the two exclusions are deliberate:

- **`check` fixtures are already gated for real** — `produce()` passes `profiles` into `check()`,
  which resolves primitives through the active set. Those fixtures deliberately name an *inactive*
  profile's forms (`heritage/check/heritage-forms-rejected-in-core` and its siblings exist precisely
  to prove the rejection), so a static under-declaration gate would fail correct fixtures.
- **Parse-only fixtures have no profile semantics to gate** — `spec/conformance.md:120` states that
  the postfix-read grammar a list index uses "is unconditional Core syntax", so a Core-only fixture
  that merely *parses* `:nums[2]` is right as written.

The harness validates every `kind` and `code` against the `@openlogo/core` registries, and every
`profiles` tag against its own `PROFILE_DEPS` table (transcribed from `spec/conformance.md`'s DAG),
so a fixture can never assert an off-contract shape.

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

**Record struct type (optional):** a plain field shape alone cannot distinguish two different
`struct` types that happen to declare identical field names (e.g. `struct point [ x y ]` and
`struct vector [ x y ]` both built with `3 4`) — both would unwrap to the same `{"x": 3, "y": 4}`.
A fixture that needs to assert WHICH struct type an actual record is (not just its field contents)
opts in by adding the reserved `"__type"` key alongside the record's usual field keys, e.g.
`{"__type": "point", "x": 3, "y": 4}`; the harness then rejects a record of any other struct type
at that position before comparing fields. Omitting `__type` (every existing fixture) keeps the
previous behavior exactly: any record with matching field contents matches, regardless of its
struct type.

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

## Characterization fixtures: locking behaviour that is *wrong*

Almost every fixture here asserts what the spec says must happen. A handful assert what the
implementation **currently does while it is known to be wrong**, and they are labelled
`CHARACTERIZATION FIXTURE` in the first words of their `description`. They exist for one class of
defect: one where the program produces **no diagnostic and no crash**, so a fixture that merely runs
the program passes against the broken build and the regression wall can only be built *before* the
fix, never after.

The current set belongs to saga #811 (a statement containing an unresolvable name is silently
discarded) and was authored under issue #816:

```text
core-language/unresolvable-name/            interaction-events/unresolvable-name/
turtle-rendering/unresolvable-name/         interaction-events/command-in-value-position/
turtle-rendering/command-in-value-position/
```

Three rules keep them from becoming a trap:

- **Each one names the ruling that will retire it.** A characterization `description` states that it
  locks today's defective behaviour and must be **flipped** when the blocking `[spec]` ruling lands
  (#814) and the runtime slice implements it (#815). A future reader must never mistake one of these
  for a statement about the contract.
- **Their neighbours are the opposite.** `arity-still-diagnosed/` and `profile-argument/` assert
  **correct** behaviour that must survive the fix unchanged, and they say so. `recursion-collapses-
  silently-execute` is paired with `recursion-baseline-unaffected` for the same reason: the fix has
  to change one column and leave the other alone.
- **They were proven to bite.** Every fixture in the set was perturbed and the harness confirmed to
  report `FAIL`, because an assertion whose content is "nothing happened" is the easiest kind to
  write vacuously.

Two related assertions are deliberately **not** fixtures, and knowing why avoids a fruitless search:

- The **no-false-positive sweep** over `spec/examples/*.logo` (#816 item 7) is a property over a
  whole corpus rather than one source paired with one expected stream, so it lives in
  `scripts/examples-semantic-sweep.test.mjs` and runs under `npm run test`.
- The `PLANT` fractal that #816 item 3 names is **not in this repository**, so its inherited
  draw-segment counts are asserted nowhere. `turtle-rendering/unresolvable-name/recursion-*` covers
  the same end-to-end shape with a small recursive tree written for the purpose, whose numbers were
  measured from it.

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
