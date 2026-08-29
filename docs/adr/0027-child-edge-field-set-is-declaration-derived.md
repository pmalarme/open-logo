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
  document is a claim a later reader cannot reproduce, and the scope is **`auditTheDeclarations`
  alone** — not `node --test` on the file, which additionally parses the 900+ file corpus and has
  been measured at 26.7 s on a cold filesystem. The walk itself is **sub-second to about two seconds
  warm** (576/579/827 ms in-process immediately after a build on one machine; 629–1752 ms across six
  runs on another, a roughly 3× spread) and **seconds cold** (3.1 s on a first run in a fresh
  process).
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

**Every self-check the walk makes about its own reach is an identity comparison, not a shape test.**
That is the load-bearing design choice, and it was arrived at the hard way: this instrument's review
defeated a succession of rules for detecting a hidden node, each strictly more general than the last
and each still defeated. The table is the record; the prose deliberately carries no count, because a
sixth row would leave a numeral behind.

| rule | defeated by |
| --- | --- |
| report object types with no properties | a property **plus** an index signature |
| reject non-array index signatures | a call signature |
| the remainder invariant, scoped to one arm | the root loop, which bypasses that arm |
| audit each node type once, at the root | a **structural look-alike** |
| treat a type as a node only when its `kind` is one node-kind literal | a **node supertype** (`NodeBase`), node-shaped without being any one node |
| require an `object`-category `kind` to carry `TypeFlags.StringLiteral` | a supertype carrying **no `kind` at all** — `{}`, or `{ source_span: SourceSpan }` — and, in the other direction, an ordinary childless wrapper `{ kind: "left" \| "right"; label: string }` rejected for a union `kind` naming no node |

The last row is the sharpest evidence for this section, because it is this section's own rule broken
in the act of stating it. That check was written in the round that introduced this text, and while
its *reference set* was the compiler's `TypeFlags` vocabulary, its **selector** — "the property named
`kind`" — was authored here, and a selector has a complement exactly as an allowed-value list does.
It was wrong in both directions at once: it admitted `{ source_span: SourceSpan }`, which `tsc` will
certify holds any node, and it rejected a legitimate wrapper. Both measured.

**What replaced it has no selector.** `holdsEveryNode` asks the compiler whether **every** `AnyNode`
member is assignable to the type, on the two arms that derive no path (`object` and `leaf`). That is
one rule for `NodeBase`, `{}`, `{ source_span }`, `object`, `unknown` and `any`, and it reaches
through sequences and optionality — `readonly NodeBase[]` fires too. It must be `every` and not
`some`: `some` is **red on a green tree with 19 rows**, because structural typing makes incidental
supertypes ordinary (`VarRefNode` is assignable to `SpannedName`). Memoised by type id, because
assignability is the one expensive question the walk asks: the file runs 1.65–2.04 s warm with the
cache and 11.5 s without it.

A shape test enumerates what its author thought of, so it has a complement that must be extended
every time someone thinks of something new — which is ADR-0025's per-container blind spot, and it
recurred at every level of the walk, inside the instrument built to end it. An identity comparison
asks a
different question: *is this the thing that was audited?* It has no complement to extend. So the
checks that survived attack are the ones phrased that way — and each compares against **a set the
system already maintains for its own reasons**, never a list curated in this file, and none of them
selects a property by name: the compiler's leaf `TypeFlags` vocabulary, a pristine realm's own-key
set, the four-part definition of a TypeScript object type, the **assignability relation** against
`AnyNode`'s membership, and node identity against the members the root inspected. That is why they
have no complement to extend — the complement is somebody else's problem, and somebody else keeps it
correct. A shape test fails not because it tests shape but because **its reference set, or its
selector, is authored here**, so it can only
ever be as complete as its author's imagination on the day. Node identity is the sharpest case:
TypeScript is structural, so "already audited" was never a property of a *shape*, and no amount of
shape enumeration could have reached it.

`POPULATED_FIELD_PATHS` looks like a counterexample and is not: it is a curated list, but it is not a
**detector**. It is pinned from both sides by derivations, so it cannot be silently incomplete — only
loudly wrong, in one round. Curation is safe when it is pinned and dangerous when it is consulted.

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
  top-level `AnyNode` loop, and the union arm — which the ordering does select — descends to two
  members that are each `node`, so it terminates without reaching `initial` either way.
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
- **What a type descended by property carries beyond those properties is asserted empty.** The
  `object` arm reads `getPropertiesOfType` and nothing else, and a TypeScript object type is
  described by four things: properties, index infos, call signatures and construct signatures. A row
  carrying the other three counts is recorded for **every type taking that arm and for every
  `AnyNode` member at the root** — a node is descended by property too, so it owes the same
  statement; a sequence is descended by type *argument* and carries no user-declared remainder — and
  the rows with a non-zero count are filtered out and asserted empty (`opaqueObjectTypes`, measured
  **0**). Without it, the #986 reviewers hid a `BlockNode` behind each of `() => BlockNode`,
  `Record<string, BlockNode>` and `{ readonly [key: string]: BlockNode }` —
  all object types with **zero** properties, so `descend([])` visited nothing and the gate stayed
  11/11 green. That is the per-container blind spot ADR-0025 records at length, reproduced inside the
  instrument built to close it.

  **Both reviewers independently proposed a narrower fix** — "report object types with no
  properties" and "reject non-array index signatures" — and each has a demonstrable escape. The first
  is defeated by a type carrying **both** a property and an index signature
  (`{ a: string; [k: string]: unknown }`); the second catches that one but not a bare function type.
  Neither *addresses* call or construct signatures — the first only catches `() => BlockNode`
  incidentally, because a bare function type happens to have zero properties, and a callable that
  **also** carries a property defeats both: `readonly zzCallable?: { (): BlockNode; readonly a: string }`
  compiles clean and is reported by the remainder invariant alone, as
  `{ at: 'StructDef.zzCallable', indexSignatures: 0, callSignatures: 1, constructSignatures: 0 }`.
  A reviewer's follow-up mutants — a container inside a sequence
  (`readonly { [key: string]: BlockNode }[]`) and one behind a property (`{ wrap: () => BlockNode }`)
  — showed the assertion also has to be **per-path and recursive** rather than a top-level shape
  test. And a third round showed it has to be applied at the **root** as well: stated only for the
  `object` arm, it held for every wrapper and no node, and an index signature on `StructDefNode`
  itself passed the gate 11/11. Each narrower rule closed the shape it was shown and left the next
  one open — the recursion the Decision section opens with, and the reason the checks that survived
  are phrased as identity comparisons rather than shape tests.

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

- Adding a node-valued field to an existing kind, **whose `kind`-and-route is not already exercised**,
  stays a three-place change — the type, `childrenOf`, and the declared path list — plus a fixture.
  What changes is that the **first** of those three is now read by the gate rather than trusted, so
  such a field declared and never exercised fails by name instead of being invisible. A field that
  *shares* a route with an exercised variant is the residual below and fails nothing.
- **The residual ADR-0025 recorded is narrowed, not eliminated, and the surviving part is measured.**
  A declared node-valued field that no fixture populates now fails — *unless it shares a path with an
  exercised variant*. Paths are keyed by node `kind` plus dotted route, so two declaring shapes
  meeting at one route merge. Both counterexamples came from the review gate and were reproduced:
  `readonly initial?: ExpressionNode` on `MapFilterComprehensionNode` passes **11 / 11**, because
  `ReduceComprehensionNode.initial` already populates `Comprehension.initial`; `readonly key?:
  ExpressionNode` on `FieldSegment` passes **11 / 11**, because `SelectorSegment.key` already
  populates `Place.segments[].key`. A route merges only where a **non-node union has two or more
  descended members** (`PlaceSegment`, `IsTest`) or where **two interfaces share a `kind`**
  (`Comprehension`) — **three** merge points. A draft of this ADR said four and included `Binder`,
  which a reviewer measured false: `Binder`'s `DestructuringBinderNode` member terminates the path
  and its `SpannedName` member extends it, so they cannot collide — a node-valued field on
  `SpannedName` fails loudly, naming `ForIn.binder.probe` and `Comprehension.binder.probe` among 17
  paths. Closing the real merge points means qualifying paths by variant discriminant on **both**
  sides, which changes the path rule `edgesUnder`, `POPULATED_FIELD_PATHS` and ADR-0025 all share — a
  redesign of that gate, tracked as issue #1004. `childrenOf`'s doc comment in `ast.ts` and the
  header of `child-edges.test.mjs` state this residual rather than claiming closure.
- A third residual, stated because the reviewer who found the second one asked that it not be claimed
  closed: a **partial** supertype — `{ source_span: SourceSpan; body: readonly StatementNode[] }`,
  which admits three `AnyNode` members rather than all 37 — escapes `holdsEveryNode`, whose rule is
  deliberately `every` rather than `some`. `some` cannot be used: it is red on a green tree with 19
  rows, because structural typing makes incidental supertypes ordinary. So the gap between "admits
  every node" and "admits some node" is open by construction, and closing it needs a discriminator
  neither of us has.

- A second residual, narrowed by the same round that found it: the walk starts at `AnyNode`, so what
  it enforces is as wide as that union. A **second type declaring an existing `kind`** is now caught
  by identity — `foreignNodeTypes` compares every node-category type met in field position against
  the union's members, and a reviewer's structural `{ kind: "Block"; …; extra?: BlockNode }` on
  `ForeverNode.body` fails it by name (M13). A draft of this ADR called such a type "inert"; that was
  false, and the mutant is why. What remains is an exported node-shaped interface appearing in **no**
  field position and no union — outside the **current declaration graph and corpus**, which is narrower
than "unreachable": external code can still assign a structurally compatible value into an `AnyNode`
position without naming the type here. Adding it to the union does **not**
  necessarily fail `tsc`: `childrenOf`'s `never` guard rejects an unhandled discriminant *value*, so
  it fires for a new `kind` and not for a second interface declaring an existing one — measured,
  `tsc -b` exit 0. What catches that one is the root loop auditing the new member and deriving its
  fields (measured: `declaredButUnpopulated = ['Block.zzhidden']`, 1 of 11), subject to residual 1 if
  the field shares an already-exercised route. A draft of this ADR said the `never` guard "fails the
  moment anything puts it in the union", which asserted compiler cover for precisely the case whose
  compiler-invisibility is why `foreignNodeTypes` exists.
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
  | M6 | `StructDefNode` gains `probeFn?: () => BlockNode`, `probeRec?: Record<string, BlockNode>`, `probeIndex?: { [key: string]: BlockNode }` and `probeMixed?: { a: string; [key: string]: unknown }` | exit 0 | **1 of 11 fails**, `opaqueObjectTypes` naming all four paths with their index/call/construct counts |
  | M7 | `StructDefNode` gains `readonly hidden?: Box<BlockNode>` for a generic `Box<T>` | exit 0 | derives `StructDef.hidden.value`; under the pre-fix rule it derived `StructDef.hidden[]` |
  | M8 | `StructDefNode` gains `metadata?: RecursiveMetadata` for a self-referential `interface RecursiveMetadata { next?: RecursiveMetadata; label: string }` | exit 0 | **1 of 11 fails**, `cyclicEdges` = 1 against 0, both path assertions green |
  | M9 | `"Ghost"` appended to `OL_NODE_KINDS` | exit 0 | **2 of 11 fail**: the declaration-side `kinds` comparison and the corpus-side kind census |
  | M10 | `StructDefNode` gains `readonly [key: string]: … \| BlockNode \| undefined` — an index signature on the **node interface itself** | exit 0 | **1 of 11 fails**, `opaqueObjectTypes` = `[{ at: 'StructDef', indexSignatures: 1, callSignatures: 0, constructSignatures: 0 }]` |
  | M11 | `StructDefNode` gains `zzArr?: ZzArrayLike` for `interface ZzArrayLike extends ReadonlyArray<string> { zzhidden: BlockNode }` | exit 0 | **2 of 11 fail**: `declared \ populated` = `['StructDef.zzArr.zzhidden']`, and `opaqueObjectTypes` **includes** `{ at: 'StructDef.zzArr', indexSignatures: 1 }` alongside a row for each inherited `ReadonlyArray` method. It takes the **`object`** arm — `isArrayType` is false for an interface that merely extends `ReadonlyArray` — which is the measurement behind "a sequence carries no user-declared remainder of its own" |
  | M12 | `StructDefNode` gains `zzCallable?: { (): BlockNode; readonly a: string }` — callable **and** carrying a property | exit 0 | **1 of 11 fails**, `opaqueObjectTypes` = `[{ at: 'StructDef.zzCallable', indexSignatures: 0, callSignatures: 1, constructSignatures: 0 }]`; defeats both narrower proposals |
  | M13 | `ForeverNode.body` retyped from `BlockNode` to a **structural** `{ kind: "Block"; source_span; body; extra?: BlockNode }` | exit 0 | **1 of 11 fails**, `foreignNodeTypes` = `[{ at: 'Forever.body', kind: 'Block', id: 241 }]`; the gate one commit earlier passes **11 of 11**, with `Block.extra` derived by nobody |
  | M14 | `StructDefNode` gains `readonly zzBase?: NodeBase` — node-*shaped* without being any one node | exit 0 | **1 of 11 fails**, `nodeShapedWrappers` naming `StructDef.zzBase`. `readonly zzBases?: readonly NodeBase[]` fires identically, so the rule reaches through a sequence |
  | M16 | `StructDefNode` gains `readonly zzSpanned?: { readonly source_span: SourceSpan }` and `readonly zzTop?: {}` — supertypes with **no `kind` at all**, each with a `tsc`-checked assignability proof in the same file | exit 0 | **1 of 11 fails** each, naming the field. The gate one commit earlier passes **11 of 11** on both |
  | — | **negative result:** `zzMetadata?: { kind: "left" \| "right"; label: string }` — an ordinary childless wrapper | exit 0 | **11 of 11 pass**. An intermediate version of M14's fix rejected this, which is what identified that check as having an authored selector |
  | M15 | a second interface declaring an **existing** kind added to `AnyNode` (`ZzBlockLookAlike` with `zzhidden?: BlockNode`) | exit 0 | **1 of 11 fails**, `declared \ populated` = `['Block.zzhidden']`. `tsc` does **not** object: the `never` guard rejects unhandled discriminant *values*, and `"Block"` already has a case |
  | — | **negative result:** `type ZzBlockAlias = BlockNode` used in field position | exit 0 | produces **no** `foreignNodeTypes` row — an alias is the same type object, so the identity check does not punish an ordinary refactor. Recorded because a check built on type identity is one a maintainer will suspect of false positives first |

  The first three M6 fields each hide a `BlockNode`; the fourth holds `unknown` and hides nothing —
  it is there to show that *having a property* does not eliminate opacity, which is the case a
  "report object types with no properties" check would pass. It does **not** defeat the other
  proposal, "reject non-array index signatures", which catches it; what defeats that one is M6's
  `probeFn`, a call signature.

  M1 is the discrimination measurement: the **pre-#986 gate**, taken verbatim from saga tip
  `22ecfb4a` and run against the same mutated `ast.ts`, passes **9 of 9**. The defect is completely
  invisible to it. M10 and M13 carry the same measurement one round in each: the gate at the
  immediately preceding commit passes **11 of 11** against each of them. M5 and M6 are the two that
  justify the whole-set checks — the intersection hides a `BlockNode` the walk never reaches with
  both path assertions green, and M6's object-flagged containers do the same one category over. Of
  M6's four fields the first three hide a node; the fourth holds `unknown` and is there for the
  property-plus-index case.

  **Assertions with no firing mutant, named rather than covered by a blanket claim:**
  `unresolvedTypes`, `categories`, `projectCount` and `configFileName`. Each states a property of the
  walk that today's declarations cannot violate, so no mutation of `ast.ts` fires them; they are
  notifications for a future change, not verified detectors. `typeVisitCount`'s floor fires under M4,
  `leafTypeFlags` under M5, `opaqueObjectTypes` under M6 and `cyclicEdges` under M8.

  `kinds` **fires but does not isolate**, and a draft of this ADR wrongly listed it as unfired — which
  mattered, because this ADR stakes its headline on that assertion being the enforcement ADR-0024
  named nowhere, and a reader reaching a "nothing can fire it" sentence would conclude the
  enforcement is vacuous. Appending `"Ghost"` to `OL_NODE_KINDS` compiles clean (`tsc -b` exit 0) and
  fails **2 of 11**: the declaration-side `kinds` comparison and the corpus-side kind census, which
  is why it does not isolate. Only one direction of the agreement needs a test at all:
  `NodeKind = (typeof OL_NODE_KINDS)[number]` and `NodeBase.kind: NodeKind`, so an interface that
  extends `NodeBase` **cannot** declare a kind the array lacks — that direction is compiler-enforced
  for the shape every node uses today. (A union member that did not extend `NodeBase` could declare
  any `kind`; what stops that one is `childrenOf`'s `never` guard from ADR-0024, not `NodeKind`.) The
  direction ADR-0024 left to a test is a kind listed in `OL_NODE_KINDS` that no `AnyNode` member
  declares, and that is what the Ghost mutant fires.

  M3 is **not isolating**, and that is a property of the defect rather than a weakness of the
  assertion: a tree carrying a node-valued field the types do not declare cannot have that field
  returned by `childrenOf`, which is typed — so the child-list and `walk` comparisons necessarily
  fire too. M4 shows the same assertion firing without any corpus-facing assertion firing, which is
  what establishes it is not decorative.

- **The defect is unverified assertion, and it is symmetric in direction while asymmetric in cost.**
  This ADR's review produced false claims about the gate's own reach in **both directions at once**,
  and the list grew every round rather than converging, so it is enumerated rather than counted — a
  tally here would be one more number nothing re-derives, which is the defect this paragraph is
  about. `Binder` named as a merge point; the leaf-flag net credited with catching mapped types;
  "which is why nothing here has to special-case them"; "a node-shaped type outside `AnyNode` is
  inert"; and the `never` guard said to fire "the moment anything puts it in the union" were
  **over**-claims. `cyclicEdges` and `kinds` listed as having no firing mutant were **under**-claims.
  Each was written by an author who believed it, and each was settled in one build by someone who ran
  it instead. The saga's working assumption had been that the failure mode is optimism; it is not, it
  is a claim nothing re-derived, and understating is the same defect wearing modest clothes.
  The *cost* is not symmetric, though, which is why the two are worth distinguishing rather than
  merging. An over-claim leaves a reader trusting a check that does not exist. The `kinds`
  under-claim was worse than a missing caveat: this ADR stakes its headline on that assertion being
  the `OL_NODE_KINDS`/`AnyNode` enforcement ADR-0024 named nowhere, so a reader reaching "no mutation
  of `ast.ts` fires them" would have concluded the enforcement is **vacuous** and stopped relying on
  a check that works. An under-claim can retire a real guarantee.
  Three of the five were written in **repair mode**, and the sharpest is the `special-case` clause:
  the edit it accompanied was *correct* — a reviewer had rightly narrowed the scope claim from "every
  object type" to "the `object` category" — and the justification bolted onto that correct narrowing
  was false, and hid a real code defect from every subsequent reader for a round. Reviewing the
  change would have passed it; only reviewing the sentence catches it. **A justification is a claim,
  and it needs evidence even when the edit it accompanies is right.** The `Binder` error is the same
  shape one step milder: a new false statement entering the document in the act of removing an old
  one.

- The declaration walk is **not** a second hand-rolled parser. ADR-0025 rejected one on merit after a
  `#925`-era attempt mis-read `ComprehensionNode` — a union rather than an interface. This walk reads
  that union correctly, though not for the reason a draft of this ADR gave: TypeScript flattens it, so
  `MapFilterComprehensionNode` and `ReduceComprehensionNode` are reached as direct members of
  `AnyNode` and `ReduceComprehensionNode.initial` is derived from the top-level loop.
