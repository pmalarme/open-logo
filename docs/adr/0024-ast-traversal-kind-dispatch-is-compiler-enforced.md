# 24. AST traversal's kind dispatch is compiler-enforced

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
enumeration documented exactly this as the assumption underneath it
(`packages/runtime/src/execute-declaration-slots.test.mjs`). The gap was repository-wide, and the
risk was never today's switch: it was the next node kind added with a body.

**A test that traverses through `childrenOf` cannot close this** — whatever it walks with, it walks
with the switch it is auditing. A test derived from an *independent* source can (reflection over
each node's own object fields drives its own recursion, so it inherits nothing from the subject);
that is the direction issue #960 takes for the half this ADR does not close.

## Decision

**Every switch in `childrenOf` enumerates its whole union and closes on `never`.**

There are three: the node-kind switch, the `IsTest` form switch, and the `PlaceSegment` kind switch
(shared by `Place` and `PostfixExpression` through one `segmentChildren` helper so the two cannot
drift apart).

1. Every member gets its own `case`, **including the ones with no children** — the seven childless
   node kinds (`NumberLit`, `WordLit`, `BooleanLit`, `VarRef`, `Local`, `Stop`, `StructDef`), the
   `empty` `IsTest` form, and the `field` segment kind. This is load-bearing, not tidiness: a member
   that falls through keeps the `default` clause inhabited, the `never` stops binding, and the guard
   becomes decorative.
2. Each `default` calls `unhandledChildCase`, whose first parameter is `never`. A member added to
   any of the three unions without a case is therefore a `tsc` error that names the omitted type,
   and the helper **throws** if untyped JavaScript reaches it — a silently childless node is the
   precise failure mode this ADR exists to remove.

## What this enforces, and what it does not

The distinction is narrow and easy to overstate, so it is stated exactly.

**Enforced by the compiler — exhaustive *dispatch*.** Every `AnyNode` kind, every `IsTest` form, and
every `PlaceSegment` kind selects an explicit case. No value of those unions can reach a fallback,
and no new member can be added without the build failing and naming it.

**Not enforced — that a case returns the *right* children.** Nothing checks that a case returns
every node-valued field of its kind. Two experiments during the review gate, run by the two
non-author reviewers, establish this rather than assume it:

- adding `readonly body?: BlockNode` to `StructDefNode` and leaving `case "StructDef"` alone
  compiles clean, and the `walk visits every core node kind, pre-order` test stays green;
- a variant that *reuses* an existing discriminant — `kind: "Comprehension"` with one extra
  `ExpressionNode` — likewise compiles clean while `childrenOf` silently omits that child.

**Reachability therefore is not guaranteed.** A node is reached only if its *holder's* case returns
the field it sits in, so a child edge that nobody adds by hand is still invisible to `walk`, to the
runtime's declaration registration, and to every checker — the same defect one level down. It is
tracked by issue #960. **The blind spot narrowed; it did not close.** Issue #925 must not be read as
having closed the whole class.

**Not enforced — that `OL_NODE_KINDS` and the `AnyNode` union agree.** A kind added to
`OL_NODE_KINDS` alone is inert (nothing can construct it as an `AnyNode`) and is caught by the
existing "walk visits every core node kind" test — *test*-enforced, not compiler-enforced.

## Consequences

- Adding a node kind is deliberately a two-place change: the union and `childrenOf`. The build fails,
  naming the type, until both land. The same now holds for an `IsTest` form and a `PlaceSegment` kind.
- A member with no children must never be "simplified" back into `default`. Doing so silently
  disarms the guard for **every** member of that union, which is why each one carries its own case
  and the switch says so.
- Instruments may drop the "does `childrenOf` have a case for this kind?" caveat. They must keep the
  caveat that a child *edge* may be missing, so "derived from the AST" still means "derived from
  what the traversal happens to reach".
- `childrenOf` is a partial function at the untyped boundary: it throws on an unrecognised
  discriminant instead of reporting no children. Production callers pass well-typed `AnyNode` values,
  from `parse` or the `ast` factory; malformed untyped input fails loudly rather than losing a
  subtree in silence.
