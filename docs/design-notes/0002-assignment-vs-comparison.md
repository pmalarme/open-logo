# 2. Assignment vs. comparison (`=`/`set … to` vs `==`)

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

Beginner programmers routinely confuse assignment and equality. Many languages sharpen that
confusion instead of resolving it: classic Logo spells assignment `make "var value` — a command
whose first argument must be a quoted word, an idiom learners find hard to read as "store `value`
in `var`"; BASIC-family languages spell assignment `LET x = 5` or bare `x = 5`, then reuse the same
`=` token for equality inside an `IF`; and Python/JavaScript reuse `=` for assignment and require a
doubled or tripled operator (`==`/`===`) for comparison, which is exactly right operationally but
still only one keystroke away from a classic "assignment where I meant comparison" bug. OpenLogo is
learner-facing from the first lesson (`spec/educational-model.md`'s level table starts learners on
`=` and `print` before any control flow), so the language needed one token that unambiguously means
"store" and a different one that unambiguously means "compare" — with no operator that means both
depending on position, and a friendly on-ramp for anyone arriving with classic Logo muscle memory.

## Decision

OpenLogo's grammar assigns three ways and never lets `=` compare (`spec/grammar.md`'s
[EBNF notation](../../spec/grammar.md#ebnf-notation) section, grammar productions at lines 103–105):

- `<place> = <value>` — the colon-form assignment (`assignment ::= colon-place "=" expression`).
  The target's leading `:` marks it as a place: `:size = 100`, `:nums[1] = 9`.
- `set <place> to <value>` — the worded assignment (`set-assignment ::= "set" bare-place "to"
  expression`), the same place rules without the leading colon, including postfix selectors such as
  `set nums[1] to 9`: `set size to 100`.
- `make <word-literal> <value>` — the **Heritage** profile's alternate assignment special form
  (`make-assignment ::= "make" word-literal expression`), specified in `spec/commands.md`'s
  [Variables and output](../../spec/commands.md#variables-and-output) section under `set … to`'s
  entry ("**Aliases:** `make \"n\" v` heritage form"): `make "size" 120`. Because its target is a
  `word-literal` rather than a `bare-place`, `make` can only name a simple variable — it has no way
  to spell a postfix selector, so it is equivalent to `set … to` for simple names only, not for
  places like `nums[1]`.

`==`/`!=` are OpenLogo's **equality/inequality** operators; ordering (`<`, `>`, `<=`, `>=`) and the
worded `is`-predicates sit alongside them at the same expression level (`spec/grammar.md`'s
[Expressions and calls](../../spec/grammar.md#expressions-and-calls) section, `comparison ::=
additive ( is-predicate | { compare-op additive } )` and `compare-op ::= "==" | "!=" | "<" | ">" |
"<=" | ">="`, lines 179–180). What all of them share, and what this decision is actually about, is
that every comparison is an expression-level reporter, never a statement, while every assignment
form (`=`, `set … to`, and Heritage `make`) is a statement, and none of them compares.
`spec/grammar.md` states explicitly: *"Assignment `=` and `set ... to` are statement forms, not
expression operators"* and `=` "never compares" (`spec/commands.md`'s notation section, line 48).

`make` is not Core: it is gated behind the Heritage profile alongside the other classic-Logo
spellings (`fd`, `bk`, `to … end`, …), so a program written entirely in canonical OpenLogo never
needs it, while a learner arriving from classic Logo can opt in without learning a new mental model
for storage. **As of this writing, `@openlogo/parser` has implemented the colon-form `=` and worded
`set … to` assignment forms but has not yet implemented the Heritage `make` spelling** (see
`packages/parser/src/parser.ts`'s header comment: "the Heritage spellings (`make`/`to`/`output`/
`op`/aliases) are handled by their own later slices; until then those spellings degrade to ordinary
calls or a collected diagnostic"). The example below is therefore marked as *specified, not yet
runnable* pending that Heritage slice.

The two implemented forms and `==` execute today, verified against `@openlogo/runtime`'s `execute`
(each `# =>` comment is the actual `print` output produced when the snippet is run):

```logo
:count = 5
if :count == 5
  print "ready"
end if
# => ready

set count to 6
print :count
# => 6
```

The Heritage form, once implemented, is specified to behave like `set … to` for simple variable
names only (its target is a quoted word, not a bare place, so it cannot spell a postfix selector
such as `nums[1]`):

```logo
# Heritage profile — specified in spec/commands.md; not yet runnable (see note above).
make "count" 7
print :count
# => 7 (once the Heritage `make` slice lands)
```

## Rationale

Three deliberate choices are packed into this decision:

1. **A different token family for assignment than for comparison.** `=`/`set … to` never compare
   and `==`/`!=` never assign, so there is no operator whose meaning depends on where it appears in
   a statement — unlike Python/JS, where `=` is unambiguous once you know it is a statement, but a
   learner scanning `if x = 5` from a BASIC-family background cannot tell by the token alone. A
   learner can point at any `=` in OpenLogo source and know it means "store", full stop.
2. **A colon marks the assignment target as a place, everywhere.** `:size = 100` reads left-to-right
   as "the place named `size` becomes 100"; the same `:size` token is what reads the variable
   elsewhere (`print :size`), so the language has one visual marker for "this is a variable
   reference/place" instead of two different spellings for read vs. write.
3. **`make` exists, but only as an on-ramp, not the primary form.** Classic Logo's `make "var value`
   idiom is equivalent to `set … to` for simple variable names but reads backwards to a modern eye
   (a command named "make" that takes a quoted word first) and its quoting convention (`"var` — an
   *open*-quote word, no closing quote) is exactly the kind of surprising lexical special case
   OpenLogo's grammar avoids everywhere else (`spec/grammar.md` line 19: *"Classic Logo open-quote
   word syntax such as `"word` is not OpenLogo"*). Keeping `make` as a fully-quoted assignment
   special form (`make "var" value`) under the Heritage profile gives migrating learners and ported
   programs a working alias without importing that lexical exception into Core, and without making
   it the form curriculum teaches first.

## How other languages do it

- **Classic Logo** already uses *distinct* spellings for the two roles: assignment is the
  `make "var value` command (an open-quote word naming the variable, followed by the new value)
  and equality is a bare `=` inside predicates like `if :x = 5 [...]`. The two roles never share a
  token, so the tension OpenLogo resolves here is not operator overloading but the open-quote word
  syntax — a lexical special case OpenLogo deliberately drops, which is why `make` survives only as
  the fully-quoted `make "var" value` Heritage alias.
- **BASIC-family languages** (BASIC, Visual Basic) spell assignment `LET x = 5` (or bare `x = 5`)
  and reuse the identical `=` token for equality inside `IF x = 5 THEN`; there is no distinct
  comparison spelling at all, so `=`'s meaning depends entirely on statement position.
- **JavaScript** spells assignment `x = 5` and equality `x == 5` (further distinguishing loose `==`
  from strict `===`) — closest in spirit to OpenLogo's split, but assignment is a valid *expression*,
  so `if (x = 5)` is accepted by the parser and only flagged by style guides and linters; the two
  operators sit one keystroke apart, which is exactly the typo class those linters exist to catch.
- **Python** also spells assignment `x = 5` and equality `x == 5`, but goes further than a lint rule:
  a bare `=` is a *statement*, not an expression, so `if x = 5:` is a hard `SyntaxError` at parse time
  (assignment-as-expression requires the distinct walrus operator `:=`). OpenLogo takes the same
  parser-enforced stance — `=` assigns only in statement position — so the mistake is a diagnostic,
  not a silently-accepted truthiness bug.
- **Pascal** spells assignment `:=` (a distinct two-character token) and equality `=`, giving
  assignment and comparison genuinely different symbols — the same design goal as OpenLogo, reached
  by inventing a new symbol for assignment instead of a new word. OpenLogo instead reuses the
  already-established colon-prefixed place syntax (`:name`) plus plain `=`, and offers the fully
  worded `set … to` alternative, favoring words a learner can read aloud over a symbol that must be
  memorized.

## Consequences

- **Clarity, fewer beginner mistakes:** every `=` a learner sees is assignment; every `==` is
  comparison. There is no statement position in which the meaning of either token changes, so the
  classic "used `=` where I meant `==`" class of bug that plagues C-family and BASIC-family
  beginners cannot arise from token confusion in OpenLogo — only from a genuine logic error.
- **No chained assignment, no assignment-as-expression:** because `=` and `set … to` are statement
  forms (`spec/grammar.md`: *"Assignment `=` and `set ... to` are statement forms, not expression
  operators"*), OpenLogo has no `a = b = c` chaining and no `if (x = compute())`-style assignment
  hiding inside a condition — a condition can only ever be a genuine comparison or boolean
  expression, closing off an entire class of "did I mean `=` or `==` here?" ambiguity by
  construction rather than by convention.
- **A friendly Heritage on-ramp without a Core lexical exception:** `make` gives classic-Logo
  learners and ported code a working alias, but because it lives in the Heritage profile as a
  fully-quoted assignment special form (not an open-quote word), Core's grammar stays free of the
  one lexical special case (`"word` without a closing quote) that would otherwise have followed it
  in. That same fully-quoted-word constraint also means `make` can only target a simple variable
  name, never a nested place like `nums[1]` or `people.tom.age`.
- **Curriculum and tooling teach one primary form:** lessons, `explain`/`hint`, and the syntax
  highlighter treat `:size = 100` and `set size to 100` as the two canonical spellings a learner
  meets first; `make` surfaces only once the Heritage profile is introduced, keeping the earliest
  lessons free of a spelling that exists solely for migration.

## Spec references

- `spec/grammar.md` — [EBNF notation](../../spec/grammar.md#ebnf-notation): the `assignment`/
  `set-assignment`/`make-assignment` grammar productions (lines 103–105); [Expressions and
  calls](../../spec/grammar.md#expressions-and-calls): the `comparison`/`compare-op` productions
  (lines 179–180) and the explicit statement-vs-operator rule for `=`/`set … to` vs `==`/`!=`.
- `spec/commands.md` — [Variables and output](../../spec/commands.md#variables-and-output): the
  `<place> = <value>` and `set … to` primitive entries, including the Heritage `make "n" v` alias
  noted on `set … to`'s entry, and the notation section's canonical example block showing all three
  assignment spellings plus `==`.
