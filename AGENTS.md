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
| `@openlogo/parser` | Lexer, reader, EBNF grammar, AST, reserved words, syntax highlighting + syntax/semantic checker |
| `@openlogo/runtime` | Evaluator, scoping, procedures, control forms, comprehensions, places, safety |
| `@openlogo/turtle` | Turtle/sprite state, pen/heading/shape, rendering (Canvas/SVG/PNG), animation, a11y |
| `@openlogo/studio` | Browser web app (learner IDE): editor/REPL, Canvas turtle view, run/stop/step, diagnostics UI, tooling, lessons |
| `@openlogo/edu` | Learner levels, `explain`/`why`/`hint`/`debug`, geometry stdlib, AI tutor, curriculum |

Build order follows the spec's profile DAG: **Core Language → Turtle & Rendering** (minimal
conformance) → optional profiles (Data, Geometry, Heritage, Sprites, Interaction, Sound,
Modules→Localization, Educational→Tutor). See [`spec/conformance.md`](spec/conformance.md).

## Repository layout

```text
spec/            Normative language specification (maintainer-owned) — the contract
docs/adr/        Architecture Decision Records (why we built it this way)
docs/architecture.md   Monorepo definition + cross-cutting contracts (AST, highlighting, events, UI)
docs/delivery.md       Release + milestone strategy
.github/agents/  The OpenLogo agent team (*.agent.md)
.github/skills/  Agent skill playbooks (shared + per-agent)
.github/instructions/  Team working agreement (always on) + per-package rules (applyTo packages/<name>/**)
.github/ISSUE_TEMPLATE/  Issue forms — feature-request, epic, feature-slice (user story), conformance-task, foundation, bug, docs
.github/labels.yml     Label taxonomy manifest (agent:*/type:*/profile:*/area:*/level:*)
.github/labeler.yml    Path→label rules for PR auto-labeling
.github/scripts/        Metadata validation + label sync (run by CI)
.github/workflows/     CI (Definition of Done), labeler, label sync — owned by @devops
packages/        @openlogo/* packages — src/ skeleton in place; see packages/README.md for the map
tests/conformance/     Stack-neutral source→events/diagnostics fixtures (grow with the build)
```

## How to work here (for any agent)

Domains build **in parallel** against four shared contracts (AST, events, `ol-*` diagnostics, token
classes). See [`docs/architecture.md`](docs/architecture.md) for the packages, contracts, and
parallelization map, and [`docs/delivery.md`](docs/delivery.md) for the release + milestone strategy.

1. **Read the spec area you are touching** plus the team agreement before coding.
2. **Work in vertical slices**: grammar → AST → runtime + trace → renderer/UI → conformance +
   integration tests → teaching hooks → docs, for one feature at a time.
3. **One task, one PR**, declaring the files/packages you will change; respect package boundaries.
4. **Prove behavior with conformance fixtures**, not prose. Extend `tests/conformance/`.
5. **Definition of Done**: builds, type-checks, lints, unit + conformance + example tests pass,
   docs/spec cross-links updated. Do not self-merge — humans + CI gate `main`.
6. **KISS + Boy Scout**: keep the design as simple as the spec allows, and leave each file a little
   better than you found it — but only within your task's declared write-set, never unrelated
   refactors. (Full rules in the team working agreement.)

When editing under `packages/<name>/`, read that package's
`.github/instructions/<name>.instructions.md` first. To open work, **file an issue from a template**
in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE) (labels come from
[`.github/labels.yml`](.github/labels.yml)); the `product-owner` schedules it onto a milestone.

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
the spec into tasks and coordinates the others. **Cross-cutting agents own no single package:**
`orchestrator`, `product-owner`, `testing`, `documentation`, and `devops` (CI/CD under
`.github/workflows/`, security, labeler, releases). See each agent file for its exact mandate.
