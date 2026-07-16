> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Localization

[Back to README](README.md)

This document defines the Normative Localization profile for OpenLogo. It realizes the alias and localized keyword pack rules from the language contract, and depends on the Modules profile described in [conformance](conformance.md) and [execution model](execution-model.md).

## Profile scope

The Localization profile lets an implementation recognize additional keyword and primitive spellings without changing the canonical language. English keywords and primitive names remain canonical; localized packs are additive. A localized program can therefore be normalized, displayed in tools, or explained in terms of the canonical English surface.

Localization requires the Modules profile because keyword packs are ordinary modules imported with `import`. An implementation that declares Localization support MUST also declare Modules support.

## Alias special form

```logo
alias new_name existing_name
```

`alias` is a special form resolved in the C2 reader pre-pass. The pre-pass runs before procedure registration and before top-level execution, so alias order is irrelevant within a program or imported module.

The form registers `new_name` as a single-token synonym for `existing_name`, where `existing_name` may be:

- a primitive name such as `forward`
- a procedure name registered during the pre-pass and definition phase
- a reserved keyword such as `define`, `repeat`, `for`, or `end`
- an already registered alias

`new_name` MUST be a valid identifier under the lexical rules in [grammar](grammar.md). `new_name` MUST be fresh in the active program namespace after imports and built-ins are considered. Aliasing onto an existing primitive, procedure, type constructor, reserved keyword, or previously registered alias raises `ol-reserved-word`.

```logo
alias avance forward
alias fd2 forward

avance 100
fd2 50
```

Aliases do not create new procedures and do not change arity, kind, argument rules, result type, trace events, or diagnostics. After pre-pass resolution, `avance 100` is the same instruction as `forward 100`.

## Pre-pass resolution

The C2 pre-pass resolves `import` and `alias` before normal reading and evaluation:

1. load imported modules
2. collect exported aliases from those modules
3. collect aliases declared in the current source
4. reject collisions with `ol-reserved-word`
5. normalize aliased tokens to their canonical spelling for parsing and tooling

Because aliases are resolved before parsing structural forms, an alias for a reserved keyword can appear anywhere the canonical keyword could appear.

```logo
alias repete repeat
alias fin end

repete 4
  forward 50
  right 90
fin repete
```

The example parses as `repeat 4 ... end repeat`. The canonical spelling remains `repeat` and `end repeat`.

## Grammar forms versus token aliases

OpenLogo distinguishes heritage grammar forms from single-token aliases.

### Heritage grammar forms

Heritage grammar forms are first-class spellings defined directly by the grammar. They are not merely aliases inserted by a pack.

| Heritage form | Canonical role |
|---|---|
| `set name to value` | worded assignment corresponding to `:name = value` |
| `make "name" value` | heritage assignment form |
| `to name ... end` | heritage procedure definition form corresponding to `define name ... end` |
| `output value` / `op value` | heritage returns corresponding to `return value` |
| `value of dict for key key_value` | heritage dictionary reader corresponding to modern dictionary access |

These forms can contain structural words such as `to`, `of`, `for`, and `key` in fixed grammar slots. They are listed in [grammar](grammar.md), interpreted in [execution model](execution-model.md), and documented with primitives in [commands](commands.md) and [data structures](data-structures.md).

### Single-token aliases

Single-token aliases are synonyms registered by the pre-pass. Built-in short names such as `fd` for `forward` and `pd` for `pen_down` are specified as token aliases and behave like aliases declared with `alias`.

```logo
alias avance forward
alias baisse_crayon pen_down

baisse_crayon
avance 100
```

The alias substitutes exactly one token. It cannot define a new multi-token grammar pattern. For example, a pack may alias `definir` to `define`, but it cannot use `alias` alone to invent a new phrase with a different word order.

## Reserved words and collisions

The normative reserved-word list is owned by [grammar](grammar.md). Reserved words include structural keywords such as `define`, `to`, `end`, `return`, `set`, `make`, `if`, `else`, `repeat`, `for`, `in`, `from`, `to`, `of`, `key`, `value`, `map`, `filter`, `reduce`, `struct`, `alias`, `import`, and `export`.

Reserved words may be aliased:

```logo
alias definir define
alias fin end
```

Reserved words may not be redefined as procedures, variables, type constructors, or alias targets for a new spelling. Any attempt to introduce a name already occupied by a reserved word, primitive, procedure, type constructor, or alias raises `ol-reserved-word`.

```logo
alias repeat forward    # error: repeat already exists
define alias
  forward 10
end                     # error: alias is reserved
```

Dictionary keys and record field names follow their own rules. Dict keys are data, so reserved words may appear as keys. Record fields live in a per-type namespace reached through `:record.field`; they do not create global aliases.

## Authoring a localized keyword pack

A keyword pack is an ordinary module that exports aliases. It SHOULD contain only alias declarations and any helper procedures that are intentionally part of the pack.

Pack authors MUST:

- keep canonical English names as the semantic source of truth
- export aliases intentionally through the module system
- avoid collisions with built-in names and with other exported pack names
- document any heritage grammar forms the pack expects learners to know
- provide ASCII spellings for accented names when practical

Pack authors SHOULD NOT redefine core concepts or change argument order. A pack named `francais` can add French tokens, but `forward` still means the same command, has the same arity, and emits the same events.

## Worked French pack

An ordinary module named `francais` can define and export French aliases:

```logo
# module: francais
export definir
export avance
export tourne_droite
export repete
export répète
export pour
export fin

alias definir define
alias avance forward
alias tourne_droite right
alias repete repeat
alias répète repeat
alias pour for
alias fin end
```

The pack aliases both `repete` and `répète` to `repeat`. `repete` is the ASCII transliteration and `répète` is the accented localized spelling.

Canonical English program:

```logo
define square :side
  repeat 4
    forward :side
    right 90
  end repeat
end define

square 80
```

Localized program after importing the pack:

```logo
import "francais"

definir carre :cote
  repete 4
    avance :cote
    tourne_droite 90
  fin repete
fin definir

carre 80
```

The localized version is equivalent to the English version after pre-pass normalization. The procedure name `carre` is user-defined; the aliases `definir`, `repete`, `avance`, `tourne_droite`, and `fin` are supplied by the pack.

The same pack may support accented learner-facing names:

```logo
import "francais"

definir carré :côté
  répète 4
    avance :côté
    tourne_droite 90
  fin répète
fin definir

carré 80
```

Identifiers admit Unicode letters, so `carré`, `:côté`, and `répète` are valid. The pack still SHOULD provide ASCII alternatives such as `carre`, `:cote`, and `repete` for keyboards and environments where accents are difficult to type.

## ASCII transliteration guidance

OpenLogo source accepts Unicode letters in identifiers and aliases, while all built-in keywords and primitives are lowercase ASCII. A localized pack MAY use accented or non-English spellings that match local classroom language.

For portability, a pack SHOULD also provide an ASCII transliteration for each localized keyword whose spelling uses accents or characters that are not convenient on all keyboards.

```logo
alias répète repeat
alias repete repeat
```

Both spellings are additive synonyms for the same canonical keyword. Tooling SHOULD display diagnostics using the spelling the learner wrote when possible, while retaining the canonical command name and diagnostic code internally.

## Tooling expectations

Tools that implement Localization MUST run the same alias pre-pass as the interpreter before syntax checking, highlighting structural keywords, or reporting unknown commands. Diagnostics keep stable `ol-*` codes from [error model](error-model.md); localized prose is separate from diagnostic identity.

Syntax highlighters SHOULD be able to color aliased structural keywords such as `definir`, `repete`, `pour`, and `fin` as keywords after imports are known. When imports are unknown, tools MAY fall back to identifier coloring and later refine the token class after module resolution.

