---
name: ast-design
description: >-
  Conventions for the OpenLogo AST in @openlogo/parser — node kinds that mirror the grammar, source
  spans on every node, immutability, and a visitor. Use when adding or changing AST nodes. The spec
  is implementation-agnostic, so the AST is our contract; co-owned by language-designer + interpreter.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

The AST is the shared contract between parsing and everything downstream (runtime, LSP, docs). The
spec deliberately "does not define an interpreter," so we own the AST — but it MUST mirror the grammar
in [`spec/grammar.md`](../../../../spec/grammar.md) and carry the spans that diagnostics and highlighting
depend on.

## Rules

- **One node kind per grammar production.** If the grammar grows a form, the AST grows one node; if it
  doesn't, the AST doesn't. No "convenience" nodes with no grammar basis.
- **Every node carries a `source_span`** (start/end line+col). Diagnostics (`shared/diagnostics`) and
  highlighting reuse these spans — they are not optional.
- **Immutable + typed.** Nodes are readonly data; no evaluation logic on nodes (that lives in
  `@openlogo/runtime`). Export node types + a factory + a `visit`/`walk` from `parser/src/ast.ts`.
- **Preserve, don't normalize.** Keep Heritage spellings (`fd`, `to`, `make`) as the same node kind
  as their Core form but record the surface spelling, so tooling/docs can distinguish alias vs canonical.
- **Versioned with the grammar.** An AST change is a serialized, one-PR change reviewed by
  `@language-designer` + `@interpreter`; update the parser, the visitor, and fixtures together.

## Core node kinds (mirror `grammar.md`)

`Program`; literals `NumberLit`, `WordLit`, `ListLit`, `BooleanLit`; `VarRef` (`:name`); `Place`
(index/field/key chains like `:people.tom.age`); `Assign` (`=` and `set … to`); `Call` (fixed-arity
prefix) and `ParenCall` (parenthesized variadic); `Block`; control `If`, `While`, `Repeat`,
`Forever`, `ForIn`, `ForRange`; `Comprehension` (`map`/`filter`/`reduce` with an expression block);
`ProcedureDef` (`define … end`), `Return`, `Stop`, `Throw`. Data profile adds `DictLit`, `StructDef`,
field/key access nodes. (No lambda / first-class procedure nodes in v0.1.)

## Procedure

1. Confirm the grammar production and its reserved words with `@language-designer`.
2. Add the node type + factory + visitor case in `parser/src/ast.ts`; attach `source_span`.
3. Wire parsing in `reader.ts`/`grammar.ts`; expose nothing beyond `src/index.ts`.
4. Give `@interpreter` the node for evaluation and `@testing` a parse fixture (source → AST shape).
5. Notify `@documentation` if the surface syntax changed.

## Checklist
- [ ] Node maps 1:1 to a grammar production; span attached.
- [ ] Immutable; no eval logic on the node; visitor updated.
- [ ] Heritage spelling preserved as surface metadata, not a new semantic node.
- [ ] Parse fixtures added; change is one serialized PR with both owners' review.
