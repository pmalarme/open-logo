# 11. Studio app bundler: Vite for the browser host

- Status: Accepted
- Date: 2026-07-20
- Deciders: OpenLogo maintainer (@pmalarme) + learner-experience
- Related: [ADR-0001](0001-tech-stack.md) (defers the "studio shell technology
  (framework/bundler)" sub-decision this ADR resolves); [ADR-0005](0005-toolchain.md) (the
  library's `tsc -b` build, unaffected by this decision)

## Context

`@openlogo/studio` (issues #123-#229) was built **headless-first**: a single state model, an app
shell (region registry), and controllers for the editor, Canvas view, run/stop/reset/step,
diagnostics, and accessibility — all plain TypeScript, all `node:test`-able, with **zero DOM**
anywhere in `src/`. That was deliberate (ADR-0001 left "studio shell technology" open), but it
means there has never been an actual page: no `index.html`, no dev server, no way for a learner (or
a reviewer) to type a program and watch the turtle draw.

Epic #276 / issue #277 closes that gap: a real browser page, started with `npm run dev`, wiring the
already-published controllers onto a real `<textarea>`, `<canvas>`, and Run button. This requires
picking a bundler/dev-server — the sub-decision ADR-0001 deferred.

## Decision

**Vite**, as a `devDependency` of `@openlogo/studio` only, hosts the browser app:

- `packages/studio/index.html` is the Vite entry HTML; `packages/studio/web/main.ts` is a thin
  browser entry that composes the published `@openlogo/studio` seams (`createStudioState`,
  `createAppShell`, `createEditorController`/`mountEditorPane`, `createCanvasRenderTarget`/
  `createCanvasViewController`/`mountCanvasView`, `createRunController`/`mountRunController`) onto
  real DOM elements. It reimplements none of them.
- `npm run dev` (`vite`) starts the dev server; `npm run build:web` (`vite build`) produces a
  static, deployable bundle in `web-dist/`; `npm run preview` (`vite preview`) serves that bundle
  locally. Both `dev` and `build:web` have a `pre*` counterpart (`predev`/`prebuild:web`) that runs
  `npm run build` (`tsc -b`) first — `tsc -b`'s project-reference graph transitively builds every
  `@openlogo/*` dependency `dev`/`build:web` needs (`core`, `parser`, `runtime`, `turtle`, `edu`,
  then `studio` itself), so a fresh clone's `npm install` → `npm run dev` (issue #277's literal
  acceptance test) resolves every workspace import without a separate manual build step. A root
  `npm run dev` passthrough (`npm run dev --workspace @openlogo/studio`) lets a learner run the dev
  server from the repo root without `cd`-ing into the package.
- The **library build stays `tsc -b`** (ADR-0005), untouched. `packages/studio/tsconfig.json`'s
  `include` was already `["src"]`, so `web/**` was already outside the library's build graph before
  this ADR — no exclusion needed, just confirmation that the boundary already holds. A separate
  `tsconfig.web.json` (`lib: ["ES2022", "DOM"]`, `noEmit: true`, not referenced by the root
  `tsconfig.json`) gives editors/Vite DOM types for `web/**` without ever pulling `lib.dom` into
  `tsc -b`'s graph — this monorepo's `tsconfig.base.json` intentionally has no `dom` lib
  (`canvas-view.ts`'s own doc comment explains why: `RenderTarget`/`Canvas2DContext` are
  hand-written structural subsets specifically so `@openlogo/turtle` and the rest of `src/` never
  need DOM types).
- **The browser entry stays a thin, logic-free wiring layer.** `npm run coverage`'s 100% gate only
  measures files loaded by a `*.test.mjs`; `web/main.ts` is never imported by a test (it lives
  outside `src/`), so it is invisible to the gate either way — but it also holds no logic worth
  covering. Anything beyond direct composition (e.g. the default boot program, a diagnostics
  summary string) is a small headless helper in `src/web-bootstrap.ts` with its own
  `web-bootstrap.test.mjs`, kept inside the 100% gate like every other module in `src/`.

### Why Vite over the alternatives

- **Vite, not a hand-rolled `esbuild`/`http-server` script.** Vite needs no config for a plain
  TypeScript + `index.html` app (it transpiles `.ts` via `esbuild` out of the box), gives a real
  HMR dev server for free, and `vite build`/`vite preview` are the same one dependency — a
  hand-rolled dev server would reimplement all three for no benefit.
- **Not webpack/Rollup directly.** Both need substantially more configuration for the same result;
  Vite already wraps Rollup for production builds.
- **Not Vitest-adjacent lock-in worries.** ADR-0005 already ruled out Vitest as the *test runner*
  (a private feed rejected its transitive `vite` version at the time). This ADR only adds Vite as
  the studio **app's** dev dependency, not as a test runner — `node:test` remains the sole test
  runner repo-wide, so this does not reopen that decision. Re-verify the feed allows a current
  `vite` version before adding it (as this ADR does); if it is ever blocked again, the fallback is a
  minimal hand-rolled `esbuild` + static-file dev script, at the cost of losing HMR.

## Consequences

- `npm install` (or `npm ci`) then `npm run dev` (from the repo root or `packages/studio`) serves a
  page with the OpenLogo logo, a `<textarea>` editor, a `<canvas>`, and a Run button — `repeat 4
  [ forward 100 right 90 ]` draws a square on Run, satisfying issue #277's acceptance test.
- `npm run build` (root `tsc -b`) is unaffected: it never sees `web/**`, so the library keeps
  building and type-checking exactly as before this ADR.
- `package-lock.json` changes (the new `vite` devDependency) — expected, and confined to that one
  addition.
- Later slices (epic #276's slices 2-3: Stop/Reset/Step + live animation, the diagnostics list
  pane, a11y/persistence/branding polish) extend `web/main.ts` and `web-bootstrap.ts` without
  needing a different bundler decision.
- Rendering libraries beyond Canvas (SVG/PNG export tooling) and the AI provider adapter remain
  deferred to their own future ADRs, per ADR-0001.
