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

## Semantic tokens (LSP contract) for studio

`highlight(source, document)` classifies tokens into the 15 normative token classes + 5 bracket
roles from [`tooling.md`](../../spec/tooling.md#L28-L84). `semanticTokens(source, document)`
(`src/semantic-tokens.ts`) layers an LSP `textDocument/semanticTokens`-shaped response on top of
that: each returned token keeps `highlight()`'s `class`/`role`/span fields and adds a `modifiers`
array drawn from the modifier vocabulary in
[`tooling.md:277`](../../spec/tooling.md#L277) — `declaration`, `reference`, `readonly`,
`defaultLibrary`, `listRole`, `blockRole`, `selectorRole`.

A future `@openlogo/studio` editor pane (or any other LSP-style client) should call
`semanticTokens()` instead of `highlight()` directly whenever it needs modifier-aware
classification (e.g. dimming a `defaultLibrary` primitive differently from a user-defined
`procedure-name`, or rendering a `declaration` site vs. a `reference` site with distinct
decorations). `highlight()` remains the lower-level, modifier-free classification API for callers
that only need token class + text + span (e.g. the syntax/semantic checker).

`src/grammar-version.ts` exports `OL_GRAMMAR_VERSION` and `assertGrammarVersionInSync()`, which
throws if the highlighter's tracked grammar version ever drifts from `@openlogo/core`'s
`OPENLOGO_VERSION`. Per the team charter, any future grammar/reserved-word change must bump
`OL_GRAMMAR_VERSION` (or the version it's checked against) in the same PR as the grammar change,
so this check turns a silently-stale highlighter into a build-time/CI failure instead.
