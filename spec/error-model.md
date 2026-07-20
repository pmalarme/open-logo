> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Error model

[Back to the specification index.](README.md)

This document defines the normative OpenLogo (OL) diagnostic model: the shape of every
finding, the stable error-code registry, the learner-facing tone, staging, severity,
localization boundary, and did-you-mean behavior.

## Philosophy

OpenLogo errors are part of teaching. A diagnostic MUST help the learner repair the
program and understand the idea behind the repair. An implementation MUST NOT present a
bare message such as "Syntax Error" or an implementation stack trace as the primary
learner message.

Diagnostics use the warm, lowercase Logo voice:

- `i don't know how to fowad. did you mean forward?`
- `forward needs a number to tell it how far to go.`

The message should name the learner's action, the concept involved, and the smallest
next step. It should avoid blame, jargon-first wording, and host-language exceptions.

## Diagnostic shape

Each diagnostic MUST contain:

| Field | Required | Meaning |
|---|---:|---|
| `code` | yes | Stable diagnostic identity, from the registry below or an `ol-style-*` linter code. |
| `source_span` | yes | The source location that best explains the finding. |
| `params` | yes | Structured data used for identity, repair, telemetry, and localization. Empty object allowed. |
| `message` | yes | Localizable learner-facing prose generated from `code` and `params`. |
| `stage` | yes | One of `parse`, `semantic`, or `runtime`. |
| `severity` | yes | One of `error` or `warning`. |
| `debug` | no | Extra detail for `debug`, developer tools, and advanced learners. |

`source_span` MUST identify at least a source document and a half-open character range or
equivalent line/column range. Spans SHOULD point at the most local repair site: the
misspelled command name, the unmatched delimiter, the bad index, or the non-boolean
condition, not the whole file.

`params` are part of the diagnostic identity. For example, `ol-type` with
`expected: "number"` and `actual: "word"` is distinct from `ol-type` with
`expected: "list"` and `actual: "number"`. Localized prose MUST be derived from
`code` and `params`; tools MUST NOT parse English messages to understand a diagnostic.

The optional `debug` detail MAY include:

- `procedure_stack`: innermost call first, with procedure name and call span.
- `state_after_error`: the observable state after the error is reported.

For runtime errors, state-after-error means the state after all effects that happened
before the failing instruction, and before any effect that the failing instruction did
not complete. It is intended for explanation and replay, not for recovery semantics.

## Stages

`parse` diagnostics come from reading tokens and structure before names and values are
resolved. They include bad tokens, unclosed strings or comments, unmatched delimiters,
and missing or mismatched `end` labels.

`semantic` diagnostics come from understanding the program after parsing but before, or
independent of, execution. They include unknown commands, wrong arity, reserved-word
redefinition, unknown struct type declarations or constructors, invalid `return`
placement, duplicate binders, and statically non-value-producing comprehension bodies.

`runtime` diagnostics come from evaluating values and state. They include type and range
errors, division by zero, reading undefined variables, reading missing dictionary keys,
unknown record fields discovered through values, limits, a program-raised `throw`, and a
reporter call that reaches the end without returning a value.

If an implementation can detect a condition earlier without changing behavior, it SHOULD
report the earlier stage. The `code` remains the same; the `stage` records when it was
found.

## Severity

Most registry codes below have `severity: error`: execution cannot continue normally at
the offending construct.

Style findings from the linter reuse the same diagnostic shape with `severity: warning`
and `ol-style-*` codes. The style namespace includes `ol-style-useless-value`, used when
a control block's last line is a bare value that will be discarded by the block-result
rule. A warning MUST NOT change program meaning.

## Normative code registry

The following codes are reserved and normative. Implementations MAY add vendor-specific
codes only outside the `ol-*` namespace.

| Code | Usual stage | Required params | Meaning and learner-message guidance |
|---|---|---|---|
| `ol-unknown-command` | semantic | `name`, optional `suggestion` | A command, reporter, special form, procedure, or constructor name is not known. If a suggestion exists, say `i don't know how to {name}. did you mean {suggestion}?`; otherwise name the unknown word and suggest checking spelling or defining it. |
| `ol-not-enough-inputs` | semantic | `callable`, `expected`, `actual` | A call or constructor received too few required inputs. Say what the callable still needs. |
| `ol-too-many-inputs` | semantic | `callable`, `expected`, `actual` | A fixed-arity call received extra inputs. If a variadic parenthesized form exists, mention wrapping the call in `( … )`. |
| `ol-type` | runtime | `expected`, `actual`, optional `value`, optional `operation` | A value has the wrong type for an operation, including list indexing with a non-number key or ordering non-orderable values. The message MUST name the expected learner concept, such as number, word, list, dict, record, or boolean. |
| `ol-range` | runtime | `operation`, `index` or `value`, optional `length` | A number is outside the allowed range, including a 1-based list index out of range, an empty `first` or `last`, `insert` outside valid positions, `pick` from an empty list, a negative whole-number `repeat` count, or a destructuring pattern length mismatch. |
| `ol-undefined-var` | runtime | `name` | Reading `:name` or `thing` found no visible binding. |
| `ol-unmatched-bracket` | parse | `delimiter`, optional `opened_at` | `[` or `]` is unmatched. Use for list literals, blocks, selectors, field lists, and patterns when the bracket itself is the structural problem. |
| `ol-unmatched-brace` | parse | `delimiter`, optional `opened_at` | `{` or `}` is unmatched in a dictionary literal. |
| `ol-unmatched-paren` | parse | `delimiter`, optional `opened_at` | `(` or `)` is unmatched in grouping or parenthesized call syntax. |
| `ol-missing-end` | parse | `opener`, optional `hint` | A long block or procedure was opened but not closed, or a control header was followed by an undelimited body. The hint SHOULD mention wrapping the body in `[ ]` or closing it with `end`. |
| `ol-mismatched-end` | parse | `expected`, `actual` | An `end` label is orphaned or does not match its opener; includes an `else` with no still-open `if`. |
| `ol-unclosed-comment` | parse | `opened_at` | A `/* … */` comment reached end of file before `*/`. |
| `ol-unclosed-string` | parse | `opened_at` | A single-line `"…"` word reached end of line or end of file, or a triple-quoted `"""…"""` word reached end of file, before its closing quote. |
| `ol-bad-token` | parse | `text` | The lexer found characters that are not valid OpenLogo tokens. The message SHOULD point at the unexpected text and mention the closest legal form when clear. |
| `ol-div-zero` | runtime | `operation` | `/` or `mod` attempted to divide by zero. OpenLogo reports this instead of producing infinity or NaN. |
| `ol-neg-sqrt` | runtime | `value` | `sqrt` received a negative number. |
| `ol-no-output` | runtime | `procedure` | A procedure was used as a reporter but reached the end without `return`, `output`, or `op`. The error is reported at the call site. |
| `ol-no-value` | semantic | `form` | A `map`, `filter`, or `reduce` body produced no final value. This is for a comprehension body with no value-producing final expression. |
| `ol-return-outside-proc` | semantic | `keyword` | `return`, `output`, or `op` appears outside any procedure. |
| `ol-return-in-comprehension` | semantic | `keyword`, `form` | `return`, `output`, `op`, or `stop` appears inside a `map`, `filter`, or `reduce` body. A comprehension is a value context, so any control-flow escape from it — not only the reporter forms — is illegal; comprehensions report by their last expression instead. |
| `ol-duplicate-binder` | semantic | `name`, `form` | A binder name is repeated where names must be distinct, including `reduce sum sum …` or a repeated name in a destructuring pattern. |
| `ol-stop-outside-proc` | semantic | none or `keyword` | `stop` appears outside any procedure. |
| `ol-repcount-outside-repeat` | semantic | none | `repcount` was used outside any enclosing `repeat`. Explain that `repcount` reports the current turn of a `repeat` and only has meaning inside one. |
| `ol-limit` | runtime | `limit`, optional `value` | A configurable safety limit was reached, such as instruction budget, recursion depth, or cancellation. The message MUST be friendly and MUST NOT expose a host stack overflow. |
| `ol-user-error` | runtime | `message` | A program reached a `throw`, halting with the learner-facing message it supplied. Library procedures such as `polygon`, `star`, `circle`, `arc`, `area`, and `perimeter` use it to reject invalid input in their own words. v0.1 has no `try`/`catch`, so it stops the program like any other runtime error. |
| `ol-not-boolean` | runtime | `actual`, optional `operation` | A condition or logical operand was not `true` or `false`. There is no truthiness. |
| `ol-bad-color` | runtime | `value` | A color argument to `set_color` or `set_background` is not one of the accepted color forms: a palette name word, an `[r g b]` list of three numbers each `0` through `255`, or a `"#rrggbb"` hex word. The message SHOULD name the accepted forms. |
| `ol-reserved-word` | semantic | `name`, `namespace` | A program attempted to redefine or collide with a reserved keyword, primitive, existing procedure, type constructor, or alias target where freshness is required. |
| `ol-unknown-type` | semantic | `name` | A type name in a **type position** — the type word of `is a` / `is_a?` — is not a known built-in type or declared struct. An unknown name in **callable position**, such as a constructor or command call, raises `ol-unknown-command` instead. |
| `ol-unknown-field` | runtime | `type`, `field`, optional `write` | A record has no such field. This includes writing an unknown struct field; records are fixed-field values. |
| `ol-unknown-key` | runtime | `key` | A required dictionary key is absent on read, or an intermediate dictionary key is absent in a nested access chain. Writing a missing final dictionary key upserts and MUST NOT raise this error. |
| `ol-not-a-place` | semantic | optional `text` | The target of `=` or `set … to` is not assignable. Reporters such as `first`, `count`, and `keys` are not places. |

## Did-you-mean

`ol-unknown-command` MUST support did-you-mean suggestions.

The candidate set is the visible callable and structural-word vocabulary after the alias
and import pre-pass: primitives, special-form heads, currently declared procedures,
struct constructors, profile words available in the implementation, and aliases. Matching
is case-insensitive because OpenLogo identifiers are case-insensitive; the displayed
suggestion SHOULD use the canonical lowercase spelling.

The algorithm is:

1. Normalize the unknown name and each candidate with OpenLogo's case-insensitive name
   comparison.
2. Compute Levenshtein edit distance with insertion, deletion, and substitution cost 1.
3. Keep candidates with distance less than or equal to 2.
4. Choose the lowest distance. If tied, prefer Core words over optional-profile words,
   then full canonical names over short aliases, then lexicographic order.
5. If no candidate remains, omit `suggestion`.

Implementations MAY add transposition as an additional edit of cost 1 only if doing so
does not suggest a candidate with ordinary Levenshtein distance greater than 2. The
normative threshold remains Levenshtein ≤2.

## Examples

Bad diagnostic style:

```logo
# not acceptable learner output:
# Syntax Error
# TypeError: expected double
```

Good diagnostic style:

```logo
fowad 100
# i don't know how to fowad. did you mean forward?

forward "far"
# forward needs a number to tell it how far to go.

:nums = [1 2 3]
print :nums[4]
# :nums has 3 things so there is no thing 4.

:ages = { tom: 8 }
print :ages.sophie
# i can't find the key "sophie" in :ages.

:ages.sophie = 6
# ok: writing a missing dictionary key adds it.

map num in :nums [
  print :num
]
# map needs the last line of its block to make a value.
```

## Localization boundary

Diagnostic identity is `code` plus `params`; prose is presentation. A French keyword
pack, for example, may localize messages and display localized aliases, but it MUST keep
the same `ol-*` code and structured params for the same condition. Tests and editor tools
SHOULD assert codes and params, not English text.

The learner message SHOULD be localizable as a template. Template authors may reorder,
inflect, or soften prose for the target language, but MUST preserve the same repair
meaning and MUST NOT hide required facts such as the expected type, missing key, or
source location.

## Relationship to tooling and tracing

The syntax checker and linter use this shape for all findings. Lex/parse and semantic
checker findings use the registry above; style findings use `ol-style-*` warning codes,
including `ol-style-useless-value`.

Runtime errors SHOULD also emit the `error` trace event defined by the execution model,
with the diagnostic embedded or referenced. The trace event is for replay and rendering;
the diagnostic remains the normative learner-facing error object.
