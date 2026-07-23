# 0. Record language design decisions

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

OpenLogo's language contract is fully specified in `spec/`, and its engineering/toolchain
decisions are recorded as Architecture Decision Records (ADRs) in `docs/adr/`. Neither surface
answers a question contributors and learners keep asking: **why is the language shaped this
way?** The spec states *what* `define … end` or `=` vs `==` mean; it does not explain why Core
chose `define … end` over `to … end`, why assignment and comparison use different operators, or
why calls are comma-free and prefix. Without a durable place for that rationale, the
team re-litigates settled language-design questions every time someone (human or agent) asks
"why not just do it like classic Logo / Python / Scheme?"

## Decision

We use **Language Design Records (LDRs)**, one Markdown file per language-design decision in
`docs/design-notes/`, numbered sequentially (`NNNN-kebab-title.md`, matching the ADR numbering
convention). Each LDR states the decision's **Context**, **Decision**, **Rationale**, **How other
languages do it**, and **Consequences**.

### When to write an LDR

Write an LDR whenever a decision fixes a **user-facing language shape** that a contributor could
reasonably ask "why is it like this and not like some other language?" about — keyword choice,
operator semantics, grammar shape, value/place semantics, profile boundaries, or anything else
that changes what a learner types or reads. Do not write an LDR for pure implementation or
toolchain choices (those are ADRs) or for the normative behavior itself (that lives in `spec/`
and is authored by the product-owner/maintainer, not documentation).

### Required sections

| Section | Answers |
|---|---|
| Context | What question or tension prompted this decision? What were the constraints (spec profile, learner level, prior art)? |
| Decision | What did OpenLogo decide, stated as a concrete, checkable rule? |
| Rationale | *Why* this decision over the alternatives — the pedagogical, ergonomic, or consistency argument. This is the layer neither `spec/` nor an ADR provides. |
| How other languages do it | A short, factual comparison against classic Logo and at least one or two other languages (e.g. Python, Scheme, JavaScript), to ground the decision and show what was consciously not chosen. |
| Consequences | What this decision enables or forecloses — for the grammar, the runtime, the curriculum, and future extensions. |

### Numbering and citation rules

- Files are numbered sequentially starting at `0000`, matching the pattern used by `docs/adr/`.
  `0000` is this format-defining note.
- Every LDR **must cite the normative `spec/` section(s) it explains** (e.g.
  `spec/grammar.md#expressions-and-calls`, `spec/commands.md`). An LDR without a spec citation is
  incomplete — the LDR explains the spec's *why*; it never states behavior the spec doesn't
  already state. The sole intentional exception is this record (LDR-0000) itself: it defines the
  LDR format rather than explaining a language-design decision, so it cites no `spec/` section —
  every LDR numbered `0001` and above **must** carry a real citation, with no further exceptions.
- LDRs are immutable once Accepted; to change a decision, add a new LDR that supersedes it (same
  `Status: Superseded by LDR-XXXX` convention as ADRs).
- `docs/design-notes/README.md` indexes every LDR, including ones still planned, so the numbering
  is reserved up front and later slices slot in without renumbering.

### LDR vs. ADR vs. spec/

- **`spec/`** is the normative contract: *what* the language does. Maintainer-owned.
- **ADRs** (`docs/adr/`) record engineering/toolchain decisions: *how* we build the
  implementation (monorepo layout, test runner, coverage gate, etc.).
- **LDRs** (`docs/design-notes/`) record language-design decisions: *why the language itself is
  shaped the way the spec says it is* — the rationale layer, aimed at contributors, agents, and
  curious learners, distinct from both the contract and the build.

## Rationale

Language design choices in OpenLogo are frequently non-obvious to anyone coming from another
language: `define … end` instead of `to … end`, `=`/`set … to` for assignment vs `==` for
comparison, a closed comma-free prefix-call grammar, no lambdas or first-class procedure values,
and a profile-based conformance DAG instead of one monolithic language. Each of these was a
deliberate trade-off balancing pedagogy, discoverability, and implementation simplicity against
prior art. Capturing that reasoning once, next to the spec section it explains, means the
argument is made a single time and can be pointed to instead of re-derived.

## How other languages do it

Most language projects either bury design rationale in mailing-list threads and design proposals
(Python PEPs), scatter it across RFCs and proposals (Rust RFCs, ECMAScript/TC39 proposals), or
never write it down in one discoverable place at all. OpenLogo instead
follows the same lightweight, numbered, immutable-record pattern popularized for architecture
decisions (Michael Nygard's ADR format) and applies it to language design, so the same
discoverability and "propose a superseding record" discipline is available for *why the language
looks the way it does*, not just *why the codebase is built the way it is*.

## Consequences

- New contributors, agents, and curious learners can read `docs/design-notes/` to understand why
  OpenLogo's syntax and semantics differ from classic Logo and other languages, without spec/
  ambiguity or re-litigating settled questions.
- Every LDR's mandatory spec citation keeps the design-notes tree anchored to the normative
  contract instead of drifting into its own shadow specification.
- Reversing a language-design decision leaves a visible trail (a superseding LDR), matching the
  ADR convention contributors already know.
- `docs/design-notes/README.md` reserves numbering for planned LDRs, so parallel slices (e.g.
  places-and-value-semantics, assignment-vs-comparison) can be dispatched independently without
  numbering collisions.
