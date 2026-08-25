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
  record supplies the mechanism for); ruling #833 rule 7; slice #841 (the implementation); refined
  by [ADR-0025](0025-token-class-declared-and-gated.md) (adds a second per-name axis, `tokenClass`,
  and replaces this record's token-class change detector with a comparison)
- Measurements: every present-tense statement about implementation behaviour in this record was
  measured at commit `1499e1e` and describes the tree as it stood when the record was accepted.
  Where a later slice is expected to change that behaviour, the record names the slice. Read every
  "today" as "at `1499e1e`".

## Context

Ruling #833 settles what a **built-in name** is — a keyword or a primitive (aliases included) that
OpenLogo itself implements — and that registering one is an error while binding data to any name is
free. The language-design rationale is [LDR-0007](../design-notes/0007-binding-vs-registration.md).
Rule 7 of that ruling requires the list of those names to **ship with every spec version**,
single-sourced and CI-asserted, but deliberately leaves *which side is authoritative* open, because
that is an architecture decision rather than a language one.

The decision matters because the current arrangement has no source at all — the names are spread
across the implementation with no single place to read them, and nothing compares that spread to
the spec. Measured at saga tip `1499e1e`, `@openlogo/parser` exposes:

- `OL_RESERVED_WORDS` — **43** Core keywords;
- `OL_PROFILE_RESERVED_WORDS` — a **Record keyed by profile**, not a flat list:
  `{ sprites: [ask, each, tell], "interaction-events": [when, every, on_key, on_click] }` — **7**
  names in total. Six are block heads; `tell` is a blockless Sprites command that is reserved all
  the same;
- **eight** separate primitive tables, reachable only as membership lookups:
  `corePrimitiveArity`, `turtlePrimitiveArity`, `dataPrimitiveArity`, `educationalPrimitiveArity`,
  `geometryPrimitiveArity`, `interactionPrimitiveArity`, `soundPrimitiveArity`,
  `spritesPrimitiveArity`;
- `heritageAliasNames()` — **13** Heritage short aliases (`bf bk bl cs fd ht lt pd pr pu rt se st`).
  Heritage has **three** shapes, not one, and they are registered differently: these 13 short
  aliases; **4 form heads** (`make`, `op`, `output`, `to`, via `heritageFormHeadNames()`); and
  **1 worded form** (`heritageWordedFormNames()` → `value-of-reader`, head `value`), added by #852,
  which finally made `heritageSurfaceSpellings()` (**18**) enumerate every Heritage spelling.
  Two measured facts about this shape matter for the gate, and both are counter-intuitive:
  - **The 13 short aliases are in no primitive table at all.** Measured, every one of them returns
    `undefined` from all eight `*PrimitiveArity` lookups; only their *canonicals* are in a table
    (`fd` → `forward` in `turtle`, `pr` → `print` in `core`). They are registered solely in the
    Heritage alias registry.
  - **All five Heritage heads are also Core keywords.** `make`, `op`, `output`, `to` and `value`
    appear in `OL_RESERVED_WORDS` *and* in a Heritage registry, so five of the 43 are reachable from
    two places at once. (The 13 short aliases are not: none is in `OL_RESERVED_WORDS`.)

Three properties of that inventory are the whole problem:

1. **There is no table for Tutor (AI).** `challenge` is in none of the eight — verified, and
   `packages/parser/src/educational-meta-commands.test.mjs` actively asserts its absence
   (`educationalPrimitiveArity("challenge") === undefined`). Nothing implements it either: the word
   appears under `packages/` only as a curriculum exercise-difficulty label
   (`difficulty: "challenge"`), never as a command. Measured, a bare `challenge` **parses clean**,
   raises `ol-unknown-command` at `check()`, and at `execute()` is diagnostic-clean while emitting
   only an `instruction` event — so the Tutor (AI) profile's one normative command is, end to end,
   an unknown name. It is normative in [`spec/conformance.md`](../../spec/conformance.md)'s
   *Tutor (AI)* section, and no registry — or evaluator — knows about it.
2. **The inventory itself drifts between branches.** Issue #841 was written against `main`, where
   there were **five** tables and no Sprites/Interaction/Sound/Heritage registries; the saga tip has
   eight plus the Heritage registries. The count of tables is not a stable fact, which is precisely
   why a gate cannot be built by diffing "the tables that happen to exist".
3. **The primitive half does not enumerate, and the alias edges are not recoverable at all.** The
   keyword half enumerates: `OL_RESERVED_WORDS` and `OL_PROFILE_RESERVED_WORDS` are exported
   constants, and the Heritage accessors are exported functions. But the eight `*PrimitiveArity`
   functions answer only *is this name a primitive?*, one name at a time. `signatures.ts` does
   define `corePrimitiveNames()`, `turtlePrimitiveNames()` and siblings, but **none of them is
   exported from `packages/parser/src/index.ts`** — verified. Under
   [ADR-0009](0009-test-layout.md)'s black-box rule a gate may only import the package's public
   entry, so today a gate literally cannot ask the implementation "what are all your primitives?"
   Nor can it ask what an alias points at, except for Heritage: measured,
   `canonicalOfHeritageAlias("fd")` is `"forward"`, but `canonicalOfHeritageAlias("setxy")` is
   `undefined` — the Turtle & Rendering one-word spellings (`setxy`, `setbg`, `seth`, `setwidth`,
   `setcolor`) are independent arity entries with no canonical mapping exposed anywhere.

The combined effect is the bug class the ruling exists to close: **45** names are currently free at
`define`, and no single artifact would have revealed it. The figure decomposes as **43**
registry-backed primitives that nothing blocks (30 Turtle & Rendering, 9 Heritage short aliases, 4
Educational) **+ `challenge`**, which by property 1 is in no registry and so cannot appear in any
enumeration of them, **+ `mod`**, which ruling #833 classifies as a keyword. That `challenge` is
invisible to the arithmetic is not a footnote — it is property 1 showing up inside the headline
number.

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

### 2. What the data must guarantee — and what it must not pin

**This section's *invariants* are normative; the JSON below is an illustration, not the contract.**
The prose following the illustration records the `0.1.0` state and the reasoning behind these
invariants; where it states a **decision** rather than a field layout — the closed tag vocabulary,
the `keyword`-before-`primitive` precedence, `profile` as metadata that must never gate blocking,
and the Tutor registry — that decision is normative and is carried by an invariant below, by §3, or
by ruling #833 itself. Nothing in this section is demoted except the shapes.
The distinction matters because this record is `Status: Accepted` and therefore immutable, while a
gate's data model is refined as it meets a real implementation — which happened three times during
this record's own review. Pinning a field layout here would mean every later refinement needs a
superseding ADR, so the document would generate exactly the churn it exists to prevent. What an ADR
owes is the decision; a JSON field layout is implementation.

So: **#841 may choose any representation it likes, provided every invariant below continues to
hold.** The invariants are not delegable and #841 cannot weaken them; the shapes are.

1. **One authoritative artifact.** `spec/built-in-names.json`, under `spec/`, maintainer-owned via
   `CODEOWNERS`, carrying a `specVersion` that matches `openlogo.version`.
2. **Entries are structured and compared in both directions** — every name in the file must be in
   the implementation and every name in the implementation must be in the file. A flat name set is
   insufficient.
3. **Every registry a name belongs to is recorded, never inferred.** A name registered in two places
   must not normalize to an entry that hides one of them, or a lost registration goes undetected.
4. **Every accessor the file names is checked for resolution, per accessor**, with an explicit
   *decided-but-not-yet-created* state that fails if the accessor ever *does* resolve. Per accessor,
   not per registry: at `0.1.0` eight registries are split.
5. **Both comparison directions are reachable** — the file names a way to ask *is this name here?*
   **and** a way to ask *what does this hold?*, because most of the implementation's registries
   answer only the first.
6. **The carve-outs are data with reasons**, and every library entry names a real `.logo` file under
   `stdlib/`, so deleting the file or promoting the name fails the build.
7. **Tutor (AI) has its own registry**, `tutorPrimitiveArity` — decided below in this section, not
   deferred to the implementing slice.

An illustration satisfying all seven at `0.1.0` — two arrays, because the interesting question is as
much *what is deliberately not a built-in name* as *what is*, plus the registry mapping invariants 4
and 5 require:

```jsonc
{
  "specVersion": "0.1.0",
  // The tag→accessor mapping the gate reads. The ADR's table is this object, printed.
  // EXCERPT — 6 of the 14 tags shown; the table below lists all fourteen at 0.1.0.
  "registries": {
    "reserved": {
      "lookup":    { "accessor": "OL_RESERVED_WORDS", "status": "present" },
      "enumerate": { "accessor": "OL_RESERVED_WORDS", "status": "present" }
    },
    "core-primitive": {
      "lookup":    { "accessor": "corePrimitiveArity", "status": "present"  },
      "enumerate": { "accessor": "corePrimitiveNames", "status": "declared" }
    },
    "tutor-primitive": {
      "lookup":    { "accessor": "tutorPrimitiveArity", "status": "declared" },
      "enumerate": { "accessor": "tutorPrimitiveNames", "status": "declared" }
    }
    // … 11 more tags omitted from this excerpt
  },
  "names": [
    { "name": "define", "category": "keyword",   "profile": "core-language",    "registries": ["reserved"] },
    { "name": "ask",     "category": "keyword",   "profile": "sprites",          "registries": ["profile-reserved"] },
    { "name": "mod",     "category": "keyword",   "profile": "core-language",    "registries": ["reserved"] },
    { "name": "to",      "category": "keyword",   "profile": "core-language",    "registries": ["reserved", "heritage-form-head"] },
    { "name": "thing",   "category": "keyword",   "profile": "core-language",    "registries": ["reserved", "core-primitive"] },
    { "name": "forward", "category": "primitive", "profile": "turtle-rendering", "registries": ["turtle-primitive"] },
    { "name": "setxy",   "category": "primitive", "profile": "turtle-rendering", "registries": ["turtle-primitive"], "aliasOf": "set_xy" },
    { "name": "fd",      "category": "primitive", "profile": "heritage",         "registries": ["heritage-alias"],   "aliasOf": "forward" },
    { "name": "challenge", "category": "primitive", "profile": "tutor-ai",       "registries": ["tutor-primitive"] }
  ],
  "excluded": [
    { "name": "polygon", "reason": "library",            "source": "stdlib/geometry/polygon.logo" },
    { "name": "of",      "reason": "contextual-keyword", "positions": ["is-predicate", "value-of-reader"] }
  ]
}
```

- **`category`** is `keyword` or `primitive`. It reuses two of `spec/tooling.md`'s class *names*, but
  it is not a token class: the two axes are independent (LDR-0007), and `mod` is the proof — it is
  `category: "keyword"` here and painted `operator`, exactly like `and`. `category` records the
  implementation's organizing split, not a learner-facing one, and never how a word is coloured.
- **`profile`** tags every entry even though blocking no longer consults it. Reservation is
  unconditional (ruling 4), but docs, the highlighter, and per-profile reference tables all still
  need to know which profile owns a name. Recording it as *metadata* rather than as a *gate* is the
  point: nothing may branch on this field when deciding whether a name is blocked.
- **`aliasOf`** is an edge, not a separate list. Every alias is a primitive
  (`spec/tooling.md`'s `primitive` token class covers aliases explicitly), so aliases live in
  `names` with their canonical target recorded. That covers both the Heritage short aliases
  (`fd` → `forward`) and the **five** Turtle & Rendering one-word spellings — measured,
  `setxy` → `set_xy`, `setbg` → `set_background`, `setcolor` → `set_color`, `seth` → `set_heading`
  and `setwidth` → `set_width` — each of which is a pair of independent entries bound to one
  primitive and each of which reproduces the call-site split LDR-0007 describes (shadow the short
  spelling and the canonical still emits its effect event: `move`/`draw-segment`,
  `background-change`, `color-change`, `turn`, `width-change` respectively). All five must be
  represented, not just the underscore-only pairs: a fix that handles `setxy` and stops there
  silently leaves four. A parallel alias list would have to be revisited by hand every time a
  canonical moved; an edge cannot drift from its target. Heritage *worded forms* — `value of … for
  key`, and the form heads `make`/`to`/`output`/`op` — are **not** `aliasOf` edges: they are grammar
  spellings rather than name-for-name substitutions. They enumerate through `heritageWordedForms()`
  (added by #852), whose registry `HERITAGE_WORDED_FORMS` in `packages/parser/src/signatures.ts` is
  keyed by **production name** — measured, one entry today:
  `{ head: "value", phrase: "value of … for key", node: "ValueOfKey" }`, with the heads folded into
  `heritageSurfaceSpellings()`. If the list ever needs to represent worded forms, that
  production-name keying is the shape to mirror — a `head` is not a name-for-name alias, so it has
  no `aliasOf` target to point at.
- **`registries`** is the **complete, exact set of implementation registries the name must appear
  in** — the field that makes the comparison bidirectional. `category` and `profile` are
  single-valued summaries and cannot express a name registered in two places, so without this field
  a dual-registered name normalizes to the same entry whether or not its second registration still
  exists: drop `thing` from `corePrimitiveArity`, or `make` from `heritageFormHeadNames()`, and a
  precedence-based gate would still see a matching keyword entry and report green. With
  `registries`, membership is checked set-equal in both directions against the named accessors, so
  either loss fails the build.

  The vocabulary is **closed and enumerated** — no shorthand, because a pattern like
  `<profile>-primitive` is exactly the kind of thing a reader completes by guessing:

  | tag | `lookup` accessor | `enumerate` accessor | `lookup` / `enumerate` status at `0.1.0` |
  |---|---|---|---|
  | `reserved` | `OL_RESERVED_WORDS` (array — scan) | `OL_RESERVED_WORDS` (array) | `present` / `present` |
  | `profile-reserved` | `OL_PROFILE_RESERVED_WORDS` (Record — scan per key) | `OL_PROFILE_RESERVED_WORDS` (Record, per key) | `present` / `present` |
  | `core-primitive` | `corePrimitiveArity` | `corePrimitiveNames` | `present` / `declared` |
  | `turtle-primitive` | `turtlePrimitiveArity` | `turtlePrimitiveNames` | `present` / `declared` |
  | `data-primitive` | `dataPrimitiveArity` | `dataPrimitiveNames` | `present` / `declared` |
  | `educational-primitive` | `educationalPrimitiveArity` | `educationalPrimitiveNames` | `present` / `declared` |
  | `geometry-primitive` | `geometryPrimitiveArity` | `geometryPrimitiveNames` | `present` / `declared` |
  | `interaction-primitive` | `interactionPrimitiveArity` | `interactionPrimitiveNames` | `present` / `declared` |
  | `sound-primitive` | `soundPrimitiveArity` | `soundPrimitiveNames` | `present` / `declared` |
  | `sprites-primitive` | `spritesPrimitiveArity` | `spritesPrimitiveNames` | `present` / `declared` |
  | **`tutor-primitive`** | `tutorPrimitiveArity` | `tutorPrimitiveNames` | `declared` / `declared` — **neither exists; #841 creates both** |
  | `heritage-alias` | `heritageAliasNames` | `heritageAliasNames` | `present` / `present` |
  | `heritage-form-head` | `heritageFormHeadNames` | `heritageFormHeadNames` | `present` / `present` |
  | `heritage-worded-form-head` | `heritageWordedFormHeads` | `heritageWordedFormHeads` | `present` / `present` |

  Measured at `1499e1e`: **lookups are 13 `present` / 1 `declared`; enumerators are 5 `present` /
  9 `declared`.** Eight primitive tags are *split* — their `lookup` resolves while their
  `*PrimitiveNames` enumerator is not exported — which is exactly why `status` attaches to an
  accessor and not to a tag. `corePrimitiveArity()` called with no argument throws `TypeError`,
  which is the concrete reason a lookup cannot stand in for an enumerator. Note the two array/Record
  accessors need adapting in **both** roles: neither is a callable predicate, so the `lookup` side
  scans them.

  **The tag→accessor mapping is data, not prose: it lives in the file, as a top-level `registries`
  object** (tag → its `lookup` and `enumerate` accessors, each with a status) alongside
  `specVersion`. That is what the gate reads; the table
  above is its human-readable copy at version `0.1.0`, printed here so the decision is reviewable
  without opening the file. Putting the mapping in the file rather than in a second schema artifact
  keeps one thing versioned by one `specVersion`, and means a new registry is a **versioned change
  to the file** — not an edit to this record, which is `Status: Accepted` and therefore immutable.
  A future registry is added to the file's `registries` object and recorded in a superseding ADR;
  this table is not amended, it simply describes `0.1.0`. Because the gate consults the file and
  never this prose, the record going stale after a superseding ADR cannot break the gate.

  Moving the mapping into data removes the human who was checking it, so the gate takes that over.
  Each tag names **two** accessors, because clause 1 checks two directions and they need different
  shapes: a **`lookup`** (*is this name in this registry?*) and an **`enumerate`** (*what names does
  this registry hold?*). Conflating them is not academic — the eight `*PrimitiveArity` functions are
  lookups only. `corePrimitiveArity` is `(name) => …` over a module-private Map; called with no
  argument it throws. So naming it alone would satisfy the per-name direction while leaving the
  whole-list direction — *does the implementation hold a name the list forgot?* — unreachable for
  the eight primitive tags, which cover most of the entries. That is the failure this record exists
  to prevent, reproduced inside the mechanism meant to prevent it: a green gate proving less than it
  appears to. Where one accessor serves both roles (`OL_RESERVED_WORDS` is an array;
  `heritageAliasNames()` enumerates) the two fields name it twice rather than special-casing.

  **Every accessor named must resolve to a real export of `@openlogo/parser`**, and the check
  distinguishes an accessor that is *missing* from one that is *not built yet* — **in the data, not
  in the gate's source**. `status` attaches to **each accessor**, not to the tag, because at `0.1.0`
  eight tags are split: their `lookup` resolves while their `enumerate` does not exist. A per-tag
  status could not express that, and either reading of it fails — call the tag `declared` and the
  gate rejects eight resolving lookups as drift; call it `present` and eight missing enumerators go
  unnoticed. Per accessor:
  - **`present`** — this accessor must resolve; if it does not, that is drift and the build fails.
  - **`declared`** — decided but not yet created, so it is *expected* absent; the gate accepts that
    and **fails if it ever does resolve**, because at that moment it should have become `present`.

  At `0.1.0` the `declared` accessors are the **eight** `*PrimitiveNames` enumerators §4 requires
  #841 to *export* (they already exist inside `signatures.ts`), plus **both** Tutor accessors, which
  the Tutor decision below requires #841 to *create* — ten in total, across nine tags. #841 flips
  each to `present` in the same change that lands it. Without a per-accessor `status` the gate would
  need hard-coded exceptions naming those accessors — the second list that drifts from the first,
  the precise failure this record exists to remove.
- **Tutor (AI) gets its own registry: `tutorPrimitiveArity`.** This decision settles it here rather
  than deferring it, because an Accepted record must not hand an unresolved architecture choice to
  its implementing slice. The alternative — filing `challenge` in the existing
  `educationalPrimitiveArity` — was rejected: it breaks the invariant clause 1 depends on, that
  `profile` matches *which* registry a name came from, since `challenge` is `tutor-ai` and that
  table is Educational's — which measurably holds exactly the four Educational baseline
  meta-commands (`explain`, `why`, `hint`, `debug`). Keeping the invariant exception-free is worth
  one small table, and it matches the shape of every profile whose primitives live in an arity
  table — eight of them, covering eight profiles. **Heritage is not a counterexample**: the names it
  contributes to `names` are *surface spellings of primitives owned elsewhere* rather than
  primitives of its own, so they are carried by an alias registry instead of a table — which is
  exactly why the 13 short aliases are in no arity table. (Heritage's other two registries hold
  grammar **forms**, not primitives at all, and contribute no `primitive` entries.) Modules and
  Localization ship no primitives. Tutor (AI) ships a primitive of its own and has neither shape,
  so it is the one genuinely missing registry. #841 creates it and
  registers `challenge` in it, together with the runtime primitive — a bare arity entry would make
  the checker accept a call the evaluator cannot execute.
- **Six names are reachable from two registries, so `category` needs a stated precedence.**
  Measured: `thing` is the only name in both `OL_RESERVED_WORDS` and a *primitive table*
  (`corePrimitiveArity`, arity 1); and `make`, `op`, `output`, `to` and `value` are each in
  `OL_RESERVED_WORDS` and a *Heritage* registry. `category` records **`keyword` first, then
  `primitive`**, `profile` follows the precedence-winning registry, and the full membership goes in
  `registries`. Clause 1 states how the gate checks it; without that precedence *and* that field,
  clause 1 is unimplementable for all six.
- **`excluded`** is the machine-readable record of the deliberate omissions, each with a `reason`.
  This is the property that must exist **in the data, not in a comment**, because every one of them
  looks like an oversight to anyone doing a "completeness" pass. Note the `positions` field records
  where a contextual word is *structural in the grammar* — for `of` that is both the `is`-predicate
  and the Heritage `value of … for key` reader, per `spec/grammar.md` — and is **not** a statement
  about highlighting: measured, the reader-form `of` is currently painted `primitive` rather than
  `keyword` (the defect #785/#755 describe, whose fix was reverted in this branch's history). Token
  class and registration are independent axes — LDR-0007 — so that mismatch has no bearing on `of`
  being excluded, and `positions` must not be used to derive one from the other.

### 3. What CI compares

The clauses below are **normative**, and are stated in the illustration's vocabulary for
concreteness. Under any other representation §2 permits, each clause binds to the invariant it
implements rather than to the field name it happens to mention. The gate runs in the CI-enforced
Definition of Done and fails on any of:

1. **Entry inequality in either direction** between `names` and the implementation's registries,
   read through `@openlogo/parser`'s public API. This is a comparison of **structured entries, not
   of a flattened name set**: for every name the gate checks that `category` matches the *kind* of
   registry it came from, that `profile` matches *which* registry it came from, that `registries` is
   **set-equal** to the accessors the name actually appears in, and that every `aliasOf` names a
   real entry. Comparing names alone would accept `mod` implemented as a primitive, `forward` filed
   under the wrong profile, a name that quietly lost one of its two registrations, or an `aliasOf`
   pointing at the wrong canonical — four ways for the list to be exactly as wrong as no list.

   **The registry→entry mapping has to be stated, because three of its cases are not the obvious
   one.** A gate written as "keyword ⇒ reserved list, primitive ⇒ a primitive table" is
   unimplementable against the tree as measured:
   - `OL_PROFILE_RESERVED_WORDS` is a **Record keyed by profile**: it supplies the `profile` tag
     directly and must be flattened per key, not concatenated blindly.
   - The **13 Heritage short aliases are in no primitive table**, yet `spec/tooling.md` puts aliases
     in the `primitive` class. They map to `category: "primitive"`, `profile: "heritage"`, sourced
     from `heritageAliasNames()` — and the profile of a *canonical* (`forward` is
     `turtle-rendering`) is not the profile of its alias.
   - **Six names are reachable from two registries.** `make`, `op`, `output`, `to` and `value` are
     in `OL_RESERVED_WORDS` *and* in a Heritage registry (`heritageFormHeadNames()`,
     `heritageWordedFormHeads()`); `thing` is in `OL_RESERVED_WORDS` *and* `corePrimitiveArity`.
     Exact equality therefore requires both a **stated precedence** and a **recorded second
     membership**, not deduplication by accident. `category` is **`keyword` first, then
     `primitive`** — mirroring the precedence the checker already applies when reporting a
     collision, measured (`define thing` reports `namespace: "reserved"`, `define count` reports
     `"primitive"`) — so such a name is filed **once**, as a keyword, and `profile` is the owning
     profile of the precedence-winning registry (`to` is `core-language`, not `heritage`). The
     precedence is not a convention this decision invents: measured, all five Heritage heads carry
     token class `keyword` while `fd`/`pr` carry `primitive`, matching `spec/tooling.md`'s own
     "structural special-form heads are `keyword`" — the checker, the highlighter and the spec
     already agree. The second membership is not inferred: it is recorded explicitly in the entry's
     `registries` array (below), because `category` and `profile` are single-valued and therefore
     cannot express it. Without both halves the gate either misfiles the five Heritage heads as
     Heritage primitives, rejects them outright, or — if it merely dedupes — silently stops noticing
     when a name's second registration disappears.

   **How far the alias half is checkable today, and what #841 must add.** Verifying that an
   `aliasOf` edge is the one the implementation *actually resolves* is only possible where the
   implementation exposes an edge at all. Measured, the public API exports exactly five alias
   accessors — `canonicalOfHeritageAlias`, `canonicalOfHeritageFormHead`, `heritageAliasArity`,
   `heritageAliasArityRange`, `heritageAliasNames` — and **all of them are Heritage**. So
   `fd → forward` is fully verifiable, while `setxy → set_xy` is not: no turtle canonical accessor
   exists, and no resolution happens at all (the two spellings are independent entries, which is
   precisely why they split). Until #841 adds an enumerable canonical map covering the turtle
   spellings — consumed by the resolver, so it cannot drift — the gate can only check that a turtle
   `aliasOf` target is a real entry of equal arity. Adding that map is part of the same public-API
   addition §4 already requires; without it the alias half of this clause is decorative for the very
   entries the ADR uses as its worked example.

   **On `tell`.** The category recorded is the one the registry supplies: `tell` is in
   `OL_PROFILE_RESERVED_WORDS` today, so it lists as a `keyword` under `sprites`. Ruling #833 leaves
   open whether it is finally *described* as a keyword or a primitive; if the maintainer moves it,
   the registry moves and the file must move with it — which is the gate doing its job, not a
   contradiction in it. Nothing here depends on the answer, because both categories are blocked at
   registration.
2. **An unregistered profile.** Every profile in `spec/conformance.md`'s DAG that ships primitives
   must have at least one `primitive` entry backed by a real registry. The normative inventory of
   what a profile ships is `spec/conformance.md`'s own profile sections together with
   `spec/commands.md`'s C3 matrix — for `challenge` specifically it is `spec/conformance.md`'s
   *Tutor (AI)* section, which C3 delegates to. This is the clause that catches today's Tutor (AI)
   hole, and it is why the gate is not a plain diff of whatever tables exist: a missing table must
   be a failure, not an empty set that trivially matches.
3. **A broken carve-out.** Every `reason: "library"` entry must name an existing `.logo` file under
   `stdlib/` (ADR-0012), and no `excluded` name may also appear in `names`. Deleting
   `stdlib/geometry/polygon.logo`, or "helpfully" promoting `polygon` to a built-in, fails the
   build.
4. **Prose drift.** The keyword listings in `spec/grammar.md` and `spec/tooling.md` must match the
   file's `keyword` entries.

The gate must itself be proven — a fixture injecting a drift must make it fail — so a green gate is
evidence rather than a comforting no-op.

**Clause 1 fails against the tree as it stood when this record was accepted, in two independent
ways, and neither is an oversight.** `challenge` belongs in `names` (it is normative in
`spec/conformance.md`) and its registry `tutorPrimitiveArity` does not exist yet; `mod` is filed
`category: "keyword"` and is in neither `OL_RESERVED_WORDS` (43 entries, measured, no `mod`) nor
`OL_PROFILE_RESERVED_WORDS`. The two are closed by **different slices**: `challenge` by #841, which
creates the Tutor (AI) registry decided above and registers it there alongside the runtime
primitive; `mod` by the grammar slice **#837**, which takes the keyword list from 43 to 44. A
maintainer landing #841 alone should therefore expect the gate to be *still* red on `mod`, not
green. Saying all of this explicitly is what stops the red gate from being "fixed" by dropping
either name from `names`, which would silently re-open the exact holes these clauses exist to close.

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
- **`@openlogo/parser`'s public API grows** by the enumerable name accessors, an enumerable
  canonical map covering the Turtle & Rendering alias spellings, and a new `tutorPrimitiveArity`
  registry for Tutor (AI) — a cross-cutting contract change under
  [ADR-0006](0006-cross-cutting-contracts.md) that needs the owning agent's review.
- **Feature detection MAY report the list; this decision does not require it.**
  `spec/conformance.md`'s feature-detection metadata already carries `openlogo.version`, the
  supported profile set, extension names and rendering targets, and exposing the built-in names
  alongside them would let a host ask one question instead of probing names. But that would add a
  required field to the metadata contract and a corresponding surface in `@openlogo/core`, which is
  a separate cross-cutting change with its own owner ([ADR-0006](0006-cross-cutting-contracts.md))
  and is deliberately **out of scope here** — this ADR decides the source of truth and the gate,
  nothing about the host API. A later slice may make it required; until then a host reads the file.
  **This supersedes the feature-detection line in #841's Definition of Done**, which was written
  before this decision and requires the list to be reported through feature detection; that
  requirement moves to its own slice.
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
