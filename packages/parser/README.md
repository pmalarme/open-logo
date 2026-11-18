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

## Style checks

`check(program, { style: true, profiles })` enables the optional Layer-3 style lints. The
`ol-style-full-name` warning points at an active primitive alias and includes its source spelling
in `params.alias` and the available canonical replacement in `params.preferred`
(`spec/tooling.md#layer-3-style-lints`).
The `fd 100` / `rt 90` calls in that section illustrate the warning; with Core, Turtle & Rendering,
and Heritage enabled, each call warns when style checks are on.

## Semantic tokens (LSP contract) for studio

`highlight(source, document, options)` classifies tokens into the 15 normative token classes + 5
bracket roles from [`tooling.md`](../../spec/tooling.md#normative-token-class-model) — see also
`spec/tooling.md#disambiguating-identifiers` and `spec/tooling.md#delimiter-roles`. `semanticTokens(source, document,
options)` (`src/semantic-tokens.ts`) layers an LSP `textDocument/semanticTokens`-shaped response on
top of that: each returned token keeps `highlight()`'s `class`/`role`/span fields and adds a
`modifiers` array drawn from the modifier vocabulary in
[`spec/tooling.md#informative-lsp-style-editor-integration`](../../spec/tooling.md#informative-lsp-style-editor-integration) — `declaration`, `reference`, `readonly`,
`defaultLibrary`, `listRole`, `blockRole`, `selectorRole` — plus one extension, `global`.

`global` marks a **use** of a variable name that resolves to a name the program declared `global`
(issue #826). It is the reader-facing half of the variable-scoping ruling: a procedure's first
*write* to a name it cannot see silently creates a private binding — correct, and deliberately never
diagnosed ([`spec/execution-model.md#what-a-scope-can-see`](../../spec/execution-model.md#what-a-scope-can-see)) — so nothing but
the paint can tell a learner that `:private = 1` and `:shared = 1` in one body mean different things.
It is a **modifier rather than a sixteenth token class** because that is how `tooling.md` already
models a grammar-derived sub-distinction: five bracket roles across two classes, exposed "as
semantic-token modifiers where possible, even when the visible theme maps all roles to the same
bracket color" ([`spec/tooling.md#delimiter-roles`](../../spec/tooling.md#delimiter-roles)), with the LSP list open — "optional
modifiers **such as** …". The normative class table is unchanged; see
[ADR-0032](../../docs/adr/0032-semantic-token-modifiers-extend-the-informative-list.md).

Because a modifier decorates whatever class a token already has, it is **not tied to `:variable`**.
All three assignment spellings resolve identically
([`spec/execution-model.md#what-an-assignment-targets`](../../spec/execution-model.md#what-an-assignment-targets)), so all three are marked:
a `:variable` token (`:count = 1`, and every read), a `set` target's bare place head (`primitive`),
and a `make` target or `thing` argument's word literal (`word/string`). Marking a word literal
classifies nothing *inside* the string, so `spec/tooling.md#normative-token-class-model`'s MUST NOT is untouched. A name a
program only **declares** — `global count = 0`, `local count` — carries nothing, because those
tokens introduce a binding rather than resolve to one.

**Studio renders it through `semanticTokens()`.** `highlight()` also exposes the answer as
`Token.global`; `semanticTokens()` carries it as a `global` modifier. The browser editor's
`packages/studio/src/highlighter.ts` consumes `semanticTokens()` and maps that modifier to
`ol-mod-global` plus `OL_GLOBAL_VARIABLE_DESCRIPTION`. `packages/studio/src/editor-cm6.ts` applies
the modifier class and description as the mark's `title`; `packages/studio/web/styles.css` provides
the visual treatment. The studio adapter preserves the token's base class while adding the modifier,
so both visual and descriptive cues reach the learner (issue #1106).

It follows **resolution, not spelling**: a `local` that shadows a global does not carry it, a
procedure parameter of the same name does not, and a root-scope `local` — which
[`spec/execution-model.md#local`](../../spec/execution-model.md#local) says "leaves it global" —
does not remove it. `src/global-variable-resolution.ts` owns that scope walk, documents each clause
behind it, and names the one case it knowingly cannot decide: a deferred handler body, which
[`spec/execution-model.md#what-a-scope-can-see`](../../spec/execution-model.md#what-a-scope-can-see) resolves at fire time, so one token can have
two resolutions (issue #1108).

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
is active ([`spec/tooling.md#normative-token-class-model`](../../spec/tooling.md#normative-token-class-model)) and `primitive` without it
([`spec/tooling.md#normative-token-class-model`](../../spec/tooling.md#normative-token-class-model)). Profile *primitives* (the Sound commands, `wait`, `input`,
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
