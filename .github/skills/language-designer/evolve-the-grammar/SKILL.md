---
name: evolve-the-grammar
description: >-
  How @language-designer changes the EBNF grammar, keywords, and reserved words in @openlogo/parser
  safely — grounded in spec/grammar.md, keeping profiles + backward compatibility intact and the
  highlighter in lockstep. Use for any syntax, keyword, or reserved-word change.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

The grammar is a normative contract. Changing it ripples into the AST, the highlighter, the linter,
docs, and every fixture — so grammar changes are deliberate, serialized, and always paired with their
tooling updates.

## Procedure

1. **Start from `spec/grammar.md`** (and `commands.md` for signatures). Keep the OpenLogo style: lowercase
   keywords, light punctuation, no commas, `[ … ]` blocks, `:name` vars, `define … end` — no lambdas or
   first-class procedures in v0.1.
2. **Place it in the right profile.** Core stays minimal; alternate spellings are **Heritage**, not new
   Core syntax. Confirm the DAG placement with `@product-owner`.
3. **Update the EBNF + reserved-word registry** together; a new keyword is reserved (case-insensitive)
   and flows from the single C19 list shared with the highlighter and linter.
4. **Coordinate the AST** with `@interpreter` (`interpreter/ast-design`): one production ↔ one node.
5. **Update the highlighter in the same PR/milestone** (`language-designer/syntax-highlighting`) — token
   classes derive from the grammar; the interlock rule forbids letting them drift.
6. **Preserve backward compatibility:** additive by default; any breaking change needs a deprecation
   note + ADR and PO sign-off.

## Critical rules

- Serialize grammar changes (one PR); they are shared-file changes by definition.
- Heritage spellings map to the **same semantics** as their Core form — never a divergent behavior.
- A grammar change is not done until reserved words, AST, highlighter fixtures, and docs are updated.

## Checklist
- [ ] Change grounded in `spec/grammar.md`; correct profile placement.
- [ ] EBNF + reserved words + AST + highlighter + docs updated together.
- [ ] Backward compatible (or ADR + deprecation + PO approval).
- [ ] Fixtures updated; single serialized PR.
