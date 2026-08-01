---
name: agent-policy
description: >-
  How OpenLogo governs GitHub Copilot cloud agents — the org/enterprise agent policies, the
  repository-level .github/agent-policy.md briefing, and how those layer with AGENTS.md,
  copilot-instructions, folder instructions, per-agent files, git hooks, and CI. Use when changing
  what agents are allowed to do, when an agent breaks a repo convention, or when adding a new rule.
created: 2026-08-01T00:00
updated: 2026-08-01T00:00
---

## Purpose

A rule only works if it reaches the party that has to follow it **and** is checked by something that
can say no. This skill maps every surface that shapes a Copilot cloud agent's behavior in OpenLogo,
says which of them can actually **enforce**, and pins the one rule that resolves conflicts:

> **Policies, instructions, and hooks are guidance. CI is the gate.**
> Never make a hook or a policy a required check, and never rely on guidance alone for anything a
> reviewer would block a PR over.

## The five layers

| # | Layer | Where | Applies to | Enforcing? |
|---|---|---|---|---|
| 1 | **Copilot agent policies** (admin) | GitHub UI — enterprise/org **Settings → Copilot / AI controls** | which agents exist, which repos they may touch, model + tool/MCP access, network access | **yes**, but only over *capabilities* — never over the content of a commit |
| 2 | **Repository agent policy** | [`.github/agent-policy.md`](../../../agent-policy.md) | every agent session in this repo | no — a briefing |
| 3 | **Instructions** | [`AGENTS.md`](../../../../AGENTS.md), [`.github/copilot-instructions.md`](../../../copilot-instructions.md), [`.github/instructions/`](../../../instructions), [`.github/agents/`](../../../agents) | repo-wide → path-scoped → per-agent | no |
| 4 | **Git hooks** | [`.githooks/`](../../../../.githooks), wired by the root `prepare` script | local `git commit` only | no — `--no-verify` bypasses it, and it never runs for commits made through the GitHub API |
| 5 | **CI + branch rulesets** | [`.github/workflows/`](../../../workflows), CODEOWNERS, required checks | every PR | **yes — the only real gate** |

### Precedence

When two surfaces disagree, the **more specific and more enforcing** one wins:

```text
CI + branch rulesets                              (blocks — final word)
  ▲ org/enterprise agent policy                   (blocks capabilities)
  ▲ .github/agents/<name>.agent.md                (per-agent)
  ▲ .github/instructions/<area>.instructions.md   (path-scoped)
  ▲ .github/agent-policy.md + AGENTS.md + copilot-instructions.md   (repo-wide)
```

**Cross-link, never duplicate.** The policy and instruction files should *point at* the SKILL that
owns each rule. Restating a rule in a second place guarantees the two copies drift.

## Layer 1 — org/enterprise agent policies (admin-applied, not in git)

Copilot agent policies are **administrator settings** configured in the GitHub UI at the enterprise
or organization level (GitHub's Copilot documentation, *agents → configuration → agent policies*).
They are not a file you commit, so **record every change here, dated**. They control *capability*:

- which agents are available (Copilot cloud agent, custom agents, third-party agents);
- which repositories an agent may act on (none / all / selected);
- model availability, tool and MCP-server access, and outbound network access.

What they **cannot** do is control the *content* of what an agent writes. In particular they cannot
make an agent produce a Conventional Commit subject: the platform authors the session's bootstrap
commit **before the agent's first turn**, and the agent has no force-push, so that commit is
**unfixable by its author**. That is precisely why commit subjects are advisory while the PR title
is the blocking check — see [`devops/branching-and-commits`](../branching-and-commits/SKILL.md) and
[ADR-0016](../../../../docs/adr/0016-commit-convention-and-agent-policy.md).

**Recorded settings for OpenLogo** — update when the maintainer changes one:

| Setting | Value | Recorded | Why |
|---|---|---|---|
| Copilot cloud agent | enabled for this repository | 2026-08-01 | the agent fleet is how OpenLogo is built |
| Agent repository access | selected repositories (`pmalarme/open-logo`) | 2026-08-01 | least privilege |
| Merge authority | none — agents never self-merge | 2026-08-01 | team agreement §5; branch rulesets enforce it |

## Layer 2 — the repository agent policy

[`.github/agent-policy.md`](../../../agent-policy.md) is a short, high-signal briefing an agent
session should read before its first commit. It carries only the rules agents have historically got
wrong — branch targeting, write-set boundaries, the commit convention, the DoD commands, and known
traps — each linking to the SKILL that owns it. Keep it **under one page**; when it grows, that is a
sign the rule belongs in a SKILL instead.

## Changing a rule

1. **Pick the owning layer.** Capability → layer 1 (maintainer, in the UI). Behavior an agent must
   know → layers 2–3. Local ergonomics → layer 4. Anything a reviewer would block over → layer 5,
   **plus** a mention in 2–3 so agents are not ambushed by it.
2. **Add the gate first.** A rule with no CI check is a suggestion; if it cannot be checked
   mechanically, say so plainly instead of implying it is enforced.
3. **Update the owning SKILL**, then cross-link from the policy/instructions — do not restate.
4. **Record admin-applied settings** in the table above, with the date and the reason.
5. **Never** add a hook or a policy to the required-checks list.

## Checklist

- [ ] The rule lives in exactly one owning place; every other mention links to it.
- [ ] If it is blocking there is a CI check for it; if it is not checkable, that is stated.
- [ ] Admin-applied agent-policy changes recorded in the table above, dated.
- [ ] `.github/agent-policy.md` still fits on a page and still links out rather than restating.
- [ ] No hook or policy was added to the required-status-check list.
