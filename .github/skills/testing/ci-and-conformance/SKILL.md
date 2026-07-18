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
   only "claimed" when it and its dependencies pass.
2. **Coverage:** enforce 100% line/branch/function coverage for all delivered code (`npm run coverage`;
   only files loaded by tests are counted, so stub packages with no runtime yet don't drag the number
   down — but any shipped code must be fully covered).
3. **Negative + fuzz:** malformed programs assert the right `ol-*` code + span (not just "an error");
   fuzz the reader/parser for stability.
4. **Stability:** `repeat 10000 [ forward 1 ]` and nested `repeat` validate the **execution budget +
   cancellation** at the event level (not frames) and stay within time/memory bounds.
5. **Regression:** every fixed bug gains a fixture so it can't return.
6. **CI (`shared/definition-of-done`):** wire `.github/workflows/` to run build, type-check/lint, unit,
   **coverage**, **conformance**, runnable examples, and applicable a11y/pedagogy checks on every PR.
   Required checks gate merges — the agent never merges.
7. **Post-M0 maintenance:** optional scheduled nightly conformance/stability + grammar-vs-highlighter
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
- [ ] CI enforces the full DoD; merges gated by required checks.
