---
name: definition-of-done
description: >-
  The OpenLogo Definition of Done — the CI-enforced checklist and PR expectations every change must
  meet before it can merge. Use to self-verify before opening or updating a pull request.
created: 2025-06-01T00:00
updated: 2026-08-02T00:00
---

## Purpose

A change is "done" only when it is proven, documented, and green. This skill is the gate. It mirrors
`.github/instructions/openlogo-team.instructions.md` §5 and is enforced by CI (`@testing`).

## Definition of Done (all that apply to the change)

1. **Builds & type-checks** (TypeScript 7).
2. **Lint passes**, including OpenLogo style-lint (`ol-style-*`) where relevant.
3. **Unit tests pass** for the changed package(s).
4. **Test coverage is 100%** — line, branch, and function coverage (`npm run coverage`; only files
   loaded by tests are counted, so stub packages with no runtime yet don't drag the number down —
   but any shipped code must be fully covered). **Verify on Node 22** (the version in `.nvmrc` that
   CI pins; `nvm use` before running): Node 22's `--experimental-test-coverage` counts `*.test.mjs`
   files toward the gate while Node 24+ excludes them, so a newer Node can report a false-green that
   CI then fails.
5. **Conformance fixtures pass** and were extended for the new/changed behavior
   (`shared/conformance-fixture`).
6. **Runnable examples still run** — `spec/examples/*.logo` and doc snippets parse and execute.
7. **Accessibility/pedagogy checks pass** where applicable (reduced-motion, keyboard, non-visual
   descriptions; progressive hints / no-spoilers).
8. **Docs & spec cross-links updated** in the same PR (no drift).
9. **Self-review passed before the PR** — the implementing agent ran
   [`shared/review-gate`](../review-gate/SKILL.md) in-session: at least two non-author sub-agents —
   the logic/spec reviewer (`rubber-duck`, or a named fallback) plus **every** domain-adaptive QA
   expert — each returned `pass`, and their verdicts are attached to the PR (reviewer ≠ author).
10. **Every review finding is resolved — blocking *and* non-blocking.** Nits, suggestions, and
    "consider…" comments are **fixed** (that is the Boy Scout rule, team instructions §11), or
    **declined with a one-line rationale** plus a follow-up issue when they are real work outside the
    declared write-set. A finding that is silently dropped leaves the change **not done**. The
    fix → commit → re-review loop runs until everything passes, **capped at 10 rounds**; if anything
    is still open after round 10, the PR is **not** opened — escalate to `@orchestrator`/the
    maintainer with the open findings and the per-round SHAs (the slice probably needs re-cutting).

## Review gate — run it before you open the PR

CI-green plus the author's own attestation is not enough. As the **last step in the implementing
session**, the author runs [`shared/review-gate`](../review-gate/SKILL.md): it dispatches at least two
non-author sub-agents — the logic/spec reviewer (`rubber-duck`, or a named fallback) and **every**
domain-adaptive **QA** expert — that between them re-run
the clean-tree DoD (verifying the build actually **emits** artifacts, not just a `0` exit),
spec-fidelity, conformance fixtures, runnable examples, a11y/pedagogy, and instructions/skills/docs/
spec drift. The author **resolves every finding — blocking and non-blocking alike** (fix it, or
decline it with a one-line rationale plus a follow-up issue when it is real work outside the declared
write-set), iterates until all reviewers return `pass` on one final SHA with nothing left open —
**within a hard cap of 10 rounds** — attaches the verdicts, and opens the PR;
`@orchestrator` (or a human) does the final verification and merge. Still open after round 10? Do not
open the PR: escalate to `@orchestrator`/the maintainer with the outstanding findings and per-round
SHAs.

## Three-tier governance ladder (Issue → Epic → Saga)

The 10-point DoD above is the **Issue Gate** — the per-PR gate every work issue clears. Above it sit
two more gates; **each tier = DoD-style checklist + required specialist review + rubber-duck review**,
just applied at a wider scope:

| Tier | Gate | Who runs it | What it proves |
|---|---|---|---|
| **Issue** | Issue Gate (this DoD + `review-gate`) | implementing agent → `@orchestrator`/human merges | one change is proven, documented, green |
| **Epic** | **Epic Gate** ([`shared/epic-gate`](../epic-gate/SKILL.md)) | `@product-owner` + `@orchestrator` | a whole capability is conformant: all child issues closed, no blocker bugs, specs approved, docs complete, contracts stable |
| **Saga** | Saga Gate (`orchestrator/integrate-and-merge` → **Saga-completion audit**) | `@orchestrator` runs/records + recommends; **maintainer** approves & closes | a profile set is conformant across **all** domains; release can ship |

An epic closes only after its Epic Gate; a saga's audit must be 100% green before the **maintainer**
promotes the RC, tags any release tuple, and closes the saga (`[saga]` is non-delegable; `spec/**` +
saga/spec-template **PRs** are gated by CODEOWNERS + the required code-owner-review ruleset).
Sagas replaced GitHub milestones, so these gates operate on
`type:saga` / `type:epic` issues and their **native sub-issue** children, not on milestone objects.

## PR expectations

- **One task = one PR**, on the correct branch type (`feature/*` for work incl. `[spec]`, `fix/*` for a
  bug; see `devops/branching-and-commits`), with the **declared write-set** listed.
- **PR title and every commit follow Conventional Commits** — `type(scope): subject`, scope = a profile
  or area (e.g. `feat(data):`, `fix(runtime):`, `docs(spec):`). CI lints this.
- **Merge target is the parent saga's `saga/*` branch, not `main`** — work integrates into its saga
  branch; the saga branch is promoted to `main` as a Release Candidate. **Maintenance-saga work merges
  straight to `main`** (that saga has no branch).
- Shared files (grammar, cross-package contracts, workspace manifests, anything under `spec/`) are
  changed **one PR at a time**.
- **You do not self-merge.** Humans + required CI checks gate the target branch by default; the
  maintainer may delegate merge execution to `@orchestrator`, only after a non-author review-gate PASS
  + green CI (the implementer is never the sole attester). **`[spec]` and `[saga]` changes are
  maintainer-only and NON-delegable** — they go through `@product-owner`/`@language-designer` to the
  maintainer, who merges personally. This is enforced by **`CODEOWNERS` + the branch ruleset**: any PR
  touching `spec/**` or the saga/spec templates requires @pmalarme's code-owner approval before it can
  merge (the ruleset on `main`/`saga/*` must keep "Require review from Code Owners" on — see
  `devops/branching-and-commits`). CODEOWNERS assigns the required reviewer; the ruleset is what blocks
  the merge.

## Suggested PR body

```markdown
## What & why
<one-paragraph summary; link the issue and the spec section(s) honored>

## Write-set
- packages/<pkg>/... , tests/conformance/<...> , docs/<...>

## Definition of Done
- [ ] build + type-check   - [ ] lint (+ style)   - [ ] unit   - [ ] 100% coverage (line/branch/function)
- [ ] conformance fixtures extended + green
- [ ] examples run   - [ ] a11y/pedagogy (if applicable)
- [ ] docs + spec cross-links updated
- [ ] self-review passed before PR (logic/spec reviewer + every domain QA, all ≠ author)
- [ ] every finding resolved — blocking **and** non-blocking (fixed, or declined with rationale + follow-up issue); converged within 10 review rounds
- [ ] one PR, write-set declared, shared files serialized
```

## Self-verify

Run the smallest command set that covers the change (build + the affected package's tests +
conformance), then the examples check. Exact commands are recorded in `docs/adr/0001-tech-stack.md`
as the toolchain lands; keep this skill in sync when they change.
