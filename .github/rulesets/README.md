# Branch-protection rulesets (`main`, `saga/*`)

These JSON files are the **reviewable, reproducible source** for the repository rulesets that gate
`main` and `saga/*`. They make the Definition of Done and the `spec/`/saga governance surfaces
**enforced** rather than advisory (issue #695). See
[ADR-0021](../../docs/adr/0021-branch-protection-rulesets.md) for the rationale.

> **Rulesets are repository-admin settings — only the maintainer (@pmalarme) can apply them.**
> Nothing here is applied automatically; committing a file changes no protection. Apply with the
> commands below.

| File | Ruleset name | Targets |
|---|---|---|
| [`main.json`](main.json) | `protect-main` | `~DEFAULT_BRANCH` (i.e. `main`) |
| [`saga.json`](saga.json) | `protect-saga-branches` | `refs/heads/saga/*` |

## What they enforce

Both rulesets require, for every PR into a protected branch:

- **A pull request before merging**, with **review from Code Owners** — this is the teeth behind the
  "maintainer-only, non-delegable" rule: a PR touching `spec/**`, `saga.yml`, `spec.yml`, or
  `CODEOWNERS` cannot merge without @pmalarme's approval (`.github/CODEOWNERS`). Ordinary slices touch
  no owned path, so no human approval is forced and the orchestrator's delegated merge authority is
  unaffected (`required_approving_review_count` is `0`; the code-owner rule only bites on owned paths).
- **The always-reporting CI status checks** (the CI-enforced Definition of Done), by their exact
  check-name. See the list below and ADR-0021 for why three workflows are deliberately **excluded**.
- **No force-pushes** (`non_fast_forward`) and **no branch deletion** (`deletion`).
- **Merge methods**: `main` allows **squash** (slice-title subject) **and merge-commit** (the RC
  promotion deliberately preserves a saga's slice history); `saga/*` allows **squash** (slices land by
  PR title) **and merge-commit** (the periodic `main → saga/*` pullback that keeps a saga from drifting
  behind released trunk must be a merge commit to preserve ancestry). This matches the applied repo
  settings — do not disable merge-commit on `main`, or the Release Candidate promotion would collapse a
  saga's commits into one.
- **Branch creation is not gated** on `saga/*` (`do_not_enforce_on_create: true`), so a saga branch can
  be created lazily when its saga starts without a PR/checks existing yet.

### Required status checks (exact names — a mismatch is a permanent block)

`Build & type-check` · `Lint & format` · `Unit, conformance & examples` · `Test coverage (100%)` ·
`Studio visual regression` · `Meta (labels, issue forms, workflows)` · `Conventional Commits` ·
`CodeQL` · `Analyze (javascript-typescript)` · `Dependency review` · `Detect toolchain`

**Deliberately NOT required** — these never report on a PR that touches none of their paths, and a
required check that never reports blocks the merge forever:

- `Copilot Setup Steps` (`copilot-setup-steps.yml` — `push` + `paths:` only)
- `Label sync` (`label-sync.yml` — `push` to `main` + `paths:` only)
- `Labeler` (`labeler.yml` — a `pull_request_target` labeling action, not a pass/fail gate)

The `Agentic workflow compile is clean (gh-aw)` job is path-conditional via a **job-level `if:`**, so
it reports a passing *skipped* conclusion when workflows are untouched and would be safe to require;
it is left out here to keep the required set equal to CI's always-reporting jobs. `Studio visual
regression` is likewise gated by a job-level `if:` and reports `skipped` (passing) when the studio is
untouched, so it is safe to require.

## How to apply (maintainer only)

Create each ruleset once:

```bash
gh api --method POST repos/pmalarme/open-logo/rulesets --input .github/rulesets/main.json
gh api --method POST repos/pmalarme/open-logo/rulesets --input .github/rulesets/saga.json
```

Update an existing ruleset in place (find its id with `gh api repos/pmalarme/open-logo/rulesets`):

```bash
gh api --method PUT repos/pmalarme/open-logo/rulesets/<id> --input .github/rulesets/main.json
```

### Dry-run first (recommended)

To satisfy both "#695 before the RC" and "don't debut a brand-new ruleset on the 133-commit RC",
create the ruleset with `"enforcement": "evaluate"` (a temporary edit) so violations are **logged,
not blocked**, open a throwaway PR to confirm every required check name resolves and no rule
misfires, review the rule-insights log, then flip back to `"enforcement": "active"` and re-apply.
`evaluate` mode requires GitHub Enterprise; on other plans, apply to a throwaway `saga/*`-shaped test
branch pattern first, or apply `active` and watch the first PR closely.

The existing `protect-default-branch` ruleset (deletion + non-fast-forward only) is **superseded** by
`protect-main`, which includes those two rules plus PR/code-owner/status-check enforcement. After
applying `protect-main`, the maintainer may delete `protect-default-branch` to avoid duplication.
