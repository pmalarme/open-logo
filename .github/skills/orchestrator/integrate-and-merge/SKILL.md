---
name: integrate-and-merge
description: >-
  How @orchestrator runs the operational half of the loop after dispatch — verifying each slice's
  in-session non-author self-review, merging under maintainer-delegated authority (or handing to a
  human), verifying the merge, and keeping main, the board, milestones, branches, and the plan clean.
  Use when a dispatched slice opens a PR, when consolidating duplicate/superseded PRs, or when closing
  out a milestone.
created: 2026-07-17T00:00
updated: 2026-07-18T00:00
---

## Purpose

`decompose-and-dispatch` gets a slice **built**; this skill gets it **landed without leaving mess.**
The orchestrator writes no feature code, but it is the **integration owner**: it **verifies each PR's
non-author self-review**, records the merge, and reconciles every tracker — board, milestone,
branches, plan — so the repo stays clean and `main` stays green.

## The per-PR run-loop

When a dispatched owner reports a PR (they should, if you set `coordinate_with_creator: true`):

### 1. Verify the implementer's self-review — never skip, never self-review

A dispatched slice arrives **already reviewed**: the owner ran `shared/review-gate` in-session and
attached **all** its non-author verdicts — the **logic/spec reviewer** (`rubber-duck`, or a named
fallback agent **with the reason it stood in**) **plus every** dispatched domain **QA** expert (at
least two verdicts total). Your job is to **verify** them — all present, all from agents that are
**not** the author (if a fallback replaced `rubber-duck`, its identity **and reason** are recorded),
each **stamped with a head SHA that matches the current PR HEAD** (a commit after a `pass` voids it),
and the reviewed base is the current `origin/main` tip (if `main` advanced under the branch, have the
owner rebase and re-review) — plus green CI and a light diff sanity check against `origin/main` (not a
stale local `main`). Do **not** re-run the whole gate round-by-round.

When **you** authored the change (an _integration_ or governance PR), the same pre-open rule applies
to you: you must **not** review it yourself, and you run `shared/review-gate` **before opening the
PR** — spawn the non-author sub-agents (the **logic/spec reviewer** — `rubber-duck` or a named
fallback — **plus every** domain QA expert the change needs), iterate to green on a committed HEAD,
and open the PR with **all** SHA-stamped verdicts in its body. If a finding forces a new commit,
re-run **all** reviewers so the attached verdicts match the final HEAD.

### 2. Merge only on a recorded PASS + green CI

Default governance (team instructions §5): humans gate `main`. When the maintainer has **delegated
merge authority** to the orchestrator, you may execute the merge — but **only** after an independent,
non-author review-gate **PASS** is recorded on the PR and required CI is green. You never merge your
own work on your own say-so; the review gate is the safeguard that keeps the "implementer is never
the sole attester" rule (`shared/review-gate`) intact, and the maintainer can reclaim the button any
time. Merge with `gh pr merge <n> --squash --delete-branch`.

### 3. Verify the merge — trust state, not the exit code

`gh pr merge --delete-branch` **always errors on the local git cleanup here**, because `main` is
checked out in the shared main worktree — the error is harmless. Confirm the _real_ outcome:

- `gh pr view <n> --json state,mergedAt,mergeCommit` → `MERGED` with a merge commit.
- `git ls-remote origin -h refs/heads/main` → HEAD advanced; the PR's head branch is gone.

### 4. Reconcile every tracker

- **Board (Projects v2):** set the issue's **Status** + **Agent** at dispatch (`In Progress` + owning
  agent) and **Done** at merge; `0 open` on the milestone is necessary but **not sufficient** to close
  it — close the **milestone** only once it also reads `0 open` **and** the milestone-completion audit
  below is green. Field/option IDs and the `gh project item-edit` recipe live in
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
Do **not** retarget a stacked PR onto `main` — a squash-merge rewrote its base as a new SHA, so
retargeting re-introduces the abandoned commits. Instead:

1. Pick the better-aligned content and **cherry-pick only its clean feature commit onto a fresh
   branch off `origin/main`** (`git cherry-pick --no-commit <sha>`).
2. Resolve conflicts by hand — usually the package `index.ts` contract-marker exports: keep the real
   exports, drop throwaway placeholder markers.
3. Re-run the clean-tree DoD **and the review gate** (all non-author verdicts on the committed HEAD —
   logic/spec reviewer + every QA expert), **then** open the consolidated PR with every verdict
   attached, and **close each superseded PR with a credit comment** to its author. Then delete the
   orphan branches (hygiene, above).

## Milestone-completion audit

A milestone (M0–M6) is a **profile-based synchronization point** (charter §12): it completes when its
profile's conformance is green **across all domains**, not when one package finishes. `0 open issues`
on the milestone is **necessary but not sufficient** — issues can close on thin or missing coverage.
Before the orchestrator closes a milestone (and before a release tuple is tagged, from M2 onward), run
a full **in-depth coverage audit** and attach it, written, to the milestone-closeout issue: map every
profile requirement to **both** its implementation **and** its conformance fixture, across five
dimensions:

1. **Profile coverage** — every primitive / command / control-form / reporter in the milestone's
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
5. **Board / traceability** — every epic and story under the milestone is Done; feature-detection
   metadata (`openlogo.version`, supported profiles, rendering targets) is correct.

The release tuple is tagged **only** when the audit is 100% green on all five dimensions — see
`devops/security-and-release` for the tagging mechanics and `docs/delivery.md` for the release +
milestone strategy this audit gates.

## Checklist (per merged slice)

- [ ] All non-author review-gate verdicts (≥2) recorded on the PR — logic/spec reviewer (`rubber-duck`, or a named fallback **+ reason**) + **every** domain QA expert, all ≠ author — each stamped with a SHA matching PR HEAD.
- [ ] Merged only after PASS + green CI — delegated authority, never self-attested.
- [ ] Merge verified via `gh pr view` + `git ls-remote`, not the `--delete-branch` exit code.
- [ ] Board Status → Done + Agent set; milestone closed when `0 open`.
- [ ] Closed-PR orphan branches deleted; no live-session worktree branch touched.
- [ ] `plan.md` + todos updated; any superseded PRs closed with credit.
- [ ] **At milestone close:** in-depth coverage audit green across all 5 dimensions (profile / spec-area / conformance / all-domain DoD / board-traceability) before the milestone is closed or a release tuple tagged.
