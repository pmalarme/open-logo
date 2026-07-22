> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Command and Primitive Reference

[Back to the specification index.](README.md)

This document is the normative reference for the OpenLogo (OL) Core Language primitives and the Turtle & Rendering primitives. It follows the canonical primitive matrix in the v0.1.0 language contract. Geometry helpers are a derived standard library in [geometry-module.md](geometry-module.md). Mutable dictionaries and records are in [data-structures.md](data-structures.md). Multiple turtles and sprites are in [turtles-and-sprites.md](turtles-and-sprites.md). Input events and sound are in [interaction-events.md](interaction-events.md). Tutor and meta-command behavior is in [educational-model.md](educational-model.md) and [ai-tutor.md](ai-tutor.md).

## Notation and language surface

Primitive entries use this shape:

- **Signature** is the canonical spelling and default arity. Alternate or variadic arities use the parenthesized call form such as `(print :a :b)`.
- **Aliases** are canonical synonyms from the primitive matrix. The full underscored name is primary when one exists. Single-token short aliases remain available where listed.
- **Kind** is **Command**, **Reporter**, or **Special form**.
- **Argument types** name accepted value types or syntactic slots.
- **Result** is the reported value or `—` for commands and effect-only special forms.
- **Concept** names the idea the primitive teaches.

All examples are lowercase and use the locked OL surface:

```logo
:count = 5
set count to 6
make "count" 7
print :count

if :count == 7
  print "ready"
end if

:nums = [10 20 30]
print :nums[1]
:nums[2] = 25

:ages = { tom: 8 }
print :ages.tom
print :ages[tom]
:ages.max = 9
```

The modern variable idiom is:

- `:name` marks a variable read and a colon-form assignment target.
- `:name = value` assigns.
- `set name to value` is an equally valid worded assignment using a bare place.
- `make "name" value` is the heritage assignment spelling.
- `==` and `!=` compare values. `=` never compares.

The access idiom is:

- `:x[i]` reads or writes a 1-based list slot.
- `:x.f` reads or writes a record field or dictionary key.
- `:d.k` and `:d[k]` read or write dictionary keys.
- `:d[:k]` uses the value of variable `:k` as the key.
- Nested chains such as `:people.tom.age` are places when used on the left of `=`.

OpenLogo has no `function` primitive, no `f(x,y)` call syntax, no lambda syntax, and no commas. Calls are prefix and space-separated.

`input` is not Core. It belongs to the Interaction profile and is specified in [interaction-events.md](interaction-events.md).

## Variables and output

### `<place> = <value>`

- **Signature:** `<place> = <value>`
- **Aliases:** none (the worded `set … to` and heritage `make "n" v` are separate spellings, not aliases of this token)
- **Kind:** Special form
- **Argument types:** assignable place, value
- **Result:** —
- **Description:** Assigns a value to a colon-form place such as `:size`, `:nums[1]`, `:p.x`, or `:people.tom.age`. An undefined simple variable becomes global unless a lexical local exists. Writing a missing dictionary key at the final selector upserts it.
- **Concept:** A variable or nested place can name a changing value.
- **Example:**

```logo
:size = 100
:nums = [1 2 3]
:nums[1] = 9
```

- **Possible errors:** `ol-not-a-place`, `ol-unknown-field`, `ol-range`; reads of intermediate missing keys may raise `ol-unknown-key`.

### `set … to`

- **Signature:** `set <place> to <value>`
- **Aliases:** `make "n" v` heritage form
- **Kind:** Special form
- **Argument types:** bare assignable place, value
- **Result:** —
- **Description:** Worded assignment using the same place rules as `=` but without the leading colon on the target.
- **Concept:** The same idea can be expressed with explicit learner-readable words.
- **Example:**

```logo
set size to 100
set nums[1] to 9
make "size" 120
```

- **Possible errors:** `ol-not-a-place`, `ol-unknown-field`, `ol-range`; reads of intermediate missing keys may raise `ol-unknown-key`.

### `local`

- **Signature:** `local name`; `(local a b …)` for multiple names
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** name or names
- **Result:** —
- **Description:** Declares one or more names local to the current procedure frame.
- **Concept:** A procedure can have private working memory.
- **Example:**

```logo
define grow :n
  local total
  :total = :n + 1
  return :total
end
```

- **Possible errors:** `ol-reserved-word` when a name is a reserved word. Used outside any procedure, `local` introduces the name in the top-level program frame rather than raising an error.

### `thing`

- **Signature:** `thing name`
- **Aliases:** `:name` sugar
- **Kind:** Reporter
- **Argument types:** name
- **Result:** value
- **Description:** Reports the value bound to a variable name. The preferred spelling is `:name`.
- **Concept:** Reading a name retrieves the value it stores.
- **Example:**

```logo
:size = 50
print :size
print thing "size"
```

- **Possible errors:** `ol-undefined-var`.

### `print`

- **Signature:** `print value`; `(print …)` for multiple values
- **Aliases:** `pr`
- **Kind:** Command
- **Argument types:** value or values
- **Result:** —
- **Description:** Emits learner-visible text output. Multiple values require the parenthesized variadic form.
- **Concept:** A program can communicate its result.
- **Example:**

```logo
print "hello"
(print "x" :x)
```

- **Possible errors:** none specified beyond general arity diagnostics.

### `show`

- **Signature:** `show value`
- **Aliases:** none
- **Kind:** Command
- **Argument types:** value
- **Result:** —
- **Description:** Emits a displayed representation of one value. It is a Core output command with implementation-defined presentation details.
- **Concept:** Values have visible representations.
- **Example:**

```logo
show [1 2 3]
```

- **Possible errors:** none specified beyond general arity diagnostics.

## Math

OpenLogo numbers are IEEE-754 double values. Trigonometric functions use degrees. Division by zero and invalid square roots are educational errors rather than NaN or Infinity.

### `+`

- **Signature:** `number + number`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** number, number
- **Result:** number
- **Description:** Adds two numbers.
- **Concept:** Addition as numeric composition.
- **Example:**

```logo
print 2 + 3
```

- **Possible errors:** `ol-type`.

### `-`

- **Signature:** `number - number`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** number, number
- **Result:** number
- **Description:** Subtracts the right number from the left number. A leading `-` written directly on a numeral, as in `-3`, is a negative numeral literal produced by the lexer, not this operator; negate an expression by writing `0 - :x`.
- **Concept:** Difference and direction on a number line.
- **Example:**

```logo
print 10 - 4
print -3
```

- **Possible errors:** `ol-type`.

### `*`

- **Signature:** `number * number`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** number, number
- **Result:** number
- **Description:** Multiplies two numbers.
- **Concept:** Repeated groups and scale.
- **Example:**

```logo
print 6 * 7
```

- **Possible errors:** `ol-type`.

### `/`

- **Signature:** `number / number`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** number, number
- **Result:** number
- **Description:** Divides the left number by the right number.
- **Concept:** Sharing and ratio.
- **Example:**

```logo
print 12 / 3
```

- **Possible errors:** `ol-type`, `ol-div-zero`.

### `mod`

- **Signature:** `number mod number`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** number, number
- **Result:** number
- **Description:** Reports the remainder after division.
- **Concept:** Cycles and wraparound.
- **Example:**

```logo
print 17 mod 5
```

- **Possible errors:** `ol-type`, `ol-div-zero`.

### `abs`

- **Signature:** `abs number`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number
- **Result:** number
- **Description:** Reports the distance of a number from zero.
- **Concept:** Magnitude without sign.
- **Example:**

```logo
print abs -5
```

- **Possible errors:** `ol-type`.

### `sqrt`

- **Signature:** `sqrt number`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number
- **Result:** number
- **Description:** Reports the square root of a non-negative number.
- **Concept:** Inverse of squaring.
- **Example:**

```logo
print sqrt 81
```

- **Possible errors:** `ol-type`, `ol-neg-sqrt`.

### `int`

- **Signature:** `int number`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number
- **Result:** number
- **Description:** Reports the integer part of a number by truncating toward zero (the fractional part is dropped), so `int 3.8` is `3` and the integer part of `-3.8` is `-3`.
- **Concept:** Separating whole-number quantity from fractional detail.
- **Example:**

```logo
print int 3.8
```

- **Possible errors:** `ol-type`.

### `round`

- **Signature:** `round number`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number
- **Result:** number
- **Description:** Reports the nearest whole number. A value exactly halfway between two whole numbers rounds up toward positive infinity, so `round 3.5` is `4` and the nearest whole number to `-3.5` is `-3`.
- **Concept:** Approximation.
- **Example:**

```logo
print round 3.8
```

- **Possible errors:** `ol-type`.

### `power`

- **Signature:** `power number number`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number, number
- **Result:** number
- **Description:** Raises the first number to the second number as an exponent.
- **Concept:** Exponential growth.
- **Example:**

```logo
print power 2 8
```

- **Possible errors:** none specified beyond general type and arity diagnostics.

### `random`

- **Signature:** `random number`; `(random a b)` for an inclusive range
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number or two numbers
- **Result:** number
- **Description:** `random n` reports an integer in `[0, n-1]`; `n` MUST be a whole number of at least `1`. `(random a b)` reports an integer in `[a, b]`; `a` and `b` MUST be whole numbers with `a <= b`. Inputs are checked in order: a non-whole bound raises `ol-type`; then `n` below `1`, or `a` greater than `b`, raises `ol-range`.
- **Concept:** Controlled unpredictability.
- **Example:**

```logo
print random 100
print (random 1 6)
```

- **Possible errors:** `ol-type`, `ol-range`.

### `randomize`

- **Signature:** `randomize`; `(randomize seed)`
- **Aliases:** none
- **Kind:** Command
- **Argument types:** none or seed
- **Result:** —
- **Description:** Seeds the random number generator. With no seed the implementation chooses a seed. With a seed the sequence is deterministic within an implementation.
- **Concept:** Experiments can be repeatable.
- **Example:**

```logo
(randomize 123)
print random 10
```

- **Possible errors:** none specified beyond general arity diagnostics.

### `sin`

- **Signature:** `sin number`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number in degrees
- **Result:** number
- **Description:** Reports the sine of an angle measured in degrees.
- **Concept:** Turning angle to horizontal component.
- **Example:**

```logo
print sin 90
```

- **Possible errors:** none specified beyond general type and arity diagnostics.

### `cos`

- **Signature:** `cos number`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number in degrees
- **Result:** number
- **Description:** Reports the cosine of an angle measured in degrees.
- **Concept:** Turning angle to vertical component.
- **Example:**

```logo
print cos 0
```

- **Possible errors:** none specified beyond general type and arity diagnostics.

### `tan`

- **Signature:** `tan number`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number in degrees
- **Result:** number
- **Description:** Reports the tangent of an angle measured in degrees.
- **Concept:** Slope from an angle.
- **Example:**

```logo
print tan 45
```

- **Possible errors:** `ol-type`, `ol-tan-undefined`.

### `pi`

- **Signature:** `pi`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** none
- **Result:** number
- **Description:** Reports the mathematical constant π.
- **Concept:** Circles have a shared ratio.
- **Example:**

```logo
print pi
```

- **Possible errors:** none specified.

## Logic and predicates

Booleans are strict. The only boolean literals are `true` and `false`. Conditions and logical operands must already be boolean values. OpenLogo has no truthiness.

Comparisons may be **chained**: `1 < :x < 10` means `1 < :x and :x < 10`, with each operand evaluated once. Alongside the prefix `?`-predicates below, OpenLogo offers equivalent **worded predicates** that read as English and also return booleans, written **operand-first** with the value before `is`: `<value> is empty` (see `empty?`), `<value> is member of <collection>` (see `member?`), `<value> is a <type-word>` (see `is_a?`), and `<value> is [ strictly ] between <low> and <high>` (inclusive, or exclusive with `strictly`). Only `is`, `strictly`, and `between` are reserved; `empty`, `member`, `of`, and `a` are contextual keywords after `is`. There is no infix `in` membership operator — use the worded form or `member?`.

### `==`

- **Signature:** `value == value`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** value, value
- **Result:** boolean
- **Description:** Reports whether two values are equal under the OL equality rules.
- **Concept:** Testing sameness.
- **Example:**

```logo
print 5 == "5"
```

- **Possible errors:** none specified for equality.

### `!=`

- **Signature:** `value != value`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** value, value
- **Result:** boolean
- **Description:** Reports the negation of `==`.
- **Concept:** Testing difference.
- **Example:**

```logo
print :name != "tom"
```

- **Possible errors:** none specified for inequality.

### `<`

- **Signature:** `value < value`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** number with number or word with word
- **Result:** boolean
- **Description:** Reports whether the left value orders before the right value.
- **Concept:** Ordering.
- **Example:**

```logo
print 3 < 4
```

- **Possible errors:** `ol-type`.

### `>`

- **Signature:** `value > value`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** number with number or word with word
- **Result:** boolean
- **Description:** Reports whether the left value orders after the right value.
- **Concept:** Ordering.
- **Example:**

```logo
print 5 > 4
```

- **Possible errors:** `ol-type`.

### `<=`

- **Signature:** `value <= value`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** number with number or word with word
- **Result:** boolean
- **Description:** Reports whether the left value is less than or equal to the right value.
- **Concept:** Inclusive ordering.
- **Example:**

```logo
print 4 <= 4
```

- **Possible errors:** `ol-type`.

### `>=`

- **Signature:** `value >= value`
- **Aliases:** none
- **Kind:** Reporter infix
- **Argument types:** number with number or word with word
- **Result:** boolean
- **Description:** Reports whether the left value is greater than or equal to the right value.
- **Concept:** Inclusive ordering.
- **Example:**

```logo
print 5 >= 4
```

- **Possible errors:** `ol-type`.

### `and`

- **Signature:** `boolean and boolean`; `(and …)` for multiple operands
- **Aliases:** none
- **Kind:** Reporter infix, short-circuit
- **Argument types:** boolean, boolean
- **Result:** boolean
- **Description:** Reports `true` only when both operands are true. The right operand is evaluated only if needed.
- **Concept:** Combining requirements.
- **Example:**

```logo
if :count > 0 and :count < 10
  print "inside"
end if
```

- **Possible errors:** `ol-not-boolean`.

### `or`

- **Signature:** `boolean or boolean`; `(or …)` for multiple operands
- **Aliases:** none
- **Kind:** Reporter infix, short-circuit
- **Argument types:** boolean, boolean
- **Result:** boolean
- **Description:** Reports `true` when at least one operand is true. The right operand is evaluated only if needed.
- **Concept:** Combining alternatives.
- **Example:**

```logo
if :done or :is_ready
  print "go"
end if
```

- **Possible errors:** `ol-not-boolean`.

### `not`

- **Signature:** `not boolean`
- **Aliases:** none
- **Kind:** Reporter unary prefix
- **Argument types:** boolean
- **Result:** boolean
- **Description:** Reports the opposite boolean.
- **Concept:** Negation.
- **Example:**

```logo
if not :done
  forward 50
end if
```

- **Possible errors:** `ol-not-boolean`.

### `true`

- **Signature:** `true`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** none
- **Result:** boolean
- **Description:** Reports the boolean true value.
- **Concept:** A condition can be explicitly true.
- **Example:**

```logo
:is_ready = true
```

- **Possible errors:** none specified.

### `false`

- **Signature:** `false`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** none
- **Result:** boolean
- **Description:** Reports the boolean false value.
- **Concept:** A condition can be explicitly false.
- **Example:**

```logo
:done = false
```

- **Possible errors:** none specified.

### `empty?`

- **Signature:** `empty? value`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** per predicate
- **Result:** boolean
- **Description:** Reports whether a supported value has no contents.
- **Concept:** Asking a yes-or-no question about data.
- **Example:**

```logo
print empty? []
print ([] is empty)
```

- **Possible errors:** `ol-type` when the value is not a list, dict, or word, matching the worded form `value is empty`.

### `member?`

- **Signature:** `member? value collection`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** per predicate
- **Result:** boolean
- **Description:** Reports whether a value is a member of a supported collection.
- **Concept:** Membership.
- **Example:**

```logo
print member? 2 [1 2 3]
print (2 is member of [1 2 3])
```

- **Possible errors:** `ol-type` when the collection is not a list or dict, matching the worded form `value is member of collection`.

### `is_a?`

- **Signature:** `is_a? value type`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** per predicate
- **Result:** boolean
- **Description:** Reports whether a value has the requested type. Record-specific behavior is specified in [data-structures.md](data-structures.md).
- **Concept:** Classifying values.
- **Example:**

```logo
print is_a? 5 "number"
print (5 is a "number")
```

- **Possible errors:** `ol-type` when the type argument is not a word, and `ol-unknown-type` when the type word does not name a known built-in type or declared struct.

## Control

Control forms run blocks for their effects and do not report values. Their bodies are bracketed `[ … ]` blocks or long `… end` blocks according to the reader rules in [grammar.md](grammar.md) and [execution-model.md](execution-model.md); a control body is always delimited.

### `if … [else …]`

- **Signature:** `if <cond> <block> [else <block>]`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** boolean condition, block, optional block
- **Result:** —
- **Description:** Runs the first block when the condition is `true`; otherwise runs the optional `else` block.
- **Concept:** Choice.
- **Example:**

```logo
if :count > 3
  print "big"
else
  print "small"
end if
```

- **Possible errors:** `ol-not-boolean`.

### `while`

- **Signature:** `while <cond> <block>`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** boolean condition, block
- **Result:** —
- **Description:** Repeats a block while its condition remains `true`.
- **Concept:** Repetition until a condition changes.
- **Example:**

```logo
:n = 3
while :n > 0
  print :n
  :n = :n - 1
end while
```

- **Possible errors:** `ol-not-boolean`, `ol-limit`.

### `repeat`

- **Signature:** `repeat count block`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** whole number, block
- **Result:** —
- **Description:** Runs a block a fixed number of times. `count` MUST be a non-negative whole number; `repeat 0` runs the block zero times. The checks are ordered: if `count` is not a whole number it raises `ol-type` (a whole number is required); otherwise, if it is negative, it raises `ol-range`.
- **Concept:** Counting loops.
- **Example:**

```logo
repeat 4
  forward 100
  right 90
end repeat
```

- **Possible errors:** `ol-type`, `ol-range`, `ol-limit`.

### `repcount`

- **Signature:** `repcount`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** none
- **Result:** number
- **Description:** Reports the current 1-based iteration count of the innermost enclosing `repeat`. When several `repeat` loops are nested, `repcount` refers to the nearest one.
- **Concept:** A loop can know which turn it is on.
- **Example:**

```logo
repeat 3
  print repcount
end repeat
```

- **Possible errors:** `ol-repcount-outside-repeat` when `repcount` is used outside any `repeat` loop.

### `for … in …`

- **Signature:** `for binder in listExpr block`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** binder, list expression, block
- **Result:** —
- **Description:** Runs a block once for each item in a list. The binder may be a name or a destructuring pattern where supported by the grammar.
- **Concept:** Visiting each item in a sequence.
- **Example:**

```logo
:names = ["ana" "tom"]
for name in :names
  print :name
end for
```

- **Possible errors:** `ol-type`.

### `for … from … to …`

- **Signature:** `for var from start to end block`; optional `by step`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** variable name, number, number, optional number, block
- **Result:** —
- **Description:** Runs a block over a numeric range with an inclusive start and end. The optional `by step` clause sets the increment (default `1`) and is part of Core; the `*(ext)*` mark in the primitive matrix is provenance only, not a separate profile. The variable begins at `start`; each turn adds `step`. With a positive `step` the block runs while the variable is `<= end`; with a negative `step` it runs while the variable is `>= end`. A `step` that points away from `end` — for example `for i from 1 to 4 by -1` — runs the block zero times, and a `step` of `0` cannot make progress and raises `ol-range`.
- **Concept:** Counting through a range.
- **Example:**

```logo
for i from 1 to 4
  print :i
end for
```

- **Possible errors:** `ol-type`, `ol-range`.

### `forever`

- **Signature:** `forever block`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** block
- **Result:** — cancellable
- **Description:** Runs a block until the program is cancelled or an implementation limit is reached.
- **Concept:** Continuous behavior.
- **Example:**

```logo
forever
  right 10
end forever
```

- **Possible errors:** `ol-limit`.

### `map`

- **Signature:** `map binder in listExpr [ expr ]`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** binder, list expression, bracketed expression-block
- **Result:** list
- **Description:** Builds a fresh list by evaluating the body for each item and keeping the last expression's value. It is not lambda syntax.
- **Concept:** Transforming every item.
- **Example:**

```logo
:nums = [1 2 3]
:doubled = map num in :nums [ :num * 2 ]
```

- **Possible errors:** `ol-type`, `ol-no-value`, `ol-return-in-comprehension`.

### `filter`

- **Signature:** `filter binder in listExpr [ boolExpr ]`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** binder, list expression, bracketed expression-block reporting boolean
- **Result:** list
- **Description:** Builds a fresh list containing the items whose body value is `true`.
- **Concept:** Keeping items that pass a test.
- **Example:**

```logo
:nums = [1 2 3]
:bigs = filter num in :nums [ :num > 1 ]
```

- **Possible errors:** `ol-not-boolean`, `ol-no-value`, `ol-return-in-comprehension`.

### `reduce`

- **Signature:** `reduce acc binder in listExpr from init [ expr ]`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** accumulator binder, item binder, list expression, initial value, bracketed expression-block
- **Result:** value
- **Description:** Folds a list from left to right. The body value becomes the next accumulator. On empty input it reports the initial value unchanged.
- **Concept:** Combining many values into one value.
- **Example:**

```logo
:nums = [1 2 3]
:total = reduce sum num in :nums from 0 [ :sum + :num ]
```

- **Possible errors:** `ol-no-value`, `ol-duplicate-binder`, `ol-return-in-comprehension`.

## Procedures

Procedures are named behavior. A procedure that reaches `return` reports a value. A procedure without `return` is a command. Procedure calls are prefix calls with fixed arity. Optional trailing parameters are specified on the `define` line and extra supplied arguments use the parenthesized call form.

### `define … end`

- **Signature:** `define name params block end`
- **Aliases:** `to` heritage form
- **Kind:** Special form
- **Argument types:** procedure name, parameters, procedure block
- **Result:** defines procedure
- **Description:** Defines a procedure during the reader registration phase so forward references work. The body uses long `end` or `end define` form.
- **Concept:** Naming a pattern so it can be reused.
- **Example:**

```logo
define double :n
  return :n * 2
end

print double 5
```

- **Possible errors:** `ol-reserved-word` when the procedure name collides with a reserved word or existing name. Wrong argument counts are reported at the call site as `ol-not-enough-inputs` or `ol-too-many-inputs`, not by `define` itself.

### `return`

- **Signature:** `return value`
- **Aliases:** `output`, `op` heritage aliases
- **Kind:** Special form
- **Argument types:** value
- **Result:** —
- **Description:** Exits the current procedure and supplies a reported value to the caller.
- **Concept:** A procedure can answer a question.
- **Example:**

```logo
define square :n
  return :n * :n
end
```

- **Possible errors:** `ol-return-outside-proc`, `ol-return-in-comprehension`, `ol-no-output` when a caller uses a non-reporting procedure as a reporter.

### `stop`

- **Signature:** `stop`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** none
- **Result:** —
- **Description:** Exits the current command procedure early without reporting a value.
- **Concept:** Ending work early.
- **Example:**

```logo
define draw_if_ready :ready
  if not :ready
    stop
  end if
  forward 100
end
```

- **Possible errors:** `ol-stop-outside-proc`, `ol-return-in-comprehension` when used inside a `map`/`filter`/`reduce` body.

### `throw`

- **Signature:** `throw <value>`
- **Aliases:** none
- **Kind:** Special form
- **Argument types:** value (typically a word message)
- **Result:** — (halts execution)
- **Description:** Halts execution immediately and raises the runtime diagnostic `ol-user-error`, using the thrown word as the learner-facing message; a non-word value is shown by its printed form. It lets a procedure reject invalid input in its own words — the geometry library uses it to validate arguments. v0.1 has no `try`/`catch`, so a thrown error stops the program like any other runtime error.
- **Concept:** A program can refuse bad input and say why.
- **Example:**

```logo
define checked_sqrt :n
  if :n < 0
    throw "square root needs a number that is not negative"
  end if
  return sqrt :n
end
```

- **Possible errors:** `ol-user-error` (the raised diagnostic).

## Words and lists

The primitives in this section are Core sequence operations. Mutable collection growth operations and dictionary or record access are specified in [data-structures.md](data-structures.md). The list is the single sequence type. There are no arrays.

### `word`

- **Signature:** `word word word`; `(word …)` variadic
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** word, word
- **Result:** word
- **Description:** Concatenates word values into a word.
- **Concept:** Building text from parts.
- **Example:**

```logo
print word "open" "logo"
```

- **Possible errors:** `ol-type`.

### `sentence`

- **Signature:** `sentence value value`; `(sentence …)` variadic
- **Aliases:** `se`
- **Kind:** Reporter
- **Argument types:** value, value
- **Result:** list
- **Description:** Builds a new list sentence from values. If an input is a list its items participate as sentence items according to the sequence rules in [data-structures.md](data-structures.md).
- **Concept:** Combining values into a sequence.
- **Example:**

```logo
print sentence "hello" "world"
```

- **Possible errors:** none specified.

### `first`

- **Signature:** `first wordOrList`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** word or list
- **Result:** element
- **Description:** Reports the first character of a word or first item of a list.
- **Concept:** Looking at the beginning.
- **Example:**

```logo
print first [10 20 30]
```

- **Possible errors:** `ol-range` for empty input.

### `last`

- **Signature:** `last wordOrList`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** word or list
- **Result:** element
- **Description:** Reports the last character of a word or last item of a list.
- **Concept:** Looking at the end.
- **Example:**

```logo
print last [10 20 30]
```

- **Possible errors:** `ol-range` for empty input.

### `butfirst`

- **Signature:** `butfirst wordOrList`
- **Aliases:** `bf`
- **Kind:** Reporter
- **Argument types:** word or list
- **Result:** word or list
- **Description:** Reports everything except the first character or item without mutating the original value.
- **Concept:** Making a smaller sequence by copying.
- **Example:**

```logo
print butfirst [10 20 30]
```

- **Possible errors:** `ol-range` for empty input.

### `butlast`

- **Signature:** `butlast wordOrList`
- **Aliases:** `bl`
- **Kind:** Reporter
- **Argument types:** word or list
- **Result:** word or list
- **Description:** Reports everything except the last character or item without mutating the original value.
- **Concept:** Copying a sequence with one part removed.
- **Example:**

```logo
print butlast [10 20 30]
```

- **Possible errors:** `ol-range` for empty input.

### `fput`

- **Signature:** `fput value list`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** value, list
- **Result:** new list
- **Description:** Reports a fresh list with the value placed at the front.
- **Concept:** Non-mutating construction.
- **Example:**

```logo
:nums = [2 3]
print fput 1 :nums
```

- **Possible errors:** none specified beyond general type and arity diagnostics.

### `lput`

- **Signature:** `lput value list`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** value, list
- **Result:** new list
- **Description:** Reports a fresh list with the value placed at the end.
- **Concept:** Non-mutating construction.
- **Example:**

```logo
:nums = [1 2]
print lput 3 :nums
```

- **Possible errors:** none specified beyond general type and arity diagnostics.

### `count`

- **Signature:** `count wordOrListOrDict`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** word, list, or dict
- **Result:** number
- **Description:** Reports the number of characters, list items, or dictionary entries.
- **Concept:** Measuring collection size.
- **Example:**

```logo
print count [1 2 3]
```

- **Possible errors:** none specified beyond general type and arity diagnostics.

### `uppercase`

- **Signature:** `uppercase word`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** word
- **Result:** word
- **Description:** Reports a word with letters converted to uppercase using Unicode-aware casing.
- **Concept:** Transforming text.
- **Example:**

```logo
print uppercase "logo"
```

- **Possible errors:** `ol-type`.

### `lowercase`

- **Signature:** `lowercase word`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** word
- **Result:** word
- **Description:** Reports a word with letters converted to lowercase using Unicode-aware casing.
- **Concept:** Transforming text.
- **Example:**

```logo
print lowercase "Logo"
```

- **Possible errors:** `ol-type`.

## Turtle movement

Turtle geometry uses origin `(0,0)` at the canvas center, +x to the right, +y upward, and heading `0` degrees upward. `right` turns clockwise and `left` turns counter-clockwise. Movement uses degrees. At program start the turtle is at position `(0,0)`, heading `0`, pen down, color `"black"`, width `1`, visible, with background `"white"`. `clear_screen` clears the drawing and homes the turtle but preserves the pen state, color, width, visibility, and background; the full start defaults are restored only at program start.

### `forward`

- **Signature:** `forward number`
- **Aliases:** `fd`
- **Kind:** Command
- **Argument types:** number
- **Result:** —
- **Description:** Moves the turtle forward by the given distance, drawing a segment when the pen is down.
- **Concept:** Distance in the turtle's current direction.
- **Example:**

```logo
forward 100
```

- **Possible errors:** none specified in C3 beyond general type and arity diagnostics.

### `back`

- **Signature:** `back number`
- **Aliases:** `bk`
- **Kind:** Command
- **Argument types:** number
- **Result:** —
- **Description:** Moves the turtle backward by the given distance relative to its current heading.
- **Concept:** Direction can be relative.
- **Example:**

```logo
back 50
```

- **Possible errors:** none specified in C3 beyond general type and arity diagnostics.

### `left`

- **Signature:** `left number`
- **Aliases:** `lt`
- **Kind:** Command
- **Argument types:** number in degrees
- **Result:** —
- **Description:** Turns the turtle counter-clockwise by the given number of degrees.
- **Concept:** Angle and rotation.
- **Example:**

```logo
left 90
```

- **Possible errors:** none specified in C3 beyond general type and arity diagnostics.

### `right`

- **Signature:** `right number`
- **Aliases:** `rt`
- **Kind:** Command
- **Argument types:** number in degrees
- **Result:** —
- **Description:** Turns the turtle clockwise by the given number of degrees.
- **Concept:** Angle and rotation.
- **Example:**

```logo
right 90
```

- **Possible errors:** none specified in C3 beyond general type and arity diagnostics.

### `home`

- **Signature:** `home`
- **Aliases:** none
- **Kind:** Command
- **Argument types:** none
- **Result:** —
- **Description:** Moves the turtle to `(0,0)` and resets heading to `0`.
- **Concept:** A coordinate system has an origin.
- **Example:**

```logo
home
```

- **Possible errors:** none specified.

### `set_xy`

- **Signature:** `set_xy x y`
- **Aliases:** `setxy`
- **Kind:** Command
- **Argument types:** number, number
- **Result:** —
- **Description:** Moves the turtle to an absolute canvas position.
- **Concept:** Absolute coordinates.
- **Example:**

```logo
set_xy 50 25
```

- **Possible errors:** none specified in C3 beyond general type and arity diagnostics.

### `set_heading`

- **Signature:** `set_heading degrees`
- **Aliases:** `seth`
- **Kind:** Command
- **Argument types:** number in degrees
- **Result:** —
- **Description:** Sets the turtle heading. Implementations normalize headings to `[0,360)`.
- **Concept:** Absolute direction.
- **Example:**

```logo
set_heading 180
```

- **Possible errors:** none specified in C3 beyond general type and arity diagnostics.

### `xcor`

- **Signature:** `xcor`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** none
- **Result:** number
- **Description:** Reports the turtle's current x-coordinate.
- **Concept:** Reading state.
- **Example:**

```logo
print xcor
```

- **Possible errors:** none specified.

### `ycor`

- **Signature:** `ycor`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** none
- **Result:** number
- **Description:** Reports the turtle's current y-coordinate.
- **Concept:** Reading state.
- **Example:**

```logo
print ycor
```

- **Possible errors:** none specified.

### `heading`

- **Signature:** `heading`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** none
- **Result:** number
- **Description:** Reports the turtle's current heading in degrees.
- **Concept:** Reading orientation.
- **Example:**

```logo
print heading
```

- **Possible errors:** none specified.

### `pos`

- **Signature:** `pos`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** none
- **Result:** list `[x y]`
- **Description:** Reports the turtle's current position as a two-item list.
- **Concept:** Grouping related values.
- **Example:**

```logo
print pos
```

- **Possible errors:** none specified.

### `towards`

- **Signature:** `towards x y`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number, number
- **Result:** number
- **Description:** Reports the heading from the current turtle position toward the given point.
- **Concept:** Computing direction from coordinates.
- **Example:**

```logo
print towards 100 0
```

- **Possible errors:** none specified in C3 beyond general type and arity diagnostics.

### `distance`

- **Signature:** `distance x y`
- **Aliases:** none
- **Kind:** Reporter
- **Argument types:** number, number
- **Result:** number
- **Description:** Reports the distance from the current turtle position to the given point.
- **Concept:** Measuring between points.
- **Example:**

```logo
print distance 100 0
```

- **Possible errors:** none specified in C3 beyond general type and arity diagnostics.

## Pen and screen

### `show_turtle`

- **Signature:** `show_turtle`
- **Aliases:** `st`
- **Kind:** Command
- **Argument types:** none
- **Result:** —
- **Description:** Makes the turtle avatar visible.
- **Concept:** Separating the drawing from the actor.
- **Example:**

```logo
show_turtle
```

- **Possible errors:** none specified.

### `hide_turtle`

- **Signature:** `hide_turtle`
- **Aliases:** `ht`
- **Kind:** Command
- **Argument types:** none
- **Result:** —
- **Description:** Hides the turtle avatar while leaving drawing behavior unchanged.
- **Concept:** View state.
- **Example:**

```logo
hide_turtle
```

- **Possible errors:** none specified.

### `pen_up`

- **Signature:** `pen_up`
- **Aliases:** `pu`
- **Kind:** Command
- **Argument types:** none
- **Result:** —
- **Description:** Lifts the pen so future movement does not draw.
- **Concept:** Moving without leaving a trail.
- **Example:**

```logo
pen_up
forward 50
```

- **Possible errors:** none specified.

### `pen_down`

- **Signature:** `pen_down`
- **Aliases:** `pd`
- **Kind:** Command
- **Argument types:** none
- **Result:** —
- **Description:** Lowers the pen so future movement draws.
- **Concept:** Drawing as movement with a trail.
- **Example:**

```logo
pen_down
forward 50
```

- **Possible errors:** none specified.

### `clear_screen`

- **Signature:** `clear_screen`
- **Aliases:** `cs`
- **Kind:** Command
- **Argument types:** none
- **Result:** —
- **Description:** Clears the drawing and sends the turtle home. It keeps the pen state, color, width, visibility, and background; full defaults are restored only at program start.
- **Concept:** Resetting a workspace while keeping style choices.
- **Example:**

```logo
clear_screen
```

- **Possible errors:** none specified.

### `clean`

- **Signature:** `clean`
- **Aliases:** none
- **Kind:** Command
- **Argument types:** none
- **Result:** —
- **Description:** Clears the drawing only. It does not move the turtle.
- **Concept:** Separating picture state from turtle state.
- **Example:**

```logo
clean
```

- **Possible errors:** none specified.

### `set_color`

- **Signature:** `set_color color`
- **Aliases:** `setcolor`
- **Kind:** Command
- **Argument types:** color
- **Result:** —
- **Description:** Sets the pen color. Accepted color forms are specified in the color section below.
- **Concept:** Attributes change future drawing.
- **Example:**

```logo
set_color "blue"
forward 100
```

- **Possible errors:** `ol-bad-color` when the argument is not one of the accepted color forms.

### `set_background`

- **Signature:** `set_background color`
- **Aliases:** `setbg`
- **Kind:** Command
- **Argument types:** color
- **Result:** —
- **Description:** Sets the canvas background color.
- **Concept:** A picture has both drawn marks and a background.
- **Example:**

```logo
set_background "white"
```

- **Possible errors:** `ol-bad-color` when the argument is not one of the accepted color forms.

### `set_width`

- **Signature:** `set_width number`
- **Aliases:** `setwidth`
- **Kind:** Command
- **Argument types:** number
- **Result:** —
- **Description:** Sets the pen stroke width for future drawing. The width MUST be a positive number.
- **Concept:** Lines have measurable thickness.
- **Example:**

```logo
set_width 4
forward 100
```

- **Possible errors:** `ol-range` when the width is zero or negative; a non-number width is the general `ol-type`.

### `fill`

- **Signature:** `fill`
- **Aliases:** none
- **Kind:** Command
- **Argument types:** none
- **Result:** —
- **Description:** Performs the implementation's fill operation for the current drawing context. Rendering details are specified in [rendering.md](rendering.md).
- **Concept:** A closed region can have an inside.
- **Example:**

```logo
fill
```

- **Possible errors:** none specified.

### `stamp`

- **Signature:** `stamp`
- **Aliases:** none
- **Kind:** Command
- **Argument types:** none
- **Result:** —
- **Description:** Draws an imprint of the current turtle shape at the current position.
- **Concept:** The actor can become part of the picture.
- **Example:**

```logo
stamp
```

- **Possible errors:** none specified.

### `set_shape`

- **Signature:** `set_shape word`
- **Aliases:** none
- **Kind:** Command
- **Argument types:** word
- **Result:** —
- **Description:** Sets the turtle avatar shape. Sprite-profile shape behavior is specified in [turtles-and-sprites.md](turtles-and-sprites.md).
- **Concept:** Visual identity.
- **Example:**

```logo
set_shape "triangle"
```

- **Possible errors:** none specified in C3 beyond general type and arity diagnostics.

## Colors

Color values accepted by `set_color` and `set_background` are exactly:

- A named color word from the normative palette: `"black"`, `"white"`, `"red"`, `"orange"`, `"yellow"`, `"green"`, `"blue"`, `"purple"`, `"pink"`, `"brown"`, `"gray"`.
- An RGB list `[r g b]` where each component is a number from `0` through `255`.
- A hex word of the form `"#rrggbb"`.

Any value that is not one of these three forms — including an unknown color word, a hex word that is not exactly `"#rrggbb"`, or an `[r g b]` list of the wrong length or with a component outside `0` through `255` — raises `ol-bad-color`.

```logo
set_color "red"
set_background [240 240 240]
set_color "#3366ff"
```

The color concept is representation: the same visible idea can be named, measured as red-green-blue components, or encoded as a hex word.

## Related primitives owned elsewhere

- Geometry commands such as `polygon :sides :size`, `star :points :size (:step 2)`, `circle :radius (:segments 36)`, `arc :angle :radius`, `grid`, `axes`, `measure`, `area :shape`, and `perimeter :shape` are derived standard-library procedures specified in [geometry-module.md](geometry-module.md).
- Data-profile mutation and structure primitives such as `list`, `add … to`, `remove … from`, `insert … in … at`, `clear`, dictionary literals, `keys`, `values`, `struct`, constructors, and record fields are specified in [data-structures.md](data-structures.md).
- Sprite-profile primitives `new_turtle`, `tell`, `ask`, `each`, `turtles`, and `who` are specified in [turtles-and-sprites.md](turtles-and-sprites.md).
- Interaction and sound primitives including `input`, `wait`, `when`, `every`, `on_key`, `on_click`, `note`, `play`, `beep`, `rest`, and `set_tempo` are specified in [interaction-events.md](interaction-events.md).
- Meta-commands are commands taking no inputs, invoked as the bare words `explain`, `why`, `hint`, and `debug` in the Educational profile; their canonical signatures are normative in [conformance.md](conformance.md#educational) and their educational behavior is owned by [educational-model.md](educational-model.md). AI-enhanced behavior and the `challenge` command (whose signature is normative in [conformance.md](conformance.md#tutor-ai)) are specified in [ai-tutor.md](ai-tutor.md).
