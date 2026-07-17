# `packages/` — OpenLogo source

This is where OpenLogo's implementation source lives: a TypeScript 7 monorepo of six
`@openlogo/*` packages. Each package's **source root is `packages/<name>/src/`**, with
`src/index.ts` as its **only public entry point**. See
[`docs/architecture.md`](../docs/architecture.md) for the full monorepo definition and the
cross-cutting contracts, and [`docs/delivery.md`](../docs/delivery.md) for the release/milestone plan.

> The build tooling (package manager, test runner, bundler) is scaffolded by
> [`@interpreter`](../.github/agents/interpreter.agent.md) in **milestone M0** and recorded in
> [ADR-0001](../docs/adr/0001-tech-stack.md); this tree defines the layout and ownership up front.

## Packages (build order follows the spec profile DAG)

| Package | Source | Owns | Owner agent | Depends on |
|---|---|---|---|---|
| [`@openlogo/core`](core/README.md) | `core/src/` | values, `ol-*` diagnostics, trace/event registry, profile metadata | `@interpreter` | — |
| [`@openlogo/parser`](parser/README.md) | `parser/src/` | lexer, grammar, AST, reserved words, highlighter, checker | `@language-designer` + `@interpreter` | core |
| [`@openlogo/runtime`](runtime/README.md) | `runtime/src/` | evaluator, scoping, control forms, comprehensions, safety, events | `@interpreter` | core, parser |
| [`@openlogo/robot`](robot/README.md) | `robot/src/` | turtle/sprite state, Canvas/SVG/PNG rendering, export, a11y | `@turtle-engine` | core, runtime |
| [`@openlogo/studio`](studio/README.md) | `studio/src/` | **browser web app**: editor, Canvas view, run loop, diagnostics UI | `@learner-experience` | parser, runtime, robot, edu, core |
| [`@openlogo/edu`](edu/README.md) | `edu/src/` | levels, `explain`/`why`/`hint`/`debug`, geometry stdlib, AI tutor | `@geometry-teacher` + `@ai-tutor` + `@curriculum` | runtime, core |

Each package has a scoped working agreement in
[`.github/instructions/<name>.instructions.md`](../.github/instructions/) (`applyTo: packages/<name>/**`).
Stack-neutral conformance fixtures live at [`tests/conformance/`](../tests/conformance/).
