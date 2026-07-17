---
name: syntax-highlighting
description: >-
  How to build the OpenLogo syntax highlighter and semantic tokens in @openlogo/parser from the
  normative token-class model in spec/tooling.md — classified from the grammar, not ad-hoc regex. Use
  for highlighting, semantic tokens, and editor/LSP token output. The highlighter tracks the grammar
  version.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Produce correct, grammar-derived token classes for editors, the studio, and documentation code
blocks. Token classes are **Normative** ([`spec/tooling.md`](../../../../spec/tooling.md)); getting them
right is what makes OpenLogo readable to learners.

## The 15 normative token classes

`keyword`, `primitive`, `number`, `word/string`, `:variable`, `comment`, `bracket`, `brace`, `paren`,
`operator`, `index/dot`, `dict-key`, `procedure-name`, `type-name`, `field-name`.

## Rules (from `tooling.md`)

- **Classify from the grammar, not regex alone.** A scanner MAY produce preliminary lexical classes,
  but the **final class depends on grammatical position**: `[` can be a list/block/selector/pattern/
  field-list; an identifier after `struct` is a `type-name`; a bare identifier before `:` inside `{ }`
  is a `dict-key`, not a keyword.
- **Case-insensitive keywords/primitives; lowercase is canonical.** Word values preserve case.
- **Comments and strings are atomic** — never classify tokens inside `#`/`//`/`/* */` or closed
  `"..."`/`"""..."""` as keywords/vars/operators.
- **Reserved words come from the generated C19 registry** in `tooling.md` — share the exact list with
  the linter; do not hand-maintain a second copy.
- **Two phases:** (1) lexical scan → preliminary classes; (2) after parse + symbol discovery → refine
  `procedure-name`, `type-name`, `field-name`, and delimiter **roles** (list/block/selector/pattern/
  field-list) as semantic-token modifiers. When semantic info is unavailable, emit grammar-safe
  lexical classes and MUST NOT misclassify dict/selector literal keys as commands.

## Interlock: track the grammar version

Token classes are derived from the grammar, so the highlighter is **pinned to the grammar/spec
version** (see `docs/delivery.md`). Any grammar or reserved-word change ships its highlighter update
in the **same milestone** — a grammar PR is not done until highlighting fixtures are updated.

## Procedure

1. Emit tokens from `parser` (`tokens.ts` → `highlight.ts`), reusing the reader so classes stay
   grammar-faithful; expose semantic tokens for `@openlogo/studio`'s LSP.
2. Cover the disambiguation cases with fixtures (the `struct point [ x y ]` / dict-key `if` examples
   from `tooling.md`).
3. Coordinate delimiter-role modifiers with `@learner-experience` for theme mapping.
4. Keep docs code-block highlighting driven by the same classifier (`@documentation`).

## Checklist
- [ ] All 15 classes produced; final class respects grammatical position.
- [ ] Keywords case-insensitive; comments/strings atomic.
- [ ] Reserved words sourced from the shared C19 registry.
- [ ] Disambiguation fixtures pass; highlighter updated with the grammar in the same PR/milestone.
