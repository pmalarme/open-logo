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

**The gate audits the traversal by walking the corpus twice, from two sources that share nothing.**

`packages/parser/src/child-edges.test.mjs` parses every `.logo` file in the repository and traverses
each tree with `walk` (which descends through `childrenOf`) and, independently, by **reflection over
each node's own object fields**, descending through arrays and wrapper objects (`DictEntryNode`,
`PlaceSegment`, `IsTest`, `ProcedureParam`) and stopping at the first node — which is the child edge
itself. Reflection drives its own recursion, so it inherits nothing from the thing it audits.

Two independent traversals of the same trees must reach the same nodes. A missing edge makes the
reflective set a strict superset of the walked set, and the edge that broke is named by its dotted
path. Only the topmost break is reported: a child whose parent was itself unreached is a consequence,
not a second finding.

**The gate carries three assertions about itself, because an instrument that cannot see its own
assumptions is the same defect one level up.**

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

Paths are recorded through wrappers, so `ProcedureDef.params[].defaultValue` is tracked separately
from `ProcedureDef.params`: a corpus full of parameterless procedures exercises the second and says
nothing about the first.

## What this enforces, and what it does not

**Enforced.** Every node-valued field that the corpus actually produces is a child edge `walk`
descends; no child is returned that the node does not hold; no unrecognised kinded shape appears; and
the corpus exercises every declared path.

**Not enforced — this is an audit of the trees the corpus produces, not a proof about the type
declarations.** A node-valued field that no `.logo` file populates is invisible to reflection.
Assertion 3 is what keeps that hole from widening silently: the declared path list is a deliberate
two-place change, so adding a walkable field means declaring it, and the gate then fails until a
fixture exercises it *and* `childrenOf` returns it. The surviving gap is a field added with **no**
declaration and **no** fixture — the same shape, and the same accepted cost, as
[ADR-0021](0021-built-in-names-list-and-ci-gate.md)'s two-file rule for primitives.

A declaration-derived check would close it outright, and was rejected on availability rather than
merit: the repository's `typescript` is the native shim, which exposes no compiler API, so reading
the interface declarations would mean hand-rolling a TypeScript parser. One was attempted during
#925's review and mis-read `ComprehensionNode`, a union rather than an interface — a hand-rolled
parser is itself an unaudited instrument, which is what this ADR is about.

## Consequences

- Adding a node-valued field to an existing kind is a three-place change: the type, `childrenOf`, and
  the declared path list — and a fixture must exercise it. Each missing piece fails the gate with the
  path named.
- The gate sits in the default test run, so it is enforced by CI without a separate script.
- Instruments that derive from the AST may now state that a *populated* field is reached. They still
  may not assume anything about a field no fixture populates.
- The declared path list carries no count. It is a list, and its length is re-derivable from the
  tree, so a literal would be an unenforced assertion of exactly the kind this saga has been removing.
