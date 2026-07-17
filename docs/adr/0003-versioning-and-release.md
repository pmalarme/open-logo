# 3. Versioning and release strategy

- Status: Accepted
- Date: 2026-07-17
- Deciders: OpenLogo maintainer (@pmalarme)
- Related: [ADR-0001](0001-tech-stack.md); details in [`../delivery.md`](../delivery.md) and
  [`../architecture.md`](../architecture.md)

## Context

OpenLogo has several domains that evolve at different speeds — the language contract, the parser and
**syntax highlighter**, the runtime, the turtle/rendering engine, the studio UI, and the education
layer — but they must stay mutually coherent and provably conformant. We need a versioning, release,
and milestone strategy that lets these domains be built **in parallel** without drifting apart.

## Decision

**Versioning.** The `spec/` version (currently `0.1.0`) is the pace-setter. Each `@openlogo/*`
package advertises feature-detection metadata (`openlogo.version` + supported **profiles**) per
`spec/conformance.md`; that metadata — not npm version numbers — is the compatibility contract. All
packages release **in lockstep** on one monorepo version initially (KISS); a package moves to its own
version line only when justified, via a follow-up ADR.

**Release = a conformant tuple.** An OpenLogo release is a set of package versions that all target
one spec version and a declared profile set, with the conformance suite green. A package MAY claim a
profile only when the conformance fixtures for that profile and its DAG dependencies pass in CI —
**release is gated by conformance.**

**Domain interlock.** The **highlighter and tooling are pinned to the grammar/spec version**: any
grammar or reserved-word change ships its matching highlighter + LSP update in the same milestone.
The four shared contracts (AST, trace/events, `ol-*` diagnostics, token classes) are agreed
**contract-first** each milestone, then domains build against them in parallel.

**Milestones** are **profile-based synchronization points** on the spec DAG (M0 Foundation → M1 Core
→ **M2 Turtle & Rendering = minimal conformance / first release** → M3 Educational → M4 Data &
Geometry → M5 Heritage·Sprites·Interaction·Sound → M6 Modules·Localization·Tutor). A milestone
completes when its profile conformance is green across **all** domains, not when one package finishes.
Each milestone maps to a GitHub milestone; issues are one vertical slice each, labeled by owning agent
and profile so parallel tracks pull independently.

## Consequences

- Domains parallelize safely because compatibility is expressed via spec-version + profiles and
  guarded by conformance, not by fragile version coupling.
- The language and its highlighter/tooling can never silently drift apart.
- "Done" and "releasable" have objective, CI-checkable meaning (conformance green).
- Full mechanics live in [`../delivery.md`](../delivery.md); revisit lockstep versioning if a domain
  genuinely needs an independent cadence.
