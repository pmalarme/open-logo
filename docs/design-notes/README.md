# Language Design Records (LDRs)

This index lists every **Language Design Record** — a Markdown record of *why the OpenLogo
language is shaped the way it is*, distinct from the normative contract in [`spec/`](../../spec/README.md)
and from the engineering/toolchain [Architecture Decision Records](../adr/) in `docs/adr/`.

Read [`0000-record-language-design-decisions.md`](0000-record-language-design-decisions.md)
first — it defines the LDR format, numbering convention, and citation requirement.

| # | Title | Status | Spec section(s) |
|---|---|---|---|
| [0000](0000-record-language-design-decisions.md) | Record language design decisions | Accepted | N/A (meta) |
| 0001 | Places and value semantics | Planned (#447) | `spec/execution-model.md` |
| 0002 | Assignment vs. comparison (`=`/`set … to` vs `==`) | Planned (#451) | `spec/grammar.md`, `spec/commands.md` |
| 0003 | Closed, comma-free, prefix call grammar | Planned (#446) | `spec/grammar.md` |
| 0004 | No lambda / no first-class procedure values | Planned (#450) | `spec/execution-model.md`, `spec/commands.md` |
| 0005 | Profiles and the conformance DAG | Planned (#448) | `spec/conformance.md` |

Numbers `0001`–`0005` are reserved for the seed LDRs above so parallel slices can land without
renumbering; each will replace its "Planned" row with the record's title link and final status
once merged.
