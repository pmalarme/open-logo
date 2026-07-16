> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Execution Model

[Back to the specification index](README.md).

This document is the authoritative OpenLogo (OL) execution and semantics
document. Grammar productions are owned by [grammar.md](grammar.md), primitive
signatures are owned by the C3 matrix in [commands.md](commands.md), and this
file defines how those forms are read, evaluated, scoped, mutated, traced, and
compared at run time.

## Value and type model

OpenLogo values are dynamically typed. The v0.1 types are:

| Type | Profile | Semantics |
|---|---|---|
| `number` | Core | One IEEE-754 double type. Whole values print without a decimal; non-whole values print trimmed to at most 10 significant digits. |
| `word` | Core | A closed double-quoted text value such as `"tom"`. Word values preserve case and may contain Unicode. |
| `list` | Core | Ordered mutable sequence and the single sequence type. Indices are 1-based. |
| `boolean` | Core | Exactly `true` and `false`. Conditions and logical operands must already be booleans. |
| `dict` | Data | Mutable insertion-ordered key/value collection. Keys are words or numbers. |
| `record` | Data | Mutable named fixed-field aggregate declared by `struct`. |
| `turtle` | Sprites | Mutable turtle identity with per-turtle drawing state. |

There are **no arrays**, **no first-class procedure values**, and **no null** in
v0.1. Absence is represented by not having a value: an undefined variable raises
`ol-undefined-var`, a missing required dict key on read raises `ol-unknown-key`,
and a procedure used as a reporter without reaching `return` raises
`ol-no-output`.

Words that parse as numbers are accepted where a number is expected. Booleans do
not coerce to numbers or words. There is no truthiness: `if`, `while`, `and`,
`or`, and `not` require boolean operands and raise `ol-not-boolean` otherwise.

Lists, dicts, records, and turtles are mutable reference values. Assigning or
passing one of these values copies the reference, not the contained structure.
The copy-producing operations described later are shallow unless a future
profile explicitly says otherwise.

## Lexical commitments used by execution

The reader receives tokens from the normative lexer in [grammar.md](grammar.md):

- Keywords and identifiers are case-insensitive; lowercase is canonical.
- Identifier spelling is snake_case, with Unicode letters admitted for user code
  and localized keyword packs. Built-ins are lowercase ASCII.
- `-` is never part of an identifier. A leading `-` directly before a numeral
  with no left operand is a negative literal; between operands it is subtraction.
- Numbers use `.` as the decimal point, independent of locale.
- Word literals are closed double-quoted strings. `\"` and `\\` are escapes;
  other characters are literal. Unterminated strings raise `ol-unclosed-string`.
- `#` and `//` start line comments; `/* ... */` starts a non-nesting block
  comment. Unterminated block comments raise `ol-unclosed-comment`.
- Horizontal whitespace and indentation are insignificant except as token
  separators. A newline ends the current statement at the top level and inside a
  bracketed `[ ... ]` or long `... end` control body; inside `[ ... ]` the newline
  is optional, because fixed arity also separates adjacent instructions.
  Immediately after a control or procedure header, a newline selects the long
  `... end` body form. Within a single expression, list literal, dict literal, or
  parenthesized group, newlines are insignificant. Consecutive newlines form a
  single separator, so blank lines may appear between statements anywhere — at the
  top level, inside `[ ... ]`, and inside a `... end` block — and the newline after
  the final statement of a file is optional.

## Reader pipeline

Execution is deliberately split into a pre-pass and two phases so learners can
write procedures and localized aliases in a natural order.

1. **Pre-pass: aliases and imports.** The reader resolves `alias` and `import`
   before parsing program structure for execution. Token aliases such as
   `fd` → `forward`, user aliases, and localized keyword-pack aliases are
   recognized everywhere regardless of source order. Heritage grammar forms
   such as `to ... end`, `output`, `op`, `make "name" value`, and
   `value of ... for key ...` are grammar spellings, not merely token aliases.
2. **Phase 1: registration.** The reader registers every `define`/`to`
   procedure and every `struct` declaration. Procedure forward references work.
   A `struct` registers both its record type and a constructor reporter named
   after the type. Collisions with primitives, existing procedures, or reserved
   names raise `ol-reserved-word`.
3. **Phase 2: execution.** Top-level instructions execute in source order using
   the registered callable and record-type tables.

`import "name"` loads exported procedures and alias declarations from a module.
Localization packs are ordinary modules that add aliases, for example
`avance` → `forward`. English keywords remain canonical.

## Three syntactic layers

The evaluator operates over three explicit layers:

1. **Prefix commands and reporters.** Calls are space-separated and consume a
   fixed default arity known from the C3 matrix or the `define` line:

   ```logo
   forward random 100
   print double 5
   set_xy 10 20
   ```

   This parses as `forward (random 100)`, `print (double 5)`, and
   `set_xy 10 20`. A callable with variadic or alternate arity must be wrapped
   in parentheses, with no commas:

   ```logo
   :nums = (list 1 2 3)
   (print :nums "has" count :nums "items")
   :roll = (random 1 6)
   ```

2. **Infix arithmetic, comparison, and logic.** Operators use the precedence
   table below. `and` and `or` short-circuit.
3. **Special forms.** Forms such as assignment, `set ... to`, `if`, `repeat`,
   `for`, `map`, `reduce`, `define`, and `struct` have fixed keyword slots and
   delimiter rules. They are not parsed as ordinary variadic calls.

## Precedence and evaluation order

Precedence from highest to lowest:

| Level | Operators/forms | Associativity and notes |
|---|---|---|
| 1 | Postfix `[]` and `.` | Left-to-right chain. |
| 2 | Unary `-`, prefix `not` | `not` requires a boolean. |
| 3 | `*`, `/`, `mod` | Left-associative. |
| 4 | `+`, `-` | Left-associative. |
| 5 | `==`, `!=`, `<`, `>`, `<=`, `>=` | Left-associative comparisons. |
| 6 | `and` | Left-associative, short-circuit. |
| 7 | `or` | Left-associative, short-circuit. |

Thus `:count > 0 and :count < 10` means
`(:count > 0) and (:count < 10)`. `and` evaluates its right operand only when
the left operand is `true`; `or` evaluates its right operand only when the left
operand is `false`. Parenthesized `(and ...)` and `(or ...)` use the same
left-to-right short-circuit semantics.

Assignment `=` and `set ... to` are statement-level special forms, not
expression operators.

## Brackets, blocks, and body forms

OpenLogo gives `[` five grammatical roles, disambiguated by position:

| Role | Example | Slot |
|---|---|---|
| List literal | `[1 2 3]` | Value position. |
| Instruction block | `repeat 4 [ forward 50 ]` | Control or comprehension body position. |
| Selector | `:nums[1]` | Postfix position after an indexable primary. |
| Pattern | `for [:x :y] in :points [...]` | Binder position. |
| Field-list | `struct point [ x y ]` | Immediately after `struct <type>`. |

Control forms (`if`, `while`, `repeat`, `for`, `forever`) accept exactly one of
two body forms:

1. a bracketed block `[ ... ]`, inline or multiline;
2. a long block closed by `end` with optional matching label: `end`, `end if`,
   `end while`, `end repeat`, `end for`, or `end forever`, preferred for
   multi-line bodies.

A control body is always delimited; there is no bare or undelimited body. Even a
single instruction is written `repeat 4 [ forward 100 ]` or as a `... end` block.
Inside a bracketed body the reader separates instructions by their fixed arity,
so `[ forward 100 right 90 ]` is two commands and newlines inside `[ ]` are
optional.

Comprehensions (`map`, `filter`, `reduce`) accept only a bracketed
expression-block `[ ... ]`. A procedure `define` accepts only a long block
closed by `end` or `end define`. `struct` is a one-line declaration with no
body. The core labels are `end`, `end if`, `end while`, `end repeat`, `end for`,
`end forever`, and `end define`; optional profiles extend this rule uniformly, so a
profile effect-block (such as `ask`, `each`, `when`, `every`, `on_key`, or
`on_click`) closes with `end` or `end <keyword>` for its own opener.

The delimited-body rule removes ambiguity. After a control header, if the rest
of the same physical line begins with `[`, the body is a bracketed block; if the
header ends the line, the body is a long `... end` block; any other token raises
`ol-missing-end` with a hint to wrap the body in `[ ]` or close it with `end`.
An `if` applies the same rule to each branch: bracketed branches read
`if <cond> [ ... ] else [ ... ]`, long-form branches read `if <cond>` ... `else`
... `end if`, and both branches take the same form. `else` binds to the nearest
still-open `if` lacking an `else`; otherwise it raises `ol-mismatched-end`.

## The block-result rule

A block is always a list of instructions. The leading form decides what happens
to any value produced inside it:

| Leading form | Block result behavior |
|---|---|
| `repeat`, `if`, `while`, `for`, `forever` | Runs for effects and yields no value. A final bare value is discarded. |
| `map`, `filter`, `reduce` | Runs once per element and uses the last expression's value. |
| `define` | Runs for effects; a procedure yields a value only by reaching `return` (`output`/`op`). |

A comprehension body that has no value-producing final expression raises
`ol-no-value`. A `return`/`output`/`op` inside a comprehension body raises
`ol-return-in-comprehension`.

## Postfix reads

Postfix read syntax is available on any primary:

```text
postfix-expr := primary (selector | "." identifier)*
selector     := "[" key-term "]"
key-term    := number | identifier | ":" name | word-literal | "(" expr ")"
```

Runtime meaning depends on the base value:

- A list requires a numeric 1-based index. Out of range raises `ol-range`.
- A dict uses a word or number key. A read miss raises `ol-unknown-key`.
- A record uses `.field` and raises `ol-unknown-field` for an absent field.
- A word may be indexed by number to read a Unicode scalar-value position.
- `.identifier` is always a literal field/key, never evaluated.

Inside a selector, a bare identifier is a literal word key and preserves case:
`:ages[tom]` uses key `"tom"`. `:ages[:who]` evaluates variable `:who` to obtain
the key. Arithmetic or other general expressions inside selectors must be
parenthesized, as in `:nums[(:i + 1)]`.

## Assignable places and mutation

The assignable-place set is closed and recursive. There are exactly two
spellings with identical meaning:

```text
colon form after "=":        ":" name postfix*
bare form after "set ... to": name postfix*
```

Examples:

```logo
:size = 100
:nums[1] = 9
:p.x = 10
:people.tom.age = 9

set size to 100
set nums[1] to 9
set p.x to 10
set people.tom.age to 9
```

Evaluation resolves each intermediate selector or field against the existing
value. There is no intermediate auto-vivification:

- a missing intermediate dict key raises `ol-unknown-key`;
- a missing intermediate record field raises `ol-unknown-field`;
- a bad intermediate list index raises `ol-range`.

Only the final selector may create a slot, and only for dicts. Writing a missing
final dict key upserts that key. Writing an unknown record field always raises
`ol-unknown-field` because record fields are typed and fixed. Writing a list
index out of range raises `ol-range`. Reporters such as `first`, `count`, and
`keys` are not places and raise `ol-not-a-place` if used as assignment targets.

Collection mutators such as `add`, `remove`, `insert`, and `clear` take an
evaluated mutable reference, not a place, and return no value.

## Special-form delimiter rules

Special forms parse fixed slots:

- `<place> = <value>` parses one colon-form place on the left and one value
  expression on the right.
- `set <place> to <value>` parses one bare place, requires `to`, then parses one
  value expression. `make "name" value` is the heritage assignment spelling.
- `add <value> to <listExpr>` mutates the evaluated list.
- `remove <value> from <listExpr>` removes the first matching element.
- `remove key <k> from <dictExpr>` removes a dict key.
- `insert <value> in <listExpr> at <index>` mutates the evaluated list.
- `clear <collExpr>` empties the evaluated list or dict.
- `for` dispatches on the keyword after its binder: `in` or `from`.
- A bracketed binder after `for`, `map`, `filter`, or `reduce` is a pattern, not
  a list literal.
- `if` and `while` parse exactly one boolean condition and then a body; `while`
  re-evaluates its condition before each pass.
- `define`/`to` parses a procedure header and a long body only.
- `struct <type> [ <field-list> ]` declares a type and constructor.

Delimiter words inside strings, nested brackets, parentheses, or braces do not
terminate the outer special form.

## Variables, scoping, and procedures

OpenLogo uses lexical frame scoping, not dynamic scoping. Procedure parameters
and locals live in the procedure frame where they are declared and are invisible
to callees unless explicitly passed as values.

Assignment by `:name = value` or `set name to value` updates the nearest
lexically visible binding; if none exists, it creates or updates a global.
`local name` declares a frame-local binding. Reading `:name` is sugar for
`thing "name"` and raises `ol-undefined-var` if no binding exists.

Procedures use `define name :a :b ... end` with heritage `to` as an alias.
Optional trailing parameters use parenthesized defaults:

```logo
define star :points :size (:step 2)
  repeat :points
    forward :size
    right 360 / :points * :step
  end repeat
end define
```

A call may omit trailing optional parameters or supply them. When supplying
extra arguments beyond the fixed default arity, use the parenthesized call form:
`(star 5 100 3)`. Wrong required argument count raises
`ol-not-enough-inputs` or `ol-too-many-inputs`.

`return value` exits the current procedure and provides its value. `output` and
`op` are heritage aliases. A procedure that reaches `return` is usable as a
reporter; a procedure that does not is a command. Using a command procedure
where a value is required raises `ol-no-output` at the call site. `stop` exits a
procedure early without a value and is invalid outside a procedure.

Recursion is supported. Each recursive invocation creates a new frame and emits
its own trace events.

## Control forms

`if` and `while` require boolean conditions. `repeat` requires a numeric count.
`forever` runs until cancellation or a configured limit. `for ... from ... to`
iterates numerically, with optional `by` in profiles that implement it. `for ...
in ...` iterates list elements in order; dict iteration follows insertion order
when a dict is accepted by a profile-specific form. Control forms run their
bodies for effect and produce no value.

## Comprehensions: map, filter, and reduce

OpenLogo v0.1 has no lambda and no function values. Higher-order work is done
with comprehension special forms:

```logo
:doubled = map num in :nums [ :num * 2 ]
:bigs = filter num in :nums [ :num > 2 ]
:total = reduce sum num in :nums from 0 [ :sum + :num ]
```

Each comprehension is a value-producing expression and may be used anywhere a
value is expected — the right side of `=` or `set ... to` (as above), a call
argument, or the body of another comprehension. Used alone as a statement, its
result is discarded like any other unused value.

`map <var> in <listExpr> [ <expr> ]` returns a fresh list containing the body
value for each element. `filter <var> in <listExpr> [ <boolExpr> ]` returns a
fresh list of original elements whose body value is `true`; a non-boolean body
raises `ol-not-boolean`. `reduce <acc> <var> in <listExpr> from <init>
[ <expr> ]` folds left and returns the final accumulator.

For `reduce`, empty input returns `init` unchanged. The accumulator and item
binders are fresh body-local bindings that shadow outer names only for the body.
The binder names must differ; duplicates raise `ol-duplicate-binder`.

Comprehension bodies are bracketed expression-blocks only. They must end in a
value-producing expression, cannot contain `return`/`output`/`op`, and may call
ordinary procedures. If the final expression calls a procedure that never
returns, `ol-no-output` is raised at that call site.

## Records and destructuring

A `record` is a mutable named fixed-field aggregate declared by `struct`:

```logo
struct point [ x y ]
:p = point 3 4
print :p.x
:p.x = 10
```

The bracket after `struct` is a field-list production, not a list literal. Field
names are lowercase snake_case and live in the record type's namespace. The type
name becomes a constructor reporter with arity equal to the number of fields.
When a constructor call is nested in another call, use parentheses:

```logo
add (point 3 4) to :path
```

Records are mutable references. Reading or writing an unknown field raises
`ol-unknown-field`. `type_of :p` reports the type word, and `is_a? :p "point"`
reports a boolean.

Destructuring in `for ... in` uses a pattern list of `:names` and binds
positionally from each element. Records destructure in declared field order;
lists destructure by item order. A short or long pattern mismatch raises
`ol-range`.

## Collections and uniform access

OpenLogo teaches list, dict, and record through one access idiom:

| Collection | Read | Write | Growth/shrink |
|---|---|---|---|
| list | `:l[i]` | `:l[i] = v`, `set l[i] to v` | `add`, `remove`, `insert`, `clear` |
| dict | `:d.key`, `:d[key]`, `:d[:var]` | final missing key upserts | `remove key`, `clear` |
| record | `:r.field` | fixed fields only | no dynamic fields |

Dict literals use braces only:

```logo
:ages = {
  sophie: 6
  tom: 8
}
```

Bare dict keys are literal data, not procedure calls; reserved words are legal
keys. Duplicate literal keys are allowed and the last value wins. Dict iteration
is insertion order. A required read miss raises `ol-unknown-key`, but a write to
a missing final dict key adds it.

Mutation and copy behavior is normative:

| Form | Behavior |
|---|---|
| `:place = ...`, `set ... to ...` | Mutate the target binding or referenced slot; no value. |
| `add`, `remove`, `insert`, `clear` | Mutate a shared collection reference; no value. |
| `fput`, `lput`, `butfirst`, `sentence`, `reverse` | Return a fresh list and leave the original unchanged. |
| `map`, `filter` | Return a fresh list. |
| `reduce` | Returns a fresh folded value or an existing reference if the body returns one. |

Fresh lists are shallow: nested references remain shared.

## Equality and ordering

`==` returns a boolean according to this matrix. `!=` is exactly the negation of
`==`.

| Left \ Right | number | word | boolean | list | dict | record | turtle | other cross-type |
|---|---|---|---|---|---|---|---|---|
| number | Numeric equality | Compare by printed form (`5 == "5"` is `true`) | `false` | `false` | `false` | `false` | `false` | `false` |
| word | Compare by printed numeric form when the word parses as a number; otherwise `false` | Case-sensitive word equality | `false` | `false` | `false` | `false` | `false` | `false` |
| boolean | `false` | `false` | Same boolean | `false` | `false` | `false` | `false` | `false` |
| list | `false` | `false` | `false` | Structural: same length and pairwise `==` | `false` | `false` | `false` | `false` |
| dict | `false` | `false` | `false` | `false` | Structural: same key set and pairwise `==`, order-independent | `false` | `false` | `false` |
| record | `false` | `false` | `false` | `false` | `false` | Same record type and pairwise-equal fields | `false` | `false` |
| turtle | `false` | `false` | `false` | `false` | `false` | `false` | Same turtle identity | `false` |

For number↔word equality, the comparison is by printed form after numeric
parsing, so `5 == "5"` is `true` and `5 == "05"` is `false` if the number's
printed form is `"5"`. Word↔word equality remains case-sensitive.

Structural equality must terminate on cyclic or shared structure. Implementations
maintain a memo set of reference pairs currently being compared. If the same
pair is encountered again while in progress, that pair is treated as equal for
that branch. This pair memoization, not identity short-circuiting alone, is
normative and covers distinct but isomorphic cycles.

Ordering operators `<`, `>`, `<=`, and `>=` are defined only for numbers and
words. Numbers compare numerically. Words compare lexicographically by Unicode
code point. Other ordered pairs raise `ol-type`.

## Numbers and math

Trigonometric reporters use degrees. `pi` reports the mathematical constant.
Division or `mod` by zero raises `ol-div-zero`; `sqrt` of a negative number
raises `ol-neg-sqrt`; a non-integer where an integer is required raises
`ol-type`. OpenLogo never exposes NaN or Infinity as learner-facing results for
these educational errors.

`random n` reports an integer in `[0,n-1]`. `(random a b)` reports an integer in
`[a,b]`. `randomize` with no input uses an implementation seed;
`randomize seed` is deterministic within an implementation. Examples that
depend on randomness state properties such as "a number in `[0,99]`" unless a
future version standardizes a PRNG.

## Turtle and canvas state

At program start and after `clear_screen`, the default turtle/canvas state is:

- origin `(0,0)` at canvas center;
- `+x` right and `+y` up;
- position `(0,0)`;
- heading `0°` is up;
- `right` turns clockwise and `left` turns counter-clockwise;
- headings are degrees normalized to `[0,360)`;
- pen down;
- color `"black"`;
- width `1`;
- turtle visible;
- background `"white"`.

Movement by distance `d` at heading `h` updates position to
`(x + d·sin h, y + d·cos h)`. With heading `0`, positive movement increases
`y`. `home` moves to `(0,0)` and sets heading to `0`. `clear_screen` clears the
drawing and homes the turtle while preserving color, width, and background.
`clean` clears the drawing only.

## Execution safety

Implementations must support cancellation. They should enforce configurable
instruction budgets and recursion-depth limits. Hitting a budget or depth limit
raises a friendly `ol-limit` diagnostic rather than crashing or exposing a host
stack trace. `forever` is therefore safe only because it is cancellable and
budgeted.

## Trace and event registry

Execution produces one normative event stream used by rendering, animation,
stepping, `why`, `debug`, playback, and sprites. Every event has this envelope:

| Field | Meaning |
|---|---|
| `seq` | Monotonic integer sequence number. |
| `kind` | One registered event kind. |
| `source-span` | Source range that caused the event. |
| `turtle-id?` | Optional turtle identity when the event is turtle-specific. |
| `payload` | Kind-specific typed data. |

There are two timing classes:

- **Start events** are emitted before their effect: `instruction` and
  `procedure-enter`.
- **Effect events** are emitted immediately after the state change or output
  they describe.

A step is the span from one `instruction` event to the next. The `instruction`
event is the unit of "one step"; effect events caused by that instruction follow
it before the next `instruction`.

Normative `kind` values:

| Timing | Kinds |
|---|---|
| Start | `instruction`, `procedure-enter` |
| Effect | `move`, `turn`, `pen-change`, `width-change`, `color-change`, `background-change`, `draw-segment`, `fill`, `stamp`, `shape-change`, `visibility-change`, `clear`, `overlay`, `procedure-exit`, `return`, `print`, `sound`, `spawn-turtle`, `primitive`, `error` |

Rendering-relevant events carry typed payloads. Examples:

- `move`: `{from:[x y], to:[x y], heading}`;
- `draw-segment`: `{from:[x y], to:[x y], color, width}`;
- `turn`: `{from, to}`;
- `clear`: `{mode:"clear_screen"}` or `{mode:"clean"}`.

`primitive` is the generic catch-all for a primitive without a more specific
event. Implementations may add extension events under a vendor namespace such as
`vendor_name.event_name`.

## Worked traces

These traces are illustrative but use the normative ordering above: start events
come before effects; effect events come after the change.

### Recursive call

```logo
define countdown :n
  if :n == 0
    return 0
  end if
  print :n
  return countdown :n - 1
end define

print countdown 2
```

Trace sketch:

| Seq | Kind | Payload |
|---:|---|---|
| 1 | `instruction` | about to run `print countdown 2` |
| 2 | `procedure-enter` | `{name:"countdown", args:[2]}` |
| 3 | `instruction` | about to run `if :n == 0 [...]` in frame `n=2` |
| 4 | `instruction` | about to run `print :n` |
| 5 | `print` | `{values:[2]}` |
| 6 | `instruction` | about to run `return countdown :n - 1` |
| 7 | `procedure-enter` | `{name:"countdown", args:[1]}` |
| 8 | `instruction` | about to run `if :n == 0 [...]` in frame `n=1` |
| 9 | `instruction` | about to run `print :n` |
| 10 | `print` | `{values:[1]}` |
| 11 | `instruction` | about to run `return countdown :n - 1` |
| 12 | `procedure-enter` | `{name:"countdown", args:[0]}` |
| 13 | `instruction` | about to run `if :n == 0 [...]` in frame `n=0` |
| 14 | `instruction` | about to run `return 0` |
| 15 | `return` | `{value:0}` |
| 16 | `procedure-exit` | `{name:"countdown", result:0}` |
| 17 | `return` | `{value:0}` |
| 18 | `procedure-exit` | `{name:"countdown", result:0}` |
| 19 | `return` | `{value:0}` |
| 20 | `procedure-exit` | `{name:"countdown", result:0}` |
| 21 | `print` | `{values:[0]}` |

Each recursive call has its own lexical frame. The caller's `:n` is not changed
by the callee.

### Record and nested dict mutation

```logo
struct point [ x y ]
:p = point 1 2
:p.x = 5

struct person [ name age ]
:people = { tom: person "tom" 8 }
:people.tom.age = 9
```

Trace and state sketch:

| Step | Effect |
|---|---|
| `:p = point 1 2` | Creates global `p` bound to a `point{x:1,y:2}` record. |
| `:p.x = 5` | Resolves `:p`, verifies final field `x`, writes `5`. Unknown field would be `ol-unknown-field`. |
| `:people = ...` | Creates a dict with key `"tom"` whose value is a `person` record. |
| `:people.tom.age = 9` | Resolves intermediate dict key `"tom"`; resolves final record field `age`; writes `9`. |

If `:people.sue.age = 9` is evaluated when `"sue"` is absent, the missing
intermediate key raises `ol-unknown-key`. It does not create a `"sue"` dict and
does not auto-vivify a `person`.

### Final dict-key upsert

```logo
:people = {}
:people.tom = { age: 8 }
:people.tom.age = 9
```

The first write upserts the final key `"tom"` because the base `:people` exists
and the final selector is a dict key. The second write resolves existing
intermediate `"tom"` and upserts or updates final key `"age"` in that nested
dict. If the intermediate `"tom"` were missing on the second line's chain, the
write would raise `ol-unknown-key`.

### `for ... in` with destructuring

```logo
struct rectangle [ x y width height ]
:shapes = (list (rectangle 0 0 100 50) (rectangle 10 10 40 40))

for [:x :y :w :h] in :shapes
  print :x
  print :w
end for
```

For each record, the pattern binds in declared field order: `x`, `y`, `width`,
`height`. The binders are body-local for that iteration. A rectangle with a
different arity is impossible for the declared type; a list element with fewer
or more than four items would raise `ol-range`.

### `map`

```logo
define double :n
  return :n * 2
end define

:nums = [1 2 3]
:doubled = map num in :nums [
  double :num
]
```

Evaluation creates a fresh result list. For each item, `num` is a fresh
body-local binding, the last expression `double :num` supplies the element
value, and the original `:nums` is unchanged. Final state:
`:doubled == [2 4 6]`.

### `reduce`

```logo
:nums = [1 2 3]
:total = reduce sum num in :nums from 0 [
  :sum + :num
]
```

The fold is left-to-right:

| Iteration | `sum` | `num` | Body value |
|---:|---:|---:|---:|
| 1 | 0 | 1 | 1 |
| 2 | 1 | 2 | 3 |
| 3 | 3 | 3 | 6 |

Final state: `:total == 6`. If `:nums` were empty, `:total` would be `0`.
`reduce sum sum in :nums from 0 [ :sum ]` raises `ol-duplicate-binder`.

## Cross-document contracts

This document is normative for runtime behavior. Other documents must link here
for:

- the value/type model and equality matrix;
- reader pre-pass and two-phase execution;
- prefix fixed-arity evaluation and variadic parenthesized calls;
- the block-result rule;
- assignable places and nested mutation;
- lexical scoping and procedure frames;
- record, collection, and comprehension semantics;
- turtle state and mathematical movement;
- safety limits and trace event timing.

Primitive names, aliases, kinds, arities, arguments, and errors must match the C3
matrix in [commands.md](commands.md). Syntax productions and reserved words must
match [grammar.md](grammar.md). Diagnostics must use the codes and message shape
from [error-model.md](error-model.md).
