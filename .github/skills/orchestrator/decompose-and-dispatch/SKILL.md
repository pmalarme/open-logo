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
5. **Dispatch to a controllable session.** If the runtime passes the delegation smoke-test, invoke
   subagents directly; otherwise emit the `@agent` calls for a human to run. Prefer a **local,
   coordinated** session per slice — `open_issue_session` / `create_session` with the issue's
   **owning custom agent**, `mode: autopilot`, and `coordinate_with_creator: true` so it reports its
   PR back for the review gate (set `notify_on_idle`). **Avoid firing uncontrolled cloud agents at
   parallel slices:** they are not messageable and branch off each other, which in M0 stacked
   duplicate PRs off abandoned branches. Label issues by agent + profile so tracks pull in parallel.
6. **Integrate per story** with `integrate-and-merge`: run the independent review gate, merge under
   delegated authority, verify the merge, and reconcile the board/milestone/branches/plan. Hold the
   **Definition of Done** gate (`shared/definition-of-done`); an integration issue closes each
   milestone once conformance is green across all domains.

## Critical rules

- Serialize shared-file changes (grammar, contracts, manifests, CI). **Contracts grow one slice at a
  time** — the AST reserves every name in `OL_NODE_KINDS` but types each node shape only in the
  grammar slice that adds it, so a consumer slice (evaluate, highlight) is **hard-blocked** on the
  slice defining its nodes. _Agreed ≠ frozen_: parallelize only against a contract already merged to
  `main`.
- Every task names exactly one primary owner and a write-set; overlapping write-sets are serialized.
- You never merge on green alone — every merge needs an independent, non-author review-gate PASS
  plus required CI; a human merges unless the maintainer has delegated it (see `integrate-and-merge`).

## Checklist
- [ ] Profile entry criteria met; contracts agreed first.
- [ ] Each task = one vertical slice, one owner, one declared write-set, ACs + DoD.
- [ ] Labels: `agent:*` + `profile:*` + `type:*`; dependencies noted.
- [ ] Integration owner assigned; milestone exit = conformance green everywhere.
