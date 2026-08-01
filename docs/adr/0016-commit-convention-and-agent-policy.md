# 16. Commit convention severity and the agent-policy layer

- Status: Accepted
- Date: 2026-08-01
- Deciders: OpenLogo maintainer (@pmalarme)
- Related: refines [ADR-0015](0015-sagas-branching-governance.md) (which introduced the branching
  model and Conventional Commits rule); mechanics in
  [`../../.github/skills/devops/branching-and-commits/SKILL.md`](../../.github/skills/devops/branching-and-commits/SKILL.md)
  and [`../../.github/skills/devops/agent-policy/SKILL.md`](../../.github/skills/devops/agent-policy/SKILL.md)

## Context

ADR-0015 made every commit subject **and** the PR title a CI-blocking Conventional Commit with a
**required** scope. In practice that rule blocked work it was never meant to block.

- **A cloud coding agent cannot fix its own commit subjects.** The Copilot platform authors a
  bootstrap commit (`Initial plan`, `chore: initial plan for …`) **before the agent's first turn**,
  and the agent has no force-push — it commits through the GitHub API. The subject is therefore
  unfixable by its author, and *every* agent-authored PR carries at least one. PR #628 sat red for
  days on exactly this, with all substantive checks green.
- **The rule guarded something that never reaches history.** We merge with `--squash`, so only the
  **PR title** becomes the commit on `main`/`saga/*`. Individual subjects are discarded at merge; we
  were blocking PRs over strings that are thrown away.
- **A required scope contradicts our own working agreement.** A vertical slice is *defined* as
  grammar → AST → runtime + trace → renderer/UI → tests → teaching hooks → docs. Forcing one scope
  makes the author pick an arbitrary winner among co-equal domains — less informative than no scope.
  Conventional Commits v1.0.0 makes scope optional; we were stricter than the spec we cite, with no
  stated benefit.
- **Guidance had no home.** Rules for agents were spread across `AGENTS.md`, `copilot-instructions`,
  folder instructions, and per-agent files, with no statement of which surfaces can actually enforce
  and which are advice — so "the rule exists" and "the rule is checked" were indistinguishable.

## Decision

**1. Scope becomes optional; up to three scopes are allowed.**
`feat: …` is valid. When a scope is present every element must come from the allowlist, and at most
three comma-separated scopes are accepted (`feat(grammar,runtime): …`). A missing scope produces a
non-blocking "consider adding a scope" notice. A fourth scope is blocking — it means the change
should be split or use an umbrella scope (`repo`, `meta`). Guidance order: name the **primary
domain**; use multiple scopes only for genuinely co-equal domains; use an umbrella scope; omit the
scope rather than inventing one.

**2. The PR title is blocking; commit subjects are advisory.**
One grammar for both surfaces, two severities. The PR title is authored, is the squash-merge
subject, and is what lands in history — it stays a hard gate. Commit subjects are reported as
GitHub warning annotations and never fail the build. To keep the title authoritative, the repository
allows **squash merging only**, with the default squash message set to *"Pull request title and
description."*

**3. Rules reach agents through five layers, and only CI is a gate.**

| Layer | Enforcing? |
|---|---|
| Org/enterprise **Copilot agent policies** (admin UI) | capabilities only |
| Repository **`.github/agent-policy.md`** briefing | no |
| **Instructions** (`AGENTS.md`, `copilot-instructions.md`, folder + per-agent files) | no |
| **Git hooks** (`.githooks/`, wired by the root `prepare` script) | no — bypassable, and never runs for API commits |
| **CI + branch rulesets** | **yes** |

A local `commit-msg` hook gives humans instant feedback using the same checker; it is explicitly
bypassable with `--no-verify` and is never a required check.

## Consequences

- Agent-authored PRs stop going red on unfixable commit subjects; the substantive DoD checks are
  unchanged and remain the real gate.
- Multi-package slices can describe themselves honestly instead of picking an arbitrary scope.
- The guarantee we actually care about is preserved: every commit that lands on `main`/`saga/*` is a
  valid Conventional Commit, because it is the linted PR title — provided the squash-merge repo
  settings stay as decided. If someone re-enables merge commits, this ADR's guarantee lapses.
- Advisory findings can be ignored. Accepted: they cost nothing and the annotation keeps the habit
  visible.
- One more documentation surface (`.github/agent-policy.md`) exists and can drift. Mitigated by the
  cross-link-never-duplicate rule and the one-page cap in `devops/agent-policy`.
- Org/enterprise policy settings live in a UI, not in git. Mitigated by recording each change, dated,
  in the `devops/agent-policy` SKILL.

## Alternatives considered

- **Exempt bot authors from the commit-subject check.** Keeps subjects blocking for humans, but adds
  an author-identity special case for a value that squash-merge discards anyway, and does nothing for
  the required-scope problem.
- **Ask agents to squash their own history.** They cannot: no force-push, and the bootstrap commit
  precedes their first turn.
- **Keep the rule and admin-merge each PR.** Normalizes bypassing the gate — the worst outcome for a
  repo whose governance depends on gates meaning something.
