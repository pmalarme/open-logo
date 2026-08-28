# 26. The child-edge gate's expected field set is derived from the type declarations

- Status: Accepted
- Date: 2026-08-28
- Deciders: OpenLogo maintainer (@pmalarme) + `@testing`, on issue #986
- Related: refines [ADR-0025](0025-child-edge-gate-audits-childrenof-independently.md) (the
  child-edge gate audits `childrenOf` from a source that does not use it)

## Context

[ADR-0025](0025-child-edge-gate-audits-childrenof-independently.md) built the child-edge gate around
reflection: for every node in the corpus it derives the child edges the node actually holds and
compares them against `childrenOf`. That comparison is only meaningful over fields the corpus
populates, so the gate also asserts **corpus adequacy** — every declared node-valued field path is
populated at least once — because a green run over a corpus that never exercises a field is
indistinguishable from a green run over a correct implementation.

That adequacy assertion compared **one** derivation, reflection over the parsed corpus, against a
hand-maintained list (`POPULATED_FIELD_PATHS`). The third source — the type declarations in
`packages/parser/src/ast.ts`, which is where a new field is actually added — was consulted by
nobody. A field added to an AST interface and missed by the list is invisible to reflection, because
reflection can only report a field that some tree carries. That is the same shape as the defect this
family of issues exists to remove: an instrument whose blind spot is invisible to itself.

ADR-0025 deferred the declaration-derived version and recorded two reasons. Both are now resolved,
and one of them was **wrong**:

- *"it takes a dependency on `unstable/*` entry points the repository does not otherwise use"* —
  true, and paid. `typescript/unstable/sync` is the only spelling TypeScript 7 publishes for its
  compiler API; the cost is one import in one test file, and the walk adds 484–642 ms to the default
  test run across three measured runs (a cold first run was 3.1 s).
- *"a declaration-derived list would still rest on the same `OL_NODE_KINDS`/`AnyNode` agreement this
  gate's oracle already states — it narrows the gap rather than removing the assumption underneath
  it"* — **this prediction is false, and the mechanism is the reason.** The walk starts *at*
  `AnyNode`, so the kinds it reaches **are** that union's membership. Comparing them against
  `OL_NODE_KINDS` is not a use of the assumption; it is the enforcement of it. ADR-0024 recorded
  that the agreement is "test-enforced, not compiler-enforced" and named no test. There was none.
  This is it.

That correction matters more than the feature. The deferral was reasoned from a property the
instrument would supposedly inherit, and the property reversed once the instrument was actually
built — the same lesson ADR-0025 already carries one paragraph earlier, where "the shim exposes no
compiler API" turned out to be the absence of the thing that was looked for rather than the absence
of the thing.

## Decision

**The expected field set is derived a second time, from `ast.ts`'s type declarations, and the two
derivations are compared in both directions.**

`auditTheDeclarations` in `packages/parser/src/child-edges.test.mjs` opens
`packages/parser/tsconfig.json` through `typescript/unstable/sync`, resolves the `AnyNode` type
alias, and walks each union member's properties by the **same path rule** `edgesUnder` applies to
real objects: the dotted route from the owning kind, through wrappers and arrays, to the first type
that is a node. Three sources must now agree — the declarations, the corpus, and the reviewed
literal — where before, two did.

The two derivations are differenced **both ways**, because the directions are different defects:

- `declared \ populated` is a **declared field no fixture exercises**. Every other assertion in the
  file stays green about it, by construction.
- `populated \ declared` is a **tree that disagrees with its own types**.

### Why full dotted paths, again and from the other side

Paths run through wrappers, so `ProcedureDef.params[].defaultValue` is tracked separately from
`ProcedureDef.params`. Attributing a wrapper-held node to the holder's field collapses the 55 paths
to **51** (measured, by projecting each path onto its first two segments), and the four it loses are
exactly the ones that say whether a wrapper's own node-valued part is ever reached:
`DictLit.entries[].key` and `.value` collapse into one, and `IsPredicate.test`'s four arms collapse
into one. A corpus of parameterless procedures populates `params` and says nothing about
`defaultValue`; the coarse reading cannot tell those apart.

### The self-checks, and why each is shaped the way it is

- **Classification is a subscript over a priority list, not a chain of conditionals.** `Math.max`
  over weighted terms selects one of `["leaf", "object", "reference", "node", "union"]`, so there is
  no arm reachable only on a broken tree — the dead-recording-path rule ADR-0025 applies throughout
  the same file.
- **Intersections get no arm at all.** They cannot occur in today's declarations, so an arm for them
  would be dead code. They fall to `leaf` instead, where their `TypeFlags` value breaks a **whole-set
  comparison** of every leaf flag met. The same catch covers `any`, `unknown`, `never`, mapped types
  and the compiler's error type: an unanticipated type constructor fails a comparison rather than
  being silently classified as childless. This is the per-container blind-spot lesson from ADR-0025
  applied to the type system instead of to runtime containers, and it is the only thing that catches
  mutant M5 below.
- **References are walked by type *argument*, never by property.** `getPropertiesOfType` on
  `readonly [number, number]` returns 34 members — `map`, `flatMap`, `at`, `Symbol.iterator` — so
  descending an array through its properties walks the `Array` prototype surface instead of its
  elements. This is load-bearing, not a shortcut.
- **Every visited type records whether it is the compiler's error type.** An unresolved reference is
  the one way this walk can come back smaller than the declarations with nothing looking wrong, so it
  is reported by name rather than left to the flag comparison alone. Measured: **0 unresolved**, over
  **1359** type visits.
- **Termination is measured, not argued.** Wrapper types form a DAG today. Rather than assert that,
  each descent filters out types already on the current chain and counts what it removed;
  `cyclicEdges` is asserted to be **0**. A counted filter costs nothing on a green tree, where an
  `if (cycle) throw` arm would be a recording path no green run executes.
- **A collapse floor, not a census.** `typeVisitCount > 1000` fails only on a walk that has shrunk,
  so ordinary growth in `ast.ts` never touches it and no derived count is asserted.

### What the literal is still for

`POPULATED_FIELD_PATHS` is **not** removed, and the choice is deliberate. Once both derivations exist
it carries no detection power they lack *while they drift apart*, but it does catch the case where
they drift **together**: a field added to `ast.ts` and exercised by a new fixture in the same change
moves both derived sets identically, and only the literal makes a human acknowledge the new walkable
field. That is the "three-place change" ADR-0025 chose, and it survives on its own merits rather than
because nothing replaced it.

## Consequences

- Adding a node-valued field to an existing kind stays a three-place change — the type, `childrenOf`,
  and the declared path list — plus a fixture. What changes is that the **first** of those three is
  now read by the gate rather than trusted, so a field declared and never exercised fails by name
  instead of being invisible.
- The residual ADR-0025 recorded — "a node-valued field that **no** fixture populates, which is
  invisible to reflection too" — is closed. `childrenOf`'s doc comment in `ast.ts` said so and has
  been corrected in the same change. The same sentence survives in
  `packages/runtime/src/execute-declaration-slots.test.mjs`, which was outside this change's declared
  write-set; correcting it is reported to `@orchestrator` rather than done here.
- `OL_NODE_KINDS` agreeing with `AnyNode` is now genuinely test-enforced, from the declarations. The
  gate reaches **36** kinds from `AnyNode` and compares them as a whole set.
- The gate keeps its single node-detection oracle: both halves ask `WALKABLE_NODE_KINDS`, which is
  `OL_NODE_KINDS`. That is still one shared assumption — but it is now an assumption the gate
  *checks* rather than one it rests on.
- **Every assertion added here is mutation-verified.** Five mutants were run in a disposable clone of
  commit `87e3773b`, each rebuilt with `tsc -b` and each confirmed present at its target location
  before the gate was run:

  | Mutant | Change | `tsc -b` | Result |
  | --- | --- | --- | --- |
  | M1 | `StructDefNode` gains `readonly probe?: BlockNode` — no `childrenOf` case, no fixture | exit 0 | **1 of 11 fails**, naming `declared \ populated` = `['StructDef.probe']` |
  | M2 | `ProcedureParam` (a wrapper) gains `readonly annotation?: WordLitNode` | exit 0 | **1 of 11 fails**, naming `['ProcedureDef.params[].annotation']` |
  | M3 | `ast.clear` returns an extra node-valued `shadow` field through a cast | exit 0 | 4 of 11 fail; `populated \ declared` = `['Clear.shadow']` |
  | M4 | the walk's wrapper descent filtered to nothing (instrument mutant) | n/a | 2 of 11 fail; `populated \ declared` = the 9 wrapper-held paths, and the visit floor reports 767 against 1359 |
  | M5 | `StructDefNode` gains `readonly note?: SpannedName & { readonly hidden: BlockNode }` | exit 0 | **1 of 11 fails**, on leaf flags `[4, 32, 64, 1024, 8192, 268435456]` |

  M1 is the discrimination measurement: the **pre-#986 gate**, taken verbatim from saga tip
  `22ecfb4a` and run against the same mutated `ast.ts`, passes **9 of 9**. The defect is completely
  invisible to it. M5 is the one that justifies the leaf-flag comparison: the intersection hides a
  `BlockNode` that the walk never reaches, both path assertions stay green, and the whole-set flag
  comparison is the only thing that fires.

  M3 is **not isolating**, and that is a property of the defect rather than a weakness of the
  assertion: a tree carrying a node-valued field the types do not declare cannot have that field
  returned by `childrenOf`, which is typed — so the child-list and `walk` comparisons necessarily
  fire too. M4 shows the same assertion firing without any corpus-facing assertion firing, which is
  what establishes it is not decorative. Recorded rather than left under a blanket claim, because an
  overstated verification claim is the same defect as an unenforced count.

- The declaration walk is **not** a second hand-rolled parser. ADR-0025 rejected one on merit after a
  `#925`-era attempt mis-read `ComprehensionNode` — a union rather than an interface. This walk reads
  that union correctly by construction: `ComprehensionNode`'s two members both declare
  `kind: "Comprehension"`, and the union arm outranks the node arm in the priority list precisely so
  the walk descends into both and finds `ReduceComprehensionNode.initial`.
