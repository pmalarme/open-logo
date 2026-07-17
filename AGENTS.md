# AGENTS.md — OpenLogo

Guidance for AI agents (GitHub Copilot coding agent, Copilot CLI, and any other) and for humans
working in this repository. For the full working agreement see
[`.github/instructions/openlogo-team.instructions.md`](.github/instructions/openlogo-team.instructions.md).

## What this repo is

**OpenLogo** (short name **OL**, `*.logo` files) is a modern, open, educational reimagining of
Logo: programming + turtle graphics + geometry + AI coaching + discovery learning. The **normative
language contract lives in [`spec/`](spec/README.md)** and is owned by the maintainer — treat it as
the source of truth and never edit it without maintainer review.

The implementation is a **TypeScript 7 monorepo** (`openlogo/`) with six packages:

| Package | Responsibility |
|---|---|
| `@openlogo/core` | Value/type model, `ol-*` diagnostics, trace/event registry, feature detection |
| `@openlogo/parser` | Lexer, reader, EBNF grammar, AST, reserved words, parse/semantic lint |
| `@openlogo/runtime` | Evaluator, scoping, procedures, control forms, comprehensions, places, safety |
| `@openlogo/robot` | Turtle/sprite state, pen/heading/shape, rendering (Canvas/SVG/PNG), animation, a11y |
| `@openlogo/studio` | Learner IDE: editor/REPL, run/stop/step, diagnostics UI, tooling, lessons |
| `@openlogo/edu` | Learner levels, `explain`/`why`/`hint`/`debug`, geometry stdlib, AI tutor, curriculum |

Build order follows the spec's profile DAG: **Core Language → Turtle & Rendering** (minimal
conformance) → optional profiles (Data, Geometry, Heritage, Sprites, Interaction, Sound,
Modules→Localization, Educational→Tutor). See [`spec/conformance.md`](spec/conformance.md).

## Repository layout

```text
spec/            Normative language specification (maintainer-owned) — the contract
docs/adr/        Architecture Decision Records (why we built it this way)
.github/agents/  The OpenLogo agent team (*.agent.md)
.github/instructions/  Shared team working agreement (always in context)
packages/        @openlogo/* implementation packages (created as the build proceeds)
tests/conformance/     Stack-neutral source→events/diagnostics fixtures (created with the build)
```

## How to work here (for any agent)

1. **Read the spec area you are touching** plus the team agreement before coding.
2. **Work in vertical slices**: grammar → AST → runtime + trace → renderer/UI → conformance +
   integration tests → teaching hooks → docs, for one feature at a time.
3. **One task, one PR**, declaring the files/packages you will change; respect package boundaries.
4. **Prove behavior with conformance fixtures**, not prose. Extend `tests/conformance/`.
5. **Definition of Done**: builds, type-checks, lints, unit + conformance + example tests pass,
   docs/spec cross-links updated. Do not self-merge — humans + CI gate `main`.

## Spec fidelity cheatsheet (canonical OpenLogo, not classic Logo)

- Lowercase keywords; no commas, no `f(x,y)`, no arrays/lambda in v0.1.
- Procedures: `define … end` with `return` (Core). `to`/`output`/`op` are Heritage.
- Turtle: `forward`/`back`/`left`/`right`/`penup`/`pendown`… (Core); `fd`/`bk`/`lt`/`rt`… are Heritage.
- `=` and `set … to` **assign**; `==` **compares**; `make` is Heritage. Variables: `:name`.
- Values: `number`, `word` (`"red"`), `list` `[ ]`, `boolean` (Core); `dict` `{k: v}`, `struct` (Data).
- Diagnostics use stable `ol-*` codes ([`spec/error-model.md`](spec/error-model.md)); never ad-hoc strings.
- `polygon`/geometry are **discoverable OpenLogo source** (Geometry profile), not primitives.
- `explain`/`why`/`hint`/`debug` are deterministic; `hint` is progressive; the AI tutor degrades
  offline to that baseline and asks before answering.

## Build & test

The monorepo is being scaffolded. Once `packages/` and the workspace manifest exist, the standard
loop is workspace install → build → test → conformance (exact commands are recorded in
[`docs/adr/0001-tech-stack.md`](docs/adr/0001-tech-stack.md) as they are decided). Until then,
prefer small, reviewable PRs and keep this file and the ADRs updated as the toolchain lands.

## The agent team

The specialized agents in [`.github/agents/`](.github/agents/) map to the packages above. In
Copilot CLI, invoke one with `@<name>` (e.g. `@interpreter`). The `orchestrator` agent decomposes
the spec into tasks and coordinates the others. See each agent file for its exact mandate.
