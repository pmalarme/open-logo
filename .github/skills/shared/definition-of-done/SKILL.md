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
4. **Conformance fixtures pass** and were extended for the new/changed behavior
   (`shared/conformance-fixture`).
5. **Runnable examples still run** — `spec/examples/*.logo` and doc snippets parse and execute.
6. **Accessibility/pedagogy checks pass** where applicable (reduced-motion, keyboard, non-visual
   descriptions; progressive hints / no-spoilers).
7. **Docs & spec cross-links updated** in the same PR (no drift).

## PR expectations

- **One task = one PR**, on a feature branch, with the **declared write-set** listed.
- Shared files (grammar, cross-package contracts, workspace manifests, anything under `spec/`) are
  changed **one PR at a time**.
- **You do not self-merge.** Humans + required CI checks gate `main`. `spec/` changes go through
  `@product-owner` to the maintainer.

## Suggested PR body

```markdown
## What & why
<one-paragraph summary; link the issue and the spec section(s) honored>

## Write-set
- packages/<pkg>/... , tests/conformance/<...> , docs/<...>

## Definition of Done
- [ ] build + type-check   - [ ] lint (+ style)   - [ ] unit
- [ ] conformance fixtures extended + green
- [ ] examples run   - [ ] a11y/pedagogy (if applicable)
- [ ] docs + spec cross-links updated
- [ ] one PR, write-set declared, shared files serialized
```

## Self-verify

Run the smallest command set that covers the change (build + the affected package's tests +
conformance), then the examples check. Exact commands are recorded in `docs/adr/0001-tech-stack.md`
as the toolchain lands; keep this skill in sync when they change.
