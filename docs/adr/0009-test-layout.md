# 9. Test layout convention (co-located `.test.mjs`)

- Status: Accepted
- Date: 2026-07-18
- Deciders: OpenLogo maintainer (@pmalarme) + testing + orchestrator
- Amends: [ADR-0005](0005-toolchain.md) (note 73-75 anticipated `.test.ts`; this supersedes that)
- Related: [ADR-0000](0000-record-architecture-decisions.md) (immutability rule);
  [ADR-0005](0005-toolchain.md) (`node:test` choice);
  [ADR-0006](0006-cross-cutting-contracts.md) (public API);
  [ADR-0007](0007-conformance-harness.md) (`tests/conformance/` for language fixtures);
  [`testing/ci-and-conformance`](../../.github/skills/testing/ci-and-conformance/SKILL.md) (loaded-module coverage policy);
  PR #41 (100% coverage gate + `npm run coverage`);
  PR #35 (first `.test.mjs` smoke tests)

## Context

The toolchain ADR ([ADR-0005](0005-toolchain.md)) fixed `node:test` as the runner and anticipated
that "when the first `*.test.ts` files land (issue #7) the runner discovers the compiled output, so
`test` runs after `build` in CI's isolated job" (lines 73-75). In practice, **two constraints
interact** that make `.test.ts` the wrong choice:

1. **Black-box import discipline:** every test must import **only** the package's public API entry
   (`@openlogo/core`, `@openlogo/parser`, etc.) — never `../somewhere/internal.js`. This keeps the
   test a true consumer of the package contract and catches exports we forgot to wire through
   `src/index.ts`.

2. **100% coverage requirement:** the Definition of Done demands 100% line/branch/function coverage
   (enforced by `npm run coverage`; team agreement §5.4). The
   [`testing/ci-and-conformance`](../../.github/skills/testing/ci-and-conformance/SKILL.md) skill
   documents the **loaded-module policy** — "only files loaded by tests are counted, so stub packages
   with no runtime yet don't drag the number down — but any shipped code must be fully covered."

When unit tests live as **compiled `.test.js` in `dist/`**, `tsc` compiles them from source and
places them alongside the package's runtime `.js` files — making them **internally loadable but
public-API-inaccessible**. A test compiled into `dist/` can `import "../internal.js"` but **cannot**
import `@openlogo/<pkg>` (the public entry is `dist/index.js`, which does not re-export the test).
The black-box discipline breaks. Worse: if a module exists but isn't re-exported from `src/index.ts`,
a test in `dist/` can still load it internally and give it coverage — hiding the fact that **the
public API omits the module**, so a real consumer would find it dead code. The 100%-coverage gate
becomes a false positive.

We need unit tests that:
- Are **co-located beside the source** (easy to find, grow with the code).
- Import **only the public API** (black-box; true consumer contract).
- **Discover unexported shipped code** as dead/uncovered (so the loaded-module 100% gate is honest).

## Decision

Unit tests are co-located **beside their source** as black-box **`.test.mjs`** files under
`packages/<pkg>/src/`, importing **only** the package public API (`@openlogo/<pkg>`). They are
discovered by `node --test` (which glob-matches `**/*.test.mjs`). Stack-neutral **language-level
conformance fixtures** stay in the top-level `tests/conformance/` directory (unchanged, per
[ADR-0007](0007-conformance-harness.md)).

### Why `.test.mjs` and NOT `.test.ts`

1. **TypeScript ignores `.mjs`.** `tsc` **does not compile** `.mjs` files into `dist/`, so tests
   never pollute the shipped artifact. They live only in `src/` as source.

2. **`node --test` runs them directly.** `node --test` (the runner from ADR-0005) discovers and runs
   `.test.mjs` files from the source tree (after `npm run build` emits the package's `dist/` via the
   `pretest` script). Each test imports the shipped public entry (`@openlogo/<pkg>`, which resolves
   to `dist/index.js`) — **black-box through the real API**.

3. **True loaded-module coverage.** When `npm run coverage` runs, every test loads the public entry
   point (`dist/index.js`), which must re-export the package's internals to make them reachable. If a
   module is shipped but **not** re-exported from `src/index.ts`, the test cannot load it, it reads
   as **0% covered**, and the 100% gate fails — catching the omission. This makes the loaded-module
   policy self-enforcing: you cannot ship code without exporting it, and you cannot export code
   without covering it.

4. **No compiled-test drift.** Because the test is **not** compiled, it cannot fall out of sync with
   the built output; it always imports the artifact CI and users see.

This choice **amends** ADR-0005 at lines 73-75 (which anticipated `.test.ts`). Per
[ADR-0000](0000-record-architecture-decisions.md), ADRs are immutable once Accepted, so this ADR
**records the divergence** rather than editing ADR-0005. The fundamental `node:test` choice in
ADR-0005 remains unchanged; only the test-file extension and lifecycle (source-tree `.mjs` run
directly, not compiled `.test.js` in `dist/`) supersedes that note.

### Directory structure (example)

```text
packages/
└─ core/
   ├─ src/
   │  ├─ index.ts              (public entry; re-exports everything shipped)
   │  ├─ diagnostics.ts        (runtime module)
   │  ├─ events.ts             (runtime module)
   │  ├─ contracts.smoke.test.mjs  (co-located test, imports @openlogo/core)
   │  └─ ...
   ├─ dist/                    (emitted by tsc -b; shipped)
   │  ├─ index.js
   │  ├─ index.d.ts
   │  ├─ diagnostics.js
   │  ├─ diagnostics.d.ts
   │  ├─ events.js
   │  ├─ events.d.ts
   │  └─ ...                    (NO .test.* files here; they never compile)
   ├─ package.json
   └─ tsconfig.json
```

### Test discovery and lifecycle

- `"test": "node --test"` (root `package.json`) glob-matches `**/*.test.mjs` across the workspace.
- `"pretest": "npm run -s build"` ensures the `dist/` artifact exists before tests import it.
- Each test file looks like:
  ```js
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import * as OL from "@openlogo/core";  // ← public API only

  test("core exposes the ol-* diagnostic registry", () => {
    assert.ok(OL.OL_DIAGNOSTIC_CODES.includes("ol-not-enough-inputs"));
    // ...
  });
  ```
  No internal imports (`import { foo } from "../somewhere.js"`), only the package name.

### Coverage and the loaded-module policy

- `npm run coverage` (from PR #41) runs `node --test --experimental-test-coverage` with
  `--test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100`.
- **Loaded-module policy** (from `testing/ci-and-conformance`): only files actually imported through
  the test's execution (via the public API) contribute to coverage. Stub packages with no runtime yet
  emit an empty `dist/index.js` and read as 100% covered (because no code is loaded). Shipped code
  **must** be both exported from `src/index.ts` **and** covered by a test that imports the public API
  — otherwise the coverage gate fails, making the 100% requirement honest.

This layout was validated by PR #35 (issue #9 parser smoke tests): `packages/core/src/contracts.smoke.test.mjs`
and `packages/parser/src/contracts.smoke.test.mjs` both import their package public API, run via
`node --test`, and produce 100% coverage of the emitted `dist/` code — proving the co-located `.test.mjs`
discipline works end-to-end.

## Consequences

- **Unit tests live in `packages/<pkg>/src/*.test.mjs`**, co-located beside the source they verify.
  They are **not** compiled; `tsc` ignores `.mjs`.
- **Language-level conformance fixtures** stay in `tests/conformance/` (stack-neutral source →
  events/diagnostics pairs, as defined in ADR-0007). The two test layers remain distinct: co-located
  unit tests verify package internals through the public API; conformance fixtures verify language
  behaviour against the spec.
- **Black-box discipline is enforced by layout:** tests import only `@openlogo/<pkg>` (the public
  entry), so they cannot cheat by reaching into internals.
- **100% coverage is now honest:** the loaded-module policy + the `.test.mjs` layout + the coverage
  gate together mean shipped code **must** be both exported **and** tested, or the gate fails. No
  false positives.
- **ADR-0005 note at lines 73-75 is superseded** by this decision. The `node:test` choice in ADR-0005
  remains Accepted; this ADR amends only the anticipated `.test.ts` extension.
- Contributors writing new packages or features should follow the pattern in
  `packages/core/src/contracts.smoke.test.mjs`: co-located `.test.mjs`, import the public API, run
  via `npm test` (which invokes `node --test`), and confirm `npm run coverage` shows 100%.
- **No additional tooling or config changes** are needed; `node --test` already discovers `**/*.test.mjs`
  out of the box, and the `pretest`/`precoverage` hooks already build before testing.
