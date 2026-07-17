<!--
OpenLogo pull request. One task = one vertical slice = one PR (team instructions §4).
Keep changes surgical (KISS) and leave the code cleaner than you found it (Boy Scout).
-->

## What & why

<!-- One or two sentences. Link the issue this slice implements. -->

Closes #

## Write-set

<!--
The files/globs this PR actually touches — it must match the declared write-set on the
issue. Shared-file edits (grammar, cross-package contracts, workspace manifests, spec/**)
are serialized one PR at a time.
-->

-

## Spec fidelity

- [ ] Canonical OpenLogo vocabulary (not classic Logo); spec sections honored:
- [ ] Diagnostics use stable `ol-*` codes with source spans (no ad-hoc error strings)

## Definition of Done

<!-- Check what applies to the artifacts this PR touches (team instructions §5). -->

- [ ] Builds and type-checks (TypeScript 7)
- [ ] Lint + format pass (incl. OpenLogo style-lint where relevant)
- [ ] Unit tests pass
- [ ] Conformance fixtures pass (extended for this feature)
- [ ] Runnable `spec/examples/*.logo` and doc examples still parse and run
- [ ] Accessibility / pedagogy checks pass where applicable
- [ ] Docs, highlighter, and spec cross-links updated in this PR (no drift)

## Independent review gate

<!--
An agent that did NOT author this change runs shared/review-gate before it goes to a human for
merge. Reviewer ≠ author. See .github/skills/shared/review-gate/SKILL.md.
-->

- [ ] Clean-tree DoD re-run — build **emits** verified (real `dist/*.js` + `*.d.ts`, not just exit 0)
- [ ] Spec-fidelity re-checked (canonical vocabulary, `ol-*` codes with spans, profile boundaries)
- [ ] Conformance fixtures present & green
- [ ] Instructions / skills / docs / spec drift checked (in this PR if needed)
- [ ] Reviewer named and ≠ author:

## Reviewers / integration

<!--
Name the owning agent(s) for the packages touched and any required cross-package reviewers.
Agents do not self-merge — a human merges once CI is green (team instructions §5).
-->

-
