---
name: epic-gate
description: >-
  The OpenLogo Epic Gate — the capability-level completion audit an epic must pass before it closes,
  sitting between the per-issue Issue Gate and the release-level Saga Gate. Use when deciding whether a
  type:epic issue is truly done. Owned by @product-owner + @orchestrator.
created: 2026-07-22T00:00
updated: 2026-07-22T00:00
---

## Purpose

An epic is the middle tier of the governance ladder (**Issue → Epic → Saga**). Individual issues each
clear the **Issue Gate** (`shared/definition-of-done`), but a green pile of closed issues does **not**
prove the *capability* is coherent, conformant, and contract-stable. The **Epic Gate** is that
capability-level audit: it closes the gap between "all my slices merged" and "this profile/feature is
actually done." Like every tier, it = **a DoD-style checklist + required specialist review +
rubber-duck review**, applied at capability scope.

## When to run it

- A `type:epic` issue's child **sub-issues** are all `Done`, and someone proposes closing the epic.
- Before an epic's Status flips to `Done` on the board (`product-owner/github-project`).
- As part of a Saga-completion audit — each child epic must already have passed its Epic Gate.

## The Epic Gate checklist

Run against the epic and **all** its native sub-issue children:

1. **All child issues closed** — every sub-issue (slice/bug/spec/task) is `Done` and passed its Issue
   Gate; none reopened or silently dropped.
2. **No blocker bugs open** against the capability (search the profile/area labels).
3. **Required `[spec]` decisions approved** — every design question the epic depended on is resolved
   and merged into `spec/` by the maintainer (no "TBD" semantics shipped).
4. **Capability conformance is green** — the profile's conformance suite passes across **all** domains
   (parser → runtime → rendering → studio → edu), not just the packages this epic touched.
5. **Cross-cutting contracts stable** — AST / events / diagnostics / token-classes the epic introduced
   or changed are final and consumed consistently by every dependent package.
6. **Docs, highlighting, and examples complete** — reference docs, syntax highlighting, and runnable
   `spec/examples/*.logo` cover the capability; every OpenLogo program in the prose is fenced
   ` ```logo ` so `npm run examples` actually checks it (issue #850); no doc/spec drift.
7. **No unresolved architecture questions** — anything deferred is filed as a follow-up issue under the
   right saga, not left implicit.
8. **Specialist review + rubber-duck review recorded at capability level** — at least the domain
   specialist(s) for the profile plus `rubber-duck` (or a named fallback) reviewed the *whole* epic
   (integration, not just individual PRs) and returned `pass`; verdicts linked on the epic issue.

## Who owns it

`@product-owner` (does the capability/scope + docs/spec judgement) **and** `@orchestrator` (does the
cross-package integration + conformance judgement) jointly sign off. Neither closes an epic alone. The
maintainer is looped in whenever an unresolved `[spec]` item is in scope.

## Outcome

- **Pass** → close the epic; set its board Status to `Done`; it now counts toward its saga's
  Saga-completion audit.
- **Fail** → keep the epic open, file the specific gaps as new sub-issues under it (or the Maintenance
  saga), and re-run when they close.

## Checklist
- [ ] All child sub-issues closed and Issue-Gate-passed.
- [ ] No blocker bugs; all required `[spec]` decisions merged.
- [ ] Profile conformance green across all domains; contracts stable.
- [ ] Docs + highlighting + examples complete; no drift; no unresolved architecture questions.
- [ ] Capability-level specialist + rubber-duck review recorded (reviewers ≠ author).
- [ ] `@product-owner` + `@orchestrator` both signed off before the epic closed.
