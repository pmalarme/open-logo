# 32. A semantic-token modifier may extend the Informative LSP list; the normative class table may not

- Status: Accepted
- Date: 2026-09-04
- Deciders: `@orchestrator` (ruling), `@language-designer` (implementation), on issue #826 under saga
  #819; reviewed by `rubber-duck`, `@testing`, and `@learner-experience`
- Related: [ADR-0026](0026-token-class-declared-and-gated.md) (the token class is declared data,
  gated against the shipped highlighter — this record governs the *other* axis, what may be added to
  the vocabulary at all); [ADR-0006](0006-cross-cutting-contracts.md) (token classes are a
  cross-cutting contract); [ADR-0000](0000-record-architecture-decisions.md)

## Context

Saga #819's variable-scoping ruling seals the procedure boundary. It accepts one readability cost
knowingly: when a procedure's first touch of a name it cannot see is a **write**, that write silently
creates a procedure-local — "which is correct, because that is a genuinely different variable"
(`spec/execution-model.md:441-446`) — and so is deliberately **not** diagnosed. Issue #825's checker
will not flag it and no other diagnostic covers it. Inside one procedure body, `:private = 1` and
`:shared = 1` are therefore indistinguishable to a reader while meaning entirely different things.

Issue #826 exists to close that hole in the paint, and its acceptance criteria say so four times, in
one specific way: *"every occurrence carries a **DISTINCT token class** for globals, different from an
ordinary variable's class"*.

That is not available. `spec/tooling.md`'s token-class table is **normative and closed** — fifteen
rows, and its `## Non-goals` states that "conformance is measured against the token classes … above".
Adding a sixteenth is a change to the conformance surface, `spec/` is maintainer-owned via
`CODEOWNERS`, and no `[spec]` issue in the saga proposed the row: #1096 (the ruling's `spec/` PR)
added `global` to the C19 reserved-word registry and the two `ol-global-*` checker rows, but no
token-class row, although #821 had listed `spec/tooling.md (token classes, semantic checking)` among
the sections affected.

The implementing agent stopped and escalated rather than editing `spec/` or inventing a class. Three
options were on the table: (A) a sixteenth normative class, (B) a semantic-token **modifier** on the
existing `:variable` class, (C) both.

## Decision

**A grammar- or resolution-derived sub-distinction over an existing lexical class is carried on the
semantic-token *modifier* channel. The normative 15-class table is not extended by an implementation.**

Concretely for #826: a `:name` occurrence that resolves to a `global`-declared binding keeps
`class: ":variable"` and gains the `global` modifier.

1. **The spec already answers this shape of question with a modifier, and says so.** Brackets have
   **five** grammatical roles — list, instruction-block, selector, pattern, field-list — and
   `spec/tooling.md` keeps **one** `bracket` class, then directs: "Editors SHOULD expose these roles
   as semantic-token modifiers where possible, **even when the visible theme maps all roles to the
   same bracket color**" (`:83-84`). `listRole`/`blockRole`/`selectorRole` are named in the LSP list
   as the vehicle. Globals-over-`:variable` is the same shape. A sixteenth class would make this the
   one sub-role in the language promoted to a top-level class, which is the inconsistency rather than
   the fix.

2. **The two lists have opposite dispositions, and both are explicit.** The class table is
   Normative and closed. The modifier list sits under a heading that reads, literally,
   `## Informative LSP-style editor integration`, and enumerates "optional modifiers **such as** …"
   (`:281-283`). "Such as" is an open list. Extending the open one needs no maintainer edit;
   extending the closed one is a contract change.

3. **No implementation change is required in another agent's package.** A sixteenth class would have
   made `packages/studio/src/highlighter.ts`'s total `Record<TokenClass, string>` a compile error —
   work inside `@learner-experience`'s package, outside the slice's declared write-set. That the
   correct mechanism also kept the write-set boundary intact is corroboration, not the reason.

4. **Append, never insert.** `global` is added **last** to `OL_TOKEN_MODIFIERS`, so the seven spec
   modifiers keep their positions and a consumer that encodes a modifier as a bit index is
   unaffected. A test pins the first seven in the document's own order.

5. **Option C — both a class and a modifier — is rejected.** One distinction with two sources of
   truth invites consumers to disagree about which is authoritative, and it still drags in the
   `spec/` row and the cross-package edit that (2) and (3) avoid.

**Where this does not apply.** A distinction the spec's class table *already* assigns a class to is
not an occasion for a modifier, and a genuinely new **lexical** class — a token shape no existing row
covers — is still a `spec/` change for the maintainer. This record is about sub-dividing a class the
table already has.

## What this does **not** claim

- **It is not equivalent to a class today, and the difference is visible to a learner.** Nothing in
  this repository renders the modifier: `packages/studio` maps token **class** to a CSS name and
  discards every other field — it already drops `role` the same way. So at the merge of #826 a
  learner sees **no** difference between `:private` and `:shared`. A sixteenth class *would* have
  been picked up by any theme automatically. That is the real cost of this decision and it is paid
  by issue **#1106**, the studio slice that switches `createParserHighlighter` to `semanticTokens()`
  and renders the modifier with a non-colour cue. **#826 is not closed by the parser slice alone**;
  its PR says `Refs`, not `Closes`. Both QA reviewers raised this independently and this bullet is
  their finding, recorded rather than resolved away.
- **It does not amend #826's acceptance criteria.** The AC says "distinct token class" and this
  delivers a modifier. `@orchestrator` ruled the criterion met in substance and superseded in
  wording, and flagged it to the maintainer; only the maintainer can accept the substitution. If it
  is overruled, the delta is one `spec/tooling.md` row plus the studio mapping — the resolution walk
  in `packages/parser/src/global-variable-resolution.ts` stands either way, because *which* channel
  carries the answer is independent of *how* the answer is computed.
- **It gives CI no new opinion.** ADR-0026's gate re-paints every **built-in name** through
  `highlight()` and compares the declared `tokenClass`; it says nothing about modifiers, and this
  change moves nothing in it — measured: 0 of the 5,088 tokens that gate paints carry the modifier,
  because none of its probe sources contains a root-level `global` declaration. So a wrong modifier
  is caught by the parser unit suite alone, which is a weaker gate than the class axis has. Nobody
  should read "the token class is gated" as covering this.
- **It does not reach every mention of a name.** `set shared to 1` targets a **bare** place
  (`spec/grammar.md:107`), which `spec/tooling.md:34` leaves outside `:variable`, and
  `make "shared" 1` names its target inside a closed string, which `:25-26` forbids classifying as a
  variable at all. Both therefore carry no signal. Whether bare place heads and binder spellings
  should be paintable is a `spec/` question covering every binding form at once — issue **#1107**.
- **It does not decide a deferred handler body.** `spec/execution-model.md:401-403` resolves a
  handler "whenever the handler fires", so one token can have two resolutions depending on an event
  time no static pass can know. The implementation resolves handler bodies at their registration
  position, pinned by a test, and issue **#1108** seeks a ruling.

## Consequences

- The `:variable` class keeps one meaning, and a consumer that ignores modifiers behaves exactly as
  it did before — which is both the safety property and, until #1106, the reason nothing is visible.
- The channel is the growth path. Adding `parameter` or `local` modifiers later is purely additive
  and breaks no consumer, which is why `Token.global` was deliberately kept a boolean rather than
  generalised into a resolution enum in advance: the enum would solve a problem the channel has
  already solved, and replacing an adopted field is a breaking change where adding a modifier is not.
- `spec/built-in-names.json`, `spec/tooling.md`, and every "15 token classes" statement in
  `AGENTS.md`, `.github/instructions/`, `docs/architecture.md` and ADR-0006 stay accurate and
  untouched, because `OL_TOKEN_CLASSES` is unchanged at fifteen.
- The next agent facing "should this be a sixteenth class?" has an answer that is not buried in a
  source comment.
