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
anything. `walk` is retained as an integration check: the per-node comparison proves each child list
is right, and `walk` proves the traversal built on it actually descends them.

**Identity and multiplicity, not membership; and order.** An earlier draft compared reachable *sets*
and was defeated four ways by the non-author reviewers, each of which now fails:

- an **aliased** edge dropped from `childrenOf` while the node remained reachable by its other route
  (`ValueOfKey.key` aliased to `dictionary`) — set membership was unchanged, multiplicity was not;
- a **spurious** edge, a parent's list carrying its own grandchild, which added nothing to the
  reachable set because that node was already in it;
- a **reordered** child list, which no set comparison can see at all — reversing `If`'s children
  passed. `childrenOf` promises source order and `walk` is pre-order, so the order is observable to
  every consumer; it is now asserted against the parser's own spans, which is the one comparison that
  cannot be circular;
- a node **hidden from enumeration** — inside a `Map`, behind a symbol key, behind a non-enumerable
  property, behind a prototype getter on a class instance, parked on an array's non-index own key, or
  sitting at an ordinary array index behind an own `Symbol.iterator` that yields nothing — invisible
  to reflection and therefore agreeing with a `childrenOf` that also omitted it.

The last is why reflection reads objects with `Reflect.ownKeys` and property descriptors rather than
`Object.entries`, reports rather than reads an accessor on a child-bearing field (a getter may return
a fresh object per call, making identity meaningless), compares the shape of every object it descends
into as a whole set, and compares every non-index own key it finds on an array against `["length"]`.
**`for…of` reads an array's indices and nothing else**, so the array branch had to be converted too —
it was the one enumeration path left on the old mechanism, and a node parked there was invisible
exactly as a symbol-keyed field had been. An instrument that silently treats what it cannot read as
empty is the defect it exists to detect, reproduced one level in; it took two rounds and two
reviewers to remove it from every path rather than only the obvious one.

The accessor claim is deliberately narrow: identifying a shape at all reads `kind`, `source_span` and
`Symbol.toStringTag`, so this does not promise that no getter runs — only that a child-bearing field
is never read through one.

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
every edge those lists declare, and reaches the same node population reflection does. No kinded,
spanned shape appears that the oracle does not know. Reflection reads every own key of the shapes it
descends — objects through `Reflect.ownKeys` and descriptors, arrays by index with their non-index
own keys reported. The corpus exercises every declared path, instantiates every node kind, and every
root clears a per-root floor.

**Not enforced — this is an audit of the trees the corpus produces, not a proof about the type
declarations.** A node-valued field that no `.logo` file populates is invisible to reflection.
Self-check 3 is what keeps that hole from widening silently: the declared path list is a deliberate
two-place change, so adding a walkable field means declaring it, and the gate then fails until a
fixture exercises it *and* `childrenOf` returns it. The surviving gap is a field added with **no**
declaration and **no** fixture — the same shape, and the same accepted cost, as
[ADR-0021](0021-built-in-names-list-and-ci-gate.md)'s two-file rule for primitives.

**Not enforced — a hostile `Proxy`.** Reflection reads objects through `Reflect.ownKeys` and
`Object.getOwnPropertyDescriptor`, and arrays by index with their non-index own keys reported, so a
symbol-keyed field, a non-enumerable field, a class instance, a null-prototype object, an
`Object.create(proto)` result, an array expando and an own `Symbol.iterator` that lies about an
array's contents are all either read correctly or rejected. A `Proxy` whose `ownKeys` trap lies is
not detectable from userland and would still hide a node. That is a limit of reflection itself rather
than of this implementation, and it is recorded rather than papered over — two earlier drafts of this
ADR claimed the container check admitted nothing it could not enumerate, and the reviewers falsified
each in one build: first with a class instance holding a node behind a prototype getter, then with a
node parked on an array's non-index own key, which `Reflect.ownKeys` reads perfectly well and this
gate was simply not asking for.

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
  on a class instance, an array expando key, or an own `Symbol.iterator` that yields nothing; a
  kinded, spanned shape with an unknown `kind`; an accessor property on a node; a declared path no
  fixture populates; a renamed corpus root; a root that contributes too few files; and a node kind no
  fixture instantiates.
- Instruments that derive from the AST may now state that a *populated* field is reached, in the
  order `childrenOf` declares. They still may not assume anything about a field no fixture populates.
- The declared path list carries no count. It is a list, and its length is re-derivable from the
  tree, so a literal would be an unenforced assertion of exactly the kind this saga has been removing.
