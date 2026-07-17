> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Grammar

Back to the [specification index](README.md).

This document is the normative grammar for **OpenLogo**. The short name is **OL**, and source files use the **`.logo`** extension. It specifies lexis, reader-visible syntax, expression precedence, bracket roles, assignable places, and reserved structural words. Evaluation details and the block-result rule are defined in [execution-model.md](execution-model.md); this grammar supplies the syntactic slots that invoke that rule.

## Lexical form and encoding

OpenLogo source text is Unicode text. Implementations must accept UTF-8 encoded `.logo` files and should preserve source spans in Unicode scalar-value positions for diagnostics.

Keywords and identifiers are case-insensitive; lowercase is canonical in specifications, tools, and examples. Word values preserve case.

Identifiers use snake_case. The ASCII core form is `[a-z_][a-z0-9_]*[?!]?`. The lexer also admits Unicode identifier letters using XID rules: `XID_Start (XID_Continue | '_')* [?!]?`. Built-in keywords and primitives are lowercase ASCII; Unicode letters are for learner names and localization packs. Hyphen is never part of an identifier: `-` is always the minus operator or a numeric sign, so `a-b` lexes as `a - b`.

Numbers use `.` as the decimal point regardless of locale. A leading `-` directly before a numeral, when there is no left operand, is part of a negative numeric literal. Between operands it is subtraction. Thus `-5`, `forward -10`, and `:x * -2` contain negative literals, while `:a-:b` and `:a - 1` contain subtraction.

Word/string literals come in two forms. A **single-line** literal is closed double quotes such as `"tom"`, `"#ff0000"`, and `"hello world"`; it may contain any Unicode scalar value except a raw newline, an unescaped closing quote, or a backslash. A **multi-line** literal is triple double quotes `"""..."""` and may span several lines. Escapes are `\"` for a quote and `\\` for a backslash in both forms; other characters are literal. An unterminated single-line or multi-line literal raises `ol-unclosed-string`. Classic Logo open-quote word syntax such as `"word` is not OpenLogo.

A multi-line literal is normalized when it is read: the newline immediately after the opening `"""` and the newline immediately before the closing `"""` are dropped, and the **common leading whitespace** shared by every non-blank content line is removed, so the least-indented content line moves to column 0 while relative indentation is preserved. The indentation of the closing `"""` does not affect the result. For example:

```logo
:poem = """
    Hello
  World
"""
```

yields the two lines `  Hello` and `World`: the two spaces common to both lines are stripped, and `Hello` keeps its extra two-space indent.

Comments are whitespace. `#` and `//` start line comments that end at the next line break. `/* */` delimits a non-nesting block comment; an unterminated block comment raises `ol-unclosed-comment`. Comment markers inside strings are literal text.

Horizontal whitespace and indentation are insignificant except as token separators. A newline ends the current statement at the top level and inside a bracketed `[ ... ]` or long `... end` control body; inside `[ ... ]` the newline is optional, because fixed arity also separates adjacent instructions. Immediately after a control or procedure header, a newline selects the long `... end` body form. Within a single expression, list literal, dict literal, or parenthesized group, newlines are insignificant. Consecutive newlines form a single separator, so blank lines may appear between statements anywhere — at the top level, inside `[ ... ]`, and inside a `... end` block — and the newline after the final statement of a file is optional.

```logo
# primary line comment
// alternate line comment
/* block comments may span
   more than one line */

:name = "tom"
:delta = -5
:total = :a - :b
```

## EBNF notation

The grammar below uses W3C/ISO-style EBNF. Literal terminals are quoted. `? name ?` denotes a lexical class or semantic predicate described in prose. `{ x }` means zero or more repetitions. `[ x ]` means an optional item. `(* x *)` is a comment. In the EBNF itself these meta-brackets are notation, not OpenLogo source brackets.

```logo
name                ::= identifier
identifier          ::= ascii-identifier | unicode-identifier
ascii-identifier    ::= ( "a"..."z" | "_" ) { "a"..."z" | "0"..."9" | "_" } [ "?" | "!" ]
unicode-identifier  ::= XID_Start { XID_Continue | "_" } [ "?" | "!" ]
callable-name       ::= identifier
type-name           ::= identifier
number              ::= [ "-" ] digit { digit } [ "." digit { digit } ] [ exponent ]
exponent            ::= ( "e" | "E" ) [ "+" | "-" ] digit { digit }
digit               ::= "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
word-literal        ::= single-line-string | multi-line-string
single-line-string  ::= "\"" { string-character | string-escape } "\""
multi-line-string   ::= "\"\"\"" { multiline-character | string-escape } "\"\"\""
string-character    ::= ? any Unicode scalar value except newline, unescaped quote, or backslash ?
multiline-character ::= ? any Unicode scalar value except backslash or an unescaped run of three quotes ?
(* the lexer takes the longest match, so a leading """ opens a multi-line string, never an empty "" followed by a quote *)
string-escape       ::= "\\\"" | "\\\\"
line-comment        ::= "#" { ? any character except newline ? }
                      | "//" { ? any character except newline ? }
block-comment       ::= "/*" { ? any character sequence not containing */ ? } "*/"
newline             ::= ? a line feed U+000A, optionally preceded by a carriage return U+000D ?
EOF                 ::= ? the end of the input ?

program             ::= [ terminator ] { statement terminator } [ statement ] EOF
terminator          ::= newline { newline }

statement           ::= assignment
                      | set-assignment
                      | make-assignment
                      | add-statement
                      | remove-statement
                      | remove-key-statement
                      | insert-statement
                      | clear-statement
                      | if-statement
                      | while-statement
                      | repeat-statement
                      | for-in-statement
                      | for-range-statement
                      | forever-statement
                      | define-statement
                      | to-statement
                      | struct-declaration
                      | return-statement
                      | stop-statement
                      | throw-statement
                      | local-statement
                      | alias-statement
                      | import-statement
                      | export-statement
                      | expression

assignment          ::= colon-place "=" expression
set-assignment      ::= "set" bare-place "to" expression
make-assignment     ::= "make" word-literal expression

colon-place         ::= ":" name { postfix }
bare-place          ::= name { postfix }
postfix             ::= selector | "." identifier
selector            ::= "[" key-term "]"
key-term            ::= number | identifier | ":" name | word-literal | "(" expression ")"

add-statement       ::= "add" expression "to" expression
remove-statement    ::= "remove" expression "from" expression
remove-key-statement ::= "remove" "key" key-term "from" expression
insert-statement    ::= "insert" expression "in" expression "at" expression
clear-statement     ::= "clear" expression

if-statement        ::= "if" expression if-bracket-tail
                      | "if" expression if-long-tail
if-bracket-tail     ::= bracket-block [ "else" bracket-block ]
if-long-tail        ::= terminator { statement terminator }
                        [ "else" terminator { statement terminator } ] if-end-label
if-end-label        ::= "end" [ "if" ]
while-statement     ::= "while" expression control-body
repeat-statement    ::= "repeat" expression control-body
for-in-statement    ::= "for" binder "in" expression control-body
for-range-statement ::= "for" name "from" expression "to" expression [ "by" expression ] control-body
forever-statement   ::= "forever" control-body

comprehension       ::= map-expression | filter-expression | reduce-expression
map-expression      ::= "map" binder "in" expression expression-block
filter-expression   ::= "filter" binder "in" expression expression-block
reduce-expression   ::= "reduce" name binder "in" expression "from" expression expression-block

binder              ::= name | destructuring-pattern
destructuring-pattern ::= "[" ":" name { ":" name } "]"

control-body        ::= bracket-block | long-control-block
bracket-block       ::= "[" { terminator } { statement { terminator } } "]"
expression-block    ::= "[" { terminator } { statement { terminator } } "]"
long-control-block  ::= terminator { statement terminator } control-end-label
control-end-label   ::= "end" [ "if" | "while" | "repeat" | "for" | "forever" ]

define-statement    ::= "define" callable-name { required-parameter } { optional-parameter } terminator { statement terminator } define-end
to-statement        ::= "to" callable-name { required-parameter } { optional-parameter } terminator { statement terminator } define-end
define-end          ::= "end" [ "define" ]
required-parameter  ::= ":" name
optional-parameter  ::= "(" ":" name expression ")"
return-statement    ::= ( "return" | "output" | "op" ) expression
stop-statement      ::= "stop"
throw-statement     ::= "throw" expression
local-statement     ::= "local" name | "(" "local" name { name } ")"

struct-declaration  ::= "struct" type-name field-list
field-list          ::= "[" identifier { identifier } "]"

alias-statement     ::= "alias" identifier identifier
import-statement    ::= "import" word-literal
export-statement    ::= "export" identifier
```

## Expressions and calls

OpenLogo calls are prefix and space-separated. Each callable has one fixed default arity. A variadic or alternate-arity call must be wrapped in parentheses. Commas are not syntax anywhere.

```logo
forward random 100
(print :a :b)
:nums = (list 1 2 3)
```

Expression grammar:

```logo
expression          ::= or-expression
or-expression       ::= and-expression { "or" and-expression }
and-expression      ::= comparison { "and" comparison }
comparison          ::= additive ( is-predicate | { compare-op additive } )
compare-op          ::= "==" | "!=" | "<" | ">" | "<=" | ">="
is-predicate        ::= "is" ( "empty"
                              | "member" "of" additive
                              | "a" word-literal
                              | [ "strictly" ] "between" additive "and" additive )
additive            ::= multiplicative { ( "+" | "-" ) multiplicative }
multiplicative      ::= unary { ( "*" | "/" | "mod" ) unary }
unary               ::= "not" unary | postfix-expression
postfix-expression  ::= primary { selector | "." identifier }
primary             ::= number
                      | word-literal
                      | boolean-literal
                      | variable-read
                      | list-literal
                      | dict-literal
                      | parenthesized-expression
                      | fixed-call
                      | parenthesized-call
                      | type-constructor-call
                      | value-of-reader
                      | comprehension

boolean-literal     ::= "true" | "false"
variable-read       ::= ":" name
list-literal        ::= "[" [ expression { expression } ] "]"
dict-literal        ::= "{" { dict-entry } "}"
dict-entry          ::= dict-key ":" expression
dict-key            ::= identifier | number
(* dict entries are separated by whitespace or newlines, never by commas *)
parenthesized-expression ::= "(" expression ")"
fixed-call          ::= callable-name { ? the callable's default arity, each input a full expression ? }
parenthesized-call  ::= "(" callable-name { expression } ")"
type-constructor-call ::= type-name { ? exactly one expression per declared field ? }
value-of-reader     ::= "value" "of" expression "for" "key" expression
```

Precedence from high to low is:

1. postfix selectors and fields: `[]`, `.`
2. prefix `not`
3. `*`, `/`, `mod`
4. `+`, `-`
5. comparisons: `==`, `!=`, `<`, `>`, `<=`, `>=`
6. `and`
7. `or`

Binary operators are left-associative. `and` and `or` short-circuit. `not` is unary prefix. A leading `-` on a numeral is part of a negative literal, not a unary operator, so negating a value is written `0 - :x` and negating a compound expression is written `0 - (:a + :b)`. Assignment `=` and `set ... to` are statement forms, not expression operators.

Each input to a prefix call is a full expression, so infix operators bind inside the argument rather than around the call: `forward :size * 2` means `forward (:size * 2)`, and `power 2 3 * 4` means `power 2 (3 * 4)`. Reporters still nest by their known arity, so `forward random 100` means `forward (random 100)`.

Comparisons may be **chained**: `1 < :x < 10` reads as `1 < :x and :x < 10`, evaluating each operand once with `and` short-circuit semantics. The worded predicates are written **operand-first**, matching the grammar production (the value precedes `is`): `<value> is empty`, `<value> is member of <collection>`, `<value> is a <type-word>`, and `<value> is [ strictly ] between <low> and <high>`. They sit at the comparison level and produce booleans. Among the words involved, `is`, `strictly`, and `between` are globally reserved; only `empty`, `member`, `of`, and `a` are contextual keywords recognized just after `is`, so those four remain usable as ordinary names elsewhere. Operand types depend on the operator: ordering comparisons (`<`, `>`, `<=`, `>=`) and `[ strictly ] between` require numbers or words; `==` and `!=` compare any two values; `<value> is empty` accepts lists, dicts, and words; `<value> is member of` accepts lists and dicts; `<value> is a` accepts any value. An operand of the wrong type raises `ol-type`.

## Places, selectors, and keys

The set of assignable places is closed and recursive. Only these forms are places:

```logo
:size = 100
:nums[1] = 9
:p.x = 5
:people.tom.age = 9
set people.tom.age to 9
```

A colon place starts with `:` and a name. A bare place is the same syntax without `:` and appears only after `set` before `to`. Both may have any number of postfixes. A postfix is either `[ key-term ]` or `.identifier`.

Selector brackets contain exactly one key-term, not a general unparenthesized expression:

```logo
print :nums[1]
print :ages[tom]
print :ages[:who]
print :ages["tom"]
print :nums[(:i + 1)]
```

A bare identifier inside a selector is a literal word key. A `:name` term uses the variable value. Arithmetic or any other expression must be parenthesized. The `.identifier` form is always a literal field or key and is never evaluated. Reserved words are allowed as selector keys because they are data in this position.

For assignment, all intermediate containers must already exist. Only the final selector may upsert a missing dictionary key. Missing intermediate dictionary keys raise `ol-unknown-key`; missing struct fields raise `ol-unknown-field`; out-of-range list indexes raise `ol-range`. Reporters such as `first`, `count`, and `keys` are not places and raise `ol-not-a-place` when used as assignment targets.

## Blocks and bracket roles

OpenLogo has five source roles for square brackets. The role is chosen by grammatical position:

| Role | Position | Example |
|---|---|---|
| list literal | value position | `:colors = ["red" "green"]` |
| instruction block | control or comprehension body position | `repeat 4 [ forward 100 right 90 ]` |
| selector | postfix position after a primary | `:nums[1]` |
| destructuring pattern | binder position | `for [:x :y] in :points [ print :x ]` |
| struct field-list | after `struct <type>` | `struct point [ x y ]` |

The roles never overlap because each occupies a distinct grammar slot. `{ }` is only a dictionary literal. `( )` groups expressions or wraps variadic and alternate-arity calls.

Control bodies for `if`, `while`, `repeat`, `for`, and `forever` use exactly one of these forms:

1. bracketed block `[ ... ]`, inline or multiline
2. long block `... end` with an optional matching label, preferred for multi-line bodies

A control body is always delimited: there is no bare or undelimited body, so even a single instruction is written `repeat 4 [ forward 100 ]` or as a `... end` block. Inside a bracketed body, instructions are separated by their fixed arity, so `[ forward 100 right 90 ]` holds two commands and newlines inside `[ ]` are optional. After a control header, the rest of the physical line decides the form: if it begins with `[`, the body is a bracketed block; if the header ends the line, the body is a long `... end` block; any other token raises `ol-missing-end` with a hint to wrap the body in `[ ]` or close it with `end`.

Every long block closes with `end`, optionally followed by the single keyword that opened it. The core labels are `end`, `end if`, `end while`, `end repeat`, `end for`, `end forever`, and `end define`. Optional profiles extend this rule uniformly: an effect-block opened by a profile keyword — for example `ask`, `each`, `when`, `every`, `on_key`, or `on_click` — closes with `end` or `end <keyword>` using that same opener, and the profile documents are normative for their own keywords. A suffix that does not match its opener, or an orphan label, raises `ol-mismatched-end`; a missing terminator raises `ol-missing-end`. An unbalanced `[ ]`, `{ }`, or `( )` raises `ol-unmatched-bracket`, `ol-unmatched-brace`, or `ol-unmatched-paren` respectively.

An `if` takes either bracketed branches, `if <cond> [ ... ] else [ ... ]`, or long-form branches, `if <cond>` … `else` … `end if`; both branches use the same form. Because every branch is delimited, `else` binds to the nearest still-open `if` and there is no dangling-`else` ambiguity.

Comprehension bodies for `map`, `filter`, and `reduce` are bracketed expression blocks only. They are never long blocks.

Procedure bodies for `define` and heritage `to` are long blocks only and close with `end` or `end define`. They are never `[ ]` blocks. `struct` is a one-line declaration.

```logo
repeat 4 [ forward 100 right 90 ]

repeat 4
  forward 100
  right 90
end repeat

if :count > 3 [ print "big" ] else [ print "small" ]

map num in :nums [ :num * 2 ]

define double :n
  return :n * 2
end define
```

The result of a block is governed by the [block-result rule](execution-model.md): control forms run blocks for effect and discard values, comprehensions keep the last expression's value, and procedures return a value only through `return`, `output`, or `op`.

## Collections, records, and comprehensions

List literals contain whitespace-separated value expressions. Dictionary literals use bare keys followed by `:` and a value expression. Entries are separated by whitespace or newlines; commas are forbidden.

```logo
:nums = [1 2 3]
:ages = {
  sophie: 6
  tom: 8
}
:ages.max = 9
```

A `struct` declaration registers the type and a constructor reporter with the same name. Its field-list is bare identifiers, not a list literal. A constructor call is a prefix call with arity equal to the number of fields.

```logo
struct point [ x y ]
:p = point 3 4
:p.x = 5
add (point 0 0) to :path
```

Destructuring patterns bind names positionally from lists or records in declared field order.

```logo
for [:x :y] in :points
  print :x
end for
```

Core comprehension forms are special forms, not function-valued higher-order calls:

```logo
:doubled = map num in :nums [ :num * 2 ]
:bigs = filter num in :nums [ :num > 2 ]
:total = reduce sum num in :nums from 0 [ :sum + :num ]
```

`map` returns a fresh list of body values. `filter` returns elements whose body value is `true`. `reduce` folds left from the initial value; the accumulator and item binder names must differ.

A comprehension is an expression: because it is recognized by its leading keyword, it may appear anywhere a value is expected — the right side of `=` or `set ... to`, a `return`, `output`, or `op` value, a call argument, or nested inside another comprehension. It may also stand alone as a statement. The `[ ... ]` that follows the collection is always the comprehension body, never a selector on that collection; to iterate over an indexed collection, parenthesize it, as in `map n in (:matrix[1]) [ :n * 2 ]`.

## Reserved words and namespaces

The normative OpenLogo reserved-word list is:

```logo
define to end return output op stop throw
set make local thing
if else while repeat for forever in from at by
key value add remove insert clear
map filter reduce
and or not true false
is between strictly
struct alias import export
```

`to` is one reserved word with multiple contextual roles: heritage procedure opener, the preposition in `set ... to`, and the bound in `for ... from ... to`. By contrast, `empty`, `member`, `of`, and `a` are **not** reserved: they act as keywords only inside an `is`-predicate (`:x is empty`, `2 is member of :nums`, `:p is a "point"`) and stay ordinary names everywhere else. (`of` is also the contextual preposition in the heritage `value of … for key` reader.)

Reserved words are structural tokens recognized by the reader. They may not be redefined as variables, procedures, primitives, or struct type constructors; such collisions raise `ol-reserved-word`. Reserved words may be aliased by `alias` or localized keyword packs because aliasing adds reader-recognized spellings rather than redefining the underlying word.

Primitives, user procedures, and struct type constructors share one callable namespace. Record field names live in a per-type namespace reached only by `.field`, so they do not collide with globals or structural words. Dictionary keys and selector bare keys are data, not declarations, so reserved words are legal keys.

Profile-specific reserved words are recognized only when their profile is active and are specified in their profile documents: the Sprites block heads `ask` and `each` and the Sprites command `tell` — a mode switch that takes no block — plus the Interaction block heads `when`, `every`, `on_key`, and `on_click`.

## Profile grammar extensions

When a profile is active, the `statement` production gains that profile's own statement forms. Each profile document defines them formally, reusing the Core `expression`, `bracket-block`, `statement`, and `terminator` productions together with a profile-specific labeled `end` such as `end ask`, `end each`, or `end when`. See [turtles-and-sprites.md](turtles-and-sprites.md) and [interaction-events.md](interaction-events.md).
