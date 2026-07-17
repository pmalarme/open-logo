---
name: decompose-and-dispatch
description: >-
  How @orchestrator turns a spec area or milestone into vertical-slice task packets, assigns a primary
  owner, declares write-sets, and dispatches to the right agent. Use when planning a milestone, filing
  issues, or coordinating parallel domain work. Owns integration + the Definition of Done gate.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Keep the factory moving in parallel without collisions: one owner per task, one PR per task, shared
contracts agreed first. You write no feature code — you decompose, dispatch, and integrate.

## Procedure

1. **Pick the milestone's profile set** from the spec DAG (`spec/conformance.md`) and confirm its
   dependency profiles are already conformant (entry criteria in `docs/delivery.md`).
2. **Fix the shared contracts first.** If the slice needs new AST nodes, event types, `ol-*` codes, or
   token classes, open one serialized contract PR (owner-reviewed) before fanning out.
3. **Cut vertical slices, not phases** (see `shared/vertical-slice`): each slice is one feature end to
   end (semantics → runtime/events → render/UI → tests → teaching → docs).
4. **Emit a task packet per slice:** owning agent (`@agent`), the exact spec sections, acceptance
   criteria (Given/When/Then), the **declared write-set** (files/globs), dependencies, and the DoD.
5. **Dispatch:** if the runtime passes the delegation smoke-test, invoke subagents directly; otherwise
   emit the `@agent` calls for a human to run. Label issues by agent + profile so tracks pull in
   parallel.
6. **Integrate per story** and hold the **Definition of Done** gate (`shared/definition-of-done`); an
   integration issue closes each milestone once conformance is green across all domains.

## Critical rules

- Serialize shared-file changes (grammar, contracts, manifests, CI); parallelize only behind agreed
  contracts.
- Every task names exactly one primary owner and a write-set; overlapping write-sets are serialized.
- You never merge on green alone — humans + required CI checks gate merges.

## Checklist
- [ ] Profile entry criteria met; contracts agreed first.
- [ ] Each task = one vertical slice, one owner, one declared write-set, ACs + DoD.
- [ ] Labels: `agent:*` + `profile:*` + `type:*`; dependencies noted.
- [ ] Integration owner assigned; milestone exit = conformance green everywhere.
