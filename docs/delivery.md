# OpenLogo delivery — release & saga strategy

> How OpenLogo (OL) ships. Defines versioning, per-domain release trains (language, highlighter,
> runtime, rendering, studio, edu) and how they stay coherent, plus the **saga** strategy that turns
> parallel domain work into proven, releasable conformance. Formalized in
> [`adr/0003-versioning-and-release.md`](adr/0003-versioning-and-release.md) and
> [`adr/0015-sagas-branching-governance.md`](adr/0015-sagas-branching-governance.md). See
> [`architecture.md`](architecture.md) for the packages and contracts referenced here.
>
> **Sagas** are the top of the planning hierarchy (**saga → epic → issue**) and **replace GitHub
> milestones**: each saga is a `type:saga` issue, and its epics/work issues attach as **native GitHub
> sub-issues**. The M0–M6 names below are saga names.

## 1. Versioning model

- **The language spec is the pace-setter.** `spec/` has its own version (currently `0.2.0`).
  Everything downstream targets a spec version.
- **Every package advertises what it implements** via feature-detection metadata
  (`spec/conformance.md`): `openlogo.version` (e.g. `0.2.0`) + the list of **profiles** it supports.
  This is the contract between packages, not their npm version numbers.
- **Package versions:** all `@openlogo/*` packages release **in lockstep** (one monorepo version) to
  start — simplest thing that works (KISS). We split a package onto its own line only when a real
  need appears, and record it in an ADR. Independent *cadence* is expressed through **profiles +
  spec version**, not divergent version numbers.
- A **release of OpenLogo** = a validated tuple: a set of package versions that all target the same
  `spec` version and agree on a declared **profile set**, with the conformance suite green.

### 1.1 When the contract version moves

**The spec version is a contract identifier, not a release artifact. It moves in the PR that changes
the normative contract — on the branch, not at release time.** Formalized in
[`adr/0033-contract-version-moves-with-the-contract.md`](adr/0033-contract-version-moves-with-the-contract.md).

This rule exists because the version *didn't* move: tags went `v0.1.0` → `v0.2.0` → `v0.3.0` while
`openlogo.version` stayed `0.1.0` throughout, because everyone treated it as a release artifact and
waited for a "release time" that only ever bumped `package.json`. The result is
[#1100](https://github.com/pmalarme/open-logo/issues/1100): three tags claiming spec `0.1.0` that do
**not** implement the same language. Measured by building each tag and running it — `define end` /
`return 1` / `end` is accepted at `v0.1.0` and `v0.2.0` and rejected with `ol-reserved-word` at
`v0.3.0`, while all three report `OPENLOGO_VERSION = 0.1.0`.

| | |
|---|---|
| **Moves it** — a conformance obligation or observable result changes | a normative behaviour change in any profile (incl. scoping/lifetime); a new/removed/re-spelled **reserved word or built-in name**; a new/removed/re-specified **`ol-*` code**; a grammar change that accepts or rejects a program it previously didn't; a profile-membership change; **and** a change to a normative surface no program's verdict reveals — trace/events, feature-detection metadata, token classes, rendering/export, accessibility |
| **Does not move it** — editorial only | typo and link fixes; clarifications and rewordings that add no requirement; formatting; examples restating settled behaviour; non-normative rationale |

The reviewer's test: **name the conformance obligation or observable result that changes, and say how
you would observe it** — a program whose verdict differs, an event or metadata field, a token painted
differently, a rendered or exported artifact. If you can't name one, the version doesn't move. A
program is the most common oracle, not the only one, and the oracle must be **observed**: `:end = 1`
looks like a reserved-word rejection and is in fact accepted at every released tag (a program may not
**declare** a built-in name, but may **bind** a value to any name).

**The bump covers four sites** — `spec/conformance.md`'s `openlogo.version`,
`spec/built-in-names.json`'s `specVersion`, `@openlogo/core`'s `OPENLOGO_VERSION`, and
`@openlogo/parser`'s `OL_GRAMMAR_VERSION` — **plus every prose statement of the version in `spec/`**
(the per-file `> OpenLogo Specification vX — Draft` stamps and the sentences in `README.md`,
`conformance.md` and `commands.md`).

**Only three of those are mechanically enforced**, and it is worth knowing which:
`assertGrammarVersionInSync()` throws at module import unless `OL_GRAMMAR_VERSION ===
OPENLOGO_VERSION`, and `npm run built-in-names` fails unless `specVersion === OPENLOGO_VERSION`.
**`spec/conformance.md`'s value is compared to nothing, and neither is any prose stamp** — rewriting
all seven of `conformance.md`'s version sites to `9.9.9` leaves every gate green. At the `0.1.0` →
`0.2.0` bump that introduced this rule, **28 of the 29 version statements in `spec/` were
hand-maintained**. Treat them as a manual checklist in the same PR, not as something CI will catch —
#1144 tracks closing that gap.

**The two version lines are independent.** The contract line and the `package.json` line are
different numbers that may coincide — they read the same on a branch that predates a release bump,
and separate again as soon as it merges. **Do not align them.** A release with no normative change
bumps only the package line; a contract change on a branch bumps only the contract line. Past tags
are never renumbered (#1100 rejected that; released artifacts are immutable).

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
| **Education** | edu | Educational/Tutor (AI)/Geometry conformance; tutor degrades offline | runtime API + spec version; curriculum pins a language version |

**The interlock rule:** the **highlighter and tooling track the grammar version**. Because token
classes are normative (`spec/tooling.md`) and derived from the grammar, any grammar/reserved-word
change carries a matching highlighter + LSP update in the same saga — a grammar PR is not "done"
until highlighting/tooling fixtures are updated. This is the concrete answer to "how do the language
and the highlighter work together."

## 3. Saga strategy

**Sagas are profile-based synchronization points on the spec DAG**, cutting across the parallel
domain tracks. Domains build continuously; a saga is where they converge, conformance goes
green, and (from M2 on) we tag a release. Sagas replace GitHub milestones — each is a `type:saga`
issue whose child epics and work issues are linked as native sub-issues.

### Principles

- **One saga = one profile set reaching conformance across every domain** (engine + highlighter
  + rendering + studio + edu + tests + docs), not one package finishing.
- **Contract-first:** each saga opens by agreeing the affected cross-cutting contracts (AST
  nodes, event types, `ol-*` codes, token classes) in a serialized PR; then the tracks fan out in
  parallel (see the parallelization map in `architecture.md`).
- **Entry criteria:** all dependency profiles (per the DAG) are already conformant.
- **Exit criteria (Saga Gate):** the saga's profile conformance suite is green on the minimal path and
  the saga's profiles; examples run; docs + highlighting updated; a11y/pedagogy checks pass; and for
  M2+ the saga is **ready to tag a release tuple** (all sign-offs recorded). The tuple itself is tagged
  **after** the maintainer promotes the `saga/*` RC to `main` — passing the gate authorizes the tag, it
  does not presuppose it. Below the Saga Gate sit the **Epic Gate** (capability audit) and the
  per-issue **Issue Gate** (Definition of Done) — see `shared/definition-of-done` and `shared/epic-gate`.
- **Sagas are `type:saga` issues; epics and work issues attach as native sub-issues**, labeled by
  owning agent + profile so parallel tracks pull independently.
- **Branching:** each active release saga has a `saga/*` branch; work merges into it and the saga
  branch is promoted to `main` as a Release Candidate the maintainer signs off
  (`devops/branching-and-commits`).

### The saga ladder

| Saga | Profiles reached | Ships (all domains) | Release |
|---|---|---|---|
| **M0 Foundation** | — | Monorepo, TS7 toolchain, CI (Definition of Done), conformance harness, cross-cutting contract stubs (AST/events/diagnostics/token-class enums) | internal |
| **M1 Core Language** | Core Language | Engine parses + evaluates Core; highlighter classifies Core tokens; studio REPL runs non-graphical Core; `conformance(core)` green | `0.1.0-core` (pre-release) |
| **M2 Turtle & Rendering** | + Turtle & Rendering = **minimal conformance** | Turtle state + events, Canvas render + SVG/PNG export, studio Run/Stop/Reset + turtle view + a11y | **`0.1.0` — first conformant release** |
| **M3 Educational baseline** | + Educational | `explain`/`why`/`hint`/`debug` deterministic; curriculum L1–L5; studio lesson pane | `0.2.0` |
| **M4 Data & Geometry** | + Data, + Geometry | dicts/records/mutation; geometry stdlib (`.logo`) + geometry-teacher reasoning; highlighter dict/struct/field classes | `0.2.0`¹ |
| **M5 Heritage · Sprites · Interaction & Events · Sound** | + those four (independent) | alternate spellings; multiple turtles; input/events/timers; sound — parallelizable | `0.3.0` |
| **M6 Modules · Localization · Tutor (AI)** | + Modules → Localization, + Tutor (AI) | `import`/`export`; localized keyword packs; AI tutor (Socratic, offline-degrading) behind the provider-neutral adapter | `0.4.0` |

¹ M3 and M4 shipped **together** in the `v0.2.0` tag (2026-07-25): `v0.2.0`'s tree already declared
M4's full profile set (Data + Geometry, on top of M3's Educational), so the two rows share one
release rather than each getting its own tag. The ladder is renumbered from M5 onward to keep
releases sequential (no `0.3.0` gap for a row whose profiles already shipped under `0.2.0`) —
`0.3.0`/`0.4.0` above are the current, authoritative mapping; do not re-derive `0.4.0`/`0.5.0` from
an older copy of this table.

M2 is the flagship: the smallest thing that is a real, conformant OpenLogo. Everything after M2 is
additive optional profiles, each releasable on its own once its conformance is green.

M3's learner-facing documentation lives at [`educational-commands.md`](educational-commands.md)
(the `explain`/`why`/`hint`/`debug` reference) and [`curriculum-overview.md`](curriculum-overview.md)
(the Level 1–5 lessons).

### Working in parallel across domains

Within a saga, these run at the same time once the contracts are fixed: language/grammar,
engine/runtime, highlighter/tooling, rendering, studio/UI, education, tests, docs. The **walking
skeleton** (`forward 100` end to end) is the M1→M2 integration spike that proves all seams before the
tracks broaden. An **integration issue** per saga (owned by `@orchestrator`) tracks it; when the
conformance suite is green the orchestrator recommends closeout and **the maintainer closes the saga**.

## 4. Continuous (the Maintenance saga, post-M0)

The standing **Maintenance saga** holds continuous / cross-cutting work that isn't tied to a release
saga; it has **no branch** and its work merges straight to `main`. Optional maintenance workflows
(`.github/workflows/`, scheduled): nightly conformance + stability → auto-file issues on regressions;
weekly docs/highlighter-vs-grammar drift check; new-issue triage into saga tracks. These are additive
and not on the critical path.
