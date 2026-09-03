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
- Word literals are closed double-quoted strings in two forms: a single-line
  `"..."` that contains no raw newline, and a multi-line triple-quoted
  `"""..."""` whose reader drops the newlines adjacent to the delimiters and
  strips the common leading indentation shared by its content lines. `\"` and
  `\\` are escapes in both forms; other characters are literal. Unterminated
  strings raise `ol-unclosed-string`.
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
   after the type. A built-in name in a declaration slot raises
   `ol-reserved-word`; a name an earlier declaration in the program or an
   imported module already registered raises `ol-duplicate-definition`, which
   MUST NOT be a silent override. See
   [grammar.md](grammar.md#keywords-primitives-and-built-in-names).
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
   `set_xy 10 20`. Each input is itself a full expression, so an infix
   operator binds inside the argument: `forward :size * 2` means
   `forward (:size * 2)`, and `power 2 3 * 4` means `power 2 (3 * 4)`. A
   callable with variadic or alternate arity must be wrapped
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
| 2 | Prefix `not` | `not` requires a boolean. A leading `-` on a numeral is part of a negative literal, not a unary operator. |
| 3 | `*`, `/`, `mod` | Left-associative. |
| 4 | `+`, `-` | Left-associative. |
| 5 | `==`, `!=`, `<`, `>`, `<=`, `>=`, `is` | Comparisons; may chain (`1 < :x < 10`); worded `is`-predicates. |
| 6 | `and` | Left-associative, short-circuit. |
| 7 | `or` | Left-associative, short-circuit. |

Thus `:count > 0 and :count < 10` means
`(:count > 0) and (:count < 10)`. `and` evaluates its right operand only when
the left operand is `true`; `or` evaluates its right operand only when the left
operand is `false`. Parenthesized `(and ...)` and `(or ...)` use the same
left-to-right short-circuit semantics.

Comparisons may be **chained**: `1 < :x < 10` is evaluated as `1 < :x and :x <
10`, computing each operand once with `and` short-circuit semantics. OpenLogo also
offers worded predicates at the comparison level that read as English and return
booleans. They are written **operand-first**, with the value before `is`: `<value>
is empty`, `<value> is member of <collection>`, `<value> is a <type-word>`, and
`<value> is [ strictly ] between <low> and <high>` (inclusive, or exclusive with
`strictly`). These are first-class alternates to the prefix `?`-predicates
(`empty?`, `member?`, `is_a?`). Only `is`, `strictly`, and `between` are keywords
everywhere; the contextual words `empty`, `member`, `of`, and `a` are recognized
just after `is` — `of` also in the heritage `value of … for key` reader — and
remain valid ordinary names elsewhere. There is no infix `in` membership operator
— use `<value> is member of <collection>` or `member?`; the word `in` is only the
`for`/comprehension preposition. Operand types depend on the operator: ordering
comparisons (`<`, `>`, `<=`, `>=`) and `[ strictly ] between` require numbers or
words; `==` and `!=` compare any two values; `is empty` accepts lists, dicts, and
words; `is member of` accepts lists and dicts; `is a` accepts any value. A
wrong-typed operand raises `ol-type`. The worded `is a` form takes a literal
type word in the grammar, so at runtime only an unknown type word can occur and
it raises `ol-unknown-type`. The prefix `is_a? value type` evaluates its type
argument: a non-word type raises `ol-type`, and an unknown type word raises
`ol-unknown-type`.

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
`ol-no-value`. A `return`/`output`/`op`/`stop` inside a comprehension body raises
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

This selector grammar (`postfix-expr`, `selector`) is unconditional Core syntax: every conforming
implementation parses it uniformly regardless of which optional profiles it claims. Profile
ownership of a specific *base-value case* is a separate, semantic-level requirement, defined by
[conformance.md#data](conformance.md#data): the list case above — `:list[i]` read and write — and
the dict and record cases above are Data-profile-owned, so a conforming implementation supports
executing them only when it claims Data. This specification does not define a dedicated diagnostic
for an implementation that parses this shared grammar but does not support one of these Data-owned
cases; per conformance.md's portability rule, a program using `:list[i]`, a dict selector, or a
record `.field` is simply not portable to an implementation that does not claim Data — the same way
any other Data-only, Sprites-only, or Interaction-only program is not portable to an implementation
that omits that profile.

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

The list-index case of a place — `:nums[1] = 9`, `set nums[1] to 9`, and the intermediate/final
list-index cases of a chained place such as `:people.tom.pets[1] = "cat"` — is Data-profile-owned on
the write side exactly as it is on the read side (see "Postfix reads" above and
[conformance.md#data](conformance.md#data)); the dict and record place cases in this section are
likewise Data-owned. The place grammar itself is unconditional Core syntax; only execution of the
list, dict, and record cases requires the Data profile.

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

OpenLogo uses lexical frame scoping, not dynamic scoping. **A name is born where
it is first assigned, lives until that scope ends, and a procedure's edge is
sealed.** Everything below follows from that one sentence.

**A procedure is a hard, total boundary.** A procedure body sees only its own
parameters, its own `local` bindings, and `global` names — never an ordinary
top-level (non-`global`) variable, and never a caller's or an enclosing block's
binding. An ordinary top-level name is **invisible** to a procedure, not merely
unwritable: reading one from inside a procedure raises `ol-undefined-var` exactly
as if the name had never been assigned, even though it exists and is readable at
the top level. This is stricter than the read-only outer-variable access many
general-purpose languages allow; it is a deliberate educational choice, so that
everything a procedure touches is named at its boundary — its parameter list plus
whichever names it declares `global` — without reading the procedure's body. The
callable namespace is a separate matter from the variable namespace covered here:
a procedure may always call primitives, other user procedures, and struct
constructors, and may recurse, regardless of variable visibility (see
[Namespaces](grammar.md#keywords-primitives-and-built-in-names); the callable
namespace, including any imported or aliased name, stays visible everywhere).

**A block (`[ … ]`) is a lifetime boundary, not a write boundary.** A block may
freely update any name visible from its enclosing scope — this is the
accumulator idiom (`repeat 4 [ forward :count * 10   :count = :count + 1 ]`) and
is how a block updates a plain top-level variable or a `global` alike (see
[`spec/examples/10-game.logo`](examples/10-game.logo), whose `on_click` handler
updates a plain top-level `:score` with no `global` declaration — an event
handler's body is registered as a lexical block at its call site, not as a
procedure body, so the sealed procedure boundary above never applies to it: a
handler sees, reads, and writes the whole lexical chain visible where it was
registered, exactly as any other block would, whether that chain bottoms out at
the root frame or inside an enclosing procedure's own locals and parameters).
A name **born**
inside a block — first assigned there, with no visible binding of that name
before the block started — dies when the block's `]` closes; reading it
afterwards raises `ol-undefined-var`.

**Fresh binding per scope entry.** Each loop iteration (`repeat`, `while`,
`forever`, `for`) and each procedure call creates new bindings for every name
first assigned in its body during that pass or call — including a plain
(non-`global`) name born inside the body, a procedure's parameters, and its
`local`s. A handler registered inside that body or call (`when`, `every`,
`on_key`, `on_click`) captures those bindings **by reference, not by snapshot
value**, so each registration observes the values as of when its handler later
runs, not as of when it was registered; combined with fresh binding per
iteration, a name assigned fresh in each pass of a loop gives each handler
registered in a different pass its own binding rather than a value shared with
every other pass's handler.

Assignment by `:name = value` or `set name to value` updates the nearest visible
binding — a parameter, a `local`, a `global`, or, at the top level, a plain
root-frame binding; if the name is not currently visible, the assignment creates
one in the **current scope**: a plain top-level binding at the root frame, or a
procedure-local binding inside a procedure, or (per the previous paragraph) a
block-local binding inside a block. Visibility decides which binding a write
targets, never the order in which reads and writes appear in the body: once a
name is visible in a scope — as a parameter, a prior `local`, or a `global` — every
subsequent read or write in that scope targets that same binding, so
`:count = :count + 1` after `global count = 0` both reads and writes the global,
never a shadowing procedure-local created by the write. The top-level program
runs in a root frame, and a `global` name is a binding in that root frame flagged
as visible from every procedure; a plain top-level binding is an ordinary root-
frame binding with no such flag, visible to blocks (which see the whole lexical
chain) but not to procedures. `local name` declares a binding in the current
scope — the enclosing block if there is one, the enclosing procedure otherwise,
or the root frame at the top level — shadowing anything visible, including a
`global` of the same name; declaring `local name` at the root frame when a
`global` of that name already exists is a no-op redeclaration, because the root
frame is where a `global` binding already lives and there is no further scope to
shadow into. Where `local name = value` supplies an initializer, the initializer
expression is evaluated **before** the new binding is created, in the enclosing
scope — so `local count = :count` inside a procedure reads the enclosing
`global count`, not the not-yet-created local, and the same expression at the
top level or in a block reads whatever binding of `:count` was already visible
there. `global name = value` is legal only at the root scope (see "The `global`
declaration" below), so its initializer is always evaluated **in the root
frame**, following the same before-the-binding-exists rule as `local`: a plain
top-level binding of that name already visible there is read by the initializer
before the `global` binding replaces it — `global count = :count + 1` after a
prior plain `:count = 5` reads `5`, then creates the `global` holding `6`. If the
name is already a `global` in the root frame, declaring it `global` again is a
no-op redeclaration exactly as `local name` is (see above): the initializer
still runs, in the root frame where that `global` is visible, and reassigns the
same binding rather than creating a second one — re-running `global count =
:count + 1` against an existing `global count = 6` updates it to `7`. Reading
`:name` is sugar for `thing "name"` and raises `ol-undefined-var`
if no binding is visible, including a name used before the statement that first
assigns it has run — a handler that fires before its `global` declaration has
executed observes the same `ol-undefined-var`, and a postfix place resolves its
base the same way a plain read does, so `:people.tom = v` for an invisible
`:people` raises `ol-undefined-var` on that base read exactly as `print :people`
would, before any assignment to the field is attempted.

**The boundary seals names, not values.** A procedure cannot see your variables —
but a list, dict, record, or turtle you pass it is a mutable reference value
(see "Assignable places and mutation" above), so the procedure can change what is
*inside* the value you handed it, and the caller sees that change, with no
`global` involved:

```logo
define f :lst
  add 99 to :lst
end
:a = [1 2]
f :a
print :a              # → [1 2 99]   the procedure changed the caller's list
```

Rebinding the parameter itself (`:lst = [ 7 ]`) never escapes — it only replaces
which value the procedure's own local parameter binding refers to. Mutating the
value the parameter refers to (`add 99 to :lst`, or `:lst.field = v` through a
record or dict parameter) always escapes, because caller and callee hold the same
reference. This is not an exception to the sealed edge: it follows directly from
mutable reference values (`spec/execution-model.md:37-38`) and requires no
`global` — a procedure can affect its caller through a mutable argument alone,
and that is intended, expected behavior, not a scoping leak.

**A procedure's frame outlives its call when a handler registered inside it is
still pending.** `when`, `every`, `on_key`, and `on_click` registered during a
procedure call keep that call's frame — its parameters and locals — alive for as
long as the handler may still fire, even after the procedure has returned. This
is closure *lifetime*, not a first-class procedure value: OpenLogo v0.1 still has
no lambda and no way to name or pass a block as a value (`:f = [ print 1 ]`
raises `ol-undefined-var`; a block is only ever the fixed body of the special
form that introduces it). `return` and `stop` inside a handler block are governed
by the ordinary rule for those keywords (`ol-return-outside-proc`,
`ol-stop-outside-proc`): a handler invocation is triggered by an event, not by a
call to the procedure that registered it, so a handler block is never dynamically
"inside" a procedure call for the purposes of `return`/`stop`, whether or not that
procedure's call is still on the stack — the same rule applies uniformly, with no
special case for a handler that happens to outlive its registering call. A nested
`define` written inside a procedure body is, by contrast, hoisted to the program's
global callable namespace during Phase 1 registration (see "Reader pipeline"
above) and therefore does **not** close over its enclosing call's frame; a handler block
written in the same position does. These are consistent with the rule — blocks
close over their lexical environment, procedures are a sealed, hoisted, top-level
namespace — but they are two different constructs with two different capture
behaviors, worth stating explicitly so neither is assumed to follow the other.

`repcount` (see [`repcount`](commands.md#repcount)) resolves **lexically**: it
reports the innermost `repeat` whose body **textually** contains the read, never
a `repeat` merely active elsewhere on the call stack. A procedure that reads
`repcount` and is called from inside a `repeat` does not see that caller's
iteration count — reading `repcount` with no enclosing `repeat` in the
procedure's own body raises `ol-repcount-outside-repeat`, the same sealed-edge
behavior rule 1 gives an ordinary variable read. This is unlike the Sprites
`ask`/`tell`/`each` addressing model (see
[turtles-and-sprites.md](turtles-and-sprites.md)), which is deliberately
*dynamic* — it tracks which turtle is currently addressed, not a name binding —
so the two are not in tension: `repcount` is a name-shaped read and is lexical;
turtle addressing is state, not a name, and is dynamic by design.

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
where a value is required raises `ol-no-output` at the call site. A `return`,
`output`, or `op` outside any procedure raises `ol-return-outside-proc`. `stop`
exits a procedure early without a value and outside any procedure raises
`ol-stop-outside-proc`.

`throw <value>` halts execution immediately with the runtime diagnostic
`ol-user-error`, carrying the thrown word as the learner-facing message; if the
value is not a word, its printed form (as `print` would show it) becomes the
message. It lets a procedure reject bad input in its own words — the geometry
library uses it to explain, for instance, an out-of-range star step. `throw` is a
Core special form; v0.1 has no `try`/`catch`, so a thrown error stops the program
like any other runtime diagnostic.

Recursion is supported. Each recursive invocation creates a new frame and emits
its own trace events.

## Control forms

`if` and `while` require boolean conditions. `repeat` requires a non-negative
whole-number count, checked in order: if the count is not a whole number it
raises `ol-type`; otherwise, if it is negative, it raises `ol-range`.
`forever` runs until cancellation or a configured limit. `for ... from ... to`
iterates numerically over an inclusive range: the variable starts at `start` and
each turn adds the `by` step (default `1`); with a positive step the body runs
while the variable is at most `end`, and with a negative step while it is at
least `end`. A step that points away from `end` runs the body zero times, and a
step of `0` raises `ol-range`. `for ...
in ...` iterates list elements in order; dict iteration follows insertion order
when a dict is accepted by a profile-specific form. Control forms run their
bodies for effect and produce no value.

**Binder scope.** Every binder a control or comprehension form introduces — the
`for ... in` and `for ... from ... to` variable, the item binder of `map`, `filter`,
and `reduce`, and `reduce`'s accumulator — is a fresh body-local binding for each
iteration, the accumulator re-bound to the running value rather than reset. It shadows
any outer binding of the same name for the duration of the body only, and is not
visible once the form completes: a read of that name afterwards has no declaration
in scope and raises `ol-undefined-var` unless an outer binding of it exists. Bare-name
binders and every name bound by a destructuring pattern follow this rule alike.

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
fresh list of original elements whose body value is `true`, preserving their
relative order; a non-boolean body raises `ol-not-boolean`. `reduce <acc> <var>
in <listExpr> from <init> [ <expr> ]` folds left and returns the final accumulator.

For `reduce`, empty input returns `init` unchanged. The accumulator and item
binders are fresh body-local bindings that shadow outer names only for the body.
The binder names must differ; duplicates raise `ol-duplicate-binder`.

Comprehension bodies are bracketed expression-blocks only. They must end in a
value-producing expression, cannot contain `return`/`output`/`op`/`stop`, and may
call ordinary procedures. If the final expression calls a procedure that never
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

Destructuring binds a pattern list of `:names` positionally from each element
and is available in every element-binding form — `for ... in`, `map`, `filter`,
and `reduce` (its item binder, not the accumulator). Records destructure in
declared field order; lists destructure by item order. A short or long pattern
mismatch raises `ol-range`.

The `destructuring-pattern` grammar production (`binder ::= name | destructuring-pattern`,
[grammar.md](grammar.md)) contains only `:name` tokens and never nests another
`destructuring-pattern`, so destructuring is flat in v0.1: there is no nested or recursive
destructuring pattern in either profile, and this document does not add one. List and record are
the only destructurable item kinds. A dict or scalar (number, word, boolean) item is not a
positionally-destructurable value: binding a destructuring pattern against one raises `ol-type`,
the general wrong-type-for-the-operation diagnostic used elsewhere in this spec, in every
conforming implementation — this is not a Data-profile dict-destructuring feature, because v0.1
defines none.

Profile ownership of this binder-pattern behavior follows the value being
destructured, not the iteration form: `for ... in`, `map`, `filter`, and
`reduce` are themselves Core control/comprehension forms, so a destructuring
pattern applied to a plain **list** item (positional unpacking of `[ ]`
elements, as in `for [:x :y] in [[1 2] [3 4]]`) is **Core** — it needs only
Core list values and the Core `binder ::= name | destructuring-pattern`
grammar production. The same pattern applied to a **record** item — as in the
`:corners` example below, which destructures `point` records in declared field
order — requires the **Data** profile, because `record` values, `struct`
declarations, and declared field order are Data-profile concepts (see
[conformance.md#data](conformance.md#data)); an implementation that claims only
Core Language and Turtle & Rendering supports list-binder destructuring but
does not support record-binder destructuring, since it has no record values to
destructure.

```logo
:corners = (list (point 0 0) (point 100 90))
:xs = map [:x :y] in :corners [ :x ]
for [:x :y] in :corners [ set_xy :x :y ]
```

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

Bare dict keys are literal data, not procedure calls; built-in names are legal
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

Rendering a value's printed form — the text produced for `print`, `show`, or a
`throw`'s learner-facing message — must terminate on cyclic structure and must
not silently re-expand large shared substructure: implementations maintain a
memo of every reference value (list, dict, or record) encountered anywhere
earlier in the *same render* — not only on the current recursive path — keyed
by reference identity. The first time a reference is encountered, its contents
are rendered by recursing as usual, and the reference is added to the memo
*before* recursing into it, so that a reference reachable from itself, directly
or transitively, is caught as a cycle. Every later encounter of that same
reference anywhere else in the same render — whether by a genuine cycle or by
an unrelated second path reaching the same shared value, for example
`print (list :shared :shared)` — is rendered as the same bounded,
implementation-defined placeholder (for example an ellipsis or a
repeated-reference marker) instead of being recursed into again. This
whole-render memo is normative and is a *stronger* requirement than the
in-progress pair memoization used for structural equality above: equality's
memo only needs to track pairs currently being compared to guarantee
termination, while rendering must recognize a repeated reference across the
*entire* render, cyclic or not, to guarantee a single, bounded printed
representation. Rendering MUST NOT overflow the host call
stack; an implementation that would otherwise overflow instead raises the friendly `ol-limit` diagnostic defined in
[error-model.md](error-model.md), which — per that document — MUST NOT itself
expose a host stack overflow.

Ordering operators `<`, `>`, `<=`, and `>=` are defined only for numbers and
words. Numbers compare numerically. Words compare lexicographically by Unicode
code point. Other ordered pairs raise `ol-type`.

## Numbers and math

Trigonometric reporters use degrees. `pi` reports the mathematical constant.
Division or `mod` by zero raises `ol-div-zero`; `sqrt` of a negative number
raises `ol-neg-sqrt`; `tan` of an angle whose tangent is undefined (an odd
multiple of 90°) raises `ol-tan-undefined`; a non-integer where an integer is
required raises `ol-type`. OpenLogo never exposes NaN or Infinity as
learner-facing results for these educational errors.

`random n` reports an integer in `[0,n-1]`; `n` MUST be a whole number of at
least `1`. `(random a b)` reports an integer in `[a,b]`; `a` and `b` MUST be
whole numbers with `a <= b`. Inputs are checked in order: a non-whole bound
raises `ol-type`, then `n` below `1` or `a` greater than `b` raises `ol-range`.
`randomize` with no input uses an implementation seed;
`(randomize seed)` is deterministic within an implementation. Examples that
depend on randomness state properties such as "a number in `[0,99]`" unless a
future version standardizes a PRNG.

## Turtle and canvas state

At program start, the default turtle/canvas state is:

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
drawing and homes the turtle (position `(0,0)`, heading `0`) while preserving the pen state, color, width, visibility, and background.
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
| `turtle-id` | Turtle identity; present only when the event is turtle-specific, otherwise absent. |
| `payload` | Kind-specific typed data. |

There are two timing classes:

- **Start events** are emitted before their effect: `instruction` and
  `procedure-enter`.
- **Effect events** are emitted immediately after the state change or output
  they describe.

A step is the span from one `instruction` event to the next. The `instruction`
event is the unit of "one step"; effect events caused by that instruction follow
it before the next `instruction`.

An effect event's `payload` captures the value or values it describes as a
point-in-time snapshot taken at the moment of emission, not a live reference to
mutable state. The snapshot is a **transitive, immutable copy of the value
graph** reachable from the payload: for a list, dict, or record, every element,
entry, or field is itself captured by this same rule, recursively, as of that
instant — capture is not shallow, so a nested mutable value nested several
levels deep is protected from later mutation exactly as a top-level one is. A
later mutation through the original live reference, at any depth (see the
mutation-and-copy table above), MUST NOT retroactively change any part of the
payload of an event already emitted.

OpenLogo list/dict/record values may alias each other or contain cycles — for
example, a self-referential list constructed by `add :l to :l` (see
[data-structures.md](data-structures.md)). Snapshot capture MUST preserve the
aliasing and cycle structure of the value graph as of the moment of capture,
using snapshot-local reference identity: two positions in the snapshot that
were the same live reference at capture time remain the same snapshotted
reference, and a position reachable from itself, directly or transitively,
remains a cycle in the snapshot rather than being expanded without bound.
Capturing a snapshot MUST terminate using a memo of live references already
captured earlier in the *same capture* — not only on the current recursive
path — so that both a direct cycle and a value reached twice via two different,
non-cyclic paths are recognized as the same snapshot-local reference and
captured only once; this is the same whole-operation memoization discipline
required above for rendering a value's printed form (a stronger discipline
than the in-progress pair memoization used for structural equality, which only
needs to guarantee termination, not dedupe shared-but-acyclic structure). This
snapshot rule is what makes deterministic replay,
stepping, and `why`/`debug` inspection of **prior effect events** well-defined
even though OpenLogo's list, dict, and record values are ordinarily mutable,
aliasable, and — through operations such as `add … to` — possibly
self-referential. This snapshot rule applies to effect-event payloads
specifically; `procedure-enter`'s `args` payload (a **start** event, emitted
*before* its effect, per the timing classes above) is not in scope here and MAY
still observe subsequent mutation of a mutable argument before the procedure
body's own effect events are emitted.

Normative `kind` values:

| Timing | Kinds |
|---|---|
| Start | `instruction`, `procedure-enter` |
| Effect | `move`, `turn`, `pen-change`, `width-change`, `color-change`, `background-change`, `draw-segment`, `fill`, `stamp`, `shape-change`, `visibility-change`, `clear`, `overlay`, `procedure-exit`, `return`, `print`, `sound`, `spawn-turtle`, `primitive`, `error`, `tutor-output` |

Rendering-relevant events carry typed payloads. Examples:

- `move`: `{from:[x y], to:[x y], heading}`;
- `draw-segment`: `{from:[x y], to:[x y], color, width}`;
- `turn`: `{from, to}`;
- `clear`: `{mode:"clear_screen"}` or `{mode:"clean"}`.

`primitive` is the generic catch-all for a primitive without a more specific
event. Implementations may add extension events under a vendor namespace such as
`vendor_name.event_name`.

### `tutor-output` (Educational profile)

**Status: Normative, scoped to the [Educational profile](conformance.md#educational).** A
Core+Turtle & Rendering conformance claim never requires this kind: a Core-only implementation never
claims the Educational profile, so it never emits `tutor-output`, and every existing event envelope
and every existing kind's payload is unchanged by this addition — nothing here alters Core-only
traces or requires a Core-only consumer to change. An implementation only emits `tutor-output` events
when it claims the Educational profile, because only that profile defines the `explain`, `why`,
`hint`, and `debug` baseline meta-commands specified in
[educational-model.md](educational-model.md#baseline-meta-commands) and required normatively in
[conformance.md#educational](conformance.md#educational).

`tutor-output` is an **effect event**: it is emitted immediately after the baseline meta-command
that triggered it produces its result, following the same start/effect convention as every other
event in this registry. Its envelope `source-span` is always the span of the meta-command invocation
itself (the bare-word call site), matching every other event kind's `source-span` meaning; it is
never replaced by the span of whatever the command is explaining.

Payload shape (data-only, stack-neutral — no host-language types):

| Field | Meaning |
|---|---|
| `command` | One of `"explain"`, `"why"`, `"hint"`, `"debug"`. |
| `segments` | A non-empty ordered list of learner-facing message segments (plain text strings). No markup is imposed by the spec. |
| `stage` | Present only when `command` is `"hint"`. One of `"nudge"`, `"concept"`, `"partial"`, `"last-resort"` — the four stages of the progressive hint model in [educational-model.md](educational-model.md#hint). Absent for `explain`, `why`, and `debug`. |
| `target-source-span` | The span of the instruction, statement range, or short program the command's `segments` describe. **MUST be present for `hint`**, using the whole-program span as its explicit value when no narrower challenge target is selected. **MUST be present for `explain`, `why`, and `debug`** whenever they describe a specific instruction, statement range, or diagnostic, and in that case MUST equal the diagnostic's own source span when `diagnostic-code` is also present. MAY be absent only for `explain`/`why`/`debug` output that concerns the program as a whole with no diagnostic and no narrower selection in scope. A span covering multiple instructions is permitted (`explain` MAY describe a short program, and `why`/`debug` MAY describe state produced across several instructions, not only one). |
| `diagnostic-code` | Optional. The `ol-*` code from [error-model.md](error-model.md) that `debug` or `why` is explaining, when the explanation concerns a diagnostic rather than turtle/variable state. Absent otherwise. |

Normative guardrail on the payload: **the `segments` of a single `tutor-output` event, read together in
order, MUST NOT constitute a complete, ready-to-run OpenLogo solution program.** This is a normative
pedagogical rule restating the no-full-solution requirement of
[conformance.md#educational](conformance.md#educational) against a concrete payload shape. It is
checkable only in a limited, structural sense — a conformance fixture MAY assert that the
concatenation of a `segments` value does not itself parse as a standalone runnable program that
satisfies the current challenge — but this check cannot prove absence of a solution conveyed through
prose, split across otherwise-unrelated commands, or expressed without valid OpenLogo syntax; a
fixture asserting this guardrail is necessary but not sufficient evidence of compliance, and human
review of new baseline templates remains required. For `hint`, this guardrail applies independently
at every `stage`, including `"last-resort"`.

Progression state for `hint` is a property of the host implementation, not the wire event itself: this
spec does not define learner sessions, challenge attempts, or any other lifecycle concept, so it does
not mandate exactly when that state resets. What it requires is only the observable ordering among the
`tutor-output` events an implementation actually emits for a given `target-source-span` value: the
first such event with `command: "hint"` MUST have `stage: "nudge"`; each subsequent one for the *same*
`target-source-span` value MUST escalate to the next stage in the nudge → concept → partial →
last-resort order; and once `"last-resort"` has been emitted for that value, further `hint` events for
it MUST repeat `stage: "last-resort"` rather than fabricate a fifth stage or reveal the solution. A
`hint` event whose `target-source-span` is a *different* value starts its own independent progression
at `"nudge"`. When (and whether) an implementation begins a fresh progression for what a learner
perceives as "the same" hint request — for example after editing the program or restarting a
challenge — is implementation-defined and out of scope for this event kind.

An implementation that consumes traces from an Educational-profile host but does not itself
special-case `tutor-output` MUST treat it as having no visible or semantic effect. This requirement
applies only to consumers of Educational traces; it does not require any change to a Core-only
implementation, which by definition never produces or consumes a `tutor-output` event, and it does
not establish any general rule for handling other unrecognized event kinds. A host that does not claim
the Educational profile MUST NOT emit `tutor-output` events.

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
matrix in [commands.md](commands.md). Syntax productions, keywords, and built-in
names must match [grammar.md](grammar.md). Diagnostics must use the codes and
message shape from [error-model.md](error-model.md).
