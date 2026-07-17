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
  "events": [{ "seq": 1, "kind": "move", "source-span": {}, "payload": {} }],
  "diagnostics": [{ "code": "ol-not-enough-inputs", "source_span": {}, "stage": "semantic" }]
}
```

- **Events** use the normative envelope — `seq`, `kind`, `source-span` (hyphen), optional `turtle-id`,
  `payload` — with `kind` values from the `@openlogo/core` registry.
- **Diagnostics** use `code`, `source_span` (underscore), `params`, `stage`, `severity`. The
  hyphen/underscore split is intentional — match the spec exactly.
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

## M0 status

There is no `@openlogo/runtime` yet, so the harness's `produce()` is a deterministic placeholder that
emits nothing; the only positive fixture is the empty-program base case. When the evaluator lands,
`produce()` becomes a real runtime call and the corpus grows one behavior at a time (positive plus
negative fixtures per feature).
