# AGENTS.md — OpenLogo

Guidance for AI agents (GitHub Copilot coding agent, Copilot CLI, and any other) and for humans
working in this repository. For the full working agreement see
[`.github/instructions/openlogo-team.instructions.md`](.github/instructions/openlogo-team.instructions.md).

## What this repo is

**OpenLogo** (short name **OL**, `*.logo` files) is a modern, open, educational reimagining of
Logo: programming + turtle graphics + geometry + AI coaching + discovery learning. The **normative
language contract lives in [`spec/`](spec/README.md)** and is owned by the maintainer — treat it as
the source of truth and never edit it without maintainer review.

The implementation is a **TypeScript 7 monorepo** (`openlogo/`) with six packages:

| Package | Responsibility |
|---|---|
| `@openlogo/core` | Value/type model, `ol-*` diagnostics, trace/event registry, feature detection |
| `@openlogo/parser` | Lexer, reader, EBNF grammar, AST, reserved words, syntax highlighting + syntax/semantic checker |
| `@openlogo/runtime` | Evaluator, scoping, procedures, control forms, comprehensions, places, safety |
| `@openlogo/turtle` | Turtle/sprite state, pen/heading/shape, rendering (Canvas/SVG/PNG), animation, a11y |
| `@openlogo/studio` | Browser web app (learner IDE): editor/REPL, Canvas turtle view, run/stop/step, diagnostics UI, tooling, lessons |
| `@openlogo/edu` | Learner levels, `explain`/`why`/`hint`/`debug`, geometry stdlib, AI tutor, curriculum |

Build order follows the spec's profile DAG: **Core Language → Turtle & Rendering** (minimal
conformance) → optional profiles (Data, Geometry, Heritage, Sprites, Interaction & Events, Sound,
Modules→Localization, Educational→Tutor (AI)). See [`spec/conformance.md`](spec/conformance.md).

## Repository layout

```text
spec/            Normative language specification (maintainer-owned) — the contract
docs/adr/        Architecture Decision Records (why we built it this way)
docs/architecture.md   Monorepo definition + cross-cutting contracts (AST, highlighting, events, UI)
docs/delivery.md       Release + milestone strategy
.github/agents/  The OpenLogo agent team (*.agent.md)
.github/skills/  Agent skill playbooks (shared + per-agent)
.github/instructions/  Team working agreement (always on) + per-package rules (applyTo packages/<name>/**)
.github/ISSUE_TEMPLATE/  Issue forms — feature-request, epic, feature-slice (user story), conformance-task, foundation, bug, docs
.github/labels.yml     Label taxonomy manifest (agent:*/type:*/profile:*/area:*/level:*)
.github/labeler.yml    Path→label rules for PR auto-labeling
.github/scripts/        Metadata validation + label sync (run by CI)
.github/workflows/     CI (Definition of Done), labeler, label sync — owned by @devops
packages/        @openlogo/* packages — src/ skeleton in place; see packages/README.md for the map
tests/conformance/     Stack-neutral source→events/diagnostics fixtures (grow with the build)
```

## How to work here (for any agent)

Domains build **in parallel** against four shared contracts (AST, events, `ol-*` diagnostics, token
classes). See [`docs/architecture.md`](docs/architecture.md) for the packages, contracts, and
parallelization map, and [`docs/delivery.md`](docs/delivery.md) for the release + milestone strategy.

1. **Read the spec area you are touching** plus the team agreement before coding.
2. **Work in vertical slices**: grammar → AST → runtime + trace → renderer/UI → conformance +
   integration tests → teaching hooks → docs, for one feature at a time.
3. **One task, one PR**, declaring the files/packages you will change; respect package boundaries.
4. **Prove behavior with conformance fixtures**, not prose. Extend `tests/conformance/`.
5. **Definition of Done**: builds, type-checks, lints, unit + conformance + example tests pass,
   docs/spec cross-links updated, and **in-session self-review** has passed — before opening the PR
   the implementing agent ran [`shared/review-gate`](.github/skills/shared/review-gate/SKILL.md),
   dispatching at least two non-author sub-agents (the logic/spec reviewer — `rubber-duck` or a named
   fallback — plus every domain QA expert) and iterating until all `pass`. Do not self-merge — humans +
   required CI checks gate `main` by default; the maintainer may delegate merge execution to
   `@orchestrator`, which does the final verification of those non-author verdicts + green CI (the
   implementer is never the sole attester).
6. **KISS + Boy Scout**: keep the design as simple as the spec allows, and leave each file a little
   better than you found it — but only within your task's declared write-set, never unrelated
   refactors. (Full rules in the team working agreement.)

**Docs have four surfaces**, each answering a different question: `spec/` (what is normatively
true), `docs/adr/` (why we chose this toolchain/engineering approach),
`docs/learn-how-its-built/` (how the implementation is coded), and `docs/design-notes/` (why the
**language itself** is shaped this way, with cross-language comparisons for advanced readers —
**Language Design Records**, one per decision, each citing the `spec/` section(s) it explains). See
the [`documentation/author-a-language-design-record`](.github/skills/documentation/author-a-language-design-record/SKILL.md)
skill for how to write one.

When editing under `packages/<name>/`, read that package's
`.github/instructions/<name>.instructions.md` first. To open work, **file an issue from a template**
in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE) (labels come from
[`.github/labels.yml`](.github/labels.yml)); the `product-owner` schedules it onto a milestone.

Every issue must be on the Project #5 board — `.github/workflows/add-to-project.yml` auto-adds new
issues/PRs (once the maintainer has provisioned the `ADD_TO_PROJECT_PAT` secret); if that automation
is ever off, use the manual fallback in the
[`product-owner/github-project`](.github/skills/product-owner/github-project/SKILL.md) skill.

## Spec fidelity cheatsheet (canonical OpenLogo, not classic Logo)

- Lowercase keywords; no commas, no `f(x,y)`, no arrays/lambda in v0.1.
- Procedures: `define … end` with `return` (Core). `to`/`output`/`op` are Heritage.
- Turtle: `forward`/`back`/`left`/`right`/`pen_up`/`pen_down`/`clear_screen`… (Core, underscored names
  primary); `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`cs`… are Heritage aliases.
- `=` and `set … to` **assign**; `==` **compares**; `make` is Heritage. Variables: `:name`.
- Values: `number`, `word` (`"red"`), `list` `[ ]`, `boolean` (Core); `dict` `{k: v}`, `struct` (Data).
- Diagnostics use stable `ol-*` codes ([`spec/error-model.md`](spec/error-model.md)); never ad-hoc strings.
- `polygon`/geometry are **discoverable OpenLogo source** (Geometry profile), not primitives.
- `explain`/`why`/`hint`/`debug` are deterministic; `hint` is progressive; the AI tutor degrades
  offline to that baseline and asks before answering.

## Build & test

The workspace uses **npm workspaces** (Node `>=22`). Develop on **Node 22** — the version in
[`.nvmrc`](.nvmrc) and the one CI pins — so local results match CI (`nvm use` reads `.nvmrc`).
This matters most for `npm run coverage`: Node 22's `--experimental-test-coverage` **counts**
`*.test.mjs` files toward the 100% gate, while Node 24+ silently **excludes** them, so a newer Node
can report a false-green that CI (Node 22) then fails. From the repo root:

```bash
npm ci               # restore the workspace from the committed lockfile
npm run build        # tsc -b — emits dist/*.js + *.d.ts across all packages
npm run typecheck    # tsc -b type-check
npm run lint         # Biome
npm run format:check # Prettier
npm run test         # node:test
npm run coverage     # node:test 100% line/branch/function gate — verify on Node 22 (see .nvmrc)
npm run conformance  # stack-neutral fixtures (placeholder until issue #6)
npm run examples     # parse + execute every spec/examples/*.logo whose required profiles are implemented; skip the rest with a visible notice
```

These eight scripts are the CI-enforced Definition of Done; see
[`docs/adr/0005-toolchain.md`](docs/adr/0005-toolchain.md) for why each tool was chosen (npm
workspaces, `tsc -b`, Prettier, Biome, `node:test`), why coverage is pinned to Node 22, and the
`typescript-eslint`/Vitest traps it avoids. Work in small, reviewable PRs and keep this file and the
ADRs in sync as the toolchain evolves.

`npm run coverage` runs through a thin deterministic wrapper (`scripts/coverage.mjs`, logic in
`scripts/coverage-gate/classify.mjs`) rather than invoking `node --test` directly. Node's parallel
`--experimental-test-coverage` occasionally under-reports coverage by a hundredth of a percent — a
stochastic cross-process V8 block-coverage **merge artifact** at the hot recursive `printedForm` in
`@openlogo/runtime` — failing the 100% gate on a fully-covered tree. The wrapper retries any coverage
shortfall that has no failing test a bounded number of times (a genuine gap is deterministic and
still fails after every retry, so a real regression is never masked); only test failures, an
unreadable report, or an anomalous fully-100 exit fail fast. See
[`docs/adr/0014-deterministic-coverage-gate.md`](docs/adr/0014-deterministic-coverage-gate.md).

## The agent team

The specialized agents in [`.github/agents/`](.github/agents/) map to the packages above. In
Copilot CLI, invoke one with `@<name>` (e.g. `@interpreter`). The `orchestrator` agent decomposes
the spec into tasks and coordinates the others. **Cross-cutting agents own no single package:**
`orchestrator`, `product-owner`, `testing`, `documentation`, and `devops` (CI/CD under
`.github/workflows/`, security, labeler, releases). See each agent file for its exact mandate.
