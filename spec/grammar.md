> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Grammar

Back to the [specification index](README.md).

This document is the normative grammar for **OpenLogo**. The short name is **OL**, and source files use the **`.logo`** extension. It specifies lexis, reader-visible syntax, expression precedence, bracket roles, assignable places, and reserved structural words. Evaluation details and the block-result rule are defined in [execution-model.md](execution-model.md); this grammar supplies the syntactic slots that invoke that rule.

## Lexical form and encoding

OpenLogo source text is Unicode text. Implementations must accept UTF-8 encoded `.logo` files and should preserve source spans in Unicode scalar-value positions for diagnostics.

Keywords and identifiers are case-insensitive; lowercase is canonical in specifications, tools, and examples. Word values preserve case.

Identifiers use snake_case. The ASCII core form is `[a-z_][a-z0-9_]*[?!]?`. The lexer also admits Unicode identifier letters using XID rules: `XID_Start (XID_Continue | '_')* [?!]?`. Built-in keywords and primitives are lowercase ASCII; Unicode letters are for learner names and localization packs. Hyphen is never part of an identifier: `-` is always the minus operator or a numeric sign, so `a-b` lexes as `a - b`.

Numbers use `.` as the decimal point regardless of locale. A leading `-` directly before a numeral, when there is no left operand, is part of a negative numeric literal. Between operands it is subtraction. Thus `-5`, `forward -10`, and `:x * -2` contain negative literals, while `:a-:b` and `:a - 1` contain subtraction.

Word/string literals are closed double-quote literals such as `"tom"`, `"#ff0000"`, and `"hello world"`. They may contain any Unicode scalar value except an unescaped closing quote or backslash. Escapes are `\"` for a quote and `\\` for a backslash; other characters are literal. Unterminated strings raise `ol-unclosed-string`. Classic Logo open-quote word syntax such as `"word` is not OpenLogo.

Comments are whitespace. `#` and `//` start line comments that end at the next line break. `/* */` delimits a non-nesting block comment; an unterminated block comment raises `ol-unclosed-comment`. Comment markers inside strings are literal text.

Whitespace is insignificant except as a token separator. Newline also terminates a bare single-instruction body.

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

The grammar below uses W3C/ISO-style EBNF. Literal terminals are quoted. `? name ?` denotes a lexical class or semantic predicate described in prose. `{ x }` means zero or more repetitions. `[ x ]` means an optional item. In the EBNF itself these meta-brackets are notation, not OpenLogo source brackets.

```logo
name                ::= identifier
identifier          ::= ascii-identifier | unicode-identifier
ascii-identifier    ::= ( "a"..."z" | "_" ) { "a"..."z" | "0"..."9" | "_" } [ "?" | "!" ]
unicode-identifier  ::= XID_Start { XID_Continue | "_" } [ "?" | "!" ]
number              ::= [ "-" ] digit { digit } [ "." digit { digit } ] [ exponent ]
exponent            ::= ( "e" | "E" ) [ "+" | "-" ] digit { digit }
word-literal        ::= "\"" { string-character | "\\\"" | "\\\\" } "\""
string-character    ::= ? any Unicode scalar value except unescaped quote or backslash ?
line-comment        ::= "#" { ? any character except newline ? }
                      | "//" { ? any character except newline ? }
block-comment       ::= "/*" { ? any character sequence not containing */ ? } "*/"

program             ::= { statement terminator } EOF
terminator          ::= newline | EOF

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
                      | map-statement
                      | filter-statement
                      | reduce-statement
                      | define-statement
                      | to-statement
                      | struct-declaration
                      | return-statement
                      | stop-statement
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

if-statement        ::= "if" expression control-body [ "else" control-body ]
while-statement     ::= "while" expression control-body
repeat-statement    ::= "repeat" expression control-body
for-in-statement    ::= "for" binder "in" expression control-body
for-range-statement ::= "for" name "from" expression "to" expression [ "by" expression ] control-body
forever-statement   ::= "forever" control-body

map-statement       ::= "map" binder "in" expression expression-block
filter-statement    ::= "filter" binder "in" expression expression-block
reduce-statement    ::= "reduce" name name "in" expression "from" expression expression-block

binder              ::= name | destructuring-pattern
destructuring-pattern ::= "[" ":" name { ":" name } "]"

control-body        ::= bracket-block | long-control-block | bare-single-instruction
bracket-block       ::= "[" { statement terminator } "]"
expression-block    ::= "[" { statement terminator } expression "]"
long-control-block  ::= newline { statement terminator } control-end-label
control-end-label   ::= "end" [ "if" | "while" | "repeat" | "for" | "forever" ]
bare-single-instruction ::= ? exactly one complete non-if statement on the same physical line ?

define-statement    ::= "define" callable-name { parameter } newline { statement terminator } define-end
to-statement        ::= "to" callable-name { parameter } newline { statement terminator } define-end
define-end          ::= "end" [ "define" ]
parameter           ::= ":" name | "(" ":" name expression ")"
return-statement    ::= ( "return" | "output" | "op" ) expression
stop-statement      ::= "stop"
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
comparison          ::= additive [ compare-op additive ]
compare-op          ::= "==" | "!=" | "<" | ">" | "<=" | ">="
additive            ::= multiplicative { ( "+" | "-" ) multiplicative }
multiplicative      ::= unary { ( "*" | "/" | "mod" ) unary }
unary               ::= ( "-" | "not" ) unary | postfix-expression
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

boolean-literal     ::= "true" | "false"
variable-read       ::= ":" name
list-literal        ::= "[" [ expression { expression } ] "]"
dict-literal        ::= "{" { dict-entry } "}"
dict-entry          ::= dict-key ":" expression
dict-key            ::= identifier | number | word-literal
authoring-note      ::= ? dict entries are separated by whitespace or newlines and never by commas ?
parenthesized-expression ::= "(" expression ")"
fixed-call          ::= callable-name { ? exactly the callable's default number of inputs ? }
parenthesized-call  ::= "(" callable-name { expression } ")"
type-constructor-call ::= type-name { ? exactly one expression per declared field ? }
value-of-reader     ::= "value" "of" expression "for" "key" expression
```

Precedence from high to low is:

1. postfix selectors and fields: `[]`, `.`
2. unary `-` and `not`
3. `*`, `/`, `mod`
4. `+`, `-`
5. comparisons: `==`, `!=`, `<`, `>`, `<=`, `>=`
6. `and`
7. `or`

Binary operators are left-associative. `and` and `or` short-circuit. `not` is unary prefix. Assignment `=` and `set ... to` are statement forms, not expression operators.

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

1. bracketed block `[ ... ]`, short or multiline
2. long block `... end` with an optional matching label
3. a bare single-instruction body

Valid end labels are exactly `end`, `end if`, `end while`, `end repeat`, `end for`, `end forever`, and `end define`. A mismatched or orphan label raises `ol-mismatched-end`; a missing terminator raises `ol-missing-end`.

A bare single-instruction body must be exactly one complete instruction on the same physical line as the control header and must be followed by newline or EOF. It may not itself be an `if` or `if ... else`; nested conditionals used as bodies must be bracketed or long-form to avoid dangling `else`.

Comprehension bodies for `map`, `filter`, and `reduce` are bracketed expression blocks only. They are never long blocks and never bare bodies.

Procedure bodies for `define` and heritage `to` are long blocks only and close with `end` or `end define`. They are never `[ ]` blocks and never bare bodies. `struct` is a one-line declaration.

```logo
repeat 4 [ forward 100 right 90 ]

repeat 4
  forward 100
  right 90
end repeat

repeat 4 forward 100

if :count > 3 [ print "big" ] else [ print "small" ]

map num in :nums [ :num * 2 ]

define double :n
  return :n * 2
end define
```

The result of a block is governed by the [block-result rule](execution-model.md): control forms run blocks for effect and discard values, comprehensions keep the last expression's value, and procedures return a value only through `return`, `output`, or `op`.

## Collections, records, and comprehensions

List literals contain whitespace-separated value expressions. Dictionary literals use bare or quoted keys followed by `:` and a value expression. Entries are separated by whitespace or newlines; commas are forbidden.

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
for [:x :y] in :points [
  print :x
]
```

Core comprehension forms are special forms, not function-valued higher-order calls:

```logo
:doubled = map num in :nums [ :num * 2 ]
:bigs = filter num in :nums [ :num > 2 ]
:total = reduce sum num in :nums from 0 [ :sum + :num ]
```

`map` returns a fresh list of body values. `filter` returns elements whose body value is `true`. `reduce` folds left from the initial value; the accumulator and item binder names must differ.

## Reserved words and namespaces

The normative OpenLogo reserved-word list is:

```logo
define to end return output op stop
set make local thing
if else while repeat for forever in from at by of
key value add remove insert clear
map filter reduce
and or not true false
struct alias import export
```

`to` is one reserved word with multiple contextual roles: heritage procedure opener, the preposition in `set ... to`, and the bound in `for ... from ... to`.

Reserved words are structural tokens recognized by the reader. They may not be redefined as variables, procedures, primitives, or struct type constructors; such collisions raise `ol-reserved-word`. Reserved words may be aliased by `alias` or localized keyword packs because aliasing adds reader-recognized spellings rather than redefining the underlying word.

Primitives, user procedures, and struct type constructors share one callable namespace. Record field names live in a per-type namespace reached only by `.field`, so they do not collide with globals or structural words. Dictionary keys and selector bare keys are data, not declarations, so reserved words are legal keys.

Profile-specific block heads such as `tell`, `ask`, and `each` for Sprites and `when`, `every`, `on_key`, and `on_click` for Interaction are reserved only in their profiles and are specified in their profile documents.
