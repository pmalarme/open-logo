# 5. Restore TypeScript 7 by moving lint to Biome

- Status: Accepted
- Date: 2026-07-17
- Deciders: OpenLogo maintainer (@pmalarme) + orchestrator
- Related: [ADR-0001](0001-tech-stack.md) (mandates TypeScript 7; this ADR resolves its deferred
  lint sub-decision and supersedes the interim compiler pin recorded in its "Toolchain (landed in
  M0)" section); [ADR-0004](0004-independent-review-gate.md) (the independent review that caught
  this); issue #5

## Context

The M0 workspace (issue #5, PR #14) stood up the monorepo but shipped
**`typescript@^6.0.3`** — TypeScript **6**, not 7 — with **ESLint + `typescript-eslint`** for the
`lint` gate. `typescript-eslint@8` (including the `8.63.1-alpha.8` pre-release) declares a hard peer
range of `typescript ">=4.8.4 <6.1.0"`, so keeping the ESLint gate green **forces the compiler below
7**. PR #14 documented this as invoking ADR-0001's "TypeScript 7 caveat."

That reading is incorrect. ADR-0001's caveat permits falling back **from the native `tsgo` compiler
to the classic `tsc`/`typescript` toolchain "without changing the language-level target (TypeScript
7 semantics)"** — both `tsgo` and classic `tsc` ship inside `typescript@7`. The caveat is about the
*compiler implementation*, not the *language version*; it does not sanction dropping to
`typescript@6`. What actually happened is the lint tool dictated the compiler version — the exact
"CI green but the wrong compiler" trap the independent review gate ([ADR-0004](
0004-independent-review-gate.md)) exists to catch, and it is called out verbatim in that ADR and in
the `shared/review-gate` skill.

`typescript@7.0.2` is published and drives `tsc -b` correctly (verified: it emits `dist/*.js` +
`*.d.ts`). The only thing standing between M0 and its mandated TypeScript 7 was the lint engine.

## Decision

**Restore `typescript@^7.0.2`** as the compiler for build and type-check.

**Move the `lint` gate to [Biome](https://biomejs.dev)** (`biome lint .`, `@biomejs/biome@^2.5`).
Biome has **no TypeScript peer dependency**, is a single fast binary, understands TypeScript
natively, and therefore cannot pin the compiler. ESLint's `eslint.config.js` and the
`@eslint/js` / `eslint` / `globals` / `typescript-eslint` dev-dependencies are removed. Biome's
formatter stays **disabled** — Prettier remains the single formatter — and the linter is scoped to
`packages/**/src/**/*.ts` and `scripts/**/*.mjs`.

Everything else from PR #14 is kept: **npm workspaces**, the strict `tsconfig.base.json`, the
single-program **`tsconfig.typecheck.json`** for `tsc -p --noEmit` (project references reject
`tsc -b --noEmit`), **Prettier** with its `.prettierignore`, `.gitattributes` (`eol=lf`), and the
`scripts/*.mjs` DoD placeholders.

This ADR **resolves** ADR-0001's deferred "lint" sub-decision and **supersedes** the interim
compiler pin and ESLint choice recorded in ADR-0001's "Toolchain (landed in M0)" section; ADR-0001
otherwise stays Accepted.

## Consequences

- The workspace targets **TypeScript 7**, as the spec, issue #5, and ADR-0001 require. `npm ci` from
  a clean tree installs cleanly; `build` / `typecheck` / `lint` / `format:check` / `test` /
  `conformance` / `examples` are green and `tsc -b` emits real `dist/*.js` + `*.d.ts` (verified
  after a full clean, not a stale-`.tsbuildinfo` no-op).
- OpenLogo lint rules are expressed in **Biome** config, not `eslint-plugin` form; contributors
  expecting ESLint should read this ADR. Re-evaluate ESLint only if/when `typescript-eslint` ships a
  stable peer range that admits TypeScript 7.
- This is the first worked example of the independent review gate catching a **merged** change that
  was CI-green yet wrong — the motivating scenario for [ADR-0004](0004-independent-review-gate.md).
