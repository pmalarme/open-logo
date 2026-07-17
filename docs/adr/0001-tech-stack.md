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

## Toolchain (landed in M0)

The workspace and toolchain are scaffolded (issue #5); the previously deferred package-manager and
lint/format sub-decisions are now made:

- **Package manager / workspaces:** **npm workspaces** over `packages/*`, installed with `npm ci`
  from the committed `package-lock.json`.
- **Compiler:** the stable **`typescript`** package driven by `tsc -b` over **project references** —
  one `tsconfig.json` per package extending a strict **`tsconfig.base.json`** (ESM `NodeNext`, target
  `ES2023`, `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `isolatedModules`), with the dependency direction encoded as `references`.
  No-emit type-checking uses a single-program **`tsconfig.typecheck.json`** (because `tsc -b --noEmit`
  is rejected when project references are present).
- **Lint / format:** **ESLint** (flat config `eslint.config.js` with `typescript-eslint`) and
  **Prettier** (`.prettierrc.json`; the maintainer-owned `spec/` and prose Markdown are in
  `.prettierignore`).

### TypeScript 7 note

TypeScript 7 (the native `tsgo`) is published as `typescript@7`, but the lint toolchain
(`typescript-eslint`) currently peer-supports TypeScript only `< 6.1`. To keep the **lint gate**
green we pin the compiler to the newest supported release on the 6→7 line and target
TypeScript-7-level *semantics* (identical strictness), then bump to `typescript@7` once
`typescript-eslint` ships stable TypeScript-7 support. This is precisely the "TypeScript 7 caveat"
fallback recorded under Consequences.

### Definition-of-Done commands

CI (`.github/workflows/ci.yml`) and contributors run the same npm scripts:

| Script | Runs |
|---|---|
| `npm run build` | `tsc -b` across project references (emits `dist/`) |
| `npm run typecheck` | `tsc -p tsconfig.typecheck.json` (strict, no emit) |
| `npm run lint` | ESLint (flat config) |
| `npm run format:check` | Prettier check (`npm run format` writes) |
| `npm run test` | unit tests (placeholder runner until the harness lands) |
| `npm run conformance` | stack-neutral fixtures under `tests/conformance/`, by profile |
| `npm run examples` | run every `spec/examples/*.logo` (pending parser + runtime) |

## Deferred sub-decisions (own follow-up ADRs)

These remain intentionally open; record each in its own ADR when decided:

- **Test runner** (e.g. Vitest/Jest/`node:test`) and the conformance-fixture harness format. M0 ships
  a discovery-based `test` placeholder (runs `node --test` over any JS test files, green when there
  are none); `@testing` replaces it and records the choice.
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
