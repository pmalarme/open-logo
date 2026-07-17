# 6. Cross-cutting contract stubs (AST, events, diagnostics, token classes)

- Status: Accepted
- Date: 2026-07-17
- Deciders: OpenLogo maintainer (@pmalarme) + interpreter + language-designer + orchestrator
- Related: [`docs/architecture.md`](../architecture.md) §4 (the four seams); ADR-0001
  (TypeScript 7 monorepo); the `interpreter/ast-design`, `shared/diagnostics`,
  `turtle-engine/turtle-event-contract`, and `language-designer/syntax-highlighting` skills;
  issue #7

## Context

Six `@openlogo/*` packages are meant to be built **in parallel**. `docs/architecture.md` §4
names four cross-cutting contracts that make that possible — the **AST**, the **trace/event
stream**, the **`ol-*` diagnostics**, and the **token classes** — and the contract-first
rule says they are agreed in one serialized change before domain work fans out. Until now
they existed only as prose in the spec and architecture doc; every downstream slice
(parser, runtime, turtle, studio, edu, tests) needs them as real TypeScript so it can
compile against stable interfaces rather than re-inventing shapes.

The spec fixes the field vocabulary but is stack-neutral, so it spells names with the
separators natural to serialized fixtures (`source-span`, `turtle-id`, `draw-segment`) while
`spec/error-model.md` spells the diagnostic field `source_span`. TypeScript identifiers
cannot contain hyphens, so the contract has to choose one faithful in-language spelling.

## Decision

Land the four contracts as **types + registries only — no behavior** — placing each where
`architecture.md` says it lives and respecting the dependency direction (`parser` → `core`,
no cycles):

- **`@openlogo/core`**
  - `spans.ts` — `SourceSpan` (`{ document, start, end }` with 1-based `[line, column]`
    positions and a half-open `[start, end)` range) and `Position`. The shared location
    primitive lives in core because core is at the bottom of the DAG; the AST, diagnostics,
    and events all reuse it.
  - `diagnostics.ts` — the full normative `ol-*` registry (`OL_DIAGNOSTIC_CODES`), the
    `ol-style-*` codes, and the `Diagnostic` shape (`code`, `source_span`, `params`,
    `message`, `stage`, `severity`, optional `debug`).
  - `events.ts` — the `TraceEvent` envelope (`seq`, `kind`, `source_span`, optional
    `turtle_id`, `payload`) and the `OL_EVENT_KINDS` registry, with typed payloads for the
    rendering-relevant kinds the spec calls out.
- **`@openlogo/parser`**
  - `ast.ts` — the `OL_NODE_KINDS` vocabulary, a `NodeBase` carrying `source_span`,
    immutable (`readonly`) node interfaces for a representative Core subset, a factory
    (`ast.*`), and a `walk` visitor.
  - `highlight.ts` — the 15 normative `OL_TOKEN_CLASSES` and the `Token` shape.

Naming and modelling conventions the contracts follow:

1. **Registries are data.** Codes, event kinds, node kinds, and token classes are
   `as const` arrays with their union type derived from the array. This gives one
   enumerable source of truth (per the `@openlogo/core` working rules) and the static union
   for free — no hand-maintained `enum` that can drift from the registry.
2. **Separator-bearing envelope fields become the identifier form `source_span` /
   `turtle_id`.** This matches the spec's own diagnostic field exactly and keeps one
   `SourceSpan` type shared across all three contracts. Event **kind values** stay the
   spec's kebab-case strings verbatim (`"draw-segment"`, `"pen-change"`) because they are
   data, not identifiers.
3. **The AST grows one node per grammar production, never ahead of it.** `OL_NODE_KINDS`
   lists the full Core vocabulary; concrete node interfaces exist for the M0 subset that
   exercises the factory and walker, and the rest gain typed shapes with their grammar
   slice. Heritage spellings are surface metadata (`CallNode.canonical`), not new kinds.

Each package exports its contract from `src/index.ts` only, consumed as the `OL` namespace
(`import * as OL from "@openlogo/core"`). A `.mjs` smoke test per package constructs a node,
an event, and a diagnostic and reads them back against the registries.

## Consequences

- Downstream slices import stable contracts from `core`/`parser` and can be built
  concurrently; a change to any contract is a serialized, owner-reviewed PR (architecture
  §4), and — per ADR-0004 — reviewed by a non-author before merge.
- These are **stubs**: the registries are complete, but node payloads and per-kind event
  payloads are intentionally minimal and fill in with each feature's vertical slice. Adding
  a node/kind/code later is a normal contract change, not a redesign.
- The runtime unit-test placeholder (`scripts/test.mjs`) discovers `*.test.mjs`, so the
  smoke tests are authored in `.mjs` against each package's built public API. When
  `@testing` chooses the real test runner it can run TypeScript tests directly; this ADR
  does not settle that deferred sub-decision.
