# 12. Standard library location: real `.logo` source in a top-level `stdlib/`

- Status: Accepted
- Date: 2026-07-22
- Deciders: OpenLogo maintainer (@pmalarme) + geometry-teacher
- Related: [ADR-0001](0001-tech-stack.md) (the monorepo's `packages/*` are pure TypeScript);
  [ADR-0007](0007-conformance-harness.md) (the fixture contract this decision's tests build on);
  [spec/geometry-module.md](../../spec/geometry-module.md) (the Geometry profile's packaged
  commands, the first library shipped under this decision); [spec/conformance.md](../../spec/conformance.md)
  (Modules profile, where `import`/auto-loading eventually lands)

## Context

Issue #338 asked for the Geometry profile's packaged commands (`polygon`, `star`, `circle`, `arc`,
`area`, `perimeter`) to ship as **discoverable OpenLogo source** — real `.logo` text a learner could
have written, not a hidden primitive (Charter §6). The first implementation attempt (PR #393,
superseded) shipped each command as a TypeScript string constant under `packages/edu/src/geometry/
*.ts`, exported through `@openlogo/edu`'s barrel. On review, the maintainer re-scoped this: string
constants embedded in `.ts` files are still source-in-a-string, one step removed from "real" source,
and they entangled the change with `@openlogo/edu`'s package (which was mid-flight on unrelated M3
curriculum/tutor work), creating exactly the kind of shared-file collision the write-set rules exist
to avoid.

The `@openlogo/*` packages are intentionally pure TypeScript (ADR-0001): no package should hold
`.logo`-in-`.ts` string literals, and no package should grow a codegen step to turn `.logo` files
into TypeScript at build time — that would blur the packages/spec boundary and add a build step for
no runtime benefit before the Modules profile (M6) actually needs to load a library at runtime.

At the same time, `import`/module loading is explicitly **out of scope** until the Modules profile
(`spec/conformance.md`'s DAG: `modules` depends only on `core-language`, and `localization` depends on
`modules`). Until then, `@openlogo/runtime`'s `execute()` takes one self-contained program and the
conformance harness (`scripts/harness/index.mjs`) and examples gate (`scripts/examples-gate.mjs`)
both run a single `.logo` file with no prelude/auto-load hook. Any stdlib shape chosen now has to
prove itself against that constraint without smuggling in a de facto module loader.

## Decision

**The standard library lives as real `.logo` files in a new top-level `stdlib/` folder**, sitting
beside `spec/`, `packages/`, and `tests/` rather than inside any one package:

```text
stdlib/
  geometry/
    polygon.logo
    star.logo
    circle.logo
    arc.logo
    area.logo
    perimeter.logo
```

- **Each file holds exactly one packaged command**, copied verbatim (character-for-character —
  guard clauses, exact `ol-user-error` message strings, formulas, optional-parameter defaults) from
  its `spec/*-module.md` packaged-command listing. A file is the single source of truth for that
  command; nothing else in the repo re-types it.
- **`packages/*` stays pure TypeScript.** No package imports, re-exports, or embeds `stdlib/`
  content as a string literal, and there is no codegen step turning `.logo` files into `.ts`. This
  keeps `@openlogo/edu` (and every other package) free of this concern entirely — the M3/M4
  collision that forced this re-scope cannot recur, because no package touches `stdlib/` at all.
- **Loading stays deferred to the Modules profile.** `stdlib/` is not wired into `execute()`, the
  conformance harness, the examples gate, or any browser/studio preload path. There is no
  `import "geometry/polygon"` yet and no implicit prelude. A future Modules-profile loader can read
  these same files unchanged — this location and one-command-per-file shape was chosen specifically
  so that loader has nothing to migrate.
- **Every fixture/example proves the library actually runs, with zero drift.** Because there is no
  loading hook, any conformance fixture or `spec/examples/*.logo` file that calls a stdlib command
  must inline that command's full source. To keep the inlined copy from silently drifting away from
  the real `stdlib/` file, a dedicated test
  (`tests/conformance/geometry/stdlib/source-drift.test.mjs`) reads each real `stdlib/geometry/
  *.logo` file and asserts every fixture that calls it contains that exact source (newline-normalized
  to stay portable across CRLF/LF checkouts) as a substring. This is a pure test-side bridge — no
  `scripts/` file was changed to build it — keeping the change second-gate (rubber-duck + `@testing`)
  rather than escalating to a third reviewer for harness/gate wiring.

### Alternatives considered

- **TypeScript string constants in `packages/edu/src/`** (the superseded PR #393 shape). Rejected:
  couples the stdlib's location to one package's build/test lifecycle, collides with in-flight work
  in that package, and is not "real" `.logo` source a learner could open and run directly.
  Reproducing this in a future `packages/parser`-based book/reader is only asymmetrically true — the
  spec calls it discoverable *source*, not an embedded string.
- **A prelude/auto-load hook added to `execute()` or the harness now.** Rejected: that is the
  Modules-profile deliverable, is a shared runtime-contract change, and would have escalated this
  slice to a tier-3 review (`@interpreter`) for work explicitly out of scope for #338.
- **Codegen turning `.logo` files into `.ts` modules at build time.** Rejected: adds a build step
  and a packages/spec boundary blur for no present benefit — nothing needs to `import` the stdlib at
  runtime yet, and by the time something does (Modules/M6), a loader can read the files directly.

## Consequences

- `stdlib/<profile>/<command>.logo` is now the canonical location for every future packaged-command
  library the spec calls "discoverable source" (Geometry today; Heritage/Data/etc. libraries, if
  any, follow the same shape).
- `packages/*` gain no new dependency on, or knowledge of, `stdlib/` — the package boundary rules in
  the team working agreement continue to hold without exception.
- Conformance fixtures and `spec/examples/*.logo` files that exercise a stdlib command must inline
  it verbatim; the `source-drift.test.mjs` pattern established here is the template for future
  libraries to reuse (one drift-guard test file per library, not per fixture).
- When the Modules profile (M6) lands an `import`/loader, it can point directly at `stdlib/` with no
  file moves or reformatting — this was a deliberate design goal of the flat, one-file-per-command
  layout.
