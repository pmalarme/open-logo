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
`profiles` array).

## Decision

Ship the harness (`scripts/conformance.mjs`) with real mechanics and a placeholder executor.

1. **Fixture format follows the skill, with one resolved ambiguity.** The runner discovers every
   `*.expected.json` under `tests/conformance/**`, pairs it with the sibling `.logo`, and reads
   `{ description, profiles, events, diagnostics }`. Both events and diagnostics use `source_span`
   (underscore) — the skill's draft anticipated a hyphenated `source-span` for events to match a
   stale spec placeholder, but `spec/execution-model.md` never actually requires the hyphen, and
   `@openlogo/core`'s `TraceEvent` envelope uses `source_span`. Issue #90 resolved this: one
   field-name convention throughout, matching the core contract exactly, so there is no wire
   conversion step between the in-memory `TraceEvent` and the fixture JSON.

2. **Placeholder `produce()`.** With no runtime, `produce(source, profiles)` returns
   `{ events: [], diagnostics: [] }`. The one positive fixture asserts the empty-program base case
   (no events, no diagnostics — genuinely true). When the evaluator lands, `produce()` becomes a real
   runtime call and the corpus grows per behaviour. Everything else — discovery, selection, contract
   validation, diffing, exit codes — is real now.

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

7. **Execution is opt-in per fixture (issue #90).** Once `@openlogo/runtime` existed, `produce()`
   gained a `shouldExecute` parameter threaded from a new optional `"execute": true` fixture field
   (default `false`). The 50+ existing fixtures are parse-focused, not all execution-valid (many
   reference undefined variables or not-yet-implemented features), so execution must never run by
   default — only a fixture that explicitly opts in gets its AST executed via `@openlogo/runtime`'s
   `execute()`; every other fixture stays on the original parse-only path. `execute()` itself is the
   minimal foundational spine: it emits one `instruction` start event per top-level statement and no
   more — no arithmetic, variables, control flow, procedures, comprehensions, or `print` semantics.
   Those land one evaluator vertical slice at a time (issues #93-#105), each fixture that exercises
   them opting in the same way.

## Consequences

- `npm run conformance` and the CI conformance job run a real harness today: 1 passing fixture, 1
  self-test, exit 0; a real mismatch (or off-contract fixture) exits non-zero with the offending
  `seq`/`code` and a diff.
- `@testing` extends the corpus as features land by swapping `produce()` for a runtime call and adding
  positive + negative fixtures per behaviour; the harness itself should not need to change.
- The `expect: "mismatch"` convention is harness-specific; real behavioural fixtures never use it. A
  future fuzz/stability layer (per `testing/ci-and-conformance`) builds on this runner.
- The harness stays `.mjs` alongside the other gate scripts; if `@testing` later prefers a typed
  runner, that is a separate, isolated change.
