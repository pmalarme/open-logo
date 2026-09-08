# Language Design Records (LDRs)

This index lists every **Language Design Record** — a Markdown record of *why the OpenLogo
language is shaped the way it is*, distinct from the normative contract in [`spec/`](../../spec/README.md)
and from the engineering/toolchain [Architecture Decision Records](../adr/) in `docs/adr/`.

Read [`0000-record-language-design-decisions.md`](0000-record-language-design-decisions.md)
first — it defines the LDR format, numbering convention, and citation requirement.

| # | Title | Status | Spec section(s) |
|---|---|---|---|
| [0000](0000-record-language-design-decisions.md) | Record language design decisions | Accepted | N/A (meta) |
| [0001](0001-places-and-value-semantics.md) | Places and value semantics — why `(point 0 0).z = 1` is `ol-not-a-place` | Accepted | `spec/grammar.md`, `spec/execution-model.md` |
| [0002](0002-assignment-vs-comparison.md) | Assignment vs. comparison (`=`/`set … to` vs `==`) | Accepted | `spec/grammar.md`, `spec/commands.md` |
| [0003](0003-closed-comma-free-prefix-call-grammar.md) | A closed, comma-free, prefix-call grammar | Accepted | `spec/grammar.md`, `spec/commands.md`, `spec/data-structures.md` |
| [0004](0004-no-lambda-first-class-procedures.md) | No lambda or first-class procedure values in v0.1 | Accepted | `spec/grammar.md`, `spec/conformance.md` |
| [0005](0005-profiles-and-the-conformance-dag.md) | Profiles and the conformance DAG | Accepted | `spec/conformance.md` |
| [0006](0006-effect-event-snapshot-timing.md) | Effect-event snapshot timing is emission-time, not evaluation-time | Accepted | `spec/execution-model.md` |
| [0007](0007-binding-vs-registration.md) | Binding versus registration — you cannot register a built-in name, you can bind data to any name | Accepted | `spec/grammar.md`, `spec/tooling.md`, `spec/error-model.md`, `spec/execution-model.md`, `spec/localization.md`, `spec/educational-model.md` |
| [0008](0008-sealed-procedure-boundary-and-block-lifetime.md) | The sealed procedure boundary, the block as a lifetime boundary, and `global` as declared sharing | Accepted | `spec/execution-model.md`, `spec/commands.md`, `spec/grammar.md`, `spec/tooling.md` |
