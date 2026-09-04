---
name: ci-and-conformance
description: >-
  How @testing builds the conformance harness and CI that enforce the Definition of Done — running the
  profile-DAG fixtures, negative/fuzz/regression, stability, and a11y/pedagogy checks. Use for CI
  workflows, the conformance runner, and stability testing. Fixtures are stack-neutral.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Make "done" and "releasable" objective and automatic. Conformance is the gate every release passes
through (`docs/delivery.md`); you own the harness and the CI that runs it.

## Procedure

1. **Conformance harness:** load stack-neutral fixtures (`shared/conformance-fixture`) — `source` +
   expected `events`/`diagnostics` — and run them by **profile**, respecting the DAG so a profile is
   only "claimed" when it and its dependencies pass. An `execute: true` fixture's `profiles` array is
   **enforced**, not merely used to select it (issue #790, `tests/conformance/README.md`): the
   harness statically detects the optional profiles its source uses and fails the fixture when the
   declared closure does not cover them, so a fixture cannot depend on a profile it never claims.
2. **Coverage:** enforce 100% line/branch/function coverage for all delivered code (`npm run coverage`;
   only files loaded by tests are counted, so stub packages with no runtime yet don't drag the number
   down — but any shipped code must be fully covered).
3. **Negative + fuzz:** malformed programs assert the right `ol-*` code + span (not just "an error");
   fuzz the reader/parser for stability.
4. **Stability:** `repeat 10000 [ forward 1 ]` and nested `repeat` validate the **execution budget +
   cancellation** at the event level (not frames) and stay within time/memory bounds.
5. **Regression:** every fixed bug gains a fixture so it can't return.
6. **Documentation examples:** `npm run examples` runs `spec/examples/*.logo` **and** every
   ` ```logo ` block fenced in `spec/**.md` / `docs/**.md` (`scripts/markdown-examples-gate.mjs`,
   issue #850, ADR-0022). An example whose contract is interactive is driven by the declarative
   host-input schedule in `scripts/examples-host-input.json` and must produce the output that entry
   asserts (issue #955) — an empty host makes every `on_key`/`on_click` handler unreachable, so
   without a schedule the gate proves only that the program parses and executes. One uniform rule:
   a block runs clean, or it is listed in
   `scripts/markdown-examples-expectations.json` where its exact `ol-*` codes (or unimplemented
   profiles) are **asserted** — so a deliberately-invalid teaching example is proven to keep raising
   its documented diagnostic, and a listed block that becomes clean fails as stale. There is no
   automatic tolerance, so a misspelled command in an excerpt fails like any other defect. The one
   honest limit is reported, not hidden: execution stops at a block's first runtime error, so the
   gate prints `PARTIAL` and a count for blocks whose later lines were statically checked but never
   run.
7. **CI (`shared/definition-of-done`):** wire `.github/workflows/` to run build, type-check/lint, unit,
   **coverage**, **conformance**, runnable examples, **the built-in-names drift gate**
   (`npm run built-in-names` — `spec/built-in-names.json` against `@openlogo/parser`'s registries in
   both directions, plus the three hand-maintained prose lists;
   [ADR-0021](../../../../docs/adr/0021-built-in-names-list-and-ci-gate.md)), and applicable
   a11y/pedagogy checks on every PR. Required checks gate merges — the agent never merges.
8. **Post-M0 maintenance:** optional scheduled nightly conformance/stability + grammar-vs-highlighter
   drift checks that auto-file issues on regression.

## Critical rules

- Fixtures are stack-neutral and seeded **before/with** implementation, not after.
- Test semantics (events/diagnostics), not pixels or timing.
- Green CI is necessary but not sufficient — humans + required checks gate merges (the maintainer may
  delegate merge execution to `@orchestrator` only, after a non-author review-gate PASS).

## Checklist
- [ ] Fixtures run per profile along the DAG; claims gated by conformance.
- [ ] Coverage enforced: 100% line/branch/function for all delivered code.
- [ ] Negative asserts exact `ol-*` code + span; fuzz + regression covered.
- [ ] Stability: budget + cancellation at event level within bounds.
- [ ] Documentation `logo` blocks parse + run (or are asserted in the expectations manifest).
- [ ] CI enforces the full DoD; merges gated by required checks.
