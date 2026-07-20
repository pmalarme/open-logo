# 5. Toolchain: npm workspaces, tsc, Prettier, Biome, and node:test

- Status: Accepted
- Date: 2026-07-17
- Deciders: OpenLogo maintainer (@pmalarme) + orchestrator
- Related: [ADR-0001](0001-tech-stack.md) (resolves its deferred toolchain sub-decisions);
  [ADR-0004](0004-independent-review-gate.md) (the review that caught two traps below)

## Context

[ADR-0001](0001-tech-stack.md) fixed the language (TypeScript 7), the monorepo shape, and the six
`@openlogo/*` packages, but **deliberately deferred** the concrete toolchain — package manager,
test runner, and the exact build/lint/format commands — to "own follow-up ADRs when decided." The
M0 foundation (issue #5) is where those constraints become real: CI already encodes the Definition
of Done as eight scripts (`build`, `typecheck`, `lint`, `format:check`, `test`, `coverage`,
`conformance`, `examples`) and activates the code jobs the moment a root `package.json` lands. This
ADR records the tools chosen to satisfy those gates, and — per the independent review gate ([ADR-0004](
0004-independent-review-gate.md)) — the two toolchain traps a reviewer must know about, plus why the
coverage gate is pinned to Node 22.

## Decision

**Package manager / workspace tool:** **npm workspaces**. It ships with Node (no extra bootstrap),
supports the `packages/*` layout, and produces a single committed `package-lock.json` that CI
installs with `npm ci`. The workspace is ESM (`"type": "module"`), Node `>=22`.

**Build + type-check:** the TypeScript **`tsc -b`** project-reference graph. Each package is
`composite` with `outDir: dist`, `rootDir: src`, and emits **both** JavaScript (`dist/*.js`) and
declarations (`dist/*.d.ts`) plus source/declaration maps. `build` and `typecheck` both drive
`tsc -b`; they are kept as separate DoD scripts because CI treats them as distinct gates and they
will diverge once a faster no-emit check is warranted.

**Format:** **Prettier** (`format` / `format:check`). A `.prettierignore` scopes the gate to the
code the toolchain owns (TypeScript, scripts, JSON config) and excludes maintainer-owned `spec/`
and the hand-authored prose in `docs/`, `.github/`, and `*.md` that predates the formatter and
keeps its ~100-column house style. `.prettierrc.json` sets `endOfLine: "auto"` so a CRLF working
tree on Windows and an LF checkout in CI both pass.

**Lint:** **Biome** (`biome lint`), **not** ESLint + `typescript-eslint`. Biome has no TypeScript
peer dependency, is a single fast binary, and needs no plugin stack. The linter is scoped to
`packages/**/src/**/*.ts` and `scripts/**/*.mjs`; Biome's formatter is disabled (Prettier owns
formatting).

**Test:** the Node built-in **`node:test`** runner (`node --test`), **not** Vitest. There are no
tests at M0; the first smoke tests land with the contract stubs (issue #7).

**Conformance + examples:** small Node scripts under `scripts/`. `conformance` is a placeholder
until the stack-neutral harness lands in issue #6; `examples` parses and executes every
`spec/examples/*.logo` file against `@openlogo/parser` + `@openlogo/runtime`, using a
`scripts/examples-profiles.json` manifest to skip (with a visible notice) any example whose
required profile isn't implemented yet, so the gate only *attempts* examples whose declared
profiles are implemented — and genuinely fails when one of those examples hits a real
parser/runtime gap, rather than reporting success just because the file is present.

This ADR **resolves** ADR-0001's deferred "package manager" and "test runner" sub-decisions and
does not supersede it; ADR-0001 remains Accepted. Rendering libraries, the studio shell, and the
AI adapter stay deferred to their own future ADRs.

### Two toolchain traps this choice avoids (surfaced by the review gate)

1. **`typescript-eslint` peer-caps the compiler below 7.** `typescript-eslint@8` declares
   `typescript ">=4.8.4 <6.1.0"`, so an ESLint stack silently pins or rejects TypeScript 7 — the
   exact "CI green but wrong compiler" class the review gate exists to catch. Biome sidesteps it
   entirely.
2. **A private package feed blocks Vitest's transitive `vite`.** Installing Vitest pulls a `vite`
   version rejected by the org feed policy, breaking `npm ci` outright. `node:test` is in-tree,
   has zero dependencies, and cannot be blocked by a feed. We revisit Vitest only if we need richer
   matchers/coverage and the dependency is installable.

### The coverage gate is Node-version-sensitive — pin dev Node to 22 (`.nvmrc`)

`npm run coverage` runs `node --test --experimental-test-coverage --test-coverage-{lines,branches,functions}=100`.
That coverage denominator is **not** stable across Node majors: **Node 22 counts `*.test.mjs` files**
toward the 100% gate, while **Node 24+ excludes them**. Because `engines.node` is `>=22`, a
contributor on a newer Node could see a green `coverage` run whose test files self-cover invisibly,
then have CI (which pins Node 22) fail on an uninvoked helper inside a `*.test.mjs` — the same
"local green, CI red" class the review gate exists to catch (this bit issues #96/#111). We fix it the
KISS way: a committed [`.nvmrc`](../../.nvmrc) pins dev to **Node 22**, matching CI, so `nvm use`
gives every contributor the same coverage denominator. We deliberately **do not** tighten
`engines.node` to a hard upper bound or add `engine-strict` — that would break `npm install` on
newer Node for no benefit; the `.nvmrc` + docs are advisory-but-sufficient, and CI remains the
enforcing gate.

## Consequences

- `npm ci` from a clean tree installs the whole workspace; the eight DoD scripts all run and
  `tsc -b` emits real `dist/*.js` + `*.d.ts` (verified from a clean tree per the review gate, not a
  stale-`.tsbuildinfo` no-op).
- One committed `package-lock.json` makes CI installs deterministic.
- **Choosing Biome over ESLint** means OpenLogo lint rules are expressed in Biome's config, not
  `eslint-plugin` form; contributors expecting ESLint should read this ADR.
- **Choosing `node:test` over Vitest** keeps the dependency surface tiny and feed-safe; when the
  first `*.test.ts` files land (issue #7) the runner discovers the compiled output, so `test` runs
  after `build` in CI's isolated job.
- Prettier deliberately does **not** reformat `spec/`, `docs/`, `.github/`, or Markdown, so this
  toolchain never churns the maintainer-owned contract or the hand-authored team docs.
