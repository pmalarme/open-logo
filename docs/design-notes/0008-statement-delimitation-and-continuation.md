# 8. Statement delimitation and continuation — why a newline ends a statement, and why `- 5` and `-5` differ

- Status: Accepted
- Date: 2026
- Deciders: OpenLogo maintainer (@pmalarme) + team

## Context

OpenLogo programs are normally written one instruction per line, and a learner can type `forward 100` and
press Enter confident that the instruction is complete. But what happens when an expression is too
long for one line? And what happens when the next line starts with `-5` — is that a negative number,
or a subtraction from the previous line's result?

These questions were raised during saga #983 (Multi-line source and newline semantics), which set out
to document a rule the parser already enforced but the spec had not yet stated precisely. The saga
discovered three things worth recording, because each contradicts a reasonable assumption a reader
might make about how the language works:

1. A single space at the start of a continuation line can silently change a program's meaning:
   `print 10` followed by `- 5` on the next line prints **5**, while `print 10` followed by `-5`
   prints **10** — and neither produces a parse or runtime error (the opt-in style lint
   `ol-style-ambiguous-continuation` flags both forms).
2. A command that needs more arguments does **not** reach across a newline to get them: `print` on
   one line and `abs 3` on the next is two statements, not one.
3. Continuation works in both directions: a trailing operator (`print 1 +` then `2`) and a leading
   operator (`print 1` then `+ 2`) both produce one statement that prints **3**.

Each of these is a consequence of the same underlying design: statement delimitation is
**token-driven, not arity-driven**, and the set of tokens that continue a statement across a
newline is closed and exhaustive for the Core Language profile. `spec/grammar.md:34` now states the
complete rule; optional profiles such as Heritage may define additional continuation positions
(documented in their respective spec sections).

## Decision

A newline ends the current statement **unless a continuation is pending**. A continuation is pending
when the token at the boundary — the last token of the current line or the first token of the next
line — syntactically requires more input. The rule operates at two levels, both specified in
`spec/grammar.md:34`:

**Expression-level continuation** keeps one expression open across a newline. The following three
triggers are closed and exhaustive for the Core Language profile (optional profiles such as Heritage
may define additional multi-token readers whose incomplete positions also open continuations,
documented in their respective spec sections):

1. **An unclosed delimiter.** Inside `( … )`, `[ … ]`, or `{ … }`, newlines are insignificant.
2. **A trailing operator, operator keyword, or incomplete production.** The line ends with a token
   whose grammar production requires at least one more token: any infix operator (`+`, `-`, `*`,
   `/`, `mod`, `or`, `and`, `==`, `!=`, `<`, `>`, `<=`, `>=`), the prefix `not`, or the comparison
   keyword `is` and the multi-token predicates it begins (`is empty`, `is member of`, `is a`,
   `is [ strictly ] between`). Once an `is`-predicate has begun, the entire predicate is a single
   expression and newlines within it are insignificant.
3. **A leading infix operator, comparison keyword, or field accessor.** The next line begins with
   an infix operator from the same set, or with `is` followed by a valid predicate form, or with
   `.` followed by an identifier. The previous line's final operand becomes the left operand.

**Statement-level continuation** keeps a control statement open after its bracket body: `else` after
a bracket-form `if` is the only trigger.

**Arity never opens a continuation at either level.** A command or reporter that has received fewer
inputs than its signature requires does not reach across a newline; the statement terminates and the
arity checker reports `ol-not-enough-inputs`.

Verified against `@openlogo/parser` and `@openlogo/runtime` on the saga branch:

```logo
# Trailing operator continues the statement:
print 1 +
  2
# => 3
```

```logo
# Leading operator also continues the statement:
print 1
  + 2
# => 3
```

The arity rule is best shown by contrast. This program runs cleanly — `abs 3` is a separate
statement whose result is silently discarded, and `print 10` prints **10**:

```logo
# Arity does NOT continue — these are two separate statements.
# `print 10` is complete (arity 1, one argument supplied).
# `abs 3` starts a new statement whose result is discarded.
print 10
abs 3
# => 10
```

If a command has **fewer** arguments than it needs, the statement still terminates at the newline
and the arity checker reports `ol-not-enough-inputs`. In the program `print` (no argument) followed
by `abs 3`, the bare `print` does not reach across the newline — it becomes two statements and the
checker flags the missing input.

The `-5` vs `- 5` contrast is similarly best shown side by side. With a space, `- 5` is infix
subtraction and continues the previous line:

```logo
# `- 5` (with space) is a leading operator — continues `print 10` as one expression:
print 10
- 5
# => 5
```

Without a space, `-5` is a negative literal and starts a new statement:

```logo
# `-5` (no space) is a negative literal — starts a new statement.
# `print 10` prints 10; the standalone `-5` is silently discarded.
print 10
-5
# => 10
```

## Rationale

### Why `- 5` and `-5` differ

This is the sharpest surprise in the rule, so it deserves explanation first. The behaviour is **not**
an independent design choice — it is a direct consequence of the lexical rule in
`spec/grammar.md:17` (the "Numbers" paragraph): a `-` directly before a numeral **with no left
operand** is part of the literal. That rule is what makes `:delta = -5` parse as an assignment of
the number negative five rather than a subtraction with a missing left operand, which is clearly the
right reading.

The consequence at a newline boundary:

- `- 5` (with a space) lexes as two tokens: the infix subtraction operator `-`, then the literal
  `5`. The leading infix operator is a continuation trigger (item 3 above), so it reaches back to
  the previous line and the two lines form one expression.
- `-5` (without a space) lexes as one token: the negative numeric literal `-5`. There is no
  operator, so no continuation trigger fires and a new statement begins.

The saga considered whether to change this — to treat a leading `-5` as continuation regardless of
spacing. The maintainer ruled that the behaviour does not change: the negative-literal rule is too
valuable to weaken (every use of `:x = -5` depends on it), and the ambiguity is better surfaced by
tooling. `ol-style-ambiguous-continuation` flags both `- 5` and `-5` at the start of a line after
an expression, making the ambiguity visible without changing what the program means.

This is an exception to the general rule that horizontal whitespace is insignificant. The spec
states it explicitly: "Because `- 5` and `-5` produce different programs, horizontal whitespace at
the start of a line can affect tokenization and therefore statement structure"
(`spec/grammar.md:34`).

### Why arity never opens a continuation

The alternative — letting a command that still needs arguments reach across a newline — was
explicitly considered during saga #983 and rejected. The cost would have been:

1. **Statement boundaries become arity-dependent.** OpenLogo's parser already consults a name
   registry to determine each callable's fixed default arity for grouping arguments within a
   statement (see LDR-0003). But **statement-boundary recognition** does not consult arity — it is
   determined entirely by the tokens at the line boundary. Arity-driven continuation would extend
   that dependency: whether a newline ends a statement would depend on how many arguments the
   preceding command still needs, not on what tokens the reader can see. The boundary decision, which
   today is local and token-visible, would become context-dependent at a distance.
2. **Reading becomes unpredictable.** A learner looking at two lines cannot tell whether they are
   one statement or two without knowing the arity of the first line's command. `forward` followed
   by `100` on the next line would be one statement; `pen_up` followed by `100` would be two.
   Whether a newline ends a statement would depend on which command was called, not on what the
   reader can see at the line boundary.
3. **Errors become silent instead of loud.** Today, a bare `print` with no argument raises
   `ol-not-enough-inputs` — a clear diagnostic naming the callable and the expected count. With
   arity-driven continuation, the parser would silently consume the next line as the missing
   argument, and a program that was meant to be two instructions would become one. The error would
   surface later, if at all, as a wrong result rather than a diagnostic.

The token-driven rule keeps statement boundaries visually obvious: a newline's effect is determined
by the tokens at the boundary, which the reader can see.

### Why continuation is bidirectional

The saga's own opening description proposed a **trailing-only** rule: a newline terminates a
statement unless the line **ends** with a token that demands more. Measurement during the saga
proved this wrong — the shipped parser already accepted **leading** operators too:

```logo
print 1
  + 2
# => 3
```

```logo
print 1
  * 5
# => 5
```

The trailing-only proposal would have forbidden these programs, which the language had always
accepted. This is a case of a rule being **discovered rather than designed**: the parser's
operator-needs-an-operand mechanism naturally applies in both directions (an operator needs an
operand on each side, regardless of which side the newline falls on), and the saga's contribution
was to recognize that the bidirectional behaviour was correct, name it, and specify it.

The bidirectional rule has a practical benefit: a learner who breaks a long expression at a `+` can
put the operator at the end of the first line or at the start of the second, and both work. This
matches the flexibility that Python offers inside brackets (PEP 8 even prefers breaking **before**
binary operators) and avoids a trap that a trailing-only rule would create: forcing the learner to
remember which end of the line break the operator must go on.

## How other languages do it

OpenLogo's choice is genuinely different from its neighbours, and the comparison is instructive
because each language picked a different trade-off between the same constraints.

**Python** uses **bracket-driven** implicit line joining: inside `()`, `[]`, or `{}`, newlines are
insignificant (like OpenLogo's trigger 1), but outside brackets a trailing operator does **not**
continue a line — the programmer must use `\` for an explicit continuation or wrap the expression in
parentheses. Leading-operator continuation inside brackets is idiomatic (PEP 8 recommends breaking
before binary operators). OpenLogo is more permissive: both trailing and leading operators continue
without any bracketing, which trades a small ambiguity (the `-5` case) for not requiring the learner
to know about escape characters or grouping-for-continuation.

**JavaScript** uses **automatic semicolon insertion (ASI)**, whose rules are notoriously
counterintuitive. The famous hazard is the opposite of OpenLogo's: a leading `(` or `[` on a new
line continues the previous statement and silently changes meaning (a function call or property
access where the programmer intended two statements). JavaScript's ASI is driven by whether the
next token **can** continue the previous statement grammatically, which makes it powerful but
unpredictable — a design OpenLogo deliberately avoids by making the trigger set closed and
exhaustive.

**Go** inserts a semicolon when the **last token** of the line is an identifier, literal, or
closing bracket (among other terminal tokens) — so a break before an infix operator after one of
those tokens is syntactically invalid, not merely discouraged by style. This is effectively a
trailing-only rule, and it is the rule saga #983 considered and rejected: it forbids
leading-operator continuation. Go enforces operator-at-end placement through its syntax and
mandatory formatter (`gofmt`). OpenLogo has no mandatory formatter, so a trailing-only rule would
silently break programs where a learner placed the operator at the start of the next line.

**Classic Logo** is largely **line-oriented**: input is processed line by line, though a single line
or bracket body may contain multiple arity-delimited instructions. Multi-line expressions are not a
standard feature across dialects (some support `~` as an explicit continuation character).
OpenLogo's token-driven continuation is a departure from this heritage, motivated by the same
readability goal that Logo's line orientation served — keeping instructions short and obvious — while
accommodating expressions that genuinely need more than one line.

## Consequences

- **Statement boundaries are locally determinable.** A reader scanning OpenLogo source can identify
  statement boundaries by looking at the tokens at the edges of each line: if the line ends or the
  next line begins with a continuation trigger — an operator, an operator keyword like `not` or
  `is`, a field accessor `.name`, an unclosed bracket, or `else` after a bracket-form `if` — the
  statement continues; otherwise it ends. No knowledge of command arities is needed; the complete
  Core trigger list is in the Decision section above.
- **The `-5` ambiguity is the price of negative literals plus bidirectional continuation.** The
  interaction between the negative-literal lexing rule and the leading-operator continuation trigger
  creates one case where a space at the start of a line changes the program. This is an accepted
  trade-off, surfaced by the `ol-style-ambiguous-continuation` lint rather than resolved by changing
  the language.
- **Arity errors are loud, not silent.** Because arity does not open a continuation, a command
  missing its arguments produces `ol-not-enough-inputs` at the checking stage — a diagnostic that
  names the callable and the expected count. The alternative (silently consuming the next line)
  would convert a missing-argument error into a wrong-program bug.
- **Leading and trailing operators are equally valid.** A learner can break a long expression at an
  operator and place the operator on either side of the line break. The language does not mandate a
  style; the `ol-style-ambiguous-continuation` lint (`spec/tooling.md:254`) flags all leading
  arithmetic operators (`+`, `-`, `*`, `/`, `mod`) on continuation lines to make the implicit
  continuation visible, and for the `-` case it additionally names both readings (subtraction vs
  negative literal) so the learner can verify which one the parser chose.
- **The trigger set is closed and grows only by spec amendment.** The four continuation triggers
  (unclosed delimiter, trailing operator, leading operator, `else` after bracket-form `if`) are
  enumerated in `spec/grammar.md:34` and described as "closed and exhaustive for the Core Language
  profile." Adding a new trigger requires a spec change, which prevents the continuation rules from
  growing ad hoc as new features are added.

## Spec references

- `spec/grammar.md:34` — the normative paragraph defining statement delimitation, continuation
  triggers (expression-level and statement-level), the arity-never-continues rule, and the `-5`
  tokenization exception.
- `spec/grammar.md:17` — the "Numbers" paragraph defining the negative-literal lexing rule (a `-`
  directly before a numeral with no left operand is part of the literal), which is the root cause
  of the `- 5` vs `-5` distinction at newline boundaries.
- `spec/tooling.md:254` — the `ol-style-ambiguous-continuation` lint definition, which flags all
  leading arithmetic operators on continuation lines and names both readings for the `-` case.
