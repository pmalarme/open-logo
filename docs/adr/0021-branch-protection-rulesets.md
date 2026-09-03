# 21. Branch-protection rulesets for `main` and `saga/*`, committed as JSON

- Status: Accepted
- Date: 2026-09-03
- Deciders: OpenLogo maintainer (@pmalarme) + @devops
- Related: implements the "Required branch protection" section of
  [`devops/branching-and-commits`](../../.github/skills/devops/branching-and-commits/SKILL.md);
  gives teeth to [ADR-0016](0016-commit-convention-and-agent-policy.md) (commit convention + agent
  policy — "CI is the gate") and to the Definition of Done
  ([ADR-0008](0008-implementer-run-self-review.md), [ADR-0020](0020-resolve-all-review-findings.md));
  pairs with the two-path merge convention recorded alongside issue #1064.

## Context

`main` and `saga/*` carried a single ruleset — `protect-default-branch`, with only `deletion` and
`non_fast_forward` rules on the default branch (issue #695). Everything the project treats as the
gate was therefore **advisory**:

- The **Definition of Done** — build, lint, unit/conformance/examples, 100% coverage, studio visual
  regression, commit convention, CodeQL, dependency review — runs in CI on every PR, but nothing
  *required* those checks to be green before merge.
- The **`spec/` and saga/spec governance surfaces** are pinned to @pmalarme in
  [`.github/CODEOWNERS`](../../.github/CODEOWNERS), but CODEOWNERS only *requests* a review; it blocks
  a merge only when the branch ruleset has **Require review from Code Owners** on. Without it, the
  "maintainer-only, non-delegable" rule for `[spec]`/`[saga]` was unenforced.
- `saga/*` branches had no protection at all beyond the default-branch deletion/force-push rules,
  which do not match `saga/*`.

Saga #572 (M5) is about to open a Release Candidate PR promoting 133 commits to `main`. The
maintainer ruled that #695 lands first so that RC is actually gated. #695 is Maintenance work with no
parent saga, so per `devops/branching-and-commits` it targets **`main`** directly — landing it on the
M5 saga branch would deliver the rulesets *after* the promotion they are meant to govern.

Rulesets are repository-admin settings: **only the maintainer can apply them.** The problem to solve
here is therefore not "apply protection" but "make the protection **reviewable and reproducible**
instead of click-ops in the settings UI".

## Decision

**1. Commit the rulesets as JSON.** Two definitions live under
[`.github/rulesets/`](../../.github/rulesets/) — `main.json` (`protect-main`, targeting
`~DEFAULT_BRANCH`) and `saga.json` (`protect-saga-branches`, targeting `refs/heads/saga/*`) — each
applyable verbatim with `gh api --method POST repos/pmalarme/open-logo/rulesets --input <file>`. A
sibling `README.md` documents apply/update/dry-run and the required-check reasoning. The definitions
are the source of truth; the applied ruleset is derived from them, so a change to protection is a
reviewable diff.

**2. `main` and `saga/*` get the same protections.** Both require: a PR before merging with
**code-owner review**, the always-reporting CI checks, and **block force-push + deletion**; both allow
squash and merge-commit. The only differences are operational, not protective: `saga/*` sets
`do_not_enforce_on_create: true` so a saga branch can be created lazily (decision 3). Crucially both
set `required_approving_review_count: 0` **with** `require_code_owner_review: true`. That combination
is the whole design:

- An ordinary slice touches **no** CODEOWNERS-owned path, so it needs **no human approval** — the
  orchestrator's delegated merge authority and the in-session review gate (agent sub-agents, not
  GitHub approvals) are untouched.
- A PR touching `spec/**`, `saga.yml`, `spec.yml`, or `CODEOWNERS` **cannot merge without
  @pmalarme's approval**. This is the enforcement `[spec]`/`[saga]` always claimed to have.

We chose an **identical** rule set for `saga/*` rather than a relaxed one because the code-owner
requirement is already self-scoping: it only bites on owned paths, so it does not burden routine
slice merges into a saga branch, and it does not impede the RC. The Release Candidate promotion is a
`saga/* → main` PR, so it is governed by **`main`**'s ruleset; the `saga/*` ruleset governs *slices
merging into* the saga branch, which are squash-by-PR-title. There is no scenario where the `saga/*`
rules obstruct the 133-commit RC, so there is no reason to weaken them.

**3. Merge methods encode the two-path model.** `main` allows **squash and merge-commit**; `saga/*`
allows **both** as well. The RC promotion (`saga/* → main`) is a deliberate **merge commit** so M5's
133-commit slice history is preserved on `main`, not collapsed. Slice merges (into `saga/*` or, for
Maintenance work, into `main`) are **squash**, with the PR title as the subject. `saga/*` must also
permit merge-commit because the periodic **`main → saga/*` pullback** — which keeps a saga branch from
drifting behind released trunk (integration-flow step 3 of `devops/branching-and-commits`) — has to be
a merge commit to preserve ancestry; a squash there would flatten released history back into the saga.
The `saga/*` ruleset also sets `do_not_enforce_on_create: true` so a saga branch can be created lazily
when its saga starts. This supersedes acceptance-criterion 6 of #695 ("squash-merge is the only
enabled merge method"): disabling merge-commit would break both the RC promotion and the pullback. The
applied repo settings already reflect the two-path model
(`allow_squash_merge`, `allow_merge_commit`, `allow_rebase_merge=false`, squash subject = PR title).

**4. Three workflows are deliberately NOT required.** A required status check that never *reports*
blocks a merge forever. `copilot-setup-steps.yml` and `label-sync.yml` run only on `push`/`paths:`,
so they never report on a normal PR; `labeler.yml` is a labeling action, not a pass/fail gate. The
required set is exactly CI's **always-reporting** jobs, by their exact check-name:

`Build & type-check` · `Lint & format` · `Unit, conformance & examples` · `Test coverage (100%)` ·
`Studio visual regression` · `Meta (labels, issue forms, workflows)` · `Conventional Commits` ·
`CodeQL` · `Analyze (javascript-typescript)` · `Dependency review` · `Detect toolchain`

`Studio visual regression` and `Agentic workflow compile is clean (gh-aw)` are path-conditional via a
**job-level `if:`** (not a workflow-level `paths:`), so they report a passing `skipped` conclusion
when their inputs are untouched and are safe to require; `Studio visual regression` is required,
`workflows-compile` is left out to keep the required set equal to the always-run jobs. An exact-name
match is essential — a check name that does not match is a permanent block.

## Timing recommendation

Rulesets take effect immediately and repo-wide, including on `saga/572-*` mid-release. The maintainer
asked for #695 **before** the RC PR; @orchestrator prefers applying **after** the RC so a brand-new
ruleset is not first exercised on a 133-commit promotion. Both can be satisfied: create the ruleset
in **`evaluate`** enforcement (violations logged, not blocked) or against a throwaway test branch,
open a throwaway PR to confirm every required check name resolves and no rule misfires, then flip to
`active`. The definitions land now (this PR), the maintainer applies them in `active` at the moment
of their choosing — ideally validated via a dry-run first. See the ruleset README for the commands.

## Consequences

- **The Definition of Done and `spec`/saga governance become enforced, not advisory.** A red PR
  cannot merge; a `spec/**` change cannot merge without the maintainer.
- **Protection changes are reviewable diffs.** The next change to required checks or rules is a PR
  against `.github/rulesets/*.json`, not an untracked settings-UI edit.
- **The RC promotion flow is preserved.** merge-commit stays enabled on `main`; the self-scoping
  code-owner rule does not block routine slices on `saga/*`.
- **The required-check list must track CI job names.** If a CI job is renamed or a new always-running
  gate is added, the JSON must be updated in the same change and re-applied, or the ruleset either
  blocks forever (renamed) or under-gates (new job). This coupling is called out in the README.
- **`protect-default-branch` is superseded** by `protect-main` (which includes its two rules); the
  maintainer may delete the old ruleset after applying the new one.
- Applying the rulesets remains a **maintainer action** — this ADR and the committed JSON do not, and
  cannot, apply them.
