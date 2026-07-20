---
applyTo: "packages/edu/**"
---

# `@openlogo/edu` — working rules

Scoped rules for files under `packages/edu/`. Read the always-on
[team agreement](openlogo-team.instructions.md) and the
[architecture](../../docs/architecture.md) first.

**Owners:** [`@geometry-teacher`](../agents/geometry-teacher.agent.md) +
[`@ai-tutor`](../agents/ai-tutor.agent.md) +
[`@curriculum`](../agents/curriculum.agent.md) ·
**Skills:** [geometry-reasoning](../skills/geometry-teacher/geometry-reasoning/SKILL.md),
[progressive-hints](../skills/ai-tutor/progressive-hints/SKILL.md),
[author-a-lesson](../skills/curriculum/author-a-lesson/SKILL.md)

## Responsibility
The education layer. Owns the **learner levels/curriculum**, the deterministic meta-commands
**`explain`/`why`/`hint`/`debug`**, the **geometry standard library** (discoverable `.logo` source) and
its **geometric reasoning**, and the **AI tutor** (Socratic, offline-degrading) behind a
provider-neutral adapter.

## Spec (normative)
- [`spec/educational-model.md`](../../spec/educational-model.md) — the 8 learner levels + meta-commands.
- [`spec/geometry-module.md`](../../spec/geometry-module.md) — geometry stdlib + reasoning (Geometry profile).
- [`spec/ai-tutor.md`](../../spec/ai-tutor.md) — tutor behavior, guardrails, provider neutrality.

## Source layout
- `packages/edu/src/index.ts` — the only public entry (levels, meta-commands, reasoning, tutor adapter).
- Geometry stdlib lives as `.logo` source, validated against the runtime — not hardcoded drawing.

## Boundaries
- Depends on **`@openlogo/runtime`** (to execute lessons) and **`@openlogo/core`** (events/diagnostics).
- Reasoning is **deterministic and offline**; AI is optional and pluggable — the baseline works with no
  provider. Never emit full solutions in learner mode.

## Conventions
- Meta-commands are deterministic, offline, arity 0, template-based; `hint` is progressive.
- Every lesson example + reference solution is validated against the runtime in CI.
- Follow the team agreement's clean-code naming rule (no abbreviations, self-explaining identifiers) — see
  [`openlogo-team.instructions.md` §10](openlogo-team.instructions.md#10-conventions).
