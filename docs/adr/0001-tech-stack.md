# 1. Technology stack and monorepo layout

- Status: Accepted
- Date: 2024
- Deciders: OpenLogo maintainer (@pmalarme)
- Supersedes: the earlier "decide the stack later via a gated ADR" plan

## Context

The `spec/` directory defines the OpenLogo language but is deliberately implementation-agnostic:
it "does not define an interpreter, runtime, editor binary, or package format." We need a concrete
implementation stack and repository shape so the agent team can build the language, turtle engine,
studio, and educational layer.

## Decision

**Runtime / language:** TypeScript 7. Public API namespace: **OL**. Source files authored by
learners use the `.logo` extension (per the spec).

**Repository:** a single monorepo rooted at `openlogo/` containing the packages below under
`packages/`. Packages are versioned together and depend only on each other's **public** APIs.

| Package | Responsibility | Owning agent(s) | Primary spec sources |
|---|---|---|---|
| `@openlogo/core` | Value/type model, `ol-*` diagnostics, trace/event registry, feature-detection metadata | interpreter | `execution-model.md`, `error-model.md`, `conformance.md` |
| `@openlogo/parser` | Lexis, reader, EBNF grammar, AST, reserved words, parse + semantic lint | language-designer, interpreter | `grammar.md`, `tooling.md`, `commands.md` |
| `@openlogo/runtime` | Evaluator, scoping, procedures, control forms, comprehensions, places/mutation, equality, safety | interpreter | `execution-model.md`, `commands.md`, `data-structures.md` |
| `@openlogo/turtle` | Turtle/sprite state, pen/heading/shape, rendering (Canvas/SVG/PNG), animation, export, accessibility | turtle-engine | `commands.md` (turtle), `rendering.md`, `turtles-and-sprites.md` |
| `@openlogo/studio` | Learner IDE: editor/REPL, run/stop/step, diagnostics UI, tooling/LSP, lesson pane, persistence | learner-experience | `tooling.md`, `rendering.md`, `error-model.md` |
| `@openlogo/edu` | Learner levels, `explain`/`why`/`hint`/`debug`, geometry stdlib, AI tutor, curriculum, examples | geometry-teacher, ai-tutor, curriculum | `educational-model.md`, `geometry-module.md`, `ai-tutor.md`, `examples/` |

**Dependency direction (high level):** `parser` and `runtime` depend on `core`; `turtle` consumes
the trace/event registry from `core`; `studio` composes `parser` + `runtime` + `turtle`; `edu`
builds on `runtime` (for `.logo` stdlib) and `core` (for diagnostics/traces).

**Build sequencing** follows the spec's profile DAG: **Core Language → Turtle & Rendering**
(minimal conformance) first, then optional profiles with their transitive dependencies.

## Deferred sub-decisions (own follow-up ADRs)

These are intentionally not fixed yet; record each in its own ADR when decided:

- **Package manager / workspace tool** (npm workspaces vs pnpm vs bun) and the exact
  build/test/lint commands (to be reflected in `AGENTS.md` once chosen).
- **Test runner** (e.g. Vitest/Jest/node:test) and the conformance-fixture harness format.
- **Rendering libraries** for `@openlogo/turtle` beyond the required Canvas target (SVG/PNG export).
- **Studio shell** technology (framework/bundler) for `@openlogo/studio`.
- **AI provider adapter** for the Tutor (AI) profile — kept provider-neutral (Foundry or others
  slot in behind one interface).

## Consequences

- Clear package boundaries let agents own areas in parallel with minimal conflict.
- A monorepo keeps the spec, packages, tests, and docs versioned together and cross-checkable.
- **TypeScript 7 caveat:** the new Go-based native compiler (`tsgo`) is cutting-edge and may not
  be production-stable for every workflow. Where `tsgo` blocks progress, teams MAY fall back to
  the current `tsc`/`typescript` toolchain for that package and note it here, without changing the
  language-level target (TypeScript 7 semantics). Revisit as the toolchain matures.
- Leaving toolchain sub-decisions open avoids premature lock-in while the first vertical slice
  (Core + Turtle) establishes real constraints.
