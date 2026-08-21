# 21. The built-in names list: one machine-readable source under `spec/`, asserted against the implementation by CI

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + devops + interpreter + orchestrator
- Related: [ADR-0000](0000-record-architecture-decisions.md) (ADRs are immutable once Accepted);
  [ADR-0006](0006-cross-cutting-contracts.md) (the four cross-cutting contracts this list joins);
  [ADR-0009](0009-test-layout.md) (black-box import discipline — a gate reads the packages through
  their public API only); [ADR-0012](0012-standard-library-location.md) (`stdlib/*.logo` — why
  `polygon` is a library, not a built-in);
  [LDR-0007](../design-notes/0007-binding-vs-registration.md) (the language-design decision this
  record supplies the mechanism for); ruling #833 rule 7; slice #841 (the implementation)

## Context

Ruling #833 settles what a **built-in name** is — a keyword or a primitive (aliases included) that
OpenLogo itself implements — and that registering one is an error while binding data to any name is
free. The language-design rationale is [LDR-0007](../design-notes/0007-binding-vs-registration.md).
Rule 7 of that ruling requires the list of those names to **ship with every spec version**,
single-sourced and CI-asserted, but deliberately leaves *which side is authoritative* open, because
that is an architecture decision rather than a language one.

The decision matters because the current arrangement has no source at all — the names are spread
across the implementation with no single place to read them, and nothing compares that spread to
the spec. Measured at saga tip `747c2e2`, `@openlogo/parser` exposes:

- `OL_RESERVED_WORDS` — **43** Core keywords;
- `OL_PROFILE_RESERVED_WORDS` — **7** profile block heads (`ask`/`each`/`tell` for Sprites,
  `when`/`every`/`on_key`/`on_click` for Interaction & Events);
- **eight** separate primitive tables, reachable only as membership lookups:
  `corePrimitiveArity`, `turtlePrimitiveArity`, `dataPrimitiveArity`, `educationalPrimitiveArity`,
  `geometryPrimitiveArity`, `interactionPrimitiveArity`, `soundPrimitiveArity`,
  `spritesPrimitiveArity`;
- `heritageAliasNames()` — **13** Heritage aliases (`bf bk bl cs fd ht lt pd pr pu rt se st`).

Three properties of that inventory are the whole problem:

1. **There is no table for Tutor (AI).** `challenge` is in none of the eight — verified — so a
   profile ships a primitive that no registry knows about.
2. **The inventory itself drifts between branches.** Issue #841 was written against `main`, where
   there were **five** tables and no Sprites/Interaction/Sound/Heritage registries; the saga tip has
   eight plus the Heritage aliases. The count of tables is not a stable fact, which is precisely why
   a gate cannot be built by diffing "the tables that happen to exist".
3. **Nothing enumerates.** The eight `*PrimitiveArity` functions answer *is this name a primitive?*
   one name at a time. `signatures.ts` does define `corePrimitiveNames()`,
   `turtlePrimitiveNames()` and siblings, but they are **not exported from
   `packages/parser/src/index.ts`** — verified. Under [ADR-0009](0009-test-layout.md)'s black-box
   rule a gate may only import the package's public entry, so today a gate literally cannot ask the
   implementation "what are all your built-in names?"

The combined effect is the bug class the ruling exists to close: **45** names are currently free at
`define` — 44 primitives plus `mod` — and no single artifact would have revealed it.

## Decision

**A single machine-readable file, `spec/built-in-names.json`, is the authoritative source. CI
asserts the implementation's registries equal it, exactly, in both directions.**

### 1. Where the source lives, and how it is versioned

The file sits under `spec/`, beside `spec/examples/`. That location is doing three jobs at once:

- **It keeps `spec/` normative and maintainer-owned**, as the team working agreement requires. The
  list is part of the contract, so a change to it is a maintainer-reviewed `spec/` PR — the same
  gate as any other normative change, enforced by `CODEOWNERS`.
- **It ships with every spec version literally**, because it is *in* the spec directory and carries
  a `specVersion` field matching `openlogo.version` (`0.1.0` today). "The list ships with every spec
  version" stops being a promise and becomes a file path.
- **It is consumable by third parties.** An independent implementer reads one JSON file instead of
  reverse-engineering prose, and diffs two spec versions with `git diff`.

The spec prose **cites** the file rather than duplicating it. `spec/grammar.md` and
`spec/tooling.md` keep their human-readable keyword listings — they are teaching text and worth
having inline — and CI asserts those listings match the file, so the prose can never drift.
Everything else (the primitive half, the aliases, the profile tags) lives only in the file.

### 2. The shape of the data

Two top-level arrays, because the interesting question is as much *what is deliberately not a
built-in name* as *what is*:

```jsonc
{
  "specVersion": "0.1.0",
  "names": [
    { "name": "define", "category": "keyword",   "profile": "core-language" },
    { "name": "ask",     "category": "keyword",   "profile": "sprites" },
    { "name": "mod",     "category": "keyword",   "profile": "core-language" },
    { "name": "forward", "category": "primitive", "profile": "turtle-rendering" },
    { "name": "setxy",   "category": "primitive", "profile": "turtle-rendering", "aliasOf": "set_xy" },
    { "name": "fd",      "category": "primitive", "profile": "heritage",         "aliasOf": "forward" },
    { "name": "challenge", "category": "primitive", "profile": "tutor-ai" }
  ],
  "excluded": [
    { "name": "polygon", "reason": "library",            "source": "stdlib/geometry/polygon.logo" },
    { "name": "of",      "reason": "contextual-keyword", "positions": ["is-predicate", "value-of-reader"] }
  ]
}
```

- **`category`** is `keyword` or `primitive`, matching `spec/tooling.md`'s token classes. It is the
  implementation's organizing split, not a learner-facing one (LDR-0007).
- **`profile`** tags every entry even though blocking no longer consults it. Reservation is
  unconditional (ruling 4), but docs, the highlighter, and per-profile reference tables all still
  need to know which profile owns a name. Recording it as *metadata* rather than as a *gate* is the
  point: nothing may branch on this field when deciding whether a name is blocked.
- **`aliasOf`** is an edge, not a separate list. Every alias is a primitive
  (`spec/tooling.md`'s `primitive` token class covers aliases explicitly), so aliases live in
  `names` with their canonical target recoverable. That covers both the Heritage short aliases
  (`fd` → `forward`) and the Turtle & Rendering one-word spellings (`setxy` → `set_xy`), which are
  two independent entries bound to one primitive and are the source of the call-site split
  LDR-0007 describes. A parallel alias list would have to be revisited by hand every time a
  canonical moved; an edge cannot drift from its target.
- **`excluded`** is the machine-readable record of the two deliberate carve-outs, each with a
  `reason`. This is the property that must exist **in the data, not in a comment**, because both
  carve-outs look like omissions to anyone doing a "completeness" pass.

### 3. What CI compares

The gate runs in the CI-enforced Definition of Done and fails on any of:

1. **Set inequality in either direction** between `names` and the union of the implementation's
   registries (`OL_RESERVED_WORDS` + `OL_PROFILE_RESERVED_WORDS` + every primitive table + the
   Heritage aliases), read through `@openlogo/parser`'s public API.
2. **An unregistered profile.** Every profile in `spec/conformance.md`'s DAG that the C3 matrix
   says ships primitives must have at least one `primitive` entry backed by a real registry. This
   is the clause that catches today's Tutor (AI) hole, and it is why the gate is not a plain diff
   of whatever tables exist: a missing table must be a failure, not an empty set that trivially
   matches.
3. **A broken carve-out.** Every `reason: "library"` entry must name an existing `.logo` file under
   `stdlib/` (ADR-0012), and no `excluded` name may also appear in `names`. Deleting
   `stdlib/geometry/polygon.logo`, or "helpfully" promoting `polygon` to a built-in, fails the
   build.
4. **Prose drift.** The keyword listings in `spec/grammar.md` and `spec/tooling.md` must match the
   file's `keyword` entries.

The gate must itself be proven — a fixture injecting a drift must make it fail — so a green gate is
evidence rather than a comforting no-op.

### 4. The implementation consumes the list; it does not re-derive it

The checker's collision rule **and** the runtime's phase-1 registration both read the same list.
`execute()` does not run `check()`, so a checker-only rule leaves the runtime free to disagree —
which is exactly today's state, where `struct forward [ x y ]` passes the checker and halts at run
time. With one list consumed by both, adding a primitive to any profile blocks it at `define` and
`struct` with no second edit, and clause 2 of the gate becomes a backstop rather than the only
defence.

To make any of this possible, `@openlogo/parser` must **export the enumerable name accessors** that
`signatures.ts` already defines internally. That is a public-API addition
([ADR-0006](0006-cross-cutting-contracts.md)), not an internal refactor.

### 5. A loaded library's procedures never enter this list

Library procedures are not built-in names — that is the whole of the Geometry carve-out. When the
Modules profile (M6) makes `stdlib/` loadable, a loaded library's procedures MUST register through
the ordinary phase-1 procedure table, so colliding with one raises `ol-duplicate-definition` by the
same code path as a learner's own second `define`. They MUST NOT be appended to the built-in-names
list, and nothing in the loader may consult it. Stated here because "the library is loaded, so its
names are taken, so add them to the list of taken names" is the obvious wrong move.

## Alternatives considered

**Option A — the spec prose is the source; CI parses it.** The normative list lives as a fenced
block in `spec/grammar.md` or a table in `spec/conformance.md`, and CI parses the markdown and
compares. Rejected as the *primary* mechanism: it makes the gate's correctness depend on a markdown
parser, and a prose block cannot carry the per-name metadata (`profile`, `aliasOf`, `reason`)
without becoming a machine format wearing prose clothing. The genuinely valuable half of Option A —
that a human reading `spec/` sees the keyword list inline — is kept, as gate clause 4.

**Option B — the implementation is the source; the spec list is generated.** `@openlogo/parser`'s
registries are authoritative and a script regenerates the spec block. Rejected, and it was
effectively disqualified before the trade-offs were weighed: it inverts "`spec/` is normative"
(team working agreement §2) and makes a maintainer-owned file agent-writable, so a mistake in the
implementation would rewrite the contract to match itself instead of failing. It also answers the
wrong question — it makes disagreement impossible by definition, when the whole point of the gate
is to *detect* disagreement.

**Option C — a third machine-readable file, both sides asserted against it.** Chosen, with one
refinement: the file is not a neutral third artifact sitting outside both worlds, it lives **under
`spec/`** and is therefore itself normative and maintainer-owned. That keeps Option B's mechanical
precision (no markdown parsing, trivial diffs, real metadata) without giving up Option A's
governance. The cost is one more file in the maintainer's review surface, which is the right price:
it is the file that most needs review.

## Consequences

- **`spec/built-in-names.json` becomes part of the contract.** Changing it is a maintainer-reviewed
  `spec/` PR gated by `CODEOWNERS`, and a third-party implementer can consume it directly instead
  of extracting names from prose.
- **`spec/` gains a non-prose normative artifact**, following the precedent of `spec/examples/`.
  Reviewing JSON is a different activity from reviewing prose; the `excluded` array with its
  `reason` field exists partly so that a reviewer can see *intent*, not just membership.
- **`@openlogo/parser`'s public API grows** by the enumerable name accessors, which is a
  cross-cutting contract change under [ADR-0006](0006-cross-cutting-contracts.md) and needs the
  owning agent's review.
- **Feature detection can report the list.** `spec/conformance.md`'s feature-detection metadata
  already carries `openlogo.version` and the supported profile set; the built-in names list joins
  it, so a host or tool can ask one question instead of probing names.
- **Adding a primitive becomes a two-file change** — the registry and `spec/built-in-names.json` —
  and CI fails until both land. That friction is deliberate: it is what makes "a profile shipped a
  primitive nobody registered" impossible rather than merely unlikely.
- **Adding a primitive is also a breaking change for programs.** Because reservation is
  unconditional and the list is versioned with the spec, a name that becomes a built-in in 0.5.0
  breaks any 0.4.0 program that had registered it. The list being versioned is what makes that
  visible in a diff instead of a surprise at run time.
- **The Geometry carve-out is now load-bearing data.** `grid`/`axes`/`measure` are in `names`;
  `polygon`/`circle`/`arc`/`star`/`area`/`perimeter` are in `excluded` with a path into `stdlib/`.
  A future contributor cannot quietly "complete" the list without deleting an `excluded` entry that
  a test is asserting on.
- **What it does not settle.** Whether `export <name>` is a registration or a reference is deferred
  to the Modules saga (M6), where the profile actually gets specified; the gate has no opinion on
  it today.
