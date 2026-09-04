# `@openlogo/parser`

Lexer/reader, EBNF grammar, AST, keyword registry, the syntax **highlighter** (token classes),
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

`highlight(source, document, options)` classifies tokens into the 15 normative token classes + 5
bracket roles from [`tooling.md`](../../spec/tooling.md#L28-L84). `semanticTokens(source, document,
options)` (`src/semantic-tokens.ts`) layers an LSP `textDocument/semanticTokens`-shaped response on
top of that: each returned token keeps `highlight()`'s `class`/`role`/span fields and adds a
`modifiers` array drawn from the modifier vocabulary in
[`tooling.md:278-280`](../../spec/tooling.md#L278-L280) — `declaration`, `reference`, `readonly`,
`defaultLibrary`, `listRole`, `blockRole`, `selectorRole` — plus one extension, `global`.

`global` marks a `:variable` occurrence that resolves to a name the program declared `global`
(issue #826). It is the reader-facing half of the variable-scoping ruling: a procedure's first
*write* to a name it cannot see silently creates a private binding — correct, and deliberately never
diagnosed ([`execution-model.md:441-446`](../../spec/execution-model.md#L441-L446)) — so nothing but
the paint tells a learner that `:private = 1` and `:shared = 1` in one body mean different things.
It is a **modifier rather than a sixteenth token class** because that is how `tooling.md` already
models a grammar-derived sub-distinction over one lexical class: five bracket roles, one `bracket`
class, exposed "as semantic-token modifiers where possible, even when the visible theme maps all
roles to the same bracket color" ([`:83-84`](../../spec/tooling.md#L83-L84)), and the LSP list is
open — "optional modifiers **such as** …". The normative class table is unchanged.

It follows **resolution, not spelling**: a `local` that shadows a global does not carry it, a
procedure parameter of the same name does not, and a root-scope `local` — which
[`execution-model.md:520-526`](../../spec/execution-model.md#L520-L526) says "leaves it global" —
does not remove it. `src/global-variable-resolution.ts` owns that scope walk and documents each
clause behind it; `highlight()` exposes its answer as `Token.global` so a class-only consumer can
read it without re-analysis.

`options` is optional on both (`HighlightOptions`); `document` is **required** on both, and that is
a rule rather than an accident. **A `document` parameter may keep a default only where it is the
last parameter** — otherwise a two-argument call binds the argument meant for the next parameter
into the `document` slot, which is silent in JavaScript and cost this repo two false issues (#832,
#840) before #951 closed it. The hazard is not specific to an options object: a trailing
`profiles: readonly CheckProfile[]` mis-binds an array just as silently, and TypeScript permits a
required parameter after a defaulted one. `parse(source, document = "<input>")` is compliant with
the rule today because nothing follows it — it is not immune to the trap, only out of its reach, so
**appending** a parameter after `document` means making it required in the same change. Inserting
one *before* `document` leaves it last, so this rule permits it — but that is not a free move
either: it re-binds every existing two-argument call, and if the inserted parameter carries its own
default the same trap moves one slot to the left. The `execute(source, document, options)` entry
point in `@openlogo/runtime` already has that shape.

`options`' one field, `profiles`, is the **active profile set**, in the same vocabulary `check()`
uses. It decides a single thing: a profile block-head — Sprites' `ask`/`each` and its mode-switch
command `tell`, Interaction's `when`/`every`/`on_key`/`on_click` — is `keyword` while its profile
is active ([`tooling.md:30`](../../spec/tooling.md#L30)) and `primitive` without it
([`:31`](../../spec/tooling.md#L31)). Profile *primitives* (the Sound commands, `wait`, `input`,
the Sprites reporters) are `primitive` under every profile set. Omit `options` and both APIs read
as Core Language alone, which is exactly what callers saw before the option existed.

A future `@openlogo/studio` editor pane (or any other LSP-style client) should call
`semanticTokens()` instead of `highlight()` directly whenever it needs modifier-aware
classification (e.g. dimming a `defaultLibrary` primitive differently from a user-defined
`procedure-name`, or rendering a `declaration` site vs. a `reference` site with distinct
decorations). `highlight()` remains the lower-level, modifier-free classification API for callers
that only need token class + text + span (e.g. the syntax/semantic checker).

`src/grammar-version.ts` exports `OL_GRAMMAR_VERSION` and `assertGrammarVersionInSync()`, which
throws if the highlighter's tracked grammar version ever drifts from `@openlogo/core`'s
`OPENLOGO_VERSION`. Per the team charter, any future grammar/keyword change must bump
`OL_GRAMMAR_VERSION` (or the version it's checked against) in the same PR as the grammar change,
so this check turns a silently-stale highlighter into a build-time/CI failure instead.
