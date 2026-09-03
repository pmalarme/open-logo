---
name: branching-and-commits
description: >-
  The OpenLogo branching model and commit convention — branch types (feature/*, fix/*, saga/*, no epic
  branch), how work integrates into saga branches and promotes to main as a Release Candidate, and the
  Conventional Commits rule CI enforces (scope optional, multi-scope allowed; PR title blocking,
  commit subjects advisory). Use when naming a branch, targeting a PR, or writing a commit.
created: 2026-07-22T00:00
updated: 2026-08-01T00:00
---

## Purpose

Keep parallel agent work mergeable and releases deliberate. This skill is the single source of truth
for **where a branch comes from, where its PR targets, and how a commit is worded**. It pairs with
`orchestrator/integrate-and-merge` (who merges) and `shared/definition-of-done` (the gate).

## Branch model (GitFlow-style, saga-anchored)

| Branch | For | Cut from | Merges into |
|---|---|---|---|
| `main` | released / integrated trunk | — | — (only via saga RC or Maintenance work) |
| `saga/<slug>` | one release saga (M0–M6) | `main` | `main` (as a Release Candidate) |
| `feature/<issue>-<slug>` | any work issue **except a bug** (slice, spec, foundation, docs, conformance, chore) | parent `saga/*` branch | parent `saga/*` branch |
| `fix/<issue>-<slug>` | a `type:bug` fix | parent `saga/*` branch | parent `saga/*` branch |

Rules:

- **An epic has no branch** — it is a planning container (sub-issues carry the code).
- **A saga branch is created lazily** — only when the saga moves to `In Progress` (see
  `product-owner/github-project`), never for planned-but-not-started sagas.
- **The Maintenance saga has no branch.** Continuous / cross-cutting work (infra, docs, refactors,
  non-release bugs) branches `feature/*` or `fix/*` **from `main`** and **merges straight to `main`**.
  The RC flow applies only to release sagas (M0–M6).
- **`[spec]` work uses `feature/*`** like other work, but is **maintainer-merged and non-delegable**
  (`CODEOWNERS` pins `spec/**`).

## Integration flow

1. Pull an issue → cut `feature/*` or `fix/*` from its **parent saga branch** (or `main` for
   Maintenance work).
2. Build it to the Issue Gate (`shared/definition-of-done`), open a PR **targeting the parent saga
   branch** (or `main` for Maintenance), merge under delegated authority after a non-author review PASS.
3. **After each merge into a saga branch, pull `main` back into it** so the saga branch never drifts
   behind released trunk and conflicts surface early:
   ```bash
   git switch saga/<slug> && git merge origin/main   # or a PR main -> saga/<slug>
   ```
4. When the saga passes its **Saga-completion audit**, open the **`saga/* → main` Release Candidate**
   PR. **The maintainer decides** whether to cut the release and tag the tuple
   (`devops/security-and-release`); the orchestrator does not self-promote.

```text
main ──┬─────────────────────────────► main (release tag)
       │                          ▲
       └─► saga/m2 ──┬───┬────────┘  (RC promotion, maintainer decides)
                     ▲   ▲
       feature/123 ──┘   │            (work issues target the saga branch)
       fix/145 ──────────┘
```

## Conventional Commits

`type(scope): subject` — **`type` and `subject` required, `scope` optional.** Two surfaces, two
severities, because they have different fates:

| Surface | Severity | Why |
|---|---|---|
| **PR title** | **blocking** | It becomes the **squash-merge subject** — the line that actually lands on `main`/`saga/*`. |
| **commit subject** | **advisory** (warning annotation) | Squash-merge discards individual subjects, and a cloud coding agent **cannot rewrite** the bootstrap commits the platform creates before its first turn. |

CI lints both via [`commitlint.yml`](../../../workflows/commitlint.yml) →
[`validate-commits.py`](../../../scripts/validate-commits.py). **CI is the gate**; the local hook
and the Copilot agent policy are guidance (see `devops/agent-policy`).

- **type** — one of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
  `chore`, `revert`. Append `!` for a breaking change (`feat(grammar)!: ...`).
- **scope** — **optional**. Conventional Commits v1.0.0 makes it optional and so do we: `feat: ...`
  is valid (CI emits a "consider adding a scope" notice, never a failure). When present, every scope
  must come from the allowlist: a **profile** (`core`, `turtle-rendering`, `data`, `geometry`,
  `heritage`, `sprites`, `interaction`, `sound`, `modules`, `localization`, `educational`,
  `tutor-ai`) or an **area** mirroring the `area:*` labels (`grammar`, `highlighter`, `checker`,
  `runtime`, `rendering`, `studio`, `edu`, `ci`, `docs` — `core` is covered by the profile scope
  above); governance/infra scopes `spec` (the maintainer-owned `spec/` surface), `deps`, `release`,
  `repo`, `meta` are also allowed.
- **subject** — imperative, concise, no trailing period.

Examples: `feat(data): add list reporters`, `fix(runtime): correct REPEAT nesting`,
`docs(spec): clarify error-model ol-2xx codes`, `ci(repo): pin actions to SHA`, `chore: bump lockfile`.

### Choosing a scope when a change spans packages

A vertical slice touches several packages by design (grammar → AST → runtime + trace → renderer/UI
→ tests → docs), so "one scope" is often a lie. In order of preference:

1. **Name the primary domain** — the package that *owns the behavior change*. Docs and tests that
   ride along do not count. `feat(grammar): add for-in loop` is right even when the PR also changes
   `@openlogo/runtime` and `docs/`.
2. **Use multiple scopes** when two or three domains are genuinely co-equal — comma-separated, no
   spaces, each from the allowlist: `feat(grammar,runtime): add for-in loop`.
   **At most three.** A fourth scope is CI-blocking and is a signal to split the PR.
3. **Use an umbrella scope** — `repo` or `meta` for cross-cutting infra/governance changes that
   belong to no single domain.
4. **Omit the scope** rather than inventing or arbitrarily picking one.

### Local check (optional, bypassable)

[`.githooks/commit-msg`](../../../../.githooks/commit-msg) runs the same checker on every local
`git commit`. It is wired by the root `prepare` npm script, so `npm ci` / `npm install` activates it:

```bash
npm ci                    # sets core.hooksPath=.githooks
git config core.hooksPath # -> .githooks
```

It is **guidance, never a gate** — bypass it deliberately with `git commit --no-verify`, and note it
cannot cover commits created through the GitHub API (which is how a cloud agent pushes). Lint a
subject by hand any time:

```bash
python .github/scripts/validate-commits.py "feat(geometry): add star polygons"
```

## Required branch protection

CODEOWNERS only has teeth when the branch ruleset enforces it. The rulesets on **`main`** and
**`saga/*`** are committed as reviewable JSON under
[`.github/rulesets/`](../../../rulesets/README.md) (`main.json`, `saga.json`) and applied by the
maintainer; [ADR-0031](../../../../docs/adr/0031-branch-protection-rulesets.md) records the choice.
They must keep these on, or the "maintainer-only, non-delegable" rule is advisory only:

- **Require a pull request before merging** + **Require review from Code Owners** — this is what makes
  a `spec/**` / `saga.yml` / `spec.yml` PR un-mergeable without @pmalarme's approval. CODEOWNERS names
  the reviewer; the ruleset blocks the merge.
- **Require status checks to pass** — at least `Conventional Commits` and `Meta`, plus the build/test
  suite — so a red PR cannot merge.
- **Block force-pushes and deletions** on `main` and `saga/*`.

The **merge-method settings** follow the two-path model (see
[ADR-0031](../../../../docs/adr/0031-branch-protection-rulesets.md)): a **slice → `saga/*`** merge is a
**squash** whose subject is the PR title, so the linted title is what lands and commit subjects can
safely be advisory; a **`saga/* → main`** Release Candidate is a deliberate **merge commit** that
preserves the saga's slice history rather than collapsing it. Repo settings therefore allow **squash
and merge-commit** (rebase off), with the squash subject set to the PR title. Both `main` and `saga/*`
allow both methods: `saga/*` needs merge-commit for the periodic `main → saga/*` pullback (step 3
above), which must preserve ancestry.

CODEOWNERS by itself does **not** restrict who clicks "Merge"; the ruleset does. If merge-actor
restriction is needed beyond code-owner review, use repo permissions/automation, not CODEOWNERS.

## Checklist
- [ ] Branch type matches the work: `feature/*` (work incl. spec), `fix/*` (bug); no epic branch.
- [ ] Cut from — and PR targets — the **parent saga branch** (or `main` for Maintenance work).
- [ ] Saga branch pulled up to `main` after each merge; `saga/*→main` RC left to the maintainer.
- [ ] `[spec]`/`[saga]` changes left for maintainer merge (CODEOWNERS + required code-owner review).
- [ ] **PR title** is a valid Conventional Commit (`type(scope): subject`; scope optional, ≤3 scopes) — this is the blocking check.
- [ ] Scope names the **primary domain**, or is omitted / multi-scope / umbrella rather than arbitrary.
- [ ] Commit subjects follow the convention where the author controls them (advisory, not a gate).
