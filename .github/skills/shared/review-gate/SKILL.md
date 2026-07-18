---
name: review-gate
description: >-
  The OpenLogo pre-merge review gate — how the implementing agent runs two independent, non-author
  reviews as sub-agents (rubber-duck for logic/design/spec-fidelity, and a domain-adaptive QA that
  re-runs the Definition of Done from a clean tree), iterates to green, and attaches both verdicts
  before opening the PR. The orchestrator then does a final verification and merges.
created: 2026-07-17T00:00
updated: 2026-07-18T00:00
---

## Purpose

CI-green and the author's own say-so are **not** enough to merge. An implementer must never be the
sole attester that their change is done: green checks can hide real defects. A stale `.tsbuildinfo`
makes `tsc -b` exit `0` without emitting anything, and a `typescript-eslint` peer-cap can pin the
compiler below TypeScript 7 — both the kind of thing a second reviewer catches and a passing
pipeline does not.

So the review runs **inside the implementing session, before the PR is opened.** The implementing
agent does not review its own work: it **dispatches two review sub-agents**, hands them the diff,
fixes what they find, and re-runs them until both return `pass`. Only then does it open an
already-green PR with both verdicts attached. This keeps the whole review in one session instead of a
slow, round-by-round hand-off through the orchestrator, while keeping the "implementer is never the
sole attester" rule intact — the agents doing the reviewing are **not** the author.

It extends `shared/definition-of-done` (the checklist the author self-runs) with two _independent_
re-runs, and is the closing step of every `shared/vertical-slice`.

## When to use

On **every** change before its PR is opened — feature slice, fix, docs, or foundation. Run it once
the author believes the Definition of Done is met, as the last step of the implementing session.

## Who runs it — the implementer, via two non-author sub-agents

The implementing agent spawns these as **sub-agents** (it can — no `tools:` allowlist restricts the
delivery agents). The agent doing the reviewing is **never the author**:

| Sub-agent           | Looks at                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rubber-duck`       | Logic, design, **spec-fidelity**, and the **diff** itself — does it do the right thing the OpenLogo way, within package boundaries, KISS/Boy-Scout, no scope creep?                                                                                                                                               |
| **QA** (a domain expert) | Re-runs the Definition of Done from a clean tree and checks the change's domain. **Domain-adaptive:** `@testing` by default (conformance + coverage + clean-tree DoD), plus/instead the owner of the changed area — `@language-designer` (grammar/AST), `@turtle-engine` (rendering), `@geometry-teacher` (geometry), `@learner-experience` (studio), `@ai-tutor` (tutor), `@curriculum` (lessons), `@documentation` (docs). |

- **QA is domain-adaptive:** dispatch the expert(s) the change actually needs, and more than one for
  a cross-cutting change (e.g. `@testing` **and** `@language-designer` for a grammar+fixtures slice).
- **QA expert ≠ author.** When the author *is* the natural QA owner (e.g. `@testing` authoring
  fixtures, `@language-designer` authoring the grammar), recruit a different non-author expert
  (`@interpreter`, `@testing`, or the relevant peer) so the reviewer stays independent.
- `rubber-duck` is a Copilot CLI built-in reviewer; the QA experts are the OpenLogo agents. Reuse
  them rather than inventing a new persona (KISS). What matters is the role: **two** independent,
  non-author reviews.

## The checklist

`rubber-duck` owns logic, design, and spec-fidelity; the **QA** sub-agent re-proves items (a)–(f)
below from a clean tree. Together they must clear every item before the PR is opened.

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

> For a **docs/skills-only** change with no touched package, these build steps are N/A — the QA
> sub-agent still runs the rest of the checklist against the docs, skills, and spec.

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

## Output — iterate to green, then hand over

- Each sub-agent records findings tied to the checklist item it fails and ends with an explicit
  **verdict**: `pass` or `block` (with the specific items to fix).
- On any `block`, the implementer **fixes and re-dispatches** that sub-agent until it returns `pass`.
  The PR is opened only once **both** `rubber-duck` **and** the QA expert return `pass`.
- **Attach both verdicts to the PR** (in the PR body or as comments) so the audit trail shows two
  independent, non-author reviews.
- **No self-merge.** The implementer does not merge. Once the PR is open with both verdicts and
  required CI is green, the **`@orchestrator` does a final verification** — both verdicts present and
  from non-authors, CI green, a light sanity check — and merges under maintainer-delegated authority
  (team instructions §5), or a human merges. The gate itself never merges, and the implementer is
  never the sole attester.

## Checklist (record on the PR)

- [ ] Two independent reviews run as sub-agents, both **≠ author**: `rubber-duck` + a domain QA expert.
- [ ] Clean-tree DoD re-run — build **emits** verified (no stale-`.tsbuildinfo` no-op; TS 7 confirmed).
- [ ] Spec-fidelity — canonical vocabulary; `ol-*` codes with spans; profile boundaries.
- [ ] Conformance fixtures present, green, and extended.
- [ ] Runnable `spec/examples/*.logo` and doc snippets parse/run.
- [ ] A11y / pedagogy checked where applicable.
- [ ] Instructions / skills / docs / spec drift checked (in-PR if needed).
- [ ] Both verdicts `pass` and attached to the PR; iterated to green before opening; no self-merge.
