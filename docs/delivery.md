# OpenLogo delivery — release & milestone strategy

> How OpenLogo (OL) ships. Defines versioning, per-domain release trains (language, highlighter,
> runtime, rendering, studio, edu) and how they stay coherent, plus the milestone strategy that turns
> parallel domain work into proven, releasable conformance. Formalized in
> [`adr/0003-versioning-and-release.md`](adr/0003-versioning-and-release.md). See
> [`architecture.md`](architecture.md) for the packages and contracts referenced here.

## 1. Versioning model

- **The language spec is the pace-setter.** `spec/` has its own version (currently `0.1.0`).
  Everything downstream targets a spec version.
- **Every package advertises what it implements** via feature-detection metadata
  (`spec/conformance.md`): `openlogo.version` (e.g. `0.1.0`) + the list of **profiles** it supports.
  This is the contract between packages, not their npm version numbers.
- **Package versions:** all `@openlogo/*` packages release **in lockstep** (one monorepo version) to
  start — simplest thing that works (KISS). We split a package onto its own line only when a real
  need appears, and record it in an ADR. Independent *cadence* is expressed through **profiles +
  spec version**, not divergent version numbers.
- A **release of OpenLogo** = a validated tuple: a set of package versions that all target the same
  `spec` version and agree on a declared **profile set**, with the conformance suite green.

## 2. Per-domain release trains and how they interlock

Each domain releases continuously behind the shared contracts, but a feature only "counts" when its
profile passes conformance. The trains and their coupling:

| Train | Packages | Release gate | Coupled to |
|---|---|---|---|
| **Language contract** | `spec/` | maintainer review | — (drives all others) |
| **Engine** | core, parser, runtime | conformance for the profiles it claims (starting Core) | spec version |
| **Highlighter / tooling** | parser (`highlight`), studio (`lsp`) | token-class fixtures match the **current grammar** | **pinned to the grammar/spec version** — ships with or immediately after any grammar change so editors never lag the language |
| **Rendering / turtle** | turtle | Turtle & Rendering conformance + a11y checks + deterministic export | events contract |
| **Studio / UI** | studio | end-to-end run loop + a11y; composes only packages agreeing on one spec version + profile set | engine + turtle + edu versions |
| **Education** | edu | Educational/Tutor/Geometry conformance; tutor degrades offline | runtime API + spec version; curriculum pins a language version |

**The interlock rule:** the **highlighter and tooling track the grammar version**. Because token
classes are normative (`spec/tooling.md`) and derived from the grammar, any grammar/reserved-word
change carries a matching highlighter + LSP update in the same milestone — a grammar PR is not "done"
until highlighting/tooling fixtures are updated. This is the concrete answer to "how do the language
and the highlighter work together."

## 3. Milestone strategy

**Milestones are profile-based synchronization points on the spec DAG**, cutting across the parallel
domain tracks. Domains build continuously; a milestone is where they converge, conformance goes
green, and (from M2 on) we tag a release.

### Principles

- **One milestone = one profile set reaching conformance across every domain** (engine + highlighter
  + rendering + studio + edu + tests + docs), not one package finishing.
- **Contract-first:** each milestone opens by agreeing the affected cross-cutting contracts (AST
  nodes, event types, `ol-*` codes, token classes) in a serialized PR; then the tracks fan out in
  parallel (see the parallelization map in `architecture.md`).
- **Entry criteria:** all dependency profiles (per the DAG) are already conformant.
- **Exit criteria:** the milestone's profile conformance suite is green on the minimal path and the
  milestone's profiles; examples run; docs + highlighting updated; a11y/pedagogy checks pass; and for
  M2+ a release tuple is tagged.
- **Milestones map to GitHub milestones; issues are one vertical slice each**, labeled by owning
  agent + profile so parallel tracks pull independently.

### The milestone ladder

| Milestone | Profiles reached | Ships (all domains) | Release |
|---|---|---|---|
| **M0 Foundation** | — | Monorepo, TS7 toolchain, CI (Definition of Done), conformance harness, cross-cutting contract stubs (AST/events/diagnostics/token-class enums) | internal |
| **M1 Core Language** | Core Language | Engine parses + evaluates Core; highlighter classifies Core tokens; studio REPL runs non-graphical Core; `conformance(core)` green | `0.1.0-core` (pre-release) |
| **M2 Turtle & Rendering** | + Turtle & Rendering = **minimal conformance** | Turtle state + events, Canvas render + SVG/PNG export, studio Run/Stop/Reset + turtle view + a11y | **`0.1.0` — first conformant release** |
| **M3 Educational baseline** | + Educational | `explain`/`why`/`hint`/`debug` deterministic; curriculum L1–L5; studio lesson pane | `0.2.0` |
| **M4 Data & Geometry** | + Data, + Geometry | dicts/records/mutation; geometry stdlib (`.logo`) + geometry-teacher reasoning; highlighter dict/struct/field classes | `0.3.0` |
| **M5 Heritage · Sprites · Interaction · Sound** | + those four (independent) | alternate spellings; multiple turtles; input/events/timers; sound — parallelizable | `0.4.0` |
| **M6 Modules · Localization · Tutor (AI)** | + Modules → Localization, + Tutor (AI) | `import`/`export`; localized keyword packs; AI tutor (Socratic, offline-degrading) behind the provider-neutral adapter | `0.5.0` |

M2 is the flagship: the smallest thing that is a real, conformant OpenLogo. Everything after M2 is
additive optional profiles, each releasable on its own once its conformance is green.

### Working in parallel across domains

Within a milestone, these run at the same time once the contracts are fixed: language/grammar,
engine/runtime, highlighter/tooling, rendering, studio/UI, education, tests, docs. The **walking
skeleton** (`forward 100` end to end) is the M1→M2 integration spike that proves all seams before the
tracks broaden. An **integration issue** per milestone (owned by `@orchestrator`) closes it once the
conformance suite is green.

## 4. Continuous (post-M0)

Optional maintenance workflows (`.github/workflows/`, scheduled): nightly conformance + stability →
auto-file issues on regressions; weekly docs/highlighter-vs-grammar drift check; new-issue triage
into milestone tracks. These are additive and not on the critical path.
