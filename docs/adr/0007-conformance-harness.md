# 7. Conformance harness (stack-neutral fixture runner)

- Status: Accepted
- Date: 2026-07-17
- Deciders: OpenLogo maintainer (@pmalarme) + testing + orchestrator
- Related: [`spec/conformance.md`](../../spec/conformance.md) (profiles + DAG);
  [`spec/execution-model.md`](../../spec/execution-model.md) (event envelope);
  [`spec/error-model.md`](../../spec/error-model.md) (`ol-*` diagnostics); the
  `shared/conformance-fixture` and `testing/ci-and-conformance` skills; ADR-0006
  (cross-cutting contracts); issue #6

## Context

Conformance is the primary proof-of-correctness gate in the Definition of Done (team agreement
§5.4): behaviour is proven by stack-neutral `source → events/diagnostics` fixtures, not prose.
Issue #6 asks for the harness that runs them — profile-aware, headless, deterministic, non-zero on
mismatch, with a readable diff — wired into `npm run conformance` and the CI conformance job.

Two facts shape the design. First, `@openlogo/runtime` does not exist yet at M0, so there is nothing
to execute fixtures against. Second, the acceptance criteria ask for both a passing fixture and a
"failing" one that demonstrates mismatch detection — but a genuinely failing fixture in the corpus
would turn the CI gate red forever. The fixture format itself is already fixed by the
`shared/conformance-fixture` skill (flat `<feature>.logo` + `<feature>.expected.json` pair, a
`profiles` array, event `source-span` with a hyphen, diagnostic `source_span` with an underscore).

## Decision

Ship the harness (`scripts/conformance.mjs`) with real mechanics and a placeholder executor.

1. **Fixture format follows the skill verbatim.** The runner discovers every `*.expected.json` under
   `tests/conformance/**`, pairs it with the sibling `.logo`, and reads `{ description, profiles,
   events, diagnostics }`. Events keep `source-span` (hyphen); diagnostics keep `source_span`
   (underscore), matching the spec.

2. **Placeholder `produce()`.** With no runtime, `produce(source, profiles)` returns
   `{ events: [], diagnostics: [] }`. The one positive fixture asserts the empty-program base case
   (no events, no diagnostics — genuinely true). When the evaluator lands, `produce()` becomes a real
   runtime call and the corpus grows per behaviour. Everything else — discovery, selection, contract
   validation, diffing, exit codes — is real now.
   
   **Status: Superseded by ADR-0010** (2026-07-18). `produce()` now calls `@openlogo/parser` and
   emits real parse diagnostics.

3. **Self-verifying negative path via `expect: "mismatch"`.** Fixtures under `_harness-selftest/`
   assert output that execution can never produce (a `move` event from an empty program) and set
   `"expect": "mismatch"`. The runner treats a correctly detected mismatch as a **pass** and prints
   the diff as a live demonstration; only an unexpected match fails. Both the matching and mismatching
   paths run every time while the gate stays green. This is the one extension to the skill's fixture
   shape — an optional `expect` field, default `"match"`.

4. **Profile selection is DAG-aware.** `--profile <id>` runs fixtures whose `profiles` intersect the
   dependency closure of `<id>` (from `spec/conformance.md`), so selecting `turtle-rendering` also
   runs `core-language`; no flag runs the full DAG. Self-tests always run.

5. **Fixtures are validated against the contracts.** The harness imports `OL_EVENT_KINDS`,
   `OL_DIAGNOSTIC_CODES`, and `OL_STYLE_DIAGNOSTIC_CODES` from `@openlogo/core` (ADR-0006) and rejects
   any fixture referencing an unregistered kind, code, or profile — making the #7 contracts
   load-bearing and catching fixture typos.

6. **`preconformance` build hook.** Because the harness imports built `@openlogo/core`, a
   `"preconformance": "npm run -s build"` script makes `npm run conformance` self-contained on a fresh
   `npm ci` checkout (the same lesson as `pretest` in ADR-0006). This is npm-native; no CI workflow
   YAML changes.

## Consequences

- `npm run conformance` and the CI conformance job run a real harness today: 1 passing fixture, 1
  self-test, exit 0; a real mismatch (or off-contract fixture) exits non-zero with the offending
  `seq`/`code` and a diff.
- `@testing` extends the corpus as features land by swapping `produce()` for a runtime call and adding
  positive + negative fixtures per behaviour; the harness itself should not need to change.
  
  **Update (ADR-0010, 2026-07-18):** `produce()` now calls the real `@openlogo/parser`. The corpus
  has grown to 3 parser fixtures (assign-and-print, empty-program, unterminated-string) plus 1
  mismatch self-test, total 4 passed.
- The `expect: "mismatch"` convention is harness-specific; real behavioural fixtures never use it. A
  future fuzz/stability layer (per `testing/ci-and-conformance`) builds on this runner.
- The harness stays `.mjs` alongside the other gate scripts; if `@testing` later prefers a typed
  runner, that is a separate, isolated change.
