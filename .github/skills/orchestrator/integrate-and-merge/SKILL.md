---
name: integrate-and-merge
description: >-
  How @orchestrator runs the operational half of the loop after dispatch — driving each slice's PR
  through the independent review gate, merging under maintainer-delegated authority, verifying the
  merge, and keeping main, the board, milestones, branches, and the plan clean. Use when a dispatched
  slice opens a PR, when consolidating duplicate/superseded PRs, or when closing out a milestone.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

`decompose-and-dispatch` gets a slice **built**; this skill gets it **landed without leaving mess.**
The orchestrator writes no feature code, but it is the **integration owner**: it shepherds each PR
through the review gate, records the merge, and reconciles every tracker — board, milestone,
branches, plan — so the repo stays clean and `main` stays green.

## The per-PR run-loop

When a dispatched owner reports a PR (they should, if you set `coordinate_with_creator: true`):

### 1. Independent review gate — never skip, never self-review

Run `shared/review-gate`: a **non-author** reviewer re-proves the Definition of Done. You are often
the author of an _integration_ PR, so you must **not** review it yourself — spawn the reviewer as a
sub-agent (`code-review` / `rubber-duck` / `@testing`) and **post its verdict as a PR comment** for
the audit trail. Review the `git diff` against `origin/main`, not a stale local `main`.

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
  agent) and **Done** at merge; close the **milestone** when it reads `0 open`. Field/option IDs and
  the `gh project item-edit` recipe live in `product-owner/github-project`. Watch for **drift** — an
  issue closed on GitHub can still read "In Progress" on the board.
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
3. Re-run the clean-tree DoD, open the consolidated PR, run the review gate, and **close each
   superseded PR with a credit comment** to its author. Then delete the orphan branches (hygiene,
   above).

## Checklist (per merged slice)

- [ ] Non-author review-gate verdict recorded on the PR (reviewer ≠ author).
- [ ] Merged only after PASS + green CI — delegated authority, never self-attested.
- [ ] Merge verified via `gh pr view` + `git ls-remote`, not the `--delete-branch` exit code.
- [ ] Board Status → Done + Agent set; milestone closed when `0 open`.
- [ ] Closed-PR orphan branches deleted; no live-session worktree branch touched.
- [ ] `plan.md` + todos updated; any superseded PRs closed with credit.
