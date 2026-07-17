# 0. Record architecture decisions

- Status: Accepted
- Date: 2024
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

OpenLogo is built by a team of specialized agents plus human maintainers. Decisions about
architecture, toolchain, and language-implementation trade-offs need to be discoverable and
durable so that any agent or contributor can understand *why* the code looks the way it does,
without re-litigating settled questions.

## Decision

We use **Architecture Decision Records (ADRs)**, one Markdown file per decision in `docs/adr/`,
numbered sequentially (`NNNN-title.md`). Each ADR states Context, Decision, Status, and
Consequences. The format follows Michael Nygard's ADR pattern.

- Status values: `Proposed`, `Accepted`, `Superseded by ADR-XXXX`, `Deprecated`.
- ADRs are immutable once Accepted; to change a decision, add a new ADR that supersedes it.
- Implementation-level decisions live here; the **language contract** itself lives in `spec/`
  and is not an ADR.

## Consequences

- New contributors and agents can read `docs/adr/` to learn the project's decision history.
- Reversing a decision leaves a visible trail (a superseding ADR) instead of silent drift.
- ADRs are cited from `AGENTS.md` and the team instructions so agents ground their work in them.
