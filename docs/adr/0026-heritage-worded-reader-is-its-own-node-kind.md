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

**Metadata records *which word was written*, and it needs the operation's Core node to be able
to carry the spelling's operands.** Both Heritage metadata mechanisms are word-to-word maps:
`HERITAGE_ALIAS_CANONICAL` maps a callable name to a Core callable name, and
`HERITAGE_FORM_HEAD_CANONICAL` maps a statement head to a Core statement word. The reader has no
Core *word* to map to — its Core equivalent is the `.`/`[]` selector **syntax** — which is why
`HERITAGE_WORDED_FORMS` deliberately carries no `canonical` column at all, and why
`checker-heritage-form.ts` gives the form's rejection no `did you mean`. `signatures.ts` states
that reasoning in place: inventing a canonical spelling "would name something absent from the
diagnostic's own span".

The second half is what settles it. The reader's Core twin is the **dotted** selector's dict
branch — `evaluateValueOfKey` establishes exactly that, passing `operation: "field"` so a
non-dict operand reports what `:x.tom` reports — and both Core dict reads parse to a `Place`,
whose `base` is a `SpannedName`, a bare variable name:

```text
print :d.k      ->  Place { base: "d", segments: [field] }
print :d["k"]   ->  Place { base: "d", segments: [index] }
```

The reader's dictionary slot is a full expression, which a `PlaceNode` base cannot hold:

```text
print value of { a: 1 } for key "a"                  ->  ValueOfKey { dictionary: DictLit,    key: WordLit }
print value of value of :d for key "a" for key "b"   ->  ValueOfKey { dictionary: ValueOfKey, key: WordLit }
```

So the node this form would have to be metadata *on* cannot represent it. That is a claim about
one node — the twin it lowers onto — and deliberately not a claim about the node vocabulary at
large.

**The obvious counter, and why it fails.** `PostfixExpressionNode` *does* expose two
full-expression slots — `base: ExpressionNode`, and `SelectorSegment.key: ExpressionNode` — so
"no node has this shape" would be false, and the reader could be shaped into a tagged
`PostfixExpression`. It should not be, for two measured reasons — the first establishing which
node is the twin, the second, decisive on its own, disqualifying the alternative. First, **it is
not the reader's twin.** Rule 2 below asks what the twin's node can hold, not whether some node
somewhere has a fitting shape, and the twin is fixed by which operation the form re-spells:
`evaluateValueOfKey` passes `operation: "field"` and reports what `:x.tom` reports, so the twin is
the variable-rooted dotted read `:d.k`, which lowers onto `PlaceNode`. `PostfixExpression` serves
`postfix-expression` — `primary { selector | "." identifier }`, a *general* selector read whose
base is an arbitrary expression, which is why `{tom: 8}.tom` and `(point 0 0).x` land there.
(The two do overlap: on a dict, `{a: 1}.a` and `value of { a: 1 } for key "a"` read the same
value. The objection is to the *production* they are spellings of, not to calling the operations
unrelated.) Second, and sufficient by itself, `SelectorSegment`'s own contract forbids it: its
span exists, in its words, "so tooling can point at exactly the `[ … ]`". The reader's source has
no brackets, so a synthesized segment would carry a span describing punctuation that is not in the
document — a defect handed to every consumer that trusts spans.

The reader is also not a re-spelling of either Core selector in what it accepts. The dictionary
table in `spec/data-structures.md` types its operands `dictExpr, keyExpr`, making it dict-only,
while `:d[key]` also indexes lists and `:d.key` also accepts records — which the reader rejects,
a divergence `tests/conformance/heritage/execution/heritage-value-of-key-record-container-rejected`
pins and which `evaluateValueOfKey` records as mandated by the spec rather than chosen by the
code. This is supporting colour rather than proof — `PostfixExpression` diverges from the reader's
operand domain too, in the other direction — and it is a narrower *operand type*, not new
semantics: the reader builds no dict-read diagnostic of its own, calling the same
`resolveDictSegment` the Core selectors call, so Heritage stays "alternate spellings only", as its
profile section in `spec/conformance.md` requires.

The kind is what consumers dispatch on. Six `case "ValueOfKey":` arms exist today — `childrenOf`
in `ast.ts`, `checker-not-a-place.ts`'s `renderValueOfKey`, and `highlight.ts`'s
`markValueOfKeyPreposition` in `@openlogo/parser`; `not-a-place-text.ts`'s `renderValueOfKey` plus
two in `evaluate.ts` (`isSupportedExpression` and the evaluation dispatch into
`evaluateValueOfKey`) in `@openlogo/runtime`. `childrenOf` returns the node's two operands in
source order, and the child-edge gate of
[ADR-0025](0025-child-edge-gate-audits-childrenof-independently.md) audits them by name as
`ValueOfKey.dictionary` and `ValueOfKey.key`.

**The precedent is not even Heritage-specific.** Core/Data already does this: `member? "k" :d`
parses to a `Call`, while its worded spelling `:k is member of :d` parses to an `IsPredicate` —
the same operation, two spellings, two node kinds, both clean. A worded spelling is not exempt
from the AST's shape rules merely because it is a spelling.

## Decision

**Record the correction here as a refinement, and state the rule that decides the next case.**

1. **The unit the AST models is the *operation*, not the production.** ADR-0006's governing
   sentence — *the AST grows one node per grammar production, never ahead of it* — is a rule about
   never inventing nodes ahead of the grammar, and it stands. It is not, and never was, a promise
   that each production gets its own kind: `to-statement` and `make-assignment` are their own
   productions (`spec/grammar.md`) and still collapse onto `ProcedureDefNode` and `AssignNode`,
   while `return-statement` spells `return`/`output`/`op` inside a single production. Alternate
   spellings of one operation share that operation's node.

2. **The test is whether the operation's Core node can carry the spelling's operands.** A Heritage
   spelling is **surface metadata** when its Core twin already lowers onto a node whose fields hold
   its operands — `CallNode.canonical` for the aliases, `AssignNode.form` /
   `ProcedureDefNode.keyword` / `ReturnNode.keyword` for the four form heads. It earns **its own
   node kind** when that twin's node cannot: `value of … for key` reads a dict by key, its twin is
   the dotted selector's dict branch, and the `PlaceNode` that twin lowers onto has a bare
   `SpannedName` base that cannot hold the reader's full-expression dictionary. Being *worded* is
   not the test, and being a separate *production* is not the test. `value of … for key` is the
   only Heritage form in the second class today — the Heritage section of `spec/conformance.md`
   lists exactly one worded form.

3. **ADR-0006 is refined, not superseded, and stays `Accepted`.** Its decision — land the four
   contracts as types and registries only, in the places `docs/architecture.md` names, respecting
   `parser` → `core` — is entirely in force; nothing about `spans.ts`, `diagnostics.ts`,
   `events.ts`, `ast.ts`, or `highlight.ts` is withdrawn. What is wrong is one clause of one
   illustrative convention. Superseding would retire a live decision over a sub-clause, and would
   leave [ADR-0024](0024-ast-traversal-kind-dispatch-is-compiler-enforced.md) — which cites
   ADR-0006 as "the AST is a cross-cutting contract" — pointing at a superseded record.

4. **ADR-0006 receives exactly one edit:** `refined by ADR-0026` appended to its `Related:` line,
   the only edit [ADR-0000](0000-record-architecture-decisions.md) and `AGENTS.md` §7 permit an
   Accepted ADR. Its body is untouched — including the false sentence, which stays as written,
   because an Accepted ADR is decision *history* and rewriting it would destroy the evidence that
   the generalization was ever made.

While correcting the "not new kinds" clause, note for the record that the parenthetical
`CallNode.canonical` also under-describes the metadata half: it names the alias mechanism only,
and the four form heads use `AssignNode.form` / `ProcedureDefNode.keyword` / `ReturnNode.keyword`
instead. That is recorded here rather than fixed there, for the same reason.

**This ADR's own first draft repeated the mistake it exists to correct**, and that is worth
recording rather than quietly fixing. It argued that the reader needed its own kind because its
operands sat "in named slots that no Core node exposes" — a second false universal, in the same
shape as the first, refuted by the `PostfixExpressionNode` the reviewers measured. The general
claim is the failure mode here: about a *vocabulary* of node kinds it is hard to check and easy to
get wrong, while the same argument scoped to *one named node* is a five-second measurement. Hence
rule 2 is phrased against the twin's node, and no claim in this ADR quantifies over
`OL_NODE_KINDS`.

That makes this a hazard of the format rather than a lapse in one document. ADR-0006's "not new
kinds" is one instance; ADR-0025 records another against itself, in its own errata: "An earlier
draft of this ADR asserted that the shim 'exposes no compiler API'. That was false … The reviewer
falsified it by building the rejected instrument." Both are the same shape — a confident
forward-looking claim written into a document that can never be corrected in place — and both were
caught the same way, by someone later building the thing the claim was about. That is precisely
why the repository's rule is *add a new ADR, never edit one*, and it is the same reasoning that
put role citations rather than line citations in this one.

## Consequences

- The written record matches the code: the exported `HERITAGE_WORDED_FORMS` entry's
  `node: "ValueOfKey"` field, and the two canonical-diagnostic-params guards that discriminate on
  it, no longer contradict an Accepted ADR.
- A future Heritage form is decided by rule 2 rather than by re-deriving the answer from the
  parser: another short alias or form head is metadata, because its twin's node already carries
  its operands; a form whose Core twin lowers onto a node that cannot carry them is a node kind,
  and adding it is a normal contract change under ADR-0006, reviewed by the AST's owners.
- ADR-0006 remains the citable record for all four cross-cutting contracts. A reader who reaches
  its Heritage sentence follows its `Related:` line here; nothing else about it moves.
- This ADR settles the node-kind question only. It deliberately asserts nothing about how the
  highlighter classifies the reader's `of` token — `markValueOfKeyPreposition` is named above
  purely as one of the six sites that dispatch on the node kind — because that classification is
  a separate, live decision.
