# 4. Independent review gate in the Definition of Done

- Status: Accepted
- Date: 2024
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

OpenLogo is built by a team of specialized agents. The Definition of Done (team instructions §5,
`shared/definition-of-done`) is CI-enforced, but two failure modes showed that **CI-green plus the
author's own attestation is not sufficient** to trust a change:

- A stale `.tsbuildinfo` made `tsc -b` exit `0` while emitting **nothing** — an incremental no-op the
  green build hid.
- A `typescript-eslint` peer-cap silently pinned the compiler **below TypeScript 7**.

Both are the kind of defect a second reviewer catches and a passing pipeline does not. An implementer
should never be the sole attester that their own change is done.

## Decision

Every change gets an **independent pre-merge review** by an agent that did **not** author it, before a
human merges. The playbook is [`shared/review-gate`](../../.github/skills/shared/review-gate/SKILL.md);
the gate is added as item 8 of the Definition of Done (team instructions §5 and
`shared/definition-of-done`) and recorded on every PR via the `## Independent review gate` block in
`PULL_REQUEST_TEMPLATE.md`.

- **No new persona.** Reuse the existing reviewers — `rubber-duck` (logic/design/spec-fidelity),
  `code-review` (the diff), and `@testing` (conformance fixtures). The reviewer is always distinct
  from the author and is named on the PR.
- The gate is a **clean-tree re-run** of the DoD (`npm ci` from clean) that explicitly verifies the
  build **emits** real artifacts (`dist/*.js` + `*.d.ts`), not merely that it exits `0`, plus
  spec-fidelity, conformance fixtures, runnable examples, a11y/pedagogy, and an
  **instructions/skills/docs/spec drift** check.
- The gate is a **process step, not a new CI job** in v1 (KISS). Automating a "a non-author reviewed
  this" check is a possible later follow-up.
- The gate **does not merge.** It yields a pass/block verdict; a human still performs the merge once
  CI is green.

## Consequences

- No change reaches a human on the strength of its author's word and a green pipeline alone.
- The drift check keeps `AGENTS.md`, the instructions, skills, `docs/`, and `spec/` cross-links from
  going stale in the same PR that changes behavior.
- One extra review pass per change; mitigated by reusing existing reviewers and a fixed checklist.
- If the gate is later automated, this ADR is superseded by the ADR that introduces that job.
