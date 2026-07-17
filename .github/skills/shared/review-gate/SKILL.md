---
name: review-gate
description: >-
  The OpenLogo independent pre-merge review gate — how an agent that did NOT author a change re-runs
  the Definition of Done from a clean tree (verifying the build actually emits artifacts), checks
  spec-fidelity, conformance, runnable examples, and instructions/skills/docs/spec drift, then
  records a pass/block verdict. Use before any change is handed to a human for merge.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

CI-green and the author's own say-so are **not** enough to merge. An implementer must never be the
sole attester that their change is done: green checks can hide real defects. A stale `.tsbuildinfo`
makes `tsc -b` exit `0` without emitting anything, and a `typescript-eslint` peer-cap can pin the
compiler below TypeScript 7 — both the kind of thing a second reviewer catches and a passing
pipeline does not. This skill is the **independent pre-merge review gate**: a second set of eyes,
from an agent that did **not** write the change, re-proves the Definition of Done and records a
pass/block verdict before a human merges.

It extends `shared/definition-of-done` (the checklist the author self-runs) with an _independent_
re-run, and is the closing step of every `shared/vertical-slice`.

## When to use

On **every** change prepared for human merge — feature slice, fix, docs, or foundation. Run it after
the author believes the Definition of Done is met and before the PR is handed to a human to merge.

## Who runs it — reviewer ≠ author

The reviewer must not be the agent that authored the change. Reuse the existing reviewers; do **not**
invent a new persona:

| Reviewer      | Looks at                                                                              |
| ------------- | ------------------------------------------------------------------------------------- |
| `rubber-duck` | Logic, design, and **spec-fidelity** — does it do the right thing the OpenLogo way?   |
| `code-review` | The **diff** itself — correctness, package boundaries, KISS/Boy-Scout, no scope creep |
| `@testing`    | **Conformance fixtures** — present, green, and extended for the new behavior          |

One reviewer may cover several rows, but the reviewer is always distinct from the author and is
**named** on the PR.

> `@testing` is the OpenLogo QA agent (`.github/agents/testing.agent.md`). `rubber-duck` and
> `code-review` are the Copilot CLI built-in reviewer agents — reuse them rather than adding a new
> OpenLogo persona (KISS). What matters is the role, not the tool: an independent, non-author review.

## The checklist

### (a) Clean-tree Definition-of-Done re-run

Do not trust the author's report or cached CI. From a clean checkout:

- Run `npm ci` (a clean install, not `npm install`), then every DoD script the change touches:
  `build`, `typecheck`, `lint`, `format:check`, `test`, `conformance`, `examples`.
- **Verify the build actually emitted artifacts** — do not accept a `0` exit code as proof. Confirm
  real `dist/*.js` **and** `*.d.ts` outputs exist and are fresh.
- **Beware the incremental no-op trap:** a stale `.tsbuildinfo` can make `tsc -b` report success
  while emitting nothing. Force a clean build (delete `dist/` + `*.tsbuildinfo`, or build with
  `--force`) and confirm the artifacts are regenerated.
- Sanity-check the toolchain itself: the compiler resolves to **TypeScript 7** — peer-caps or
  transitive pins must not silently downgrade it.

> Until the M0 toolchain lands (root `package.json` + scripts), these steps are N/A and CI's code
> jobs are gated off; the reviewer still runs the rest of the checklist against the docs and spec.

### (b) Spec-fidelity

- Canonical OpenLogo vocabulary, not classic Logo (`shared/spec-fidelity`).
- Diagnostics use stable `ol-*` codes **with source spans** — no ad-hoc error strings.
- The feature sits in exactly one **profile** and respects the dependency DAG / minimal path.

### (c) Conformance fixtures

- Stack-neutral fixtures exist under `tests/conformance/` for the feature and are **green**
  (`shared/conformance-fixture`) — positive **and** negative (`ol-*`) cases, tagged with the right
  profile. Fixtures were extended, never weakened.

### (d) Runnable examples

- `spec/examples/*.logo` and doc snippets still **parse and run**.

### (e) Accessibility / pedagogy (where applicable)

- Reduced-motion, keyboard access, and non-visual descriptions (`spec/rendering.md`); progressive
  hints / no-spoilers for educational commands (`spec/educational-model.md`).

### (f) Instructions / skills / docs / spec drift

Ask: does this change require updating any of —

- `AGENTS.md`
- `.github/instructions/*.instructions.md`
- `.github/skills/**`
- `docs/**` (including ADRs)
- `spec/` cross-links

If yes, the update **must be in the same PR**. A behavior change that leaves its guidance stale is a
**block**, even when code and tests are green.

## Output — pass or block

- Record findings as **review comments** on the PR, each tied to the checklist item it fails.
- End with an explicit **verdict**: `pass` (gate satisfied) or `block` (with the specific items to
  fix). A block is resolved by a new revision and a re-run of this gate.
- **No self-merge.** The gate does not merge. Once the verdict is `pass` and required CI is green, a
  **human** performs the merge by default — or a maintainer-delegated `@orchestrator`, only on that
  recorded non-author PASS (team instructions §5). The implementer is never the sole attester.

## Checklist (record on the PR)

- [ ] Reviewer named and **≠ author**.
- [ ] Clean-tree DoD re-run — build **emits** verified (no stale-`.tsbuildinfo` no-op; TS 7 confirmed).
- [ ] Spec-fidelity — canonical vocabulary; `ol-*` codes with spans; profile boundaries.
- [ ] Conformance fixtures present, green, and extended.
- [ ] Runnable `spec/examples/*.logo` and doc snippets parse/run.
- [ ] A11y / pedagogy checked where applicable.
- [ ] Instructions / skills / docs / spec drift checked (in-PR if needed).
- [ ] Verdict recorded (pass/block); no self-merge.
