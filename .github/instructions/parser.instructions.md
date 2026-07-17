---
applyTo: "packages/parser/**"
---

# `@openlogo/parser` — working rules

Scoped rules for files under `packages/parser/`. Read the always-on
[team agreement](openlogo-team.instructions.md) and the
[architecture](../../docs/architecture.md) first.

**Owners:** [`@language-designer`](../agents/language-designer.agent.md) +
[`@interpreter`](../agents/interpreter.agent.md) ·
**Skills:** [evolve-the-grammar](../skills/language-designer/evolve-the-grammar/SKILL.md),
[ast-design](../skills/interpreter/ast-design/SKILL.md),
[syntax-highlighting](../skills/language-designer/syntax-highlighting/SKILL.md),
[syntax-checking](../skills/language-designer/syntax-checking/SKILL.md)

## Responsibility
Turn `.logo` text into structure and static findings. Owns the **lexer/reader**, the **EBNF grammar**,
the **AST**, the **reserved-word registry**, the **syntax highlighter** (token classes), and the
**syntax + semantic checker** (parse and semantic lint, plus `ol-style-*` style lints).

## Spec (normative)
- [`spec/grammar.md`](../../spec/grammar.md) — the grammar the AST mirrors.
- [`spec/tooling.md`](../../spec/tooling.md) — 15 token classes, the C19 reserved words, and the three
  checker layers (parse / semantic / style).
- [`spec/commands.md`](../../spec/commands.md) — C3 signatures for arity/name checks.
- [`spec/error-model.md`](../../spec/error-model.md) — `ol-*`/`ol-style-*` codes to emit (from `core`).

## Source layout
- `packages/parser/src/index.ts` — the only public entry (parse, AST types, highlight tokens, check).
- Suggested modules: `tokens.ts`, `reader.ts`, `grammar.ts`, `ast.ts`, `highlight.ts`, `check.ts`.

## Boundaries
- Depends on **`@openlogo/core`** (diagnostics, values) only — never on `runtime`/`turtle`/`studio`.
- **Highlighting and checking classify from the grammar**, not ad-hoc regex.
- The reserved-word list is the single C19 registry shared by highlighter and checker — do not fork it.

## Conventions
- Every AST node carries a `source_span`; one grammar production ↔ one node.
- Diagnostics use only registered `ol-*` codes; the highlighter ships with any grammar change (interlock).
