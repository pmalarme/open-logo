---
applyTo: "**"
---

# OpenLogo Team — Working Agreement

This file is the shared charter for every OpenLogo agent and contributor. It is always in
context (`applyTo: "**"`). Individual agents live in `.github/agents/*.agent.md` and inherit
these rules.

## 1. What we are building

**OpenLogo** (short name **OL**, source files `*.logo`) is a modern, open-source, educational
reimagining of Logo: **programming + turtle graphics + geometry + AI coaching + discovery
learning**. The language contract is fully specified in [`spec/`](../../spec/README.md).

We implement that spec as a **TypeScript 7 monorepo** in `openlogo/` with six packages
(see [ADR-0001](../../docs/adr/0001-tech-stack.md)):

| Package | Owns | Primary agent(s) |
|---|---|---|
| `@openlogo/core` | value/type model, `ol-*` diagnostics, trace/event registry, feature-detection metadata | interpreter |
| `@openlogo/parser` | lexis, reader, EBNF grammar, AST, reserved words, syntax highlighting, syntax + semantic checker | language-designer, interpreter |
| `@openlogo/runtime` | evaluator, scoping, procedures, control forms, comprehensions, places/mutation, equality, safety | interpreter |
| `@openlogo/robot` | turtle/sprite state, pen/heading/shape, rendering (Canvas/SVG/PNG), animation, export, accessibility | turtle-engine |
| `@openlogo/studio` | browser web app: editor/REPL, Canvas turtle view, run/stop/step, diagnostics UI, tooling/LSP, lesson pane, persistence | learner-experience |
| `@openlogo/edu` | learner levels, `explain`/`why`/`hint`/`debug`, geometry stdlib, AI tutor, curriculum, examples | geometry-teacher, ai-tutor, curriculum |

## 2. The source of truth

- **`spec/` is normative.** It is the contract. When code and spec disagree, the spec wins;
  open an issue rather than diverging silently.
- **`spec/` is owned by the maintainer (@pmalarme).** No agent edits `spec/` directly. The
  **product-owner** agent proposes changes via a PR that a human reviews and merges. Everyone
  else raises ambiguities as issues/change-requests.
- Key spec files agents must read before working in their area:
  [`conformance.md`](../../spec/conformance.md) (profiles + dependency DAG + minimal path),
  [`grammar.md`](../../spec/grammar.md), [`commands.md`](../../spec/commands.md) (C3 primitive
  matrix), [`execution-model.md`](../../spec/execution-model.md),
  [`error-model.md`](../../spec/error-model.md) (`ol-*` codes),
  [`rendering.md`](../../spec/rendering.md), [`educational-model.md`](../../spec/educational-model.md),
  [`ai-tutor.md`](../../spec/ai-tutor.md), [`tooling.md`](../../spec/tooling.md).

## 3. Build order follows the spec's profile DAG

Minimal conforming implementation is **Core Language → Turtle & Rendering**. Build in that
order, then add optional profiles only with their transitive dependencies:

```text
Core Language
├─ Turtle & Rendering ─┬─ Geometry (also needs Data) └─ Sprites
├─ Data
├─ Heritage (also needs Data)
├─ Interaction & Events
├─ Sound
├─ Modules ─ Localization
└─ Educational ─ Tutor (AI)
```

Learner **levels are a curriculum sequencing model, not profiles** — do not conflate them.

## 4. How we work

- **Vertical slices, not horizontal phases.** Deliver one language feature end to end:
  grammar → AST → runtime + trace events → renderer/UI → conformance + integration tests →
  teaching hooks → docs. Do **not** build "all parsing", then "all runtime".
- **One task = one PR** on a feature branch. Each task **declares its write-set** (the files/
  packages it will touch) up front.
- **Serialize shared-file edits.** Grammar, cross-package contracts, `package.json`/workspace
  manifests, and anything under `spec/` change one PR at a time to avoid conflicts.
- **One integration owner per story** (the orchestrator or the story's primary agent) merges
  the slice and keeps `main` green.
- **Respect package boundaries.** Depend on a sibling package's public API, never its internals.
  Cross-package changes need the owning agent's review.

## 5. Definition of Done (CI-enforced)

A change is done only when, for the artifacts it touches:

1. It builds and type-checks (TypeScript 7).
2. Lint passes (including OpenLogo style-lint rules where relevant).
3. Unit tests pass.
4. **Conformance fixtures pass** — behavior is proven by stack-neutral `source → events/
   diagnostics` fixtures under `tests/conformance/`, extended for the new feature.
5. Runnable `spec/examples/*.logo` and doc examples still parse and run.
6. Accessibility and pedagogy checks pass where applicable (see §8–9).
7. Docs and spec cross-links are updated in the same PR (no drift).

Agents do not self-merge; humans and required CI checks gate `main`.

## 6. Spec fidelity — canonical OpenLogo, not classic Logo

Match the merged spec exactly. Common mistakes to avoid:

- **Lowercase keywords, light punctuation.** No commas, no `f(x,y)` call syntax, no significant
  whitespace, no arrays/lambda/first-class procedure values in v0.1.
- **Procedures:** Core uses `define … end` with `return`/`stop`/`throw`. `to`/`output`/`op` are
  **Heritage** spellings (optional profile), not Core.
- **Turtle commands:** Core canonical names are `forward`/`back`/`left`/`right`/`penup`/
  `pendown`/`showturtle`/`hideturtle`/`clearscreen`/`print`. `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/
  `st`/`ht`/`cs`/`pr` are **Heritage** aliases.
- **Assignment vs comparison:** `<place> = <value>` and `set <place> to <value>` assign; `==`
  compares. `make` is Heritage. Variables are referenced as `:name`; places nest like
  `:people.tom.age`.
- **Values:** `number`, `word` (`"red"`), `list` (`[ ]`), `boolean` are Core. `dict` (`{ k: v }`)
  and `record`/`struct` are the **Data** profile.
- **Control forms:** `if`, `while`, `repeat`, `forever`, `for … in`, `for … from … to`.
  Comprehensions `map`/`filter`/`reduce` are Core with bracketed expression bodies — no lambda.
- **Blocks** are `[ … ]` inline or `… end` multiline; a control body is always delimited.
- **Geometry is discoverable source.** `polygon` and friends are OpenLogo standard-library
  procedures (Geometry profile), **not** opaque primitives. Only `grid`/`axes`/`measure` are
  renderer-backed. Never add hidden drawing shortcuts that bypass learning `repeat`/turns/`define`.

## 7. Diagnostics, traces, and feature detection

- All diagnostics use the normative shape and stable **`ol-*` codes** from
  [`error-model.md`](../../spec/error-model.md): code, source span, params, message, stage
  (parse/semantic/runtime), severity, plus optional did-you-mean. Style lints use `ol-style-*`.
  Diagnostics are owned by `@openlogo/core`; never invent ad-hoc error strings.
- Execution emits a **deterministic trace/event stream** (`@openlogo/core` registry, produced by
  `@openlogo/runtime`, consumed by `@openlogo/robot` and `@openlogo/studio`). Keep turtle
  **state/events deterministic and headless**, with animation layered on top — so
  `repeat 10000 [ forward 1 ]` tests semantics, not frames.
- Feature-detection metadata exposes `openlogo.version` = `0.1.0`, supported profiles, extension
  names, and rendering targets. Extensions use the `<vendor>.<feature>` namespace and must not
  redefine profile behavior.

## 8. Determinism, safety, and rendering

- Movement/heading math is deterministic; degrees, `0` points up, `right` turns clockwise.
- Enforce a cancellable execution budget (Run/Stop/Reset) so runaway programs stay stable.
- Rendering (`@openlogo/robot`) must support at least Canvas; SVG/PNG recommended. Honor
  reduced-motion, keyboard access, and non-visual descriptions from
  [`rendering.md`](../../spec/rendering.md). Export must be deterministic.

## 9. Educational guardrails

- `explain`, `why`, `hint`, `debug` are **Educational** profile commands: deterministic, offline,
  template-based, and must not print a complete ready-to-run solution. **`hint` is progressive** —
  a nudge first, never the full answer.
- `challenge` and AI behavior are the **Tutor (AI)** profile: Socratic (ask before answering),
  learner-adaptive, and **degrade gracefully to the deterministic Educational baseline when the
  AI backend is unavailable**. The AI provider is pluggable behind a provider-neutral adapter.

## 10. Conventions

- TypeScript 7, ES modules, `strict` on. Public API namespace is **OL**.
- Prefer ecosystem tooling over hand-rolled scripts. No secrets in code or fixtures.
- No MCP servers required in v1 (optional Microsoft Learn MCP later for research-heavy agents).
- When you finish a slice, leave the tree green and the docs/spec cross-links consistent.

## 11. Engineering principles

- **KISS — keep it simple.** Prefer the simplest design that satisfies the spec and passes
  conformance. No speculative abstraction, no configuration for a single caller, no premature
  generalization or performance tricks. When two solutions work, ship the smaller, more obvious one
  — a learner-facing language rewards code a learner could almost read. If a harder approach might
  be needed later, note it in an issue rather than building it now.
- **Boy Scout rule — leave it better than you found it.** While you are in a file for a task, make
  the small improvement in front of you: a clearer name, a missing test, a fixed typo, a dead branch
  removed. **Stay inside your task's declared write-set.** Do not scope-creep into unrelated
  refactors, files you don't own, or shared files outside the task — if you spot a larger problem,
  file an issue or flag `@orchestrator` instead of expanding the PR. KISS and the Boy Scout rule
  serve the same goal: a codebase that stays simple and keeps getting a little cleaner, one small,
  well-scoped step at a time.

## 12. Architecture, contracts & parallel work

- The monorepo layout, package internals, and cross-cutting contracts are defined in
  [`docs/architecture.md`](../../docs/architecture.md); the release + milestone strategy in
  [`docs/delivery.md`](../../docs/delivery.md) and
  [`docs/adr/0003-versioning-and-release.md`](../../docs/adr/0003-versioning-and-release.md).
- **Four shared contracts cross package boundaries:** the **AST** (`@openlogo/parser`), the
  **trace/event stream** and the **`ol-*` diagnostics** (`@openlogo/core`), and the **token classes /
  syntax highlighting** (`@openlogo/parser`, normative in `spec/tooling.md`). Agree them
  **contract-first** — one serialized PR — before a milestone's domain work fans out. Changing any of
  them later is a serialized, owner-reviewed PR.
- **Domains run in parallel** (language, engine, highlighter/tooling, rendering, studio/UI, education,
  tests, docs) against those contracts — see the parallelization map in `architecture.md`.
- **The highlighter and tooling track the grammar version:** any grammar or reserved-word change ships
  its highlighting + LSP update in the **same milestone**; a grammar PR is not done until the tooling
  fixtures are updated.
- **Milestones are profile-based synchronization points** on the spec DAG. A milestone completes when
  its profile conformance is green across **all** domains (not when one package finishes); from M2
  (Turtle & Rendering = minimal conformance) onward a release tuple is tagged.

## 13. Where to work & how the backlog is run

- **Source lives in `packages/<name>/src/`** — [`packages/README.md`](../../packages/README.md) is the
  source-folder map, and each package's public entry is `src/index.ts` only.
- **Folder-scoped instructions.** Each package has a scoped agreement at
  `.github/instructions/<name>.instructions.md` (`applyTo: "packages/<name>/**"`) that inherits this
  charter and pins that package's responsibilities, spec files, boundaries, and conventions. Read your
  package's file before editing under it.
- **File issues from templates**, never freehand:
  [`.github/ISSUE_TEMPLATE/`](../ISSUE_TEMPLATE) — `epic`, `feature-slice`, `conformance-task`,
  `foundation`, `bug`, `docs`. Each seeds the right `type:*`/`agent:*` labels.
- **Labels are a manifest.** [`.github/labels.yml`](../labels.yml) is the single source of truth
  (`agent:*` owner, `type:*` kind, `profile:*`, `area:*`, `level:*`). Exactly one `agent:*` and one
  `type:*` per issue; the milestone — not a label — says which M0–M6 it lands in.
- **The product-owner runs the board** (Project, milestones, issues, labels) via `gh`; see the
  `product-owner/github-project`, `epics-and-milestones`, and `triage-and-label` skills. Other agents
  request work through issues and let the product-owner/orchestrator schedule it.
