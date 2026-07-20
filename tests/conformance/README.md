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
