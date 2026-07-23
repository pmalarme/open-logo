---
name: decompose-and-dispatch
description: >-
  How @orchestrator turns a spec area or milestone into vertical-slice task packets, assigns a primary
  owner, declares write-sets, and dispatches to the right agent. Use when planning a milestone, filing
  issues, or coordinating parallel domain work. Owns integration + the Definition of Done gate.
created: 2026-07-17T00:00
updated: 2026-07-23T00:00
---

## Purpose

Keep the factory moving in parallel without collisions: one owner per task, one PR per task, shared
contracts agreed first. You write no feature code — you decompose, dispatch, and integrate.

## Procedure

1. **Pick the milestone's profile set** from the spec DAG (`spec/conformance.md`) and confirm its
   dependency profiles are already conformant (entry criteria in `docs/delivery.md`).
2. **Fix the shared contracts first.** If the slice needs new AST nodes, event types, `ol-*` codes, or
   token classes, open one serialized contract PR (owner-reviewed) before fanning out.
3. **Cut vertical slices — small, dedicated, not phases** (see `shared/vertical-slice`): each slice is one feature end to end (semantics → runtime/events → render/UI → tests → teaching → docs) **and** small — roughly **one grammar production-family** (e.g. arithmetic precedence, comparison chains, `local` declarations) or an equivalently narrow unit, small enough to implement, self-review, and review in one focused session. **Any task large enough to become a marathon session MUST be split into smaller stories before dispatch.** #9 (the foundational lex → parse → AST slice, +3580/−15 lines across 12 files) is a **one-time bootstrapping exception**, not a template; the conformance-corpus epic #43 is the model — it organizes parser validation into ~22 small, single-production stories (S3 literals, S7 arithmetic, S9 chained comparisons … S22 reserved words and diagnostics), each designed to be independently dispatched, reviewed, and merged. When in doubt, cut smaller (KISS, charter §11).
4. **Emit a task packet per slice:** owning agent (`@agent`), the exact spec sections, acceptance
   criteria (Given/When/Then), the **declared write-set** (files/globs), dependencies, and the DoD.
5. **Dispatch to a controllable session — always kick off in autopilot, with a prompt.** Prefer a
   **local, coordinated** session per slice: `open_issue_session` / `create_session` with the
   issue's **owning custom agent**, `coordinate_with_creator: true`, and `notify_on_idle` so it
   reports its PR back. **The `kickoff` object is mandatory and MUST carry both a `prompt` and
   `mode: autopilot`** — this is what makes the session run autonomously to a PR. A session created
   **without** a kickoff prompt is born **idle** and sits waiting for the human to click it in the
   sidebar — the single most common reason a dispatched slice "never started"; and one created with
   a prompt but in `plan`/`interactive` mode auto-starts yet **pauses for approval/input** instead of
   running unattended to a PR. Only autopilot + prompt runs the slice to completion on its own. Never create an idle session and expect a follow-up
   `send_session_message` to launch it: a cold session won't wake from a message, and a warm one
   typically only does the git-sync/new-branch step then idles again, needing a second explicit
   go-kick. **One call, autopilot + prompt, or it will not run.**
   **The kickoff must require in-session self-review** (`shared/review-gate`): before opening the PR
   the owner dispatches at least two non-author sub-agents — the **logic/spec reviewer** (`rubber-duck`, or a named fallback)
   + **every** domain-adaptive **QA** expert (`@testing` and/or the changed area's owner) — and iterates
   on a committed HEAD until **each** returns `pass` on that SHA, then opens an already-green PR with all
   SHA-stamped verdicts attached. **Run the
   session on a Claude or GPT large model** so `rubber-duck` is available; if it is not, the owner
   substitutes a named second non-author domain agent for that review and records which agent stood in and why. **Avoid firing uncontrolled cloud agents at parallel
   slices:** they are not messageable and branch off each other, which in M0 stacked duplicate PRs
   off abandoned branches. Label issues by agent + profile so tracks pull in parallel.
   - **Require an explicit ACK, then verify — don't trust the returned session id.** Dispatching is
     not done when the tool returns a session id: a session can be created but sit idle, fail to
     kick off, or never pick up its prompt. Make the kickoff **self-reporting** — end the kickoff
     `prompt` with an explicit instruction: _"As your very first action, before any planning or
     work, send a cross-session message back to me (the orchestrator, session `<my-id>`) with
     `ACK: started <issue> in autopilot`, then proceed to build and open the PR."_ The ACK is the
     only reliable proof the session actually woke and began running its kickoff.
   - **Re-kickoff loop.** After dispatch, wait for that ACK (you'll also get an idle notification via
     `notify_on_idle`). If **no ACK arrives**, the session is almost certainly born-idle waiting for
     UI activation: (1) **re-send the go-kick** — `send_session_message` with the same prompt + ACK
     instruction **and `mode: autopilot`** (the tool's `mode` is a separate parameter — "same
     autopilot prompt" alone does not set it); (2) cross-check ground truth, since `get_session` metadata is stale —
     `git -C <session_path> rev-list --count origin/main..HEAD` and `git status --porcelain` reveal a
     session that is in fact working before any push; (3) if it still hasn't started after a re-kick,
     **escalate to the human to activate it in the sidebar** rather than assuming work is underway.
     Never mark a slice "in flight" on the strength of a session id alone.
6. **Integrate per story** with `integrate-and-merge`: **verify** the owner's attached non-author
   verdicts (≥2 — logic/spec reviewer + every QA expert; don't re-run the whole gate round-by-round), merge under delegated authority once CI is
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
- You never merge on green alone — every merge needs all the independent, non-author review-gate
  verdicts (≥2, attached by the implementer) plus required CI; a human merges unless the maintainer has
  delegated it (see `integrate-and-merge`).

## Checklist
- [ ] Profile entry criteria met; contracts agreed first.
- [ ] Each task = one vertical slice, one owner, one declared write-set, ACs + DoD.
- [ ] Each slice small + dedicated (~one grammar production-family); marathon-sized tasks split before dispatch (#9 = one-time exception; corpus epic #43's small stories S3–S22 = the model).
- [ ] Labels: `agent:*` + `profile:*` + `type:*`; dependencies noted.
- [ ] Dispatched via one `kickoff` call with `mode: autopilot` **and** a prompt (never idle-then-message); ACK requested in the prompt.
- [ ] Dispatched session verified **started** — ACK received (or, after re-kick, confirmed via `git rev-list`/`git status`; escalated to a human and left **blocked** if neither), not just created — before moving on.
- [ ] Integration owner assigned; milestone exit = conformance green everywhere.
