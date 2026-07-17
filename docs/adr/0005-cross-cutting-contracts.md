# 5. Cross-cutting contract stubs (AST, events, diagnostics, token classes)

- Status: Accepted
- Date: 2026-07-18
- Deciders: @interpreter + @language-designer (co-owners), OpenLogo maintainer (@pmalarme)

## Context

OpenLogo builds as a TypeScript monorepo whose domains (language, runtime, turtle, studio,
education, tests, docs) run in parallel against **four shared contracts** that cross package
boundaries (`docs/architecture.md` §"Cross-cutting contracts"; team instructions §12):

1. the **AST** (`@openlogo/parser`),
2. the **trace/event stream** (`@openlogo/core`),
3. the **`ol-*` diagnostics** (`@openlogo/core`), and
4. the **token classes / syntax highlighting** (`@openlogo/parser`).

The `spec/` is normative but implementation-agnostic — it fixes the language, not the TypeScript
shapes. So the shared code contract has to be agreed **contract-first**, in one place, before a
milestone's domain work fans out; changing any of them later is a serialized, owner-reviewed PR.
This ADR records the M0 stubs (issue #7): **types and public exports only — no behavior**, the
minimal stable surface that every other package can import against, extended per slice thereafter.

Two questions had to be settled up front because they shape the whole surface:

- **Where does `SourceSpan` live?** It is used by all four contracts. Placing it anywhere but the
  root package would create a dependency cycle.
- **How do the stubs get a smoke test without a build step or a new dependency?** CI's `test` job
  runs `npm ci` then `npm run test` with **no prior build** (`.github/workflows/ci.yml`), so a test
  cannot import compiled `dist/` output.

## Decision

**Placement + dependency direction.** `SourceSpan` (and its `Position`) live in `@openlogo/core`,
the root package that depends on nothing. Diagnostics and the event registry live in `@openlogo/core`;
the AST and token classes live in `@openlogo/parser`, which imports `SourceSpan` **type-only** from
`@openlogo/core`. `@openlogo/parser` may depend on `@openlogo/core`, never the reverse — no cycles.
Every contract is re-exported from its package's `src/index.ts` (the only public entry point).

**The four shapes (KISS — the minimal stable surface).**

- **Spans** — `Position { line, column }` (1-based) and `SourceSpan { document, start, end }`
  (half-open: `start` inclusive, `end` exclusive). The one span type shared by AST, events, and
  diagnostics.
- **Diagnostics** — the normative `ol-*` code set (`spec/error-model.md`) as `const` arrays
  (`OL_ERROR_CODES`, `OL_STYLE_CODES`, combined `DIAGNOSTIC_CODES`) with string-literal-union types
  derived from them, plus the `Diagnostic` shape `{ code, sourceSpan, params, message, stage,
  severity, debug? }` where `stage ∈ parse | semantic | runtime` and `severity ∈ error | warning`.
- **Events** — the `EVENT_KINDS` registry (`spec/execution-model.md`) as a `const` array with a
  derived `EventKind` union, and the `TraceEvent` envelope `{ seq, kind, sourceSpan, turtleId?,
  payload }`.
- **AST** — a discriminated union over a PascalCase `kind` tag, one interface per grammar
  production (`spec/grammar.md`), a `readonly sourceSpan` (and readonly fields) on **every** node,
  and an explicit `Visitor<R>` interface. Nodes are **data only** — no methods.
- **Token classes** — the normative token-class set from `spec/tooling.md` as a `const` array
  (`TOKEN_CLASSES`) with a derived `TokenClass` union, for the highlighter / semantic tokens.

**Conventions.**

- **`const` arrays + derived unions, not TS `enum`s.** Each closed set is a `const [...] as const`
  array with its type derived as `(typeof ARR)[number]`. This gives a runtime registry to validate
  against **and** a compile-time union — and, unlike `enum`, it is fully erasable under Node's
  native type stripping (see below).
- **Field names are camelCase (`sourceSpan`, `turtleId`)** — the TypeScript idiom and the shapes
  named in the issue — while the spec's prose uses `source_span`/`turtle-id` for the conceptual
  model. The mapping is 1:1; serialization naming is a later, separate decision.
- **Type-only cross-module/cross-package imports.** `SourceSpan` is always imported with
  `import type`, so it is erased at runtime and never triggers a cross-file/cross-package module
  load in a natively-run test.

**Smoke test without a build or a new dependency.** Tests are `*.test.ts` beside the source and use
Node's built-in `node:test` + `node:assert` (no new dependency). `scripts/test.mjs` runs
`node --experimental-strip-types --test` directly over the TypeScript sources, so they exercise the
real source with no build step. Each test imports its package's runtime registries from the
individual `.ts` modules and imports the contract **types** via `import type` (erased). The test
files are **run-only**: because they use explicit `.ts` import specifiers (illegal under an emitting
build) and import Node's built-in modules (which would otherwise pull in an `@types/node` dev
dependency), each package's `tsconfig.json` **and** the no-emit `tsconfig.typecheck.json` both
**exclude** `src/**/*.test.ts`. Native type-stripping needs no type information, so the smoke tests
run without adding a single dependency, while the contract types they construct are themselves fully
type-checked through their own source modules and the emitted `.d.ts`.

## Consequences

- The four contracts are now a stable, importable surface: parallel domain work (runtime, turtle,
  studio, edu, tooling, tests) can code against them immediately, and each later slice **extends**
  them (adds a node kind, an event, a code) rather than inventing its own shapes.
- `SourceSpan` in `@openlogo/core` keeps the dependency graph acyclic (`parser → core` only).
- The `const`-array registries double as the runtime source of truth a validator/`did-you-mean`
  can check against, with zero enum runtime cost.
- The camelCase-vs-`source_span` divergence is intentional and documented here so it is not "fixed"
  into drift; a future serialization contract will map the two explicitly.
- A dual import-extension convention is now in play **by design**: emit-source files use `.js`
  specifiers (NodeNext emit), the excluded test files use `.ts` specifiers (native run +
  type-check only). This is the price of testing TS source with no build step and no dependency.
- Running tests over source sets a **Node floor**: native type stripping (`>=22.6` with the flag;
  default on `>=22.18`), consistent with the repo's `engines` and CI's Node 22. If a richer runner
  is later chosen (an `@testing` ADR-0001 sub-decision), it supersedes only `scripts/test.mjs`, not
  these contracts.
- Any later change to one of the four shapes is a serialized, owner-reviewed PR (team
  instructions §12), and ships its dependents in lockstep (e.g. a grammar/AST change updates the
  highlighter + tooling fixtures in the same milestone).
