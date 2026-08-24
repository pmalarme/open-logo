# 24. AST traversal completeness is a compile-time property

- Status: Accepted
- Date: 2026-08-24
- Deciders: OpenLogo maintainer (@pmalarme) + `@interpreter`, on issue #925
- Related: [ADR-0006](0006-cross-cutting-contracts.md) (the AST is a cross-cutting contract)

## Context

`childrenOf` in `packages/parser/src/ast.ts` returns a node's direct children as a hand-written
per-kind `switch`. It is not one traversal among several — it is *the* traversal. `walk` is built
on it, and so is every AST-derived instrument in the repository: the runtime's
`registerDeclarations` (`packages/runtime/src/execute-internal.ts`), the `ol-undefined-var`, style,
and control-flow checkers, the highlighter's semantic tokens, and the studio's fold ranges.

The switch ended in a bare `default: return []`, so a node kind added without a case silently
became a leaf: declarations inside it were never registered, statements inside it never executed.

**Its incompleteness was invisible to the obvious test for it.** Any instrument that walks the tree
to derive a set of kinds, block slots, or reachable positions descends *through* `childrenOf`, so an
omitted kind never appears on either side of a comparison — the instrument and its subject share the
blind spot, and the missing coverage reads as "no such case exists". #839's derived block-slot
enumeration documented exactly this as the one assumption underneath it
(`packages/runtime/src/execute-declaration-slots.test.mjs`). The gap was repository-wide, and the
risk was never today's switch: it was the next node kind added with a body.

A test cannot close this. Whatever the test walks with, it walks with `childrenOf`.

## Decision

**`childrenOf` enumerates every `AnyNode` kind explicitly, and its `default` clause is typed
`never`.**

1. Every kind gets its own `case`, **including the genuinely childless ones** (`NumberLit`,
   `WordLit`, `BooleanLit`, `VarRef`, `Local`, `Stop`, `StructDef`). They return `[]` from their own
   case rather than falling through. This is load-bearing, not tidiness: a kind that falls through
   keeps the `default` clause inhabited, the `never` binding stops binding, and the guard becomes
   decorative.
2. `default` calls a helper whose parameter is `never`. A kind in the union without a case is
   therefore a `tsc` error that names the omitted type, and the helper **throws** if untyped
   JavaScript reaches it — a silent leaf is the precise failure mode this ADR exists to remove.

Per-kind traversal completeness is consequently a property the compiler checks, not a claim.

## What "derived from the AST" may and may not assume

This is the cross-cutting half of the decision, and it turns on a distinction that is easy to blur:
**completeness and reachability are different properties, and only the first is compiler-enforced.**

`childrenOf` now guarantees that every `AnyNode` kind, **when handed to it**, reports its children.
It does **not** guarantee that every kind is ever *reached*, because reachability depends on the
*holder's* case returning the field the node sits in. A new kind stored in a new field of an existing
kind is fully handled by `childrenOf` and still never reached. **The blind spot narrowed; it did not
close.**

So an instrument that derives a set by walking the AST may now state, as enforced:

- **Completeness.** Every `AnyNode` kind has a child list. Omitting a kind cannot compile.

It may **not** assume, and must keep stating as an assumption:

- **Reachability — that every node-valued *field* is a child edge.** Adding a node-typed field to an
  *existing* kind (say a `body` on `StructDefNode`) without extending that kind's case still compiles
  and is still invisible: the same defect class, one level down. This was established by experiment
  during the review gate, not inferred — the non-author logic reviewer added `readonly body?:
  BlockNode` to `StructDefNode`, left `childrenOf` untouched, and `npm run build` exited 0 with the
  `walk visits every core node kind, pre-order` test still green. The guard constrains **kinds, not
  fields**. Tracked by issue #960; #925 must not be read as having closed the whole class.
- **That `OL_NODE_KINDS` and the `AnyNode` union agree.** A kind added to `OL_NODE_KINDS` alone is
  inert (nothing can construct it as an `AnyNode`) and is caught by the existing
  "walk visits every core node kind" test — *test*-enforced, not compiler-enforced.

## Consequences

- Adding a node kind is deliberately a two-place change: the union and `childrenOf`. The build fails,
  naming the type, until both land.
- A childless kind must never be "simplified" back into `default`. Doing so silently disarms the
  guard for **every** kind, which is why each one carries its own case and the switch says so.
- Instruments may drop the "is `childrenOf` complete?" caveat. They must keep the reachability
  caveat: a kind with a case can still be unreachable, so "derived from the AST" still means
  "derived from what the AST traversal happens to reach".
- `childrenOf` is a partial function at the untyped boundary: it throws on an unrecognised `kind`
  instead of reporting no children. Every in-repository caller passes nodes obtained from `parse`,
  so this is unreachable in practice and loud if it ever is not.
