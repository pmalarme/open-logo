> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Tooling

[Back to the specification index.](README.md)

This document defines the OpenLogo (OL) tooling contract for syntax highlighting and diagnostics.
The token classes and lint codes in this file are Normative. LSP-style editor integration is
Informative and describes one way to expose the same behavior in editors.

Tooling MUST follow the language contract in [grammar.md](grammar.md), the primitive matrix in
[commands.md](commands.md), the evaluation rules in [execution-model.md](execution-model.md), the
diagnostic registry in [error-model.md](error-model.md), and the human conventions in
[style-guide.md](style-guide.md). Source files use the `.logo` extension.

## Normative token-class model

A highlighter MUST classify tokens from the grammar, not from ad-hoc regular expressions alone. A
scanner MAY produce preliminary classes, but the final classes below depend on grammatical position:
`[` may be a list, block, selector, pattern, or field-list delimiter; an identifier after `struct`
may be a type name; a bare identifier inside a dict literal before `:` is a dict key.

Tokenization is case-insensitive for keywords and built-in primitives; lowercase is canonical.
User names may contain Unicode letters as allowed by the identifier grammar. Word values preserve
case. Comments and strings are atomic: tokens inside comments or closed `"..."` strings MUST NOT be
classified as keywords, variables, operators, or delimiters.

| Token class | Normative scope |
|---|---|
| `keyword` | Structural words recognized by the reader: the reserved words listed in [Reserved words](#reserved-words-for-tooling), plus profile block-heads when their profile is active. |
| `primitive` | Built-in commands, reporters, and aliases from the C3 primitive matrix, including full names such as `forward`, one-word aliases such as `pendown`, short aliases such as `fd`, heritage command aliases such as `pr`, and profile primitives when enabled. Structural special-form heads are `keyword` unless they are being documented as callable entries. |
| `number` | Numeric literals, including negative literals when the lexer rules classify the leading `-` as part of the number. |
| `word/string` | Closed double-quoted word literals such as `"tom"`, `"#ff0000"`, and `"hello world"`; escapes `\"` and `\\` remain inside the same token. |
| `:variable` | A colon-prefixed variable read or colon-form assignable place head, such as `:count`, `:nums[1]`, or `:people.tom.age`. The `:` and identifier SHOULD be styled as one semantic unit. |
| `comment` | `#` and `//` line comments, and non-nesting `/* ... */` block comments. |
| `bracket` | `[` and `]` delimiters for list literals, instruction blocks, comprehension expression-blocks, destructuring patterns, and struct field lists. |
| `brace` | `{` and `}` delimiters for dictionary literals only. |
| `paren` | `(` and `)` grouping and parenthesized alternate/variadic calls. |
| `operator` | Assignment `=`, comparisons `== != < > <= >=`, arithmetic `+ - * / mod`, boolean `and or not`, membership `in` when used as an infix reporter, and dictionary-literal key separator `:`. |
| `index/dot` | Postfix selectors and access punctuation: `[` `]` when used as an index/key selector, and `.` in `:record.field`, `:dict.key`, or nested chains. |
| `dict-key` | A bare dictionary literal key before `:` inside `{ key: value }`, and a bare selector key in `:dict[key]` when parsed as a literal word key. Reserved words are allowed here as data. |
| `procedure-name` | User-defined procedure names in `define name ... end` / `to name ... end`, procedure calls resolved to user procedures, and alias declarations whose target is a procedure. |
| `type-name` | Struct type names in `struct point [ x y ]`, constructor calls for known struct types, and type words in type-oriented tooling presentations. |
| `field-name` | Struct field names in `struct <type> [ field1 field2 ... ]` and field access `.field` when the base type is known to be a record. |

### Disambiguating identifiers

The same spelling can be highlighted differently depending on position:

```logo
struct point [ x y ]
define move_to_point :p
  set_xy :p.x :p.y
end

:ages = { if: 6  tom: 8 }
print :ages.if
```

In this example, `struct`, `define`, and `end` are `keyword`; `point` is `type-name` in the
declaration and a constructor when called; `move_to_point` is `procedure-name`; `set_xy` and `print`
are `primitive`; `:p` and `:ages` are `:variable`; `x` and `y` in the field list and `.x`/`.y` are
`field-name` when record typing is known; `if` and `tom` inside the dict literal are `dict-key`, not
keywords.

When semantic information is unavailable, a highlighter MUST still produce grammar-safe lexical
classes and MAY defer `procedure-name`, `type-name`, and `field-name` precision until after parsing
and symbol discovery. It MUST NOT misclassify dict keys or selector literal keys as commands merely
because their spelling matches a reserved word.

### Delimiter roles

Bracket role is grammar-derived:

| Role | Position |
|---|---|
| List literal | Value position, such as after `=` or as a command argument. |
| Instruction block | Body position after `repeat`, `if`, `while`, `for`, or `forever`. |
| Comprehension expression-block | Body position after `map`, `filter`, or `reduce`; must produce a value. |
| Selector | Postfix position after an indexable primary: `:nums[1]`, `:ages[:who]`. |
| Pattern | Binder position, such as `for [:x :y] in :points`. |
| Field list | Immediately after `struct <type>`. |

Editors SHOULD expose these roles as semantic-token modifiers where possible, even when the visible
theme maps all roles to the same bracket color.

## Reserved words for tooling

The Core reserved-word list is generated from the grammar. This is the C19 registry repeated here so
highlighters and linters can share the same names:

`define`, `to`, `end`, `return`, `output`, `op`, `stop`, `set`, `make`, `local`, `thing`, `if`,
`else`, `while`, `repeat`, `for`, `forever`, `in`, `from`, `at`, `by`, `of`, `key`, `value`, `add`,
`remove`, `insert`, `clear`, `map`, `filter`, `reduce`, `and`, `or`, `not`, `true`, `false`,
`struct`, `alias`, `import`, `export`.

`to` is contextual: it is both the heritage procedure opener and the slot word in `set ... to` and
`for ... from ... to`. Profile block-heads are reserved only when the profile is active:
`tell`, `ask`, and `each` for Sprites; `when`, `every`, `on_key`, and `on_click` for Interaction.
Reserved words may be aliased by `alias`, but they MUST NOT be redefined as variables, procedures,
or struct type names; such redefinitions produce `ol-reserved-word`.

## Editor grammar guidance

TextMate grammars SHOULD use lexical patterns for fast first-pass coloring, then rely on an OL parser
or semantic-token provider for role-sensitive classes. In particular, a TextMate grammar SHOULD:

- Treat strings and comments as highest-precedence captures.
- Capture colon-prefixed identifiers as `:variable`.
- Capture delimiter characters separately so matching pairs can be colored.
- Avoid treating every bare identifier as a command; command status depends on arity and namespace.
- Avoid comma-based rules; OpenLogo has no comma syntax.

Tree-sitter grammars SHOULD encode the full grammatical roles from [grammar.md](grammar.md),
including fixed-arity prefix calls, parenthesized variadic calls, long `... end` blocks with optional
matching labels, and the five bracket roles. A tree-sitter query SHOULD map concrete syntax nodes to
the token classes above, with semantic passes adding user procedure, struct, and field information.

## Normative diagnostic shape

Every syntax checker, semantic checker, and style linter finding MUST use the C10 diagnostic shape:

| Field | Requirement |
|---|---|
| `code` | A stable `ol-*` or `ol-style-*` code. |
| `source-span` | File URI or path plus start/end line and column in the original source. |
| `params` | Structured values used to localize and deduplicate the diagnostic. |
| `message` | A localizable learner-facing message. Diagnostic identity is not the prose. |
| `stage` | One of `parse`, `semantic`, or `runtime`. Static tooling normally emits `parse` or `semantic`. |
| `severity` | `error` or `warning`; style findings are warnings. |
| `debug` | Optional details such as token role, expected forms, symbol table source, or procedure stack. |

Static tools MUST NOT invent new non-style error codes when a C10 code applies. Implementations MAY
add vendor-specific diagnostics only with a namespaced code such as `vendor.ol-extra-rule`, and such
diagnostics MUST NOT be required for conformance.

## Layer 1: lex and parse checking

The parse layer runs before name resolution. It MUST report structural errors with C10 parse codes
and SHOULD recover far enough to report additional independent findings in the same document.

| Condition | Code | Required behavior |
|---|---|---|
| Unmatched `[` or `]` | `ol-unmatched-bracket` | Point at the unmatched delimiter; include the expected mate in `params`. |
| Unmatched `{` or `}` | `ol-unmatched-brace` | Treat braces only as dict delimiters; never as blocks. |
| Unmatched `(` or `)` | `ol-unmatched-paren` | Include whether the parser was inside grouping or a parenthesized call. |
| Missing body delimiter or long-block terminator | `ol-missing-end` | Use for a `define` or long control block left unclosed, or a control header followed by an undelimited body that should be wrapped in `[ ]` or closed with `end`. |
| Mismatched, orphan, or invalid `end` label | `ol-mismatched-end` | Accept the core labels `end`, `end if`, `end while`, `end repeat`, `end for`, `end forever`, and `end define`, plus `end <keyword>` for any active profile block-head (e.g. `ask`, `each`, `when`, `every`, `on_key`, `on_click`). |
| Unclosed block comment | `ol-unclosed-comment` | `/* ... */` comments are non-nesting. |
| Unclosed string | `ol-unclosed-string` | Closed double quotes are required; classic open `"word` is invalid. |
| Bad token | `ol-bad-token` | Use for characters or token sequences outside the grammar, including commas used as separators. |

Example parse diagnostics:

```logo
repeat 4 forward 100
```

Finding: `code=ol-missing-end`, `stage=parse`, `severity=error`, `params={ opener: "repeat",
hint: "wrap the body in [ ] or close it with end" }`, message: `repeat needs its body wrapped in [ ]
or closed with end.`

```logo
:ages = { tom: 8 sophie: 6 }
```

Finding: `code=ol-bad-token`, `stage=parse`, `severity=error`, `params={ token: "," }`, message:
`openlogo does not use commas here. write dictionary entries with spaces or new lines.`

## Layer 2: semantic checking

The semantic layer runs after the alias/import pre-pass, procedure and struct registration, and
grammar parsing. It MUST use the active conformance profile set when deciding which primitives and
profile block-heads are available.

| Condition | Code | Required behavior |
|---|---|---|
| Unknown command, reporter, procedure, primitive, or active-profile form | `ol-unknown-command` | Provide did-you-mean suggestions using Levenshtein distance ≤2 over visible names. |
| Not enough inputs for a fixed-arity or selected call form | `ol-not-enough-inputs` | Include callable name, expected count, and actual count. |
| Too many inputs outside parenthesized alternate/variadic forms | `ol-too-many-inputs` | Include callable name and explain when parentheses are required. |
| Undefined variable read | `ol-undefined-var` | Point at the `:variable` token or place head that reads an unbound value. |
| Redefining a reserved word, primitive, existing procedure, existing type constructor, or existing alias | `ol-reserved-word` | Apply to `define`, `to`, `struct`, `local`, and `alias` registrations as appropriate. |
| Unknown struct type or constructor | `ol-unknown-type` | Use when a type position names no registered struct type. |
| Unknown record field | `ol-unknown-field` | Use for record field reads and writes; struct fields are fixed and never upsert. |
| Assignment or `set` target is not an assignable place | `ol-not-a-place` | Reject reporter calls, literals, computed values, and parenthesized expressions as targets. |
| Comprehension body statically has no value-producing final expression | `ol-no-value` | Applies to `map`, `filter`, and `reduce`; `return` inside a comprehension is `ol-return-in-comprehension`. |
| `return`, `output`, or `op` outside a procedure | `ol-return-outside-proc` | Point at the control word. |
| `return`, `output`, or `op` inside `map`/`filter`/`reduce` | `ol-return-in-comprehension` | Explain that comprehensions report the last expression. |
| Repeated `reduce` or pattern binder name | `ol-duplicate-binder` | Include the repeated binder name. |

Semantic tools SHOULD also report statically knowable uses of runtime C10 codes, such as
`ol-not-boolean` for a literal non-boolean condition, `ol-type` for a literal non-number used as
`forward` distance, or `ol-range` for a literal list index known to be out of range. Tools MUST NOT
report speculative type errors when dynamic values are unknown.

Example semantic diagnostics:

```logo
fowad 100
```

Finding: `code=ol-unknown-command`, `stage=semantic`, `severity=error`, `params={ name: "fowad",
suggestion: "forward" }`, message: `i don't know how to fowad. did you mean forward?`

```logo
print first
```

Finding: `code=ol-not-enough-inputs`, `stage=semantic`, `severity=error`, `params={ callable:
"first", expected: 1, actual: 0 }`, message: `first needs one input.`

```logo
count :nums = 3
```

Finding: `code=ol-not-a-place`, `stage=semantic`, `severity=error`, `params={ target: "count :nums"
}`, message: `count :nums is a value, not a place you can change.`

```logo
:doubled = map num in :nums [
  print :num
]
```

Finding: `code=ol-no-value`, `stage=semantic`, `severity=error`, `params={ form: "map" }`, message:
`map needs the last instruction in its block to make a value.`

## Layer 3: style lints

Style lints are warnings. They reuse the C10 diagnostic shape with `severity=warning`, `stage=semantic`,
and an `ol-style-*` code. The source of each rule is [style-guide.md](style-guide.md); the codes below
are the normative registry for v0.1. A conforming linter MAY allow users to disable style rules, but
it MUST keep the code identity stable when the rule is enabled.

| Code | Rule |
|---|---|
| `ol-style-useless-value` | A control block has a final value-producing expression whose value is discarded. |
| `ol-style-name-case` | User identifiers should be lowercase snake_case with optional `?` or `!`; built-ins should be shown lowercase. |
| `ol-style-full-name` | Prefer primary full underscored primitive names over short aliases in teaching material, such as `pen_down` over `pd`. |
| `ol-style-one-command-per-line` | Prefer one command or special form per line outside compact one-line examples. |
| `ol-style-block-indentation` | Indent the contents of `[ ]` and long `... end` blocks consistently. |
| `ol-style-prefer-block` | Suggest a `... end` block when a bracketed `[ ]` control body spans multiple lines. |
| `ol-style-predicate-name` | Procedures that return booleans should end in `?`, such as `is_ready?`. |
| `ol-style-procedure-name` | Procedure names should describe the learner-visible action or question, often `draw_*`, `make_*`, or `is_*?`. |
| `ol-style-comment-style` | Prefer `#` comments in examples; `//` and `/* ... */` remain valid syntax. |
| `ol-style-magic-number` | Repeated unexplained numeric literals should be named with a variable. |
| `ol-style-equality-confusion` | Suspicious use of `=` where `==` was probably intended, or `==` in an assignment-shaped learner pattern. |
| `ol-style-deep-nesting` | Deep unlabeled nesting should be refactored or labeled with matching `end <form>` where long blocks are used. |
| `ol-style-hidden-abstraction` | A shortcut procedure such as `draw_square 100` hides a concept that the surrounding lesson expects the learner to build from `repeat`. |

Example style diagnostics:

```logo
repeat 4
  :side * 2
end repeat
```

Finding: `code=ol-style-useless-value`, `stage=semantic`, `severity=warning`, `params={ form:
"repeat" }`, message: `repeat runs its block for actions, so this value is ignored.`

```logo
fd 100
rt 90
```

Finding: `code=ol-style-full-name`, `stage=semantic`, `severity=warning`, `params={ alias: "fd",
preferred: "forward" }`, message: `for learning examples, prefer forward over fd.`

## Informative LSP-style editor integration

An editor integration can expose this specification through Language Server Protocol concepts:

- `textDocument/semanticTokens` returns the token classes in this document, plus optional modifiers
  such as `declaration`, `reference`, `readonly`, `defaultLibrary`, `listRole`, `blockRole`, or
  `selectorRole`.
- `textDocument/publishDiagnostics` returns C10-shaped parse, semantic, and style findings.
- `textDocument/completion` suggests visible primitives, user procedures, variables, struct types,
  fields, dict keys when statically known, and reserved words valid at the cursor.
- `textDocument/hover` explains a primitive signature from the C3 matrix, a variable binding, a
  struct field, a diagnostic code, or the block-result rule for the current block.
- `textDocument/definition` jumps from a user procedure call to `define`, from a struct constructor
  or field to `struct`, and from an alias to its declaration or target.
- `textDocument/codeAction` offers safe fixes such as replacing `fd` with `forward`, adding a missing
  `end`, wrapping an undelimited control body in `[ ]` or a `... end` block, changing `=` to `==` in an `if` condition,
  or inserting a missing comprehension final expression placeholder.
- `textDocument/formatting` applies the indentation and one-command-per-line rules from the style
  guide without changing program meaning.

LSP integrations SHOULD compute diagnostics incrementally but MUST preserve the same observable
diagnostic codes, spans, params, and severities that a batch checker would produce. They SHOULD
degrade gracefully when imports cannot be loaded by reporting only diagnostics that are valid without
the missing module information.

## Non-goals

This document specifies behavior only. It does not define implementation binaries, package names,
editor extension manifests, theme colors, parser generator formats, or a reference language server.
Those artifacts may be built by implementations, but conformance is measured against the token
classes, diagnostic shape, diagnostic layers, and lint-code registry above.
