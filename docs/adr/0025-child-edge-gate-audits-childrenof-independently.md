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

The accessor claim is deliberately narrow: identifying a shape at all reads `kind`, `source_span` and
`Symbol.toStringTag`, so this does not promise that no getter runs — only that a child-bearing field,
index or named, is never read through one.

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

**Not enforced — a hostile `Proxy`.** Reflection reads objects **and arrays** through
`Reflect.ownKeys` and `Object.getOwnPropertyDescriptor`, checking both prototypes exactly and
excluding no key by name; it snapshots those descriptors **before** reading any property, including
`kind`; it records the `typeof` of every value it meets; and it checks that the two canonical
prototypes hold no node themselves. So a symbol-keyed field, a non-enumerable field, a class
instance, a null-prototype object, an
`Object.create(proto)` result, an array expando, a non-canonical index such as `"4294967295"`, an
array subclass, a node parked under a `source_span` key, an own `Symbol.iterator` that lies about
an array's contents, a **function** carrying a node, a **self-erasing accessor** that deletes its
sibling when read, and a node installed on `Array.prototype` **itself** are all either read
correctly or rejected. A `Proxy` whose `ownKeys` trap lies is not detectable from userland and would
still hide a node. That is a limit of reflection itself rather
than of this implementation, and it is recorded rather than papered over.

That last sentence is the only claim here stated as a limit, and it is deliberate — but treat it as
the current state of an argument the reviewers have won every round so far, not as a settled result.
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
still matched because the identity was not what changed. The count of those drafts is deliberately
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
- the fix for a self-erasing accessor is an **ordering** rule, not a new check: descriptors are
  snapshotted before any property is read. Every read is a chance for the subject to edit the
  evidence. The same rule applies one level up — reflection now runs **before** `walk`, because a
  `walk` that removes a node as it goes was otherwise observed only after the removal.
- the fix for a polluted prototype is to audit **the prototypes themselves**. Asserting that a value
  has exactly `Array.prototype` says nothing about what `Array.prototype` contains, and the chain
  above those two is pinned so the check is exhaustive rather than merely two-deep.

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
- The gate sits in the default test run, so it is enforced by CI without a separate script.
- **Every assertion here is mutation-verified, not coverage-verified.** A recording path cannot
  execute on a green tree, so 100% coverage of the gate file says nothing about whether its findings
  work. Each assertion is discharged by at least one mutant that fires in isolation: a node-valued
  field added to an existing kind with `childrenOf` untouched (`tsc` exits 0, which is the whole
  point); an aliased edge dropped while the node stays reachable by its other route; a spurious
  grandchild; a reversed child list; a node hidden behind a `Map`, a symbol key, a prototype getter
  on a class instance, an array expando, a non-canonical index such as `"4294967295"`, an array
  subclass holding a node behind an inherited getter, an accessor on a valid index, a node parked
  under a `source_span` key, a node on a function-valued field, a self-erasing accessor, a node
  installed on `Array.prototype`, or an own `Symbol.iterator`
  that yields nothing; a kinded, spanned shape with an unknown `kind`; an accessor property on a
  node; a `walk` made post-order; a `walk` with its sibling order reversed; a `walk` that removes a
  node as it goes;
  a declared path no fixture populates; a renamed corpus root; a root that contributes too few
  files; and a node kind no fixture instantiates. A **correct** alias is equally a regression case:
  it must pass, and a draft that rejected it is recorded above.
- Instruments that derive from the AST may now state that a *populated* field is reached, in the
  order `childrenOf` declares. They still may not assume anything about a field no fixture populates.
- The declared path list carries no count. It is a list, and its length is re-derivable from the
  tree, so a literal would be an unenforced assertion of exactly the kind this saga has been removing.
