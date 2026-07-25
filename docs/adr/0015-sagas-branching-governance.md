# 15. Sagas, branching, and multi-level governance gates

- Status: Accepted
- Date: 2026-07-22
- Deciders: OpenLogo maintainer (@pmalarme)
- Related: refines [ADR-0003](0003-versioning-and-release.md) (versioning/release) and
  [ADR-0004](0004-independent-review-gate.md)/[ADR-0008](0008-implementer-run-self-review.md) (review
  gate); mechanics in [`../delivery.md`](../delivery.md),
  [`../../.github/skills/product-owner/sagas-epics-and-issues/SKILL.md`](../../.github/skills/product-owner/sagas-epics-and-issues/SKILL.md),
  [`../../.github/skills/devops/branching-and-commits/SKILL.md`](../../.github/skills/devops/branching-and-commits/SKILL.md),
  and [`../../.github/skills/shared/epic-gate/SKILL.md`](../../.github/skills/shared/epic-gate/SKILL.md)

## Context

OpenLogo is built by autonomous agents. The prior model used **GitHub milestones** as the top planning
container and expressed epic → slice hierarchy with **body checklists**. Three problems emerged:

- **Agents cannot govern milestones as first-class work.** A milestone is not an issue, so a cloud
  agent cannot create, label, link, or close one the way it does issues. Native GitHub **sub-issues**,
  by contrast, are issues an agent can create and link end-to-end.
- **Hierarchy lived in prose.** Body checklists (`- [ ] #123`) drift from reality and have no progress
  bar, no rollup, and no API.
- **Only two governance tiers existed.** A per-PR Definition of Done (Issue level) and a
  milestone-completion audit (release level), with **nothing auditing a whole capability** (epic)
  before it closed — capabilities could be declared "done" on a pile of green-but-shallow slices.

There was also no written branching model or commit convention, so parallel agent branches and PR
titles were inconsistent.

## Decision

**1. Sagas replace GitHub milestones.** The top of the hierarchy is a **saga** (`type:saga` issue): a
profile-DAG synchronization point that groups epics toward a release. The release ladder M0–M6 are
sagas; a standing **Maintenance** saga holds continuous, non-release work. Milestones are retired.

**2. Native GitHub sub-issues express hierarchy (saga → epic → issue).** Parentage is a real sub-issue
link, never a body checklist: an epic is a sub-issue of its saga; a work issue (slice/bug/spec/task) is
a sub-issue of its epic. This is the sole source of truth for structure and rollup. **Exception:** small
foundation/chore work with no natural epic may hang **directly under a saga** (typically the Maintenance
saga) — it still clears its own **Issue Gate** and is a native sub-issue of that saga, never an orphan.

**3. A new `[spec]` type.** Design/architecture/language decisions and **any `spec/` change** are a
first-class `type:spec` issue. `[spec]` and `[saga]` are **maintainer-owned and non-delegable**;
`CODEOWNERS` pins `spec/**` and the saga/spec templates to the maintainer, and the branch rulesets on
`main` and `saga/*` keep **"Require review from Code Owners"** on so those paths cannot merge without
@pmalarme's approval. (CODEOWNERS names the required reviewer; the ruleset is what blocks the merge —
they are only teeth together.)

**4. Three-tier governance ladder.** Each tier = a DoD-style checklist + required specialist review +
rubber-duck review, at widening scope:

- **Issue Gate** — the existing Definition of Done + `shared/review-gate`, per PR.
- **Epic Gate** — new capability audit (`shared/epic-gate`): all child issues closed, no blocker bugs,
  required specs approved, profile conformance green across all domains, contracts stable, docs
  complete. Owned by `@product-owner` + `@orchestrator`.
- **Saga Gate** — the renamed release-level audit (`orchestrator/integrate-and-merge` →
  Saga-completion audit), unchanged in substance.

**5. GitFlow-style, saga-anchored branching.** `feature/*` for all work except bugs, `fix/*` for bugs,
`saga/*` for an active release saga (created lazily when it moves to In Progress); an **epic has no
branch**. Work merges into its **parent saga branch**; after each merge `main` is pulled back into the
saga branch; `saga/* → main` is a **Release Candidate** the maintainer decides to cut. Maintenance-saga
work branches from and merges straight to `main` (that saga has no branch).

**6. Conventional Commits, CI-enforced.** Every commit subject and PR title follow `type(scope):
subject`, scope drawn from the profile/area taxonomy. `.github/workflows/commitlint.yml` +
`validate-commits.py` enforce it.

## Consequences

- Agents can create and govern the full hierarchy (sagas, epics, sub-issue links) as ordinary issues —
  no human-only milestone step in the loop.
- Hierarchy has live progress bars and an API; body checklists are gone.
- A capability is audited (Epic Gate) before it is called done, closing the missing middle tier.
- `spec/` and release-planning changes are structurally maintainer-gated (CODEOWNERS **plus** the
  branch ruleset's required code-owner review — non-delegable).
- Branches and commit/PR titles are consistent and machine-checkable; releases are deliberate RC
  promotions rather than ad-hoc merges to `main`.
- Migration: only the **open** milestones are re-created as sagas (titles preserved); closed milestones
  are left as historical records. Saga branches are **not** pre-created.
