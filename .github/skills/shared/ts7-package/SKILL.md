---
name: ts7-package
description: >-
  Conventions for the OpenLogo TypeScript 7 monorepo — ESM, strict typing, package boundaries,
  public API surface, dependency direction, and how to add or extend an @openlogo/* package. Use for
  any code change in packages/.
created: 2025-06-01T00:00
updated: 2025-06-01T00:00
---

## Purpose

Keep the six `@openlogo/*` packages clean, decoupled, and buildable so agents can work in parallel
with minimal conflict. Grounded in `docs/adr/0001-tech-stack.md`.

## The packages and dependency direction

```text
core  ← parser
core  ← runtime           (parser + runtime depend on core's public API)
core  ← robot             (robot consumes the trace/event registry)
parser + runtime + robot  ← studio     (studio composes them)
core + runtime            ← edu         (edu adds .logo stdlib + teaching over runtime)
```

Depend only on a sibling's **public API** (its package entry point), never its internal files.
Cross-package changes need the owning agent's review and a serialized PR.

## Conventions

- **ESM** modules, `"type": "module"`. **`strict: true`** TypeScript everywhere.
- Public API namespace is **OL**; export it from each package's `src/index.ts`. Nothing outside a
  package imports its internals.
- One responsibility per package (see the ownership table in
  `.github/instructions/openlogo-team.instructions.md`). If code doesn't fit its package, it's in the
  wrong package.
- Deterministic core: no wall-clock/random in `core`/`parser`/`runtime` outputs; animation/timing
  live only in `robot`/`studio`.
- No secrets in code or fixtures; the AI adapter (`edu`) reads config at runtime.

## Adding or extending a package

1. Create `packages/<name>/` with `package.json` (name `@openlogo/<name>`, ESM), `tsconfig.json`
   extending the root config, and `src/index.ts` as the only public surface.
2. Declare intra-repo deps against public entry points; wire it into the workspace manifest
   (serialized change — manifests are shared files).
3. Add build + test scripts consistent with the chosen runner (recorded in ADR-0001) and a package
   `README.md` (`@documentation`).
4. Add at least one test and, for language/turtle behavior, conformance fixtures.

## TypeScript 7 caveat

TS7's native compiler (`tsgo`) is new and may not cover every workflow. If it blocks a package,
fall back to the current `tsc`/`typescript` toolchain **for that package**, keep the TypeScript 7
language target, and note it in `docs/adr/0001-tech-stack.md`. Don't let tooling churn stall a slice.

## Checklist
- [ ] Correct package for the change; public API via `src/index.ts` only.
- [ ] ESM + `strict`; no cross-package internal imports.
- [ ] Determinism preserved in core/parser/runtime.
- [ ] Manifest/tsconfig edits serialized; README updated.
