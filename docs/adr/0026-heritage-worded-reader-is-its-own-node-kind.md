# 26. The Heritage worded reader is its own AST node kind

- Status: Accepted
- Date: 2026-08-28
- Deciders: OpenLogo maintainer (@pmalarme) + `@documentation`, on issue #848
- Related: refines [ADR-0006](0006-cross-cutting-contracts.md) (cross-cutting contract
  stubs — the AST is one of the four)

## Context

[ADR-0006](0006-cross-cutting-contracts.md)'s third modelling convention ends with a sentence
that is false today:

> **The AST grows one node per grammar production, never ahead of it.** `OL_NODE_KINDS` lists
> the full Core vocabulary; concrete node interfaces exist for the M0 subset that exercises the
> factory and walker, and the rest gain typed shapes with their grammar slice. Heritage
> spellings are surface metadata (`CallNode.canonical`), not new kinds.

Heritage reaches the AST three ways, and only two of them are metadata.

**Short aliases** are exactly what ADR-0006 describes. `HERITAGE_ALIAS_CANONICAL` in
`packages/parser/src/signatures.ts` maps `fd` → `forward`, `bk` → `back`, and so on;
`canonicalOfHeritageAlias` reads that map; and `parseFixedCall` hands its result straight to
`ast.call`'s `canonical` parameter, producing a `CallNode` that carries the Core name beside the
surface one. Word in, word out.

**Form heads** are metadata too, but not in the field ADR-0006 names. `make`/`to`/`output`/`op`
are never recorded as `canonical`. `HERITAGE_FORM_HEAD_CANONICAL` maps them to `set`/`define`/
`return` for diagnostic params, while the AST keeps the surface head as a tag on the *same* Core
node the Core spelling builds: `AssignNode.form` (`"equals" | "set" | "make"`),
`ProcedureDefNode.keyword` (`"define" | "to"`), and `ReturnNode.keyword`
(`"return" | "output" | "op"`). Different field, same claim, and the claim holds.

**The worded dictionary reader `value of … for key` is a node kind.** `"ValueOfKey"` is a member
of `OL_NODE_KINDS`; `ValueOfKeyNode` is a registered interface in `packages/parser/src/ast.ts`
with its own `dictionary` and `key` fields; `ast.valueOfKey` builds it; and `parseValueOfKey`
calls that builder with no canonical argument, because the builder has no parameter to receive
one.

The sentence was **true when it was written**. ADR-0006 is dated 2026-07-17; commit `619679c1`
(2026-07-21, "feat(runtime): dict value runtime evaluation (#322) (#384)") added `ValueOfKey`
four days later. This is a generalization a later slice falsified, not a careless claim — which
is precisely the situation a refining ADR exists for.

It is now load-bearing rather than merely stale. `signatures.ts`'s `HERITAGE_WORDED_FORMS`
registry records `node: "ValueOfKey"` as a field and is exported through `@openlogo/parser`'s
public API (`heritageWordedForm`, `heritageWordedForms`), and both canonical-diagnostic-params
guards — `packages/parser/src/heritage-canonical-diagnostic-params.test.mjs` and its runtime
twin — assert on that field as the discriminator proving a test program really reaches the form.
An Accepted ADR contradicts an exported field and the guards that depend on it.

### Why this form cannot be metadata

Metadata needs a Core node to sit on, and this form has none. Both Core dict reads parse to a
`Place`, whose `base` is a `SpannedName` — a bare variable name:

```text
print :d.k      ->  Place { base: "d", segments: [field] }
print :d["k"]   ->  Place { base: "d", segments: [index] }
```

The reader's dictionary slot is a full expression, which a `PlaceNode` base cannot hold:

```text
print value of { a: 1 } for key "a"                  ->  ValueOfKey { dictionary: DictLit,    key: WordLit }
print value of value of :d for key "a" for key "b"   ->  ValueOfKey { dictionary: ValueOfKey, key: WordLit }
```

That is the whole difference. `fd` and `make` re-spell a **word** inside a production Core
already has, and the Core node is sitting there waiting for the tag. The reader is its own
production —

```ebnf
value-of-reader     ::= "value" "of" expression "for" "key" expression
```

(`spec/grammar.md:217`) — with two full-expression operands in named slots that no Core node
exposes. There is nothing for a Heritage tag to be metadata *on*.

Nor is it a re-spelling of either Core selector in what it accepts. `spec/data-structures.md:268`
types its operands `dictExpr, keyExpr`, making it dict-only, while `:d[key]` also indexes lists
and `:d.key` also accepts records — which the reader rejects, a divergence
`tests/conformance/heritage/execution/heritage-value-of-key-record-container-rejected` pins and
which `evaluate.ts` records as mandated by the spec rather than chosen by the code. Its accepted
operand domain matches neither Core spelling exactly, so there is no single Core form it could be
tagged as a variant of. (This is a narrower *operand type*, not new semantics: the reader builds
no dict-read diagnostic of its own, calling the same `resolveDictSegment` the Core selectors
call, so Heritage stays "alternate spellings only", `spec/conformance.md:150`.)

The kind is what consumers dispatch on. Six `case "ValueOfKey":` arms exist today — `childrenOf`
in `ast.ts`, `checker-not-a-place.ts` and `highlight.ts` in `@openlogo/parser`, and
`not-a-place-text.ts` plus two in `evaluate.ts` (`isSupportedExpression` and the evaluation
dispatch) in `@openlogo/runtime`. `childrenOf` returns the node's two operands in source order,
and the child-edge gate of [ADR-0025](0025-child-edge-gate-audits-childrenof-independently.md)
audits them by name as `ValueOfKey.dictionary` and `ValueOfKey.key`.

**The precedent is not even Heritage-specific.** Core/Data already does this: `member? "k" :d`
parses to a `Call`, while its worded spelling `:k is member of :d` parses to an `IsPredicate` —
the same operation, two productions, two node kinds, both clean. A worded spelling is not exempt
from "one node per grammar production" merely because it is a spelling.

## Decision

**Record the correction here as a refinement, and state the rule that decides the next case.**

1. **ADR-0006's governing sentence is the rule and is unchanged:** *the AST grows one node per
   grammar production, never ahead of it.* The Heritage sentence three lines later is an
   over-stated special case of that rule, not a second rule. Where they conflict, the production
   rule wins — and it is the production rule that predicts `ValueOfKey`.

2. **The test is the grammar, not the profile.** A Heritage spelling is surface metadata when it
   substitutes a *word* inside a production Core already has and the Core node it lowers onto can
   hold its operands — `CallNode.canonical` for the aliases, `AssignNode.form` /
   `ProcedureDefNode.keyword` / `ReturnNode.keyword` for the four form heads. A Heritage spelling
   earns its own node kind when it is its own grammar production whose operands no Core node
   exposes. `value of … for key` is the second, and is the only Heritage form in that class today
   (`spec/conformance.md:157` lists exactly one worded form).

3. **ADR-0006 is refined, not superseded, and stays `Accepted`.** Its decision — land the four
   contracts as types and registries only, in the places `docs/architecture.md` names, respecting
   `parser` → `core` — is entirely in force; nothing about `spans.ts`, `diagnostics.ts`,
   `events.ts`, `ast.ts`, or `highlight.ts` is withdrawn. What is wrong is one clause of one
   illustrative convention. Superseding would retire a live decision over a sub-clause, and would
   leave [ADR-0024](0024-ast-traversal-kind-dispatch-is-compiler-enforced.md) — which cites
   ADR-0006 as "the AST is a cross-cutting contract" — pointing at a superseded record. A
   refinement is also what this *is*: ADR-0006's primary rule already accounts for `ValueOfKey`;
   only its Heritage gloss failed to.

4. **ADR-0006 receives exactly one edit:** `refined by ADR-0026` appended to its `Related:` line,
   the only edit [ADR-0000](0000-record-architecture-decisions.md) and `AGENTS.md` §7 permit an
   Accepted ADR. Its body is untouched — including the false sentence, which stays as written,
   because an Accepted ADR is decision *history* and rewriting it would destroy the evidence that
   the generalization was ever made.

While correcting the "not new kinds" clause, note for the record that the parenthetical
`CallNode.canonical` also under-describes the metadata half: it names the alias mechanism only,
and the four form heads use `AssignNode.form` / `ProcedureDefNode.keyword` / `ReturnNode.keyword`
instead. That is recorded here rather than fixed there, for the same reason.

## Consequences

- The written record matches the code: the exported `HERITAGE_WORDED_FORMS` entry's
  `node: "ValueOfKey"` field, and the two canonical-diagnostic-params guards that discriminate on
  it, no longer contradict an Accepted ADR.
- A future Heritage form is decided by rule 2 rather than by re-deriving the answer from the
  parser: another short alias or form head is metadata; another worded production with operands
  no Core node can hold is a node kind, and adding it is a normal contract change under ADR-0006,
  reviewed by the AST's owners.
- ADR-0006 remains the citable record for all four cross-cutting contracts. A reader who reaches
  its Heritage sentence follows its `Related:` line here; nothing else about it moves.
- This ADR settles the node-kind question only. It deliberately asserts nothing about how the
  highlighter classifies the reader's `of` token — `markValueOfKeyPreposition` is named above
  purely as one of the six sites that dispatch on the node kind — because that classification is
  a separate, live decision.
