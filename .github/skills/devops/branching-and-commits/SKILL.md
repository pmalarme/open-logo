---
name: branching-and-commits
description: >-
  The OpenLogo branching model and commit convention — branch types (feature/*, fix/*, saga/*, no epic
  branch), how work integrates into saga branches and promotes to main as a Release Candidate, and the
  Conventional Commits rule CI enforces. Use when naming a branch, targeting a PR, or writing a commit.
created: 2026-07-22T00:00
updated: 2026-07-22T00:00
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

## Conventional Commits (CI-enforced)

**Every commit subject AND the PR title** follow `type(scope): subject`. CI lints both via
[`.github/workflows/commitlint.yml`](../../../workflows/commitlint.yml) →
[`validate-commits.py`](../../../scripts/validate-commits.py); the PR title matters most because it
becomes the squash-merge subject.

- **type** — one of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
  `chore`, `revert`. Append `!` for a breaking change (`feat(grammar)!: ...`).
- **scope** — a **profile** (`core`, `turtle-rendering`, `data`, `geometry`, `heritage`, `sprites`,
  `interaction`, `sound`, `modules`, `localization`, `educational`, `tutor-ai`) or an **area**
  (`grammar`, `runtime`, `rendering`, `studio`, `edu`, `ci`, `docs`, `spec`); infra scopes `deps`,
  `release`, `repo`, `meta` are also allowed. Scope is **required**.
- **subject** — imperative, concise, no trailing period.

Examples: `feat(data): add list reporters`, `fix(runtime): correct REPEAT nesting`,
`docs(spec): clarify error-model ol-2xx codes`, `ci(repo): pin actions to SHA`.

Run it locally before pushing:

```bash
python .github/scripts/validate-commits.py "feat(geometry): add star polygons"
```

## Checklist
- [ ] Branch type matches the work: `feature/*` (work incl. spec), `fix/*` (bug); no epic branch.
- [ ] Cut from — and PR targets — the **parent saga branch** (or `main` for Maintenance work).
- [ ] Saga branch pulled up to `main` after each merge; `saga/*→main` RC left to the maintainer.
- [ ] `[spec]`/`[saga]` changes left for maintainer merge (CODEOWNERS).
- [ ] Every commit subject + the PR title are valid Conventional Commits (type(scope): subject).
