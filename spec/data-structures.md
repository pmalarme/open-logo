> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Data structures

Back to the [spec index](README.md).

This document is normative for OpenLogo lists, dictionaries, records, destructuring, the uniform collection access idiom, mutation-vs-copy behavior, and Level 8 comprehension usage. It realizes the Data profile rows of the canonical primitive matrix and the collection rules in the language contract. The Core list reporters and comprehension special forms are included here because they are the learner-facing data tools, even when their conformance owner is Core.

OpenLogo has no arrays. The `list` is the single sequence type.

## Profiles and ownership

- Lists are Core values and are also the sequence foundation used by the Data profile.
- Dictionaries and records are in the optional Data profile.
- `map`, `filter`, and `reduce` are Core special forms introduced at Level 8; this document specifies their data-structure usage.
- Heritage spellings are compatibility forms only. In this file the full-name reporters `first`, `last`, `butfirst`, `butlast`, `count`, `word`, `sentence`, `fput`, and `lput` are Core, not Heritage. The dict reader `value of … for key …` is Heritage.

## The uniform collection access idiom

OpenLogo teaches three mutable collections with one rule:

| Collection | Read a place | Write a place | Grow or shrink |
|---|---|---|---|
| list | `:path[1]` | `:path[1] = point 0 0` | `add … to`, `remove … from`, `insert … in … at`, `clear` |
| dict | `:ages.tom`, `:ages[tom]`, `:ages[:who]` | `:ages.tom = 8` | `remove key … from`, `clear` |
| record | `:p.x` | `:p.x = 10` | fixed fields; no grow or shrink operation |

The same place syntax chains across collection kinds:

```logo
struct person [ name age ]

:people = {
  tom: person "tom" 8
}

print :people.tom.age
:people.tom.age = 9
```

The colon form writes with `:place = value`. The worded form writes the same place without the leading colon:

```logo
set people.tom.age to 10
```

All collection values are mutable references. If two variables refer to the same collection, a write through either variable is visible through the other.

## Lists

A list is an ordered mutable sequence. A list literal uses `[ … ]`; elements are whitespace-separated value expressions. The literal may span lines.

```logo
:colors = [
  "red"
  "green"
  "blue"
]

:nums = [1 2 3]
```

List indexing is 1-based:

```logo
print :nums[1]     # => 1
:nums[1] = 9
print :nums[1]     # => 9
```

Reading or writing an index outside the list raises `ol-range`. A list selector requires a number key; any other selector key raises `ol-type`.

### Mutating list operations

| Primitive | Kind | Args | Result | Errors | Semantics |
|---|---:|---|---|---|---|
| `list` | R | 0 | list | — | returns a new empty mutable list |
| `(list a b …)` | R | values | list | — | returns a new mutable list containing the values |
| `add … to` | S | value, listExpr | — | `ol-type` | appends the value to the list |
| `remove … from` | S | value, listExpr | — | — | removes the first occurrence, if any |
| `insert … in … at` | S | value, listExpr, index | — | `ol-range` | inserts before the 1-based position |
| `clear` | S | list expr | — | — | removes all list elements |
| `:list[i]` | R/place | index | element | `ol-range` | reads or writes the 1-based element |

```logo
:pets = (list "cat" "dog")
add "bird" to :pets
insert "fish" in :pets at 2
remove "dog" from :pets
clear :pets
```

`remove … from` removes the first occurrence only. If the value is not present, the list is unchanged.

### Core non-mutating list reporters

These reporters do not mutate their input:

| Primitive | Kind | Args | Result | Errors | Semantics |
|---|---:|---|---|---|---|
| `first` | R | word/list | element | `ol-range` on empty | first character or first list element |
| `last` | R | word/list | element | `ol-range` on empty | last character or last list element |
| `butfirst` | R | word/list | word/list | `ol-range` on empty | all but the first item |
| `butlast` | R | word/list | word/list | `ol-range` on empty | all but the last item |
| `fput` | R | value, list | new list | — | returns a fresh list with the value at the front |
| `lput` | R | value, list | new list | — | returns a fresh list with the value at the end |
| `sentence` | R | value, value | list | — | returns a fresh list combining values as a sentence |
| `count` | R | word/list/dict | number | — | returns length or entry count |

Aliases `bf`, `bl`, and `se` are Heritage aliases. The full names are Core.

```logo
:nums = [1 2 3]
:more = fput 0 :nums
:also = lput 4 :nums
:tail = butfirst :nums
:words = sentence "hello" "world"

print :nums       # still [1 2 3]
print first :more # => 0
print last :also  # => 4
print count :nums # => 3
```

### Derived list reporters in the Data profile

| Primitive | Kind | Args | Result | Errors | Semantics |
|---|---:|---|---|---|---|
| `reverse` | R | list | list | — | returns a fresh list in reverse order |
| `pick` | R | list | element | `ol-range` on empty | returns one element |
| `sort` | R | list | list | `ol-type` | returns a fresh list sorted in ascending order; elements must be mutually orderable (all numbers or all words), else `ol-type` |
| `member? value collection` (Core) | R | value, collection | boolean | `ol-type` | Core membership test; on a list it checks elements, and with the Data profile a dict is also accepted, checking its keys; a collection that is neither a list nor a dict raises `ol-type`; worded form `value is member of collection` |

```logo
:nums = [1 2 3]
:backward = reverse :nums
print member? 2 :nums          # => true
print (2 is member of :nums)   # => true
```

`sort` orders numbers numerically and words lexicographically, following the same ordering rules as `<`, `>`, `<=`, and `>=` in [execution-model.md](execution-model.md). A list that mixes numbers and words, or that contains any other type, is not mutually orderable and raises `ol-type`.

## Dictionaries

A dictionary maps word or number keys to values. It is a mutable reference value. Use a literal with `{ key: value }` or the `dict` reporter for an empty dictionary.

Dictionary literals use bare keys, a colon, no commas, and may span lines:

```logo
:ages = {
  sophie: 6
  tom: 8
}

:empty_scores = dict
```

Bare keys are literal keys, not variable reads. Keys preserve case and are compared using OpenLogo equality. Reserved words are legal dictionary keys because they are data.

If a literal repeats a key, the last entry wins. The key keeps its first insertion position for iteration, and the final value is the value from the last duplicate entry.

```logo
:settings = {
  speed: 1
  speed: 3
}

print :settings.speed  # => 3
```

Dictionary iteration order is insertion order. `keys :d` and `values :d` return lists in that order.

### Dictionary reads

Use any of the uniform access forms:

```logo
:who = "tom"

print :ages.tom
print :ages[tom]
print :ages[:who]
print value of :ages for key "tom"
```

- `:d.key` uses a literal key named `key`.
- `:d[key]` uses the bare selector grammar, so `key` is a literal word key.
- `:d[:var]` uses the value of the variable as the key.
- `value of :d for key <k>` is the Heritage dict reader.

A required read miss raises `ol-unknown-key`.

### Dictionary writes and upserts

Writing a missing final dictionary key adds it:

```logo
:ages.max = 9
:ages[:who] = 10
set ages.lee to 7
```

Only the final selector upserts. A missing intermediate container in a chain raises `ol-unknown-key`; OpenLogo does not auto-vivify intermediate dictionaries.

```logo
:people = dict

# error: the intermediate key tom is missing
:people.tom.age = 8

:people.tom = {
  age: 8
}

# ok: final key height is added inside the existing tom dictionary
:people.tom.height = 120
```

### Dictionary operations

| Primitive | Kind | Args | Result | Errors | Semantics |
|---|---:|---|---|---|---|
| `dict` | R | 0 | dict | — | returns a new empty mutable dictionary |
| `{ k: v … }` | R | key/value entries | dict | `ol-type` for bad key | returns a new mutable dictionary |
| `:dict.key` | R/place | key | value | `ol-unknown-key` on read miss | reads or writes a literal key |
| `:dict[key]` | R/place | key | value | `ol-unknown-key` on read miss | reads or writes a bare literal key |
| `:dict[:var]` | R/place | key | value | `ol-unknown-key` on read miss | reads or writes the variable's key value |
| `value of … for key …` | R | dictExpr, keyExpr | value | `ol-unknown-key` | Heritage dict reader |
| `remove key … from` | S | key, dictExpr | — | — | removes the key if present |
| `clear` | S | dict expr | — | — | removes all entries |
| `member? key dict` | R | key, dict | boolean | — | tests whether the value is a key; worded form `key is member of dict` |
| `keys` | R | dict | list | — | returns keys in insertion order |
| `values` | R | dict | list | — | returns values in insertion order |
| `count` | R | dict | number | — | returns entry count |

```logo
:ages = {
  tom: 8
  sophie: 6
}

print member? "tom" :ages
print ("tom" is member of :ages)
print keys :ages
print values :ages
print count :ages

remove key "tom" from :ages
clear :ages
```

## Records and structs

A record is a mutable named aggregate with a fixed field set. The `struct` declaration introduces the type, its fields, and a constructor reporter named after the type. There is no `new`.

```logo
struct point [ x y ]

:p = point 3 4
print :p.x
:p.x = 10
```

The bracketed field list is not a list literal. It contains bare field names and performs no evaluation. The type name registers a constructor in the callable namespace, so it must not collide with a primitive or procedure. A collision raises `ol-reserved-word`.

Records are typed by their struct type and have fixed fields. Reading or writing an unknown field raises `ol-unknown-field`.

```logo
struct person [ name age ]

:p = person "tom" 8
print type_of :p
print is_a? :p "person"

# error: height is not a person field
:p.height = 120
```

### Record operations

| Primitive | Kind | Args | Result | Errors | Semantics |
|---|---:|---|---|---|---|
| `struct` | S | type name, field-list | declares type and constructor | `ol-reserved-word` | registers the record type in phase 1 |
| `<type>` constructor | R | field values | record | `ol-not-enough-inputs`, `ol-too-many-inputs` | constructs a mutable record with arity equal to the field count |
| `:record.field` | R/place | — | field value | `ol-unknown-field` | reads or writes a fixed field |
| `type_of` | R | record | word | — | reports the record type name |
| `is_a?` (Core) | R | value, type | boolean | `ol-type`, `ol-unknown-type` | Core type test on any value; the type must be a word naming a known type, else `ol-type` (non-word) or `ol-unknown-type` (unknown word); for a record it matches the struct type name |

### Nested records and dictionaries

Records and dictionaries chain through the same access idiom. Chains are readable and writable.

```logo
struct person [ name age ]

:people = {
  tom: person "tom" 8
}

print :people.tom.age
:people.tom.age = 9
```

Unknown dictionary keys and unknown record fields are distinct:

- a missing dictionary key on read raises `ol-unknown-key`;
- a missing final dictionary key on write is added;
- a missing intermediate dictionary key raises `ol-unknown-key`;
- an unknown record field on read or write raises `ol-unknown-field`.

### Lists of records

A list of records is just a list. The list element can be selected first, then a record field can be selected.

```logo
struct point [ x y ]

:path = list
add (point 0 0) to :path
add (point 100 90) to :path

print count :path
print :path[1].x
:path[1].x = 5
```

Parentheses are used around `point 0 0` when it is nested as the value input to `add`.

### Destructuring

Every element-binding form — `for … in`, `map`, `filter`, and `reduce` (its item binder, not the accumulator) — may use a pattern list of variable names instead of a single name. The pattern binds positionally from each list element, or from record fields in declared order.

```logo
struct point [ x y ]

:points = (list (point 0 0) (point 50 100))

for [:x :y] in :points
  print sentence :x :y
end for

:xs = map [:x :y] in :points [ :x ]          # => [0 50]
```

The pattern list uses `:names` because it binds variables. The same pattern works in `map`, `filter`, and `reduce`. A short or long pattern mismatch raises `ol-range`.

## Mutation versus copy

Collection mutation and copy-producing reporters are intentionally contrasted for teaching. Copies are shallow: nested collection or record references are shared.

| Form | Result | Mutates shared reference? | Fresh value? | Notes |
|---|---|---:|---:|---|
| `add … to` | — | yes | no | appends to an existing list |
| `remove … from` | — | yes | no | removes first occurrence from an existing list |
| `remove key … from` | — | yes | no | removes a dictionary key if present |
| `clear` | — | yes | no | empties an existing list or dictionary |
| `insert … in … at` | — | yes | no | inserts into an existing list |
| `:place = …` | — | yes | no | writes a variable, list slot, dict key, or record field |
| `set <place> to …` | — | yes | no | worded spelling of the same place write |
| `fput` | list | no | yes | returns a shallow fresh list |
| `lput` | list | no | yes | returns a shallow fresh list |
| `butfirst` | word/list | no | yes | returns a fresh word or list |
| `butlast` | word/list | no | yes | returns a fresh word or list |
| `sentence` | list | no | yes | returns a shallow fresh list |
| `reverse` | list | no | yes | returns a shallow fresh list |
| `map` | list | no | yes | returns a fresh list of body values |
| `filter` | list | no | yes | returns a fresh list of selected original elements |
| `reduce` | value | no | depends on body | returns the final accumulator value |

```logo
:a = [1 2 3]
:b = :a
add 4 to :b
print :a       # sees the added 4

:c = lput 5 :a
print :a       # unchanged by lput
print :c       # fresh list
```

## Map, filter, and reduce comprehensions

At Level 8, higher-order work is written with three comprehension special forms. OpenLogo v0.1 has no first-class functions and no `lambda`.

Each comprehension uses a binder, a list expression, and a bracketed expression body. The body is `[ ]` only, never `… end`. It reports by the value of its last expression, so `return`, `output`, and `op` are not used in comprehension bodies.

```logo
:nums = [1 2 3 4]

:doubled = map num in :nums [ :num * 2 ]
:bigs = filter num in :nums [ :num > 2 ]
:total = reduce sum num in :nums from 0 [ :sum + :num ]
```

`map` returns a fresh list containing one body value for each element:

```logo
define double :n
  return :n * 2
end

:nums = [1 2 3]
:doubled = map num in :nums [ double :num ]
```

`filter` returns a fresh list containing the original elements whose body value is `true`. A non-boolean body raises `ol-not-boolean`.

```logo
:nums = [1 2 3 4]
:small = filter num in :nums [ :num < 3 ]
```

`reduce` folds left. On an empty input list it returns the initial value unchanged. The accumulator binder and item binder are body-local, shadow outer names, and must differ; repeating them raises `ol-duplicate-binder`.

```logo
:nums = [1 2 3 4]
:total = reduce sum num in :nums from 0 [ :sum + :num ]
```

A comprehension body that has no value-producing final expression raises `ol-no-value`. A `return`, `output`, `op`, or `stop` inside a comprehension body raises `ol-return-in-comprehension`. If the final expression calls a procedure that never returns a value, that call raises `ol-no-output` at the call site.

## Error summary

| Situation | Diagnostic |
|---|---|
| list index out of range | `ol-range` |
| non-number list selector | `ol-type` |
| read missing dictionary key | `ol-unknown-key` |
| write missing final dictionary key | no error; key is added |
| missing intermediate dictionary key in a chain | `ol-unknown-key` |
| unknown record field on read or write | `ol-unknown-field` |
| assigning to a non-place | `ol-not-a-place` |
| bad dictionary key type | `ol-type` |
| `struct` type name collides with existing callable | `ol-reserved-word` |
| record constructor arity too small or too large | `ol-not-enough-inputs`, `ol-too-many-inputs` |
| comprehension final body has no value | `ol-no-value` |
| `filter` body is not boolean | `ol-not-boolean` |
| `return`/`output`/`op`/`stop` inside a comprehension body | `ol-return-in-comprehension` |
| repeated `reduce` binder name | `ol-duplicate-binder` |

These diagnostics use the shared error shape defined by the [error model](error-model.md). Place parsing and selector grammar are defined by the [grammar](grammar.md), and mutation semantics are evaluated as specified by the [execution model](execution-model.md).
