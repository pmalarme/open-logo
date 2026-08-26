# 25. The child-edge gate audits `childrenOf` from a source that does not use it

- Status: Accepted
- Date: 2026-08-25
- Deciders: OpenLogo maintainer (@pmalarme) + `@interpreter`, on issue #960
- Related: refines [ADR-0024](0024-ast-traversal-kind-dispatch-is-compiler-enforced.md)
  (kind dispatch is compiler-enforced)

## Context

[ADR-0024](0024-ast-traversal-kind-dispatch-is-compiler-enforced.md) closed one half of a defect and
said so precisely: `childrenOf`'s dispatch is exhaustive over discriminant *values*, and that buys
nothing about whether a case returns the *right* children. A node-valued field added to an
already-handled kind compiles clean, is silently absent from the child list, and is therefore never
reached — not by `walk`, nor by the runtime's `registerDeclarations`, the checkers, the highlighter's
semantic tokens, or the studio's fold ranges, because all of them descend through `childrenOf`.

That residual cannot be closed by a `never` guard, because TypeScript has no way to require that a
returned array mentions every node-valued field of a type. It also cannot be closed by any test that
traverses with `walk`: the instrument would share the traversal it is auditing, an omitted edge would
remove the same nodes from both sides of the comparison, and the result would read as "no such field
exists". That is the failure this whole family of issues exists to eliminate.

## Decision

**The gate audits the traversal by deriving each node's child edges from the node itself.**

`packages/parser/src/child-edges.test.mjs` parses every `*.logo` file under `tests/conformance/`,
`spec/examples/` and `stdlib/` — skipping those that do not parse cleanly, which are the corpus's
deliberate parse-error fixtures — and for each node derives, by **reflection over the node's own
object fields**, the child edges that node holds: descending through arrays and wrapper objects
(`DictEntryNode`, `PlaceSegment`, `IsTest`, `ProcedureParam`) and stopping at the first node, which is
the edge. It compares that against `childrenOf(node)` by object **identity and multiplicity**.

The two sides share `parse`, object identity and `OL_NODE_KINDS`. What they share nothing of is
child-edge enumeration and recursion logic, which is the property that makes the comparison mean
anything. `walk` is retained as the integration check, compared as an **ordered identity sequence of
visits per file** against reflection's own pre-order — not counts, which permit a traversal that
visited a different population the same number of times; not membership, which hides the
multiplicity an aliased edge lives in; and not a sorted multiset, which cannot distinguish the
pre-order `walk` documents from a post-order one.

**Identity and multiplicity, not membership; and order.** An earlier draft compared reachable *sets*
and was defeated repeatedly by the non-author reviewers, each defeat now failing:

- an **aliased** edge dropped from `childrenOf` while the node remained reachable by its other route
  (`ValueOfKey.key` aliased to `dictionary`) — set membership was unchanged, multiplicity was not;
- a **spurious** edge, a parent's list carrying its own grandchild, which added nothing to the
  reachable set because that node was already in it;
- a **reordered** child list, which no set comparison can see at all — reversing `If`'s children
  passed. `childrenOf` promises source order and `walk` is pre-order, so the order is observable to
  every consumer; it is now asserted against the parser's own spans, which is the one comparison that
  cannot be circular;
- a node **hidden from enumeration** — inside a `Map`, behind a symbol key, behind a non-enumerable
  property, behind a prototype getter on a class instance, parked on an array's non-index own key,
  sitting at an ordinary array index behind an own `Symbol.iterator` that yields nothing, held by
  an array *subclass* behind an inherited getter, parked under a `source_span` key that the
  enumeration excluded by name, carried on a **function**-valued field that the object test returns
  past, erased by a **self-erasing accessor** before the audit could record it, or installed on
  `Array.prototype` **itself** — invisible to reflection and therefore agreeing with a `childrenOf`
  that also omitted it;
- a **reordered, re-sequenced, or self-editing `walk`** — moving `visit(node)` after the recursion,
  reversing the sibling order, or removing a node from the tree while traversing it — which the
  child-list comparison cannot see at all, because every child list is
  still correct. Only `walk`'s own visit sequence carries it, and only if that sequence is compared
  in order.

The last is why reflection reads objects with `Reflect.ownKeys` and property descriptors rather than
`Object.entries`, records the descriptor kind of every field it meets and compares the whole set (a
getter may return a fresh object per call, making identity meaningless, so a child-bearing field is
never read through one), compares the shape of every object it descends
into as a whole set, and reads arrays by own key rather than by iteration. **Array iteration is not a
reliable enumeration**: `for…of` goes through `Symbol.iterator`, which a subclass or an own property
can override to report contents that are not there, and it reads each index through its getter. So
arrays are descended by descriptor, their prototype is checked against `Array.prototype` exactly, and
every non-index own key is compared against `["length"]` — where "index" means a *canonical* index,
since `"4294967295"`, `"00"`, `"1e2"` and `"-0"` are ordinary string properties that iteration never
visits. An instrument that silently treats what it cannot read as empty is the defect it exists to
detect, reproduced one level in; it took several rounds and two reviewers to remove it from every path
rather than only the obvious one.

**No key is excluded by name.** An earlier version skipped `source_span`, on the reasoning that a
node's span is metadata rather than a child edge. That is true of a *node* and false of every wrapper
object reflection descends through, so the name became an unconditionally ignored hiding place: a
reviewer declared a populated, node-valued `Program.mutantHidden.source_span` and passed the entire
gate with the node unreachable by both `childrenOf` and `walk`. Nothing needs excluding — a
`SourceSpan` holds a `document` string and two `Position` tuples of numbers, so descending into one
finds no node and contributes no field path. **A name-based exclusion is a blind spot with a name,
and it does not stop being one because the name is usually metadata.**

The accessor claim used to be narrow because identifying a shape read `kind`, `source_span` and
`Symbol.toStringTag`. It no longer needs to be: nothing in the snapshot phase reads a property at
all, so no getter runs there — a child-bearing field is never read through one, and neither is the
classification that decides what a value *is*.

Descriptor kinds are recorded for **every** field and compared as a whole set, rather than collecting
just the accessors. Collecting only the offenders is a projection that runs solely on a tree already
known to be broken — dead on a green tree, which is the defect this gate exists to detect, one level
in. The cost is that the failure names the kind rather than the offending path; `shapes` and
`arrayKeys` already make that trade.

**The gate carries three self-checks, because an instrument that cannot see its own assumptions is
the same defect one level up.**

1. **Its node-detection oracle is a named constant**, not a condition inside a helper. Everything the
   gate concludes rests on "a value is a node when its `kind` is in `OL_NODE_KINDS`", and ADR-0024
   records that `OL_NODE_KINDS` agreeing with the `AnyNode` union is *test*-enforced, not
   compiler-enforced. The gate states that dependency rather than assuming it.
2. **A kinded, spanned shape whose `kind` is not a node kind fails, rather than being skipped.** The
   known exceptions — the `field` and `index` `PlaceSegment` discriminants — are compared as a whole
   set, so a newcomer breaks the equality instead of slipping past a recogniser. A silent skip is how
   the condition becomes reachable without anyone noticing.
3. **The corpus must populate exactly the declared node-valued field paths**, compared both ways.
   Without this, a green run over a corpus that never exercises a field is indistinguishable from a
   green run over a correct implementation — the "green signal certifying less than it appears to"
   that #924 measured with a constant `document` field and #932 with a mutated `stamp` row.

Paths are recorded as the route from the owning node down to the node it leads to, so only routes
ending at a node appear: `ProcedureDef.params[].defaultValue` is a path and `ProcedureDef.params` is
not. A corpus full of parameterless procedures leaves the parameter list populated with metadata and
contributes no path at all, which is exactly the distinction the list has to make.

## What this enforces, and what it does not

**Enforced.** For every node the parseable corpus produces, its child list is exactly the set of
edges the node itself holds — same objects, same multiplicity — so a missing edge, an aliased edge
dropped while the node stays otherwise reachable, and a spurious edge all fail. Those children are
**in source order**, asserted against the spans the parser recorded rather than against reflection's
field order, because `walk` is pre-order and every consumer inherits that order. `walk` descends
every edge those lists declare, **in the order it promises**: its visit sequence is compared element
by element against reflection's own pre-order, so a post-order walker and a reversed sibling
traversal both fail, and comparing those sequences as sorted multisets — which an earlier version
did — cannot see either, for the same reason sorted child lists could not see a reversed child list.
Reflection also runs *before* `walk`, so a `walk` that edits the tree as it goes cannot be observed
only after the edit. No kinded, spanned shape appears that the oracle does not know. Reflection reads
every own key of the shapes it descends, with no key excluded by name — objects and arrays alike,
through `Reflect.ownKeys` and descriptors snapshotted before any property is read, with an array's
non-index own keys reported and its prototype checked exactly, every field's descriptor kind
recorded, the `typeof` of every value recorded, and the two canonical prototypes themselves checked
for nodes. The corpus exercises every declared path, instantiates every node kind, and every root
clears a per-root floor.

**Not enforced — this is an audit of the trees the corpus produces, not a proof about the type
declarations.** A node-valued field that no `.logo` file populates is invisible to reflection.
Self-check 3 is what keeps that hole from widening silently: adding a walkable field means declaring
it in the path list, and the gate then fails until a fixture exercises it *and* `childrenOf` returns
it — the three-place change described under Consequences. The surviving gap is a field added with
**no** declaration and **no** fixture — the same shape, and the same accepted cost, as
[ADR-0021](0021-built-in-names-list-and-ci-gate.md)'s two-file rule for primitives.

**What the reflection side enforces.** It reads objects **and arrays** through
`Reflect.ownKeys` and `Object.getOwnPropertyDescriptor`, checking both prototypes exactly and
excluding no key by name; it snapshots the **whole reachable graph** before anything else reads it,
**reading no property of any value** while it does so — `kind` comes from its own data descriptor,
`source_span` from key presence, and shape from `Array.isArray` and `Object.getPrototypeOf`;
it records the `typeof` of every value it meets; and it compares the intrinsic prototypes against a
**pristine realm**'s own-key sets, **by symbol identity rather than by description**. So a symbol-keyed
field, a non-enumerable field, a class instance, a null-prototype object, an
`Object.create(proto)` result, an array expando, a non-canonical index such as `"4294967295"`, an
array subclass, a node parked under a `source_span` key, an own `Symbol.iterator` that lies about
an array's contents, a **function** carrying a node, a **self-erasing accessor** that deletes its
sibling when read, an **inherited** `kind` getter that `fieldsOf` cannot see, a `walk` or an
ancestor's `childrenOf` that **edits the tree mid-audit**, a
`Symbol.toStringTag` **getter** that erases a descendant before the snapshot reaches it, and a node
installed on an intrinsic prototype — as a data property, behind a getter, inside a wrapper
object, or under a symbol whose *description* imitates a well-known one — are all
either read correctly or rejected.

**Not enforced — the residuals, named with their mutants.** Ten rounds of adversarial review by two
non-author reviewers produced a defeat every round, and the sequence is the finding: each fix closed
the container or the read it was shown, and the next round found the adjacent one. Rounds 7–10 stopped
adding cases and started adding rules — record the `typeof` of every value; snapshot the whole graph
before reading it; compare intrinsics against a pristine realm; read no property at all. **The
rules were strictly better and still did not terminate**, because each is quantified over a set that
must itself be enumerated correctly, and round 9 broke the enumeration twice: once on symbol
identity, once on own-versus-inherited.

So the boundary is stated, not claimed closed:

- **A hostile `Proxy`** whose `ownKeys` trap lies is not detectable from userland. A limit of
  reflection itself.
- **An intrinsic the instrument calls, replaced rather than added.** This gate runs in the **same
  realm** as its subject, so every builtin it uses is one the subject could have swapped. Measured:
  replacing `Object.prototype.toString` — which the shape namer called during the snapshot phase —
  erased **77 real AST nodes** with the gate green (a past mutant measurement, not a claim about the
  current tree). That route is closed by deleting the read; the
  class is not, because the pristine-realm check compares own-key sets **once, at the end of the
  run** — so it sees an intrinsic that is still polluted when it looks, and not one **swapped**, nor
  one added during the audit and deleted again before it looks. Capturing intrinsics at module load
  does not help, because the subject is imported first. Both halves of that sentence are measured: a
  self-removing inherited getter passes the end-of-run check in every run, and the gate catches it
  only through the no-read rule.
- **The same realm, reached through the *subject* rather than the instrument.** The no-read
  discipline hardens this gate; nothing hardens `childrenOf`. It discriminates with
  `"kind" in node.binder` in two places, and `in` is a **HasProperty** check — it walks the prototype
  chain but invokes no getter, so it is invisible to a rule about *reads*. Polluting
  `Object.prototype.kind` with a plain data property flips both branches and makes `childrenOf`
  return a metadata `SpannedName` as a child.

  This is **detected today, incidentally rather than by design**, and the distinction is worth
  recording: reflection now classifies by *own data* `kind` while `childrenOf` classifies by `in`, so
  under pollution the two **diverge** and the mismatch fires. Before the own-descriptor fix both
  consulted the prototype chain, would have **agreed**, and would have mirrored the corruption
  silently. A gate that catches something because two implementations disagree is not the same as one
  that catches it because a rule forbids it, and the difference matters the day the subject changes.

**Both require a deliberately hostile construction.** Against the threat this gate exists for — a
developer adds a node-valued field and forgets `childrenOf` — it is complete: ten rounds of attack
found **zero** false positives and no defect reachable without adversarial intent. Against a hostile
subject it is not, and by the measurement above it cannot be.

That is the argument for [#986](https://github.com/pmalarme/open-logo/issues/986)'s
declaration-derived checker, and it is now evidence rather than preference: a type declaration is a
**finite closed set** read in a **different realm** from the subject, so it terminates where this
cannot. An honest limit in an immutable document outlives a claim that ages badly.

Two notes on where that boundary sits.

A node reachable only through an inherited member that is not a field of any node type — the
reviewer's example was `Function.prototype`, reached via `node.toString.someProperty` — is out of
the *declared-field* model: the subject of #960 is a declared node-valued field that `childrenOf`
forgot, and `node.toString` is not one. But `Function.prototype` is audited
anyway, because the pristine-realm comparison costs one more entry in a list, so the boundary no
longer has to carry that case. An earlier draft justified excluding it as "enumeration with no
termination condition", which the reviewer correctly called inaccurate — a visited-identity set
terminates over the finite intrinsic graph. The honest reason was always scope, not tractability,
and an argument that overstates its own necessity is the weaker one even when its conclusion
stands.

The same-realm limit is the same shape as the `Proxy` one: **an instrument cannot bootstrap trust in
the realm it is running inside.** Recording the boundary is the point. It is drawn where the threat
model is, not where the last mutant happened to land.

Treat both residuals as the current state of an argument the reviewers won every round, not as a
settled result.
**Every previous
draft of this paragraph asserted the container check admitted nothing it could not enumerate, and a
reviewer falsified each one in a single build** — first a class instance holding a node behind a
prototype getter, then a node on an array's non-index own key, then an array *subclass* holding a
node behind an inherited getter (the cross-product of the first two, still open because each fix had
hardened one container against the attack aimed at it), then a node parked under the one key the
enumeration excluded by name, and then — after that key exclusion was deleted — a node on a
**function**-valued field, which the `typeof value === "object"` test returns past as a childless
leaf, plus a **self-erasing accessor** that deleted its node-bearing sibling the moment the audit
read `kind`, plus a node installed on `Array.prototype` **itself**, where exact prototype identity
still matched because the identity was not what changed — and then, once that was audited for data
properties, the same node behind a **getter** on `Object.prototype`, whose value is not in the
descriptor at all — and finally, in round 9, two breaks of the *enumeration itself* rather than of
the rules: a symbol whose **description** imitated `Symbol.iterator`, which a stringified key
comparison could not tell from the real one, and an **inherited** `kind` getter, which `fieldsOf`
cannot see because it enumerates own keys. The count of those drafts is deliberately
not written down: it was
wrong within one review round every time it was, which is the same unenforced-assertion rule that
kept derived counts out of ADR-0024. The pattern they share is worth more than the tally — **a
per-container mechanism produces a per-container blind spot** — which is why the enforcement
paragraph above now names one mechanism applied to every shape rather than one mechanism per shape.

The last three sharpen that pattern into something more useful than "add another case", and the
gate is built the second way in each instance:

- the fix for a function container is **not** a `typeof value === "function"` branch. That is a
  recording arm no green tree executes — dead code, which this file rejects everywhere else — and it
  closes exactly one container while leaving the next unnamed one open. The `typeof` of **every**
  value is recorded instead and compared as a whole set, so a container class nobody anticipated
  fails rather than being skipped.
- the fix for a self-erasing accessor is an **ordering** rule, not a new check: the whole reachable
  graph is snapshotted before anything else reads it. Every read is a chance for the subject to edit
  the evidence, and snapshotting one node before reading *it* proved insufficient — an ancestor's
  `childrenOf`, or a child's `source_span` getter feeding the handle function, could erase a
  **descendant's** field while the audit was still walking down to it. Reflection is now a complete
  phase, and `childrenOf`, the span helpers and `walk` all run after it.
- the fix for a polluted prototype is to check the intrinsic prototypes against **a pristine realm**,
  not to recognise the shape of the last attack. Three successive versions were defeated in turn — a
  node parked on `Array.prototype` as a data property, then the same node behind a **getter** whose
  value is not in the descriptor, then a node inside a plain **wrapper object** that is neither —
  and each fix recognised only the shape it had been shown. What all three share is that they *add
  an own key*, so `node:vm` supplies a fresh realm and the comparison is against its key set. The
  baseline cannot drift, because the same Node computes both sides, and it needs no hand-maintained
  list of what a prototype is supposed to contain. Asserting that a value has exactly
  `Array.prototype` says nothing about what `Array.prototype` contains; the chain above is pinned so
  the check is exhaustive rather than merely deep.
- the fix for a tag getter is **deletion**, not deferral. `Object.prototype.toString.call` consults
  `Symbol.toStringTag`, so naming a shape with it *invoked an inherited getter* — user code, during
  the phase that claims to run none, which a reviewer used to delete a populated descendant field
  before the snapshot reached its owner. The tag carried no detection power the prototype comparison
  did not already have, so it is gone rather than moved to a later phase. **A read you do not need
  is a read you cannot be attacked through.**

A declaration-derived check would close it outright, and is **deferred on cost, not availability**.
TypeScript 7 does ship a usable API: `typescript/unstable/sync` exports `Project`, `Program`,
`Checker` and `Symbol`, and `typescript/unstable/ast` the node helpers. A probe during #960's review
used it against `packages/parser/tsconfig.json` to derive all the node-valued field paths from
`ast.ts`'s declarations alone, with no unresolved type references — so the instrument is buildable
without hand-rolling anything. It is deferred because it takes a dependency on `unstable/*` entry
points the repository does not otherwise use, and because a declaration-derived list would still rest
on the same `OL_NODE_KINDS`/`AnyNode` agreement this gate's oracle already states — it narrows the
gap rather than removing the assumption underneath it. It is tracked as issue #986, named here
because an ADR is immutable and a deferral nobody can find is indistinguishable from a decision not
to do it; ADR-0024's residual was actionable precisely because it named #960 in its text.

A *hand-rolled* parser remains rejected on merit: one was attempted during #925's review and mis-read
`ComprehensionNode`, a union rather than an interface, which makes it an unaudited instrument of
exactly the kind this ADR is about.

An earlier draft of this ADR asserted that the shim "exposes no compiler API". That was false, and it
came from checking for `node_modules/typescript/lib/typescript.js` — the pre-7 layout — rather than
reading the package's export map. The reviewer falsified it by building the rejected instrument. It
is recorded here because an ADR is immutable and is reasoned from long after it is written: the
reason on record has to be the true one.

## Consequences

- Adding a node-valued field to an existing kind is a three-place change: the type, `childrenOf`, and
  the declared path list — and a fixture must exercise it. Once the corpus produces the field, each
  missing piece fails the gate with the field path named. A field that is declared nowhere *and*
  exercised nowhere is the accepted residual above, not something this bullet claims to catch.
- Aliasing is legitimate in the AST and stays legitimate: a node reachable by two fields must appear
  twice in its parent's child list, and `walk` visits it twice. The gate enforces that as a real
  constraint rather than an accident of how it compares — and a draft of it briefly *rejected* the
  legitimate case, by comparing reflection's visit count against a distinct-identity set. A gate that
  fails on valid input is worse than one that misses an invalid one; both counts are visits now.
  **The corpus cannot supply this case** — the parser makes a fresh object per source position, so
  no natural alias occurs — which is why the same-object exemption in the tie check carries its own
  regression test rather than relying on the corpus. Until a reviewer asked, that promise was
  asserted here and enforced nowhere.
- The gate sits in the default test run, so it is enforced by CI without a separate script.
- **Every assertion here is mutation-verified, not coverage-verified.** A recording path cannot
  execute on a green tree, so 100% coverage of the gate file says nothing about whether its findings
  work. Most assertions are discharged by at least one mutant that fires them **in isolation**, and
  one is not — named here rather than left under a blanket claim, because an overstated
  verification claim is the same defect as an unenforced count:
  - `mismatchedChildLists` is **dominated** by the `walk` comparison under every natural mutant,
    since `walk` is literally `visit(node); for (const child of childrenOf(node))` — so a child-list
    defect necessarily perturbs the visit sequence too. It isolates only under a *compensating*
    mutant, where a second traversal cancels the first. It stays because it is the only assertion
    that names the offending **dotted field path**, and because the compensating world is the real
    one for `registerDeclarations`, the checkers and the highlighter, which call `childrenOf`
    directly rather than through `walk`.

  A previous draft of this bullet also listed `tiedStartRows` as having no isolating mutant. That was
  **false, and false in the understating direction** — a reviewer produced one in a single build
  (giving a `While` body its condition's start position: the tie assertion fires alone, the
  source-order assertion passes). The reason is written three lines from the assertion itself:
  `Array.prototype.sort` is stable, so a tied pair keeps its original order and *cannot* trip the
  order comparison. Understating what a gate proves is a smaller error than overstating it, and it
  is the same error — a claim about the tree that nothing re-derived.

  The rest each isolate: a node-valued
  field added to an existing kind with `childrenOf` untouched (`tsc` exits 0, which is the whole
  point); an aliased edge dropped while the node stays reachable by its other route; a spurious
  grandchild; a reversed child list; a node hidden behind a `Map`, a symbol key, a prototype getter
  on a class instance, an array expando, a non-canonical index such as `"4294967295"`, an array
  subclass holding a node behind an inherited getter, an accessor on a valid index, a node parked
  under a `source_span` key, a node on a function-valued field, a self-erasing accessor, a
  `Symbol.toStringTag` getter that erases a descendant, a node installed on an intrinsic prototype
  as a data property, behind a getter, or inside a wrapper object, or an own `Symbol.iterator`
  that yields nothing; a kinded, spanned shape with an unknown `kind`; an accessor property on a
  node; a `walk` made post-order; a `walk` with its sibling order reversed; a `walk` that removes a
  node as it goes; an ancestor's `childrenOf` that erases a descendant's field;
  a declared path no fixture populates; a renamed corpus root; a root that contributes too few
  files; and a node kind no fixture instantiates. A **correct** alias is equally a regression case:
  it must pass, and it now has its own test rather than a promise.
- Instruments that derive from the AST may now state that a *populated* field is reached, in the
  order `childrenOf` declares. They still may not assume anything about a field no fixture populates.
- The declared path list carries no count. It is a list, and its length is re-derivable from the
  tree, so a literal would be an unenforced assertion of exactly the kind this saga has been removing.
