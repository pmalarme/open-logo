# 8. Implementer-run self-review (rubber-duck + domain QA)

- Status: Accepted
- Date: 2026-07-18
- Deciders: OpenLogo maintainer (@pmalarme) + team
- Amends: [ADR-0004](0004-independent-review-gate.md)

## Context

[ADR-0004](0004-independent-review-gate.md) established an **independent, non-author pre-merge
review** (the review gate) as item 8 of the Definition of Done. In practice the orchestrator ran that
gate _after_ a slice opened its PR, routing each `block` back to the implementing session and
re-reviewing the revision — a slow, round-by-round hand-off that split one review across many
cross-session messages. Two things became clear while landing the first M1 slices:

- The **implementing session is the right place** to run the review: it already holds the full
  context, can fix findings immediately, and can re-review in a tight loop without the orchestrator
  relaying verdicts one at a time.
- Custom agents **can** dispatch sub-agents (the `task` tool) once they are not restricted by a
  `tools:` allowlist — so an implementer can spawn its own reviewers.

ADR-0004's principle stands (**an implementer is never the sole attester**); what changes is _who_
runs the gate and _when_.

## Decision

The review gate is **run by the implementing agent, in-session, before the PR is opened** — not by
the orchestrator afterward. Before opening a PR the implementer dispatches **two independent,
non-author review sub-agents** and iterates until both return `pass`:

1. **`rubber-duck`** — logic, design, spec-fidelity, and the diff itself.
2. **QA — a domain-adaptive expert** — re-runs the clean-tree Definition of Done and checks the
   change's domain, recruiting whichever OpenLogo agent the change needs: `@testing` by default
   (conformance + coverage), plus/instead the owner of the changed area (`@language-designer`,
   `@turtle-engine`, `@geometry-teacher`, `@learner-experience`, `@ai-tutor`, `@curriculum`,
   `@documentation`). The QA expert is always **≠ the author**; more than one may be recruited for a
   cross-cutting change.

The implementer opens an already-green PR with **both verdicts attached**. The `@orchestrator` then
does a **final verification** — both non-author verdicts present, CI green, a light sanity check —
and merges under maintainer-delegated authority (or a human merges).

This **amends** ADR-0004 in two ways:

- It replaces the fixed three-reviewer list (`rubber-duck` / `code-review` / `@testing`) with
  `rubber-duck` + a **domain-adaptive QA** expert.
- It relocates the gate from "orchestrator-run after the PR" to "implementer-run before the PR."

To make this possible, the delivery agents **drop their `tools:` allowlist** (`read/search/edit/
execute`) so they receive the default toolset, which includes sub-agent dispatch (`task`). An
explicit allowlist silently excluded it.

## Consequences

- One review happens in one session, in a tight fix-and-recheck loop — no round-by-round
  cross-session relay of `block` verdicts.
- The "implementer is never the sole attester" guarantee is preserved: the two reviewers are **not**
  the author, and the orchestrator still verifies before merge.
- QA is now **domain-aware** — the right expert reviews the right change, instead of a fixed list.
- Delivery agents are no longer tool-restricted; they rely on the team charter + skills for scope
  rather than a frontmatter allowlist. `@documentation` also regains `execute`, which its old
  allowlist omitted, so it can run its own Definition of Done.
- ADR-0004 is **amended, not reversed**: the independent-non-author-review principle and the
  clean-tree / emit-verified checklist it introduced still hold.
