---
name: integrate-and-merge
description: >-
  How @orchestrator runs the operational half of the loop after dispatch — verifying each slice's
  in-session non-author self-review, merging under maintainer-delegated authority (or handing to a
  human), verifying the merge, and keeping main, the board, sagas, branches, and the plan clean.
  Use when a dispatched slice opens a PR, when consolidating duplicate/superseded PRs, or when closing
  out a saga.
created: 2026-07-17T00:00
updated: 2026-08-01T00:00
---

## Purpose

`decompose-and-dispatch` gets a slice **built**; this skill gets it **landed without leaving mess.**
The orchestrator writes no feature code, but it is the **integration owner**: it **verifies each PR's
non-author self-review**, records the merge, and reconciles every tracker — board, saga, branches,
plan — so the repo stays clean and `main` stays green.

## The per-PR run-loop

> **Effective target branch.** Everything below — the review base, the "did HEAD advance"
> post-merge check, and consolidation cherry-picks — is relative to the **PR's target branch**, not
> always `main`. The target is the **parent saga's `saga/*` branch** for work under a release saga,
> and **`main`** only for **Maintenance-saga** work (that saga has no branch). Read "the target" below
> as that effective branch, and **land shared contracts on the target before fan-out**, not on `main`.

When a dispatched owner reports a PR (they should, if you set `coordinate_with_creator: true`):

### 1. Verify the implementer's self-review — never skip, never self-review

A dispatched slice arrives **already reviewed**: the owner ran `shared/review-gate` in-session and
attached **all** its non-author verdicts — the **logic/spec reviewer** (`rubber-duck`, or a named
fallback agent **with the reason it stood in**) **plus every** dispatched domain **QA** expert (at
least two verdicts total). Your job is to **verify** them — all present, all from agents that are
**not** the author (if a fallback replaced `rubber-duck`, its identity **and reason** are recorded),
each **stamped with a head SHA that matches the current PR HEAD** (a commit after a `pass` voids it),
and the reviewed base is the current **target**-branch tip (if the target advanced under the branch,
have the owner rebase and re-review) — plus green CI and a light diff sanity check against the
**target** (not a stale local branch). Do **not** re-run the whole gate round-by-round.

When **you** authored the change (an _integration_ or governance PR), the same pre-open rule applies
to you: you must **not** review it yourself, and you run `shared/review-gate` **before opening the
PR** — spawn the non-author sub-agents (the **logic/spec reviewer** — `rubber-duck` or a named
fallback — **plus every** domain QA expert the change needs), iterate to green on a committed HEAD,
and open the PR with **all** SHA-stamped verdicts in its body. If a finding forces a new commit,
re-run **all** reviewers so the attached verdicts match the final HEAD.

### 2. Merge only on a recorded PASS + green CI

Default governance (team instructions §5): humans gate the target branch (`main` or the parent
`saga/*`). When the maintainer has **delegated
merge authority** to the orchestrator, you may execute the merge — but **only** after an independent,
non-author review-gate **PASS** is recorded on the PR and required CI is green. You never merge your
own work on your own say-so; the review gate is the safeguard that keeps the "implementer is never
the sole attester" rule (`shared/review-gate`) intact, and the maintainer can reclaim the button any
time. Merge with `gh pr merge <n> --squash --delete-branch`.

**Merge target = the parent saga's `saga/*` branch, not `main`** (see `devops/branching-and-commits`):
work issues integrate into their saga branch, which is later promoted to `main` as a Release
Candidate. **Maintenance-saga work merges straight to `main`** (that saga has no branch). `[spec]` and
`[saga]` PRs are **maintainer-only, non-delegable** — never merge them, even under delegated authority;
hand them to the maintainer (`CODEOWNERS` + the target branch's required code-owner-review ruleset block
the merge until they approve).

### 3. Keep it moving — substantive red vs. cosmetic red

A PR must never sit open for weeks over a check its author physically cannot fix. Classify the red
before you wait on it:

- **Substantive** — build, typecheck, lint, `format:check`, coverage (100%), unit / conformance /
  examples, CodeQL, dependency review, Meta. **Never waivable.** Red here means the work is not done.
- **Cosmetic / governance** — the advisory commit-subject convention, the labeler, formatting of
  tool-generated artifacts. Fix them when the author can; they do not justify an open-ended stall.

**The 72-hour rule.** If a PR is green on every substantive check and the only remaining red is
cosmetic **and unfixable by its author** (the classic case: the Copilot platform's bootstrap commit
subject, which the agent cannot rewrite — see
[ADR-0016](../../../../docs/adr/0016-commit-convention-and-agent-policy.md)), the integration owner
posts a **waiver comment** naming (a) the check, (b) why it is unfixable by this author, (c) the
compensating control (for example: squash-merge lands the linted PR title, so history stays clean),
and then proceeds under delegated merge authority.

**Never waivable, under any deadline:** a red substantive check, the two non-author review-gate
verdicts, `spec/**` or `saga.yml`/`spec.yml` changes, or anything CODEOWNERS-gated. The waiver buys
speed on cosmetics only — it never buys a shortcut through review.

**Weekly age sweep.** Any PR older than 7 days gets a decision, not a nudge: merge it, split it, or
close it with a written reason.

### 4. Verify the merge — trust state, not the exit code

`gh pr merge --delete-branch` **often errors on the local git cleanup here**, because the target branch
(usually `main`, or the `saga/*` branch) is checked out in a shared worktree — the error is harmless.
Confirm the _real_ outcome:

- `gh pr view <n> --json state,mergedAt,mergeCommit` → `MERGED` with a merge commit.
- `git ls-remote origin -h refs/heads/<target>` → the **target** branch HEAD advanced (that is the
  parent `saga/*`, or `main` for Maintenance work); the PR's head branch is gone.

### 5. Reconcile every tracker

- **Board (Projects v2):** set the issue's **Status** + **Agent** at dispatch (`In Progress` + owning
  agent) and **Done** at merge; `0 open` on the saga's children is necessary but **not sufficient** to
  close it — a **saga** is closed **by the maintainer** only once every child epic passed its **Epic
  Gate** and the Saga-completion audit below is green (the orchestrator records + recommends; `[saga]`
  closure is maintainer policy, non-delegable), and close an **epic** only once its **Epic Gate**
  (`shared/epic-gate`) passes. Field/option IDs and the `gh project item-edit` recipe live in
  `product-owner/github-project`. Watch for **drift** — an issue closed on GitHub can still read
  "In Progress" on the board.
- **Branch hygiene:** merged-PR branches auto-delete; **closed (non-merged) PR branches do not —
  delete them** with `git push origin --delete <branch>` so the repo stays clean. **Never delete a
  branch that is the checked-out HEAD of a live session worktree** (`git worktree list`), including
  your own orchestrator branch. Clean stray local fetch/integration branches too, but **never
  `git worktree remove`** an app-managed session worktree — closing the session in the app does that.
- **Plan / todos:** update `plan.md` and the session todo board so the next step is unambiguous.

## Consolidating duplicate / superseded PRs

Parallel or cloud agents sometimes ship two PRs for one slice, or stack one on an abandoned branch.
Do **not** retarget a stacked PR onto the target — a squash-merge rewrote its base as a new SHA, so
retargeting re-introduces the abandoned commits. Instead:

1. Pick the better-aligned content and **cherry-pick only its clean feature commit onto a fresh
   branch off the target** (`origin/<saga-branch>`, or `origin/main` for Maintenance work;
   `git cherry-pick --no-commit <sha>`).
2. Resolve conflicts by hand — usually the package `index.ts` contract-marker exports: keep the real
   exports, drop throwaway placeholder markers.
3. Re-run the clean-tree DoD **and the review gate** (all non-author verdicts on the committed HEAD —
   logic/spec reviewer + every QA expert), **then** open the consolidated PR with every verdict
   attached, and **close each superseded PR with a credit comment** to its author. Then delete the
   orphan branches (hygiene, above).

## Saga-branch integration (main → saga pullback, saga → main = RC)

Work merges into the **parent saga's `saga/*` branch**, so keep that branch current and know how it
promotes to `main` (full model in `devops/branching-and-commits`):

- **After every merge into a `saga/*` branch, pull `main` back into it** (`git merge origin/main` on
  the saga branch, or a PR) so the saga branch never drifts behind released work and conflicts surface
  early, not at release.
- **`saga/*` → `main` is a Release Candidate.** When the saga's Saga-completion audit is green, open
  the promotion PR; **the maintainer decides whether to cut the release** and tag the tuple — the
  orchestrator does not self-promote a saga to `main`.
- The **Maintenance** saga has **no branch**: its work already merges straight to `main`, so there is
  no pullback or RC step for it.

## Saga-completion audit

A saga (M0–M6) is a **profile-based synchronization point** (charter §12): it completes when its
profile's conformance is green **across all domains**, not when one package finishes. `0 open` child
issues is **necessary but not sufficient** — issues can close on thin or missing coverage, and every
child **epic must already have passed its Epic Gate** (`shared/epic-gate`). The orchestrator **runs and
records** this audit but **does not close the saga**: `[saga]` is maintainer-owned and non-delegable
(closing the saga issue is **maintainer policy** — CODEOWNERS + the branch ruleset gate the *PR*, not
issue closure), so the orchestrator attaches the written audit plus the required sign-offs and a
**recommendation**, and the **maintainer approves the promotion, tags any release tuple, and closes the
saga**. Run the full **in-depth coverage audit** and attach it, written, to the saga-closeout issue:
map every profile requirement to **both** its implementation **and** its conformance fixture, across
six dimensions:

1. **Profile coverage** — every primitive / command / control-form / reporter in the saga's
   profile(s) (`spec/commands.md` C3 matrix, `spec/conformance.md`) is implemented **and** has a
   conformance fixture.
2. **Spec-area coverage** — every normative section for the profile (`spec/grammar.md` productions,
   `spec/execution-model.md` behaviors, `spec/error-model.md` `ol-*` codes, `spec/rendering.md`,
   `spec/tooling.md`) is reflected in code **and** tests.
3. **Conformance** — the full profile-DAG fixture suite is green; negative / fuzz / regression
   fixtures exist for the profile's diagnostics.
4. **DoD across ALL domains** (not a single package) — build / typecheck / lint / test /
   coverage(100%) / conformance / examples green repo-wide; docs + spec cross-links synced; a11y /
   pedagogy checks where applicable.
5. **Board / traceability** — every epic (Epic-Gate-passed) and story under the saga is Done;
   feature-detection metadata (`openlogo.version`, supported profiles, rendering targets) is correct.
6. **Sign-offs recorded** — the capability-level **specialist review(s)** for the saga's profile(s)
   plus a **rubber-duck** (or a named, reason-recorded fallback) reviewed the saga as a whole and
   returned `pass`, and `@product-owner` co-signed the scope/docs judgement; verdicts linked on the
   saga-closeout issue. The orchestrator then hands the audit + recommendation to the maintainer.

The maintainer approves the promotion and **the release tuple is tagged only** when the audit is 100%
green on all six dimensions — see
`devops/security-and-release` for the tagging mechanics and `docs/delivery.md` for the release +
saga strategy this audit gates.

## Checklist (per merged slice)

- [ ] All non-author review-gate verdicts (≥2) recorded on the PR — logic/spec reviewer (`rubber-duck`, or a named fallback **+ reason**) + **every** domain QA expert, all ≠ author — each stamped with a SHA matching PR HEAD.
- [ ] Merged only after PASS + green CI — delegated authority, never self-attested.
- [ ] Merge verified via `gh pr view` + `git ls-remote`, not the `--delete-branch` exit code.
- [ ] Board Status → Done + Agent set; epic closed only on Epic-Gate pass; **saga closed by the maintainer** once children Done + audit green (orchestrator records + recommends, does not close).
- [ ] Closed-PR orphan branches deleted; no live-session worktree branch touched.
- [ ] `plan.md` + todos updated; any superseded PRs closed with credit.
- [ ] No PR stalled on cosmetic red: substantive checks green + author-unfixable cosmetic red → waiver comment recorded, then merge (never waive a substantive check or a review verdict).
- [ ] Saga branches kept current (main pulled back after each merge); `saga/*`→`main` promotion left to the maintainer.
- [ ] **At saga close:** in-depth coverage audit green across all 6 dimensions (profile / spec-area / conformance / all-domain DoD / board-traceability / sign-offs recorded), attached + recommended by the orchestrator, before the **maintainer** closes the saga or tags a release tuple.
