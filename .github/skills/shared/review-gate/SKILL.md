---
name: review-gate
description: >-
  The OpenLogo pre-merge review gate — how the implementing agent runs at least two independent,
  non-author reviews as sub-agents (a logic/spec reviewer — rubber-duck or a named fallback — and
  every domain-adaptive QA that re-runs the Definition of Done from a clean tree), resolves *every*
  finding — blocking and non-blocking alike — over at most 10 iterations, and attaches all verdicts
  before opening the PR. The orchestrator then does a final verification and merges.
created: 2026-07-17T00:00
updated: 2026-08-02T00:00
---

## Purpose

CI-green and the author's own say-so are **not** enough to merge. An implementer must never be the
sole attester that their change is done: green checks can hide real defects. A stale `.tsbuildinfo`
makes `tsc -b` exit `0` without emitting anything, and a `typescript-eslint` peer-cap can pin the
compiler below TypeScript 7 — both the kind of thing a second reviewer catches and a passing
pipeline does not.

So the review runs **inside the implementing session, before the PR is opened.** The implementing
agent does not review its own work: it **dispatches at least two review sub-agents**, hands them the diff,
fixes what they find, and re-runs them until all return `pass`. Only then does it open an
already-green PR with all verdicts attached. This keeps the whole review in one session instead of a
slow, round-by-round hand-off through the orchestrator, while keeping the "implementer is never the
sole attester" rule intact — the agents doing the reviewing are **not** the author.

It extends `shared/definition-of-done` (the checklist the author self-runs) with two _independent_
re-runs, and is the closing step of every `shared/vertical-slice`.

## When to use

On **every** change before its PR is opened — feature slice, fix, docs, or foundation. Run it once
the author believes the Definition of Done is met, as the last step of the implementing session.

## Who runs it — the implementer, via at least two non-author sub-agents

The implementing agent spawns these as **sub-agents** (it can — no `tools:` allowlist restricts the
delivery agents). The agent doing the reviewing is **never the author**:

| Sub-agent           | Looks at                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **logic/spec reviewer** — `rubber-duck`, or a **named non-author fallback** agent | Logic, design, **spec-fidelity**, and the **diff** itself — does it do the right thing the OpenLogo way, within package boundaries, KISS/Boy-Scout, no scope creep?                                                                                                                                               |
| **QA** (a domain expert) | Re-runs the Definition of Done from a clean tree and checks the change's domain. **Domain-adaptive:** `@testing` by default (conformance + coverage + clean-tree DoD), plus/instead the owner of the changed area — `@language-designer` (grammar/AST), `@turtle-engine` (rendering), `@geometry-teacher` (geometry), `@learner-experience` (studio), `@ai-tutor` (tutor), `@curriculum` (lessons), `@documentation` (docs). |

- **QA is domain-adaptive:** dispatch the expert(s) the change actually needs, and more than one for
  a cross-cutting change (e.g. `@testing` **and** `@language-designer` for a grammar+fixtures slice).
- **QA expert ≠ author.** When the author *is* the natural QA owner (e.g. `@testing` authoring
  fixtures, `@language-designer` authoring the grammar), recruit a different non-author expert
  (`@interpreter`, `@testing`, or the relevant peer) so the reviewer stays independent.
- `rubber-duck` is a Copilot CLI built-in reviewer; the QA experts are the OpenLogo agents. Reuse
  them rather than inventing a new persona (KISS). What matters is the role: **at least two**
  independent, non-author reviews — the **logic/spec reviewer** plus **every** dispatched QA expert.
- **`rubber-duck` needs a compatible session model.** It is a built-in critic that deliberately runs
  on a _different_ model from the session, and is only available when the implementing session uses a
  **Claude or GPT large model**. Run implementing sessions on such a model; if `rubber-duck` is
  unavailable, substitute a **named second non-author domain agent** as the logic/spec reviewer and
  **record which agent stood in and why** (so the fallback is auditable) — there are still **two**
  independent reviews.
- **Reviewers never edit the branch.** `rubber-duck` is read-only by design; the QA experts _can_
  edit but must not — a reviewer who changes the branch becomes an **author** and voids their own
  verdict. Reviewers report findings; the **author** fixes them.

## The checklist

The **logic/spec reviewer** (`rubber-duck`, or a named fallback) owns logic, design, and
spec-fidelity; the **QA** sub-agent(s) re-prove items (a)–(f) below from a clean tree. Every
dispatched reviewer must clear every item before the PR is opened.

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

## Findings — every finding gets resolved, blocking or not

Reviewers raise findings at different severities: a `block` (the change is wrong, unproven, or
drifted) and **non-blocking** ones (nits, suggestions, "consider…", follow-ups). **Both must be
resolved before the PR is opened** — "it was only a nit" is not a disposition. Each finding ends in
exactly one of two states, recorded on the PR:

- **Fixed** — the default. Non-blocking findings inside the task's declared write-set are simply
  fixed; that is the Boy Scout rule (team instructions §11) doing its job.
- **Declined, with a one-line rationale** — allowed only when the fix would leave the declared
  write-set, belongs to another package/owner, or contradicts the spec or KISS. Real work that is
  merely out of scope is **filed as a follow-up issue** and the issue number is recorded next to the
  rationale. A finding that is silently dropped, deferred without an issue, or answered with "will
  do later" counts as **unresolved**, and the PR is not ready.

The reviewer does not get a veto over the disposition, and the author does not get to ignore
findings: the audit trail (fixed, or declined with a rationale/issue) is what makes the choice
reviewable by `@orchestrator` and the maintainer.

## Iterate until everything passes — at most 10 rounds

One **round** = dispatch reviewers → collect findings → fix/decline → commit. Repeat until **every**
reviewer returns `pass` on the same final HEAD **and** every finding of every severity is fixed or
declined-with-rationale. The loop is **bounded at 10 rounds** on one change.

If round 10 ends with anything still open, **stop — do not open (or mark ready) the PR** and escalate
to `@orchestrator` (or the maintainer) with: the outstanding findings, the SHA reviewed in each
round, and why the change is not converging. Not converging in 10 rounds is a signal about the
*slice*, not the reviewers — usually it is too big, its spec basis is ambiguous, or it needs a
contract change first, and it should be re-cut (`orchestrator/decompose-and-dispatch`) rather than
ground out.

## Output — iterate to green, then hand over

- **Review a clean, committed HEAD.** Commit the work first (no uncommitted changes) so the reviewers
  see exactly what the PR will contain. Each sub-agent records findings tied to the checklist item it
  fails, **marks each finding `block` or `non-blocking`**, **names the base + head commit SHA it
  reviewed**, and ends with an explicit **verdict**: `pass` or `block` (with the specific items to
  fix). A `pass` that carries non-blocking findings is **not** a licence to open the PR — those
  findings are resolved first (see above).
- On any `block` **or any unresolved finding of any severity**, the implementer **fixes (or declines
  with a recorded rationale), commits, and re-dispatches**. **Any new commit after a
  `pass` invalidates that `pass`:** re-run **all** reviewers on the new HEAD so every verdict
  describes the *same* final SHA. The PR is opened only once **every** reviewer — the **logic/spec
  reviewer** (`rubber-duck` or its named fallback) **and each** dispatched QA expert — returns `pass`
  on that HEAD with **zero** findings left open, within the **10-round cap**.
- **Attach every verdict to the PR** (body or comments), each stamped with the reviewed head SHA, so
  the audit trail shows two (or more) independent, non-author reviews of the revision being merged.
- **No self-merge.** The implementer does not merge. Once the PR is open with every verdict and
  required CI is green, the **`@orchestrator` does a final verification** — every verdict present,
  from non-authors, and **stamped with a SHA matching PR HEAD** (a later commit voids an earlier
  `pass`), CI green, a light sanity check — and merges under maintainer-delegated authority
  (team instructions §5), or a human merges. The gate itself never merges, and the implementer is
  never the sole attester.

## Checklist (record on the PR)

- [ ] All required reviews run as sub-agents, **all ≠ author** (at least two): the **logic/spec reviewer** — `rubber-duck` (Claude/GPT large session model) **or a named non-author fallback** — plus **every** dispatched domain QA expert; reviewers stayed read-only.
- [ ] Clean-tree DoD re-run — build **emits** verified (no stale-`.tsbuildinfo` no-op; TS 7 confirmed).
- [ ] Spec-fidelity — canonical vocabulary; `ol-*` codes with spans; profile boundaries.
- [ ] Conformance fixtures present, green, and extended.
- [ ] Runnable `spec/examples/*.logo` and doc snippets parse/run.
- [ ] A11y / pedagogy checked where applicable.
- [ ] Instructions / skills / docs / spec drift checked (in-PR if needed).
- [ ] **Every finding resolved — blocking *and* non-blocking**: each one fixed, or declined with a one-line rationale (+ follow-up issue number when it is real work outside the write-set).
- [ ] Converged within the **10-round cap** (otherwise: not opened — escalated to `@orchestrator`/maintainer with the open findings and per-round SHAs).
- [ ] All verdicts `pass` on the **same final HEAD** (SHA-stamped) and attached; any later commit re-ran every reviewer; no self-merge.
