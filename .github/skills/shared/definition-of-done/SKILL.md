---
name: definition-of-done
description: >-
  The OpenLogo Definition of Done — the CI-enforced checklist and PR expectations every change must
  meet before it can merge. Use to self-verify before opening or updating a pull request.
created: 2025-06-01T00:00
updated: 2025-06-01T00:00
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
   but any shipped code must be fully covered).
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

## Review gate — run it before you open the PR

CI-green plus the author's own attestation is not enough. As the **last step in the implementing
session**, the author runs [`shared/review-gate`](../review-gate/SKILL.md): it dispatches at least two
non-author sub-agents — the logic/spec reviewer (`rubber-duck`, or a named fallback) and **every**
domain-adaptive **QA** expert — that between them re-run
the clean-tree DoD (verifying the build actually **emits** artifacts, not just a `0` exit),
spec-fidelity, conformance fixtures, runnable examples, a11y/pedagogy, and instructions/skills/docs/
spec drift. The author iterates until all return `pass`, attaches the verdicts, and opens the PR;
`@orchestrator` (or a human) does the final verification and merge.

## PR expectations

- **One task = one PR**, on a feature branch, with the **declared write-set** listed.
- Shared files (grammar, cross-package contracts, workspace manifests, anything under `spec/`) are
  changed **one PR at a time**.
- **You do not self-merge.** Humans + required CI checks gate `main` by default; the maintainer may
  delegate merge execution to `@orchestrator`, only after a non-author review-gate PASS + green CI
  (the implementer is never the sole attester). `spec/` changes go through `@product-owner` to the
  maintainer.

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
- [ ] one PR, write-set declared, shared files serialized
```

## Self-verify

Run the smallest command set that covers the change (build + the affected package's tests +
conformance), then the examples check. Exact commands are recorded in `docs/adr/0001-tech-stack.md`
as the toolchain lands; keep this skill in sync when they change.
