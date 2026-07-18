---
name: decompose-and-dispatch
description: >-
  How @orchestrator turns a spec area or milestone into vertical-slice task packets, assigns a primary
  owner, declares write-sets, and dispatches to the right agent. Use when planning a milestone, filing
  issues, or coordinating parallel domain work. Owns integration + the Definition of Done gate.
created: 2026-07-17T00:00
updated: 2026-07-17T23:40
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
5. **Dispatch to a controllable session.** Prefer a **local, coordinated** session per slice —
   `open_issue_session` / `create_session` with the issue's **owning custom agent**, `mode:
   autopilot`, and `coordinate_with_creator: true` (set `notify_on_idle`) so it reports its PR back.
   **The kickoff must require in-session self-review** (`shared/review-gate`): before opening the PR
   the owner dispatches two non-author sub-agents — `rubber-duck` + a domain-adaptive **QA** expert
   (`@testing` and/or the changed area's owner) — and iterates on a committed HEAD until both `pass`
   on that SHA, then opens an already-green PR with both SHA-stamped verdicts attached. **Run the
   session on a Claude or GPT large model** so `rubber-duck` is available; if it is not, the owner
   substitutes a second non-author domain agent for that review. **Avoid firing uncontrolled cloud agents at parallel
   slices:** they are not messageable and branch off each other, which in M0 stacked duplicate PRs
   off abandoned branches. Label issues by agent + profile so tracks pull in parallel.
6. **Integrate per story** with `integrate-and-merge`: **verify** the owner's two attached non-author
   verdicts (don't re-run the whole gate round-by-round), merge under delegated authority once CI is
   green, then reconcile the board/milestone/branches/plan. Hold the **Definition of Done** gate
   (`shared/definition-of-done`); an integration issue closes each milestone once conformance is
   green across all domains.

## Critical rules

- Serialize shared-file changes (grammar, contracts, manifests, CI). **Contracts grow one slice at a
  time** — the AST reserves every name in `OL_NODE_KINDS` but types each node shape only in the
  grammar slice that adds it, so a consumer slice (evaluate, highlight) is **hard-blocked** on the
  slice defining its nodes. _Agreed ≠ frozen_: parallelize only against a contract already merged to
  `main`.
- Every task names exactly one primary owner and a write-set; overlapping write-sets are serialized.
- **`@openlogo/parser` is co-owned — split slices by pipeline stage.** The **lex → reader → parse →
  AST** construction, semantic analysis, and evaluation are **`@interpreter`** (e.g. #9 lex/parse→AST,
  #10 evaluate). Grammar/keyword/reserved-word evolution and the **grammar-derived tooling** —
  highlighter / semantic token classes and the syntax/semantic checker — are **`@language-designer`**
  (e.g. #11 highlighter). Both hold `execute` and ship their own PRs; the AST node shapes are the
  shared contract (interpreter-authored, language-designer-reviewed, grown one slice at a time). Never
  route the lex/parse/AST slice to `@language-designer` or the highlighter/checker slice to
  `@interpreter`.
- You never merge on green alone — every merge needs the two independent, non-author review-gate
  verdicts (attached by the implementer) plus required CI; a human merges unless the maintainer has
  delegated it (see `integrate-and-merge`).

## Checklist
- [ ] Profile entry criteria met; contracts agreed first.
- [ ] Each task = one vertical slice, one owner, one declared write-set, ACs + DoD.
- [ ] Labels: `agent:*` + `profile:*` + `type:*`; dependencies noted.
- [ ] Integration owner assigned; milestone exit = conformance green everywhere.
