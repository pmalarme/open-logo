# 27. The child-edge gate's expected field set is derived from the type declarations

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
  true, and paid. TypeScript 7 publishes its compiler API only under `unstable/*` (`unstable/sync`,
  `unstable/async` and `unstable/ast`); this uses the synchronous one. The cost is one import in one
  test file. Timing is stated as a magnitude rather than a range, because a range in an immutable
  document is a claim a later reader cannot reproduce: **hundreds of milliseconds warm** (576, 579
  and 827 ms measured in-process immediately after a build) and **seconds cold** (3.1 s on a first
  run in a fresh process; a reviewer measured 2.2 s immediately after a rebuild on their machine, and
  I could not reproduce that figure on mine — recorded because the disagreement is the useful part).
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
  over weighted terms selects one of `["leaf", "object", "sequence", "node", "union"]`, so there is
  no arm reachable only on a broken tree — the dead-recording-path rule ADR-0025 applies throughout
  the same file. One ordering in that list is **currently never exercised**: `union` outranks `node`,
  and the number of types classified `union` whose declared `kind` is also a node kind is **0**
  (measured). TypeScript flattens nested unions, so `ComprehensionNode` — whose two members both
  declare `kind: "Comprehension"` — never appears as a type object in the walk. The ordering is
  defensive, not load-bearing, and an earlier draft of this ADR claimed it was what found
  `ReduceComprehensionNode.initial`. A reviewer falsified that twice over: the path comes from the
  top-level `AnyNode` loop, and had the node arm won, the union arm would have terminated at two node
  members anyway.
- **A `sequence` is `isArrayType`/`isTupleType`, not `ObjectFlags.Reference`.** `Reference` covers
  every generic instantiation, so a first draft walked an ordinary generic wrapper `Box<BlockNode>`
  through its type arguments and derived `field[]` where reflection derives `field.value` — the gate
  **rejected a valid shape**, which is worse than missing an invalid one. Measured before and after:
  the same declaration yields `StructDef.hidden[]` under the old rule and `StructDef.hidden.value`
  under the new one. The two rules select the same 135 visits on today's declarations, which is
  exactly why the defect was invisible until a reviewer wrote a generic wrapper.
- **Intersections get no arm at all.** They cannot occur in today's declarations, so an arm for them
  would be dead code. They fall to `leaf` instead, where their `TypeFlags` value breaks a **whole-set
  comparison** of every leaf flag met. That catch covers every **non-object** constructor: `any`,
  `unknown`, `never`, and the compiler's error type. **It does not cover object-flagged ones**, and a
  draft of this ADR said it covered mapped types, which is false — `Record<string, BlockNode>` is
  `isObjectType()`, never reaches `leaf`, and left the flag set unchanged.
- **What an object type carries beyond its properties is asserted empty.** The `object` arm reads
  `getPropertiesOfType` and nothing else, and a TypeScript object type is described by four things:
  properties, index infos, call signatures and construct signatures. A row carrying the other three
  counts is recorded for **every** object type, and the rows with a non-zero count are filtered out
  and asserted empty (`opaqueObjectTypes`, measured **0**). Without it, the #986 reviewers hid a
  `BlockNode` behind each of `() => BlockNode`, `Record<string, BlockNode>` and
  `{ readonly [key: string]: BlockNode }` — all object types with **zero** properties, so
  `descend([])` visited nothing and the gate stayed 11/11 green. That is the per-container blind spot
  ADR-0025 spent nine rounds on, reproduced inside the instrument built to close it. Asserting "an
  object type has properties" would have closed those three and left the **mixed** case open —
  `{ a: string; [k: string]: unknown }` has a property *and* an index signature — so the assertion is
  over the remainder, not over the symptom.

  **The first version of that fix was itself the defect this file forbids**, and neither reviewer
  caught it: it pushed a row only when a mechanism was present, so six lines could not execute on a
  green tree. `npm run coverage` named them (`child-edges.test.mjs` 99.55 line / 99.22 branch,
  uncovered 1009-1014) and, being deterministic, survived all five retries of the coverage gate's
  merge-artifact allowance. Recorded because it is the clearest evidence available that the
  no-dead-recording-arm rule needs a *gate* and not a *convention*: the author wrote the anti-pattern
  while fixing a finding about blind spots, and two independent non-author reviews read past it.
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

`POPULATED_FIELD_PATHS` is **not** removed. Once both derivations exist it carries no detection power
they lack *while they drift apart*, but it does catch the case where they drift **together**: a field
added to `ast.ts` and exercised by a new fixture in the same change moves both derived sets
identically, and only the literal makes a human acknowledge the new walkable field. It is pinned once,
against the corpus. A second assertion pinning it against the declarations was written and then
deleted during review — with both differences asserted empty it had no independent failure state,
which is the definition of decorative.

## Consequences

- Adding a node-valued field to an existing kind stays a three-place change — the type, `childrenOf`,
  and the declared path list — plus a fixture. What changes is that the **first** of those three is
  now read by the gate rather than trusted, so a field declared and never exercised fails by name
  instead of being invisible.
- **The residual ADR-0025 recorded is narrowed, not eliminated, and the surviving part is measured.**
  A declared node-valued field that no fixture populates now fails — *unless it shares a path with an
  exercised variant*. Paths are keyed by node `kind` plus dotted route, so two declaring shapes
  meeting at one route merge. Both counterexamples came from the review gate and were reproduced:
  `readonly initial?: ExpressionNode` on `MapFilterComprehensionNode` passes **11 / 11**, because
  `ReduceComprehensionNode.initial` already populates `Comprehension.initial`; `readonly key?:
  ExpressionNode` on `FieldSegment` passes **11 / 11**, because `SelectorSegment.key` already
  populates `Place.segments[].key`. The four merge points are `Comprehension`, `PlaceSegment`,
  `IsTest` and `Binder`. Closing it means qualifying paths by variant discriminant on **both** sides,
  which changes the path rule `edgesUnder`, `POPULATED_FIELD_PATHS` and ADR-0025 all share — a
  redesign of that gate, tracked as issue #1004. `childrenOf`'s doc comment in `ast.ts` and the
  header of `child-edges.test.mjs` state this residual rather than claiming closure.
- A second residual: the walk starts at `AnyNode`, so everything it enforces is exactly as wide as
  that union. A node-shaped interface that does not extend `NodeBase` and appears in no union is
  invisible to it — inert, because `childrenOf` and `walk` are typed and the reflective half's
  `foreignShapes` would fire if one ever reached a tree, but not something this gate checks.
- The stale sentence in `packages/runtime/src/execute-declaration-slots.test.mjs` — which still
  describes the unpopulated-field residual as open — was outside this change's declared write-set and
  is on `@orchestrator`'s ledger for the epic #901 sweep rather than filed separately. Note that it
  is stale only for `BlockNode`-typed slots; a node behind a call or index signature was genuinely
  invisible until this change, and a variant-merged one still is.
- `OL_NODE_KINDS` agreeing with `AnyNode` is now genuinely test-enforced, from the declarations. The
  gate reaches **36** kinds from `AnyNode` and compares them as a whole set.
- The gate keeps its single node-detection oracle: both halves ask `WALKABLE_NODE_KINDS`, which is
  `OL_NODE_KINDS`. That is still one shared assumption — but it is now an assumption the gate
  *checks* rather than one it rests on.
- **Mutation verification, stated per assertion rather than as a blanket claim.** A draft of this ADR
  said "every assertion added here is mutation-verified", which a reviewer measured false — several
  of the added assertions have no mutant that fires them. What was actually run, in disposable clones:

  | Mutant | Change | `tsc -b` | Result |
  | --- | --- | --- | --- |
  | M1 | `StructDefNode` gains `readonly probe?: BlockNode` — no `childrenOf` case, no fixture | exit 0 | **1 of 11 fails**, naming `declared \ populated` = `['StructDef.probe']` |
  | M2 | `ProcedureParam` (a wrapper) gains `readonly annotation?: WordLitNode` | exit 0 | **1 of 11 fails**, naming `['ProcedureDef.params[].annotation']` |
  | M3 | `ast.clear` returns an extra node-valued `shadow` field through a cast | exit 0 | 4 of 11 fail; `populated \ declared` = `['Clear.shadow']` |
  | M4 | the walk's wrapper descent filtered to nothing (instrument mutant) | n/a | 2 of 11 fail; `populated \ declared` = the 9 wrapper-held paths, and the visit floor reports 767 against 1359 |
  | M5 | `StructDefNode` gains `readonly note?: SpannedName & { readonly hidden: BlockNode }` | exit 0 | **1 of 11 fails**, on leaf flags `[4, 32, 64, 1024, 8192, 268435456]` |
  | M6 | `StructDefNode` gains `probeFn?: () => BlockNode`, `probeRec?: Record<string, BlockNode>`, `probeIndex?: { [key: string]: BlockNode }` and a mixed `probeMixed?: { a: string; [key: string]: unknown }` | exit 0 | **1 of 11 fails**, `opaqueObjectTypes` naming all four paths with their index/call/construct counts |
  | M7 | `StructDefNode` gains `readonly hidden?: Box<BlockNode>` for a generic `Box<T>` | exit 0 | derives `StructDef.hidden.value`; under the pre-fix rule it derived `StructDef.hidden[]` |

  M1 is the discrimination measurement: the **pre-#986 gate**, taken verbatim from saga tip
  `22ecfb4a` and run against the same mutated `ast.ts`, passes **9 of 9**. The defect is completely
  invisible to it. M5 and M6 are the two that justify the whole-set checks — the intersection hides a
  `BlockNode` the walk never reaches with both path assertions green, and M6's four object-flagged
  containers do the same one category over.

  **Assertions with no isolating mutant, named rather than covered by the blanket claim:**
  `unresolvedTypes`, `categories`, `cyclicEdges`, `kinds`, `projectCount` and `configFileName`. Each
  states a property of the walk that today's declarations cannot violate, so no mutation of `ast.ts`
  fires them; they are notifications for a future change, not verified detectors. `typeVisitCount`'s
  floor fires under M4, and `leafTypeFlags` under M5.

  M3 is **not isolating**, and that is a property of the defect rather than a weakness of the
  assertion: a tree carrying a node-valued field the types do not declare cannot have that field
  returned by `childrenOf`, which is typed — so the child-list and `walk` comparisons necessarily
  fire too. M4 shows the same assertion firing without any corpus-facing assertion firing, which is
  what establishes it is not decorative.

- The declaration walk is **not** a second hand-rolled parser. ADR-0025 rejected one on merit after a
  `#925`-era attempt mis-read `ComprehensionNode` — a union rather than an interface. This walk reads
  that union correctly, though not for the reason a draft of this ADR gave: TypeScript flattens it, so
  `MapFilterComprehensionNode` and `ReduceComprehensionNode` are reached as direct members of
  `AnyNode` and `ReduceComprehensionNode.initial` is derived from the top-level loop.
