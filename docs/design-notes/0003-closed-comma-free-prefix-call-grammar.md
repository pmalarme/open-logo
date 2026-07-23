# 3. A closed, comma-free, prefix-call grammar

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

Most modern general-purpose languages call a function or method with a parenthesized,
comma-separated argument list: `f(x, y)`. That shape is so common that contributors coming from
Python, JavaScript, or C-family languages tend to assume OpenLogo works the same way. It does not.
OpenLogo calls are **prefix and space-separated**, arguments are never comma-separated anywhere in
the grammar, and every callable (primitive or user-defined procedure) has exactly **one fixed
default arity**. A call at a different arity — most often variadic primitives like `print`,
`word`, `sentence`, and `list` — must be wrapped in parentheses. This raises the recurring
question: why not just adopt `f(x, y)`, and why does an unparenthesized call have only one
possible number of arguments?

## Decision

Per `spec/grammar.md#expressions-and-calls`:

> OpenLogo calls are prefix and space-separated. Each callable has one fixed default arity. A
> variadic or alternate-arity call must be wrapped in parentheses. Commas are not syntax anywhere.

Concretely:

- A **fixed call** (`fixed-call ::= callable-name { ? the callable's default arity, each input a
  full expression ? }`) takes exactly the callable's one default arity, with no parentheses and no
  commas: `forward random 100` calls `forward` with one argument, itself the result of calling
  `random` with one argument (100) — reporters nest by their own known arity, so this parses as
  `forward (random 100)`, never `forward random` followed by a stray `100`.
- A **parenthesized call** (`parenthesized-call ::= "(" callable-name { expression } ")"`) is the
  only way to supply a variadic or alternate argument count. `spec/commands.md` (line 13) states
  it directly: "Signature is the canonical spelling and default arity. Alternate or variadic
  arities use the parenthesized call form such as `(print :a :b)`." The same pattern appears on
  `word` (`spec/commands.md:1000`, `word word word`; `(word …)` variadic) and `sentence`
  (`spec/commands.md:1017`, `sentence value value`; `(sentence …)` variadic).
- A `struct` constructor call is a prefix call whose fixed arity equals its declared field count
  (`spec/grammar.md#collections-records-and-comprehensions`): `struct point [ x y ]` then
  `point 3 4` — no parentheses needed because two fields means arity two is the *default*, not a
  variadic case.
- Procedure calls follow the identical rule (`spec/commands.md:908`): "Procedure calls are prefix
  calls with fixed arity. Optional trailing parameters are specified on the `define` line and extra
  supplied arguments use the parenthesized call form."
- Because each input to a prefix call is a full expression, infix operators bind *inside* an
  argument, never around the whole call (`spec/grammar.md#expressions-and-calls`): `power 2 3 * 4`
  means `power 2 (3 * 4)`, not `(power 2 3) * 4`.
- Commas never appear as syntax anywhere in the grammar — not in call arguments, not in list
  literals (`[1 2 3]`), not in dict literals (entries separated by whitespace or newlines,
  `spec/grammar.md:208`, `spec/grammar.md:310`).

Validated against the runtime (`@openlogo/parser` + `@openlogo/runtime`, checked out at this
commit):

```logo
# fixed call: forward's arity is 1, random's arity is 1; parses as forward (random 100),
# drawing forward by a random distance in [0, 99] — not a fixed, predictable value
forward random 100

# fixed call: power's arity is 2; "3 * 4" is one full expression, so this is power 2 (3 * 4)
:result = power 2 (3 * 4)  # -> :result is 4096, i.e. power 2 12
print :result

:a = 1
:b = 2
(print :a :b)               # parenthesized call: print's default arity is 1, two values need parens

(word "a" "b" "c")           # parenthesized call: word's default arity is 2, three values need parens
:nums = (list 1 2 3)         # parenthesized call: list's default arity is 0 (bare list returns [])
print :nums                  # -> [1 2 3]

struct point [ x y ]
:p = point 3 4               # fixed call: point's arity is 2 (its field count), no parens needed
print :p.x                   # -> 3
print :p.y                   # -> 4

print (sentence 1 2 3)       # parenthesized call: sentence's default arity is 2, three values need parens
                              # -> [1 2 3]
```

The contrasting failure case confirms the fixed-arity rule is enforced, not just documented:
`print 1 2` (no parentheses, two values against `print`'s default arity of one) is rejected at
parse time with `ol-bad-token` — "each instruction needs a new line of its own. i didn't expect 2
to keep going on this line." — because the parser has already consumed `print 1` as a complete
fixed call and treats the trailing `2` as an unexpected token starting a new instruction on the
same line.

## Rationale

The fixed-default-arity-plus-parenthesized-escape-hatch design keeps the common case — the
overwhelming majority of calls in a beginner's program — free of any bracketing punctuation at all:
`forward 100`, `right 90`, `print :name`. That mirrors how a person gives an instruction in natural
language ("turn right 90", not "turn(right, 90)"), which matters for a language whose primary
audience is a learner typing their first program. Parentheses become *necessary* only for the
genuinely unusual case — a variable or alternate number of arguments — so seeing them around a call
is a useful cue to check whether that call is using a non-default argument count, even though (as
the next paragraph explains) they are not the *only* way parentheses show up in a program.

Banning commas everywhere, not just in calls, keeps the whitespace-light grammar unambiguous.
Comma-separated argument lists only work cleanly in languages that also use parentheses (and often
commit to significant nesting depth) to delimit where the list starts and ends; OpenLogo's
prefix-call style has no natural closing delimiter for an unparenthesized call, so if commas were
allowed as separators the parser (and the learner) would have no way to tell where a variadic
argument list ends without additional punctuation — precisely the ambiguity parentheses exist to
resolve for the minority of calls that need it. Parentheses are not exclusive to this one job —
a `parenthesized-expression ::= "(" expression ")"` (`spec/grammar.md#expressions-and-calls`) groups
*any* expression, and because a fixed call is itself one kind of expression
(`primary ::= … | fixed-call | …`), that includes wrapping a fixed call purely for visual grouping:
`forward (:x + :y)` groups the sum inside `forward`'s one argument, and `(forward 100)` is equally
valid grammar even though `forward`'s argument count already matches its default
(`spec/grammar.md:272`: "`( )` groups expressions or wraps variadic and alternate-arity calls.").
Consequently, the convention this LDR describes is **a habit worth building, not a syntactic
guarantee**: a non-default argument count *must* be parenthesized, so parentheses are a necessary
signal in that direction, but their mere presence around a callable head does not, by itself, prove
the argument count differs from the default.

## How other languages do it

- **Scheme** (and Lisp generally) is fully parenthesized prefix: every call, from `(+ 1 2)` to
  `(display "hi")`, is wrapped in parentheses, and arity is effectively always "however many forms
  appear before the closing paren." This is maximally uniform and trivially variadic everywhere,
  but it means *every* call — including the simplest one-argument command — carries bracketing
  punctuation, which is exactly the beginner friction OpenLogo's default-arity-without-parens rule
  avoids. OpenLogo borrows Scheme's parenthesized-prefix form only for the minority of calls that
  actually need a non-default arity.
- **Classic Logo** dialects are OpenLogo's direct inspiration here: `forward 100`, `right 90`, and
  `print` all read as unparenthesized prefix instructions, and variadic primitives like `(list 1 2
  3)` or `(sentence 1 2 3)` already used the parenthesized form to disambiguate from the
  fixed-arity default. OpenLogo formalizes and closes that inherited convention — the spec makes
  the "one fixed default arity, parenthesize to vary it" rule total and explicit for every
  primitive and procedure, whereas classic Logo dialects varied in which primitives supported this
  and did not always document it as a single rule.
- **Python, JavaScript, and C-family languages** use `f(x, y)` universally, with commas separating
  arguments and parentheses marking every call, fixed- or variable-arity alike (variadic parameters
  like Python's `*args` or JavaScript's rest parameters live *inside* the same always-parenthesized
  call form). OpenLogo deliberately does not adopt this: it would require parentheses on every
  call, not just the variadic ones, and would need commas — both of which conflict with the
  natural-language-like, whitespace-separated instruction style the rest of Core is built around.

## Consequences

- **Parsing is predictable by construction.** Given a callable's fixed default arity, the parser
  (and a learner reading the source) can determine exactly how many following expressions belong
  to a fixed call without scanning for a closing delimiter — each argument is one full expression,
  consumed left to right until the arity is satisfied (`spec/grammar.md#expressions-and-calls`).
- **Variadic and alternate-arity calls are opt-in and visually marked.** Any call that needs more
  or fewer arguments than the default must use parentheses (`(print :a :b)`, `(word "a" "b"
  "c")`, `(sentence 1 2 3)`), so the punctuation itself flags "this isn't the default shape" —
  there is no silent or implicit variadic behavior.
- **Reporters nest by their own arity, not by punctuation.** `forward random 100` composes two
  fixed calls without any bracketing; `power 2 3 * 4` similarly composes a fixed call with an
  infix expression, because each argument slot is a full expression
  (`spec/grammar.md#expressions-and-calls`).
- **Struct constructors reuse the same rule rather than a special case.** A `struct`'s generated
  constructor is simply a prefix call whose default arity happens to equal the field count
  (`spec/grammar.md#collections-records-and-comprehensions`) — no separate constructor-call syntax
  was needed.
- **Comprehensions are a special form, not a variadic higher-order call.** `map`/`filter`/`reduce`
  are recognized by their leading keyword and take a bracketed body (`spec/grammar.md#collections-
  records-and-comprehensions`), not a lambda argument passed through parenthesized-call syntax —
  "OpenLogo v0.1 has no first-class functions and no `lambda`" (`spec/data-structures.md:383`), so
  the parenthesized-call escape hatch this LDR describes is never used to simulate higher-order
  functions.
- **Future primitives and procedures must declare one default arity up front.** Any new callable
  added to `spec/commands.md` needs an explicit default-arity signature, and only variadic or
  alternate-arity primitives should also document a parenthesized form — keeping the "which calls
  need parentheses" set closed and spec-driven rather than growing ad hoc.
