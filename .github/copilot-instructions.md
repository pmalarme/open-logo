# OpenLogo — Copilot instructions

OpenLogo (short name **OL**, `*.logo`) is a modern, open, educational reimagining of Logo:
programming + turtle graphics + geometry + AI coaching + discovery learning.

**Read these first:**

- [`AGENTS.md`](../AGENTS.md) — project overview, packages, how to work here.
- [`.github/instructions/openlogo-team.instructions.md`](instructions/openlogo-team.instructions.md)
  — the full team working agreement (ownership, Definition of Done, spec-fidelity rules).
- [`spec/`](../spec/README.md) — the **normative** language contract and single source of truth.
  It is maintainer-owned; do not modify it without explicit maintainer review.

**Essentials:**

- Implementation is a **TypeScript 7 monorepo** with packages `@openlogo/{core, parser, runtime,
  turtle, studio, edu}`. Build order follows the spec's profile DAG: **Core Language → Turtle &
  Rendering** first (minimal conformance), then optional profiles with their dependencies.
- Work in **vertical slices**, one feature end to end; one task per PR; prove behavior with
  conformance fixtures under `tests/conformance/`; keep docs and spec cross-links in sync.
- **Match the spec exactly:** lowercase keywords, `define … end` for procedures (`to` is Heritage),
  `forward`/`right`/… Core names (`fd`/`rt`/… are Heritage), `=`/`set … to` assign while `==`
  compares, `:name` variables, values `number`/`word`/`list`/`boolean`, stable `ol-*` diagnostics,
  and geometry as discoverable OpenLogo source rather than primitives.
- Educational commands `explain`/`why`/`hint`/`debug` are deterministic; `hint` is progressive; the
  AI tutor is Socratic and degrades offline to the deterministic baseline.

Do not self-merge; humans and required CI checks gate `main`.
