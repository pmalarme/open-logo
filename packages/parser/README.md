# `@openlogo/parser`

Lexer/reader, EBNF grammar, AST, reserved-word registry, the syntax **highlighter** (token classes),
and the syntax + semantic **checker** (parse/semantic lint + `ol-style-*` style lints).

- **Source root:** `src/` — public entry `src/index.ts` (suggested: `tokens.ts`, `reader.ts`,
  `grammar.ts`, `ast.ts`, `highlight.ts`, `check.ts`).
- **Owners:** [`@language-designer`](../../.github/agents/language-designer.agent.md) +
  [`@interpreter`](../../.github/agents/interpreter.agent.md).
- **Working rules:** [`parser.instructions.md`](../../.github/instructions/parser.instructions.md).
- **Spec:** [`grammar.md`](../../spec/grammar.md), [`tooling.md`](../../spec/tooling.md),
  [`commands.md`](../../spec/commands.md), [`error-model.md`](../../spec/error-model.md).
- **Depends on:** `@openlogo/core`.
