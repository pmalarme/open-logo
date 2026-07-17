---
applyTo: "packages/core/**"
---

# `@openlogo/core` — working rules

Scoped rules for files under `packages/core/`. Read the always-on
[team agreement](openlogo-team.instructions.md) and the
[architecture](../../docs/architecture.md) first.

**Owner:** [`@interpreter`](../agents/interpreter.agent.md) ·
**Skills:** [ts7-package](../skills/shared/ts7-package/SKILL.md),
[diagnostics](../skills/shared/diagnostics/SKILL.md)

## Responsibility
The foundation package. Owns the **value/type model** (`number`, `word`, `list`, `boolean`; `dict`/
`struct` for Data), the **`ol-*` diagnostic registry** (the single source of every code), the
**trace/event registry**, and **feature-detection/profile metadata** (`openlogo.version`, profiles).

## Spec (normative)
- [`spec/execution-model.md`](../../spec/execution-model.md) — values, equality, trace events.
- [`spec/error-model.md`](../../spec/error-model.md) — the C10 diagnostic shape + `ol-*` codes.
- [`spec/conformance.md`](../../spec/conformance.md) — profiles + feature-detection metadata.

## Source layout
- `packages/core/src/index.ts` — **the only public entry**; export values, diagnostics, event types,
  and profile metadata from here.
- Keep the diagnostic registry and event registry as data/enums, not scattered string literals.

## Boundaries
- **Depends on nothing** in `@openlogo/*` — this package sits at the bottom of the DAG.
- Everyone else imports these contracts from `core`; never re-declare a diagnostic code or event type
  in another package.

## Conventions
- A new `ol-*` code or trace event is a **serialized, owner-reviewed** change (it is a shared contract).
- No rendering, parsing, or evaluation logic here — only the shared model + registries.
