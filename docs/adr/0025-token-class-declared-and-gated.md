# 25. The token class is declared data, gated against the shipped highlighter

- Status: Accepted
- Date: 2026-08-25
- Deciders: OpenLogo maintainer (@pmalarme) + `@language-designer`, on issue #959
- Related: [ADR-0021](0021-built-in-names-list-and-ci-gate.md) (the built-in names list this
  refines, adding a second per-name axis); [ADR-0006](0006-cross-cutting-contracts.md) (token
  classes are a cross-cutting contract); [ADR-0000](0000-record-architecture-decisions.md)

## Context

`spec/tooling.md`'s `keyword` token-class row was a 2,055-character English paragraph that
enumerated, in prose, which words a conforming highlighter paints `keyword`. It was normative and
it was the only enumeration in the specification that no gate could validate.

ADR-0021's gate reached it with a **content fingerprint** — a sha256 over the row's bytes. That is
a change detector and its own documentation said so: it verified the row had not changed and
nothing about whether the row was true. The limit was demonstrated during the #901 Epic Gate audit
in two steps with a control: invert the row's meaning → the digest goes stale → exit 1; recompute
the digest → **0 findings, exit 0, with a factually false normative claim on disk.**

The gap had already cost three items in M5. Issue #840 proposed painting rules that contradicted
the row and was closed void; PR #905 implemented #840 and **passed all eight Definition-of-Done
gates while contradicting the specification**; issue #832 was a false bug report in the same area,
closed not-reproducible.

Issue #841's closing record concluded that *"a fourth [mechanism] will [overstate] too unless the
row is first restructured into something derivable"*. Three mechanisms had been tried across twenty
review rounds — hand-declared clause anchors, a fingerprint alone, and a fingerprint with derived
claims layered on — and each claimed more than it checked.

**One premise in that record was wrong, and correcting it is what makes this decision available.**
`spec/built-in-names.json` recorded that the class *"cannot be derived"*, citing issue #855. What
#855 measured and refuted was **derivation from data that already existed**: a positional rule
(refuted by `local end` / `export end` / `:p.end` all painting `keyword`), and "the keyword list
minus the operators" (refuted because the class also *adds* four words that are not built-in names
at all). **Declaring the class as new, first-class data was never attempted.** `spec/grammar.md:378`
says the token class and the keyword list are independent sets and that neither determines the
other; it does not say the class cannot be written down. "Cannot be derived from the existing
lists" and "cannot be recorded at all" are different claims, and both #841 and #959's own framing
treated them as one.

## Decision

**Each name in `spec/built-in-names.json` carries a `tokenClass` beside its `category`, and
`npm run built-in-names` compares that declaration against `@openlogo/parser`'s shipped
`highlight()` output in both directions.**

1. **Two axes, explicitly independent.** `category` answers *may a program declare this name?*
   `tokenClass` answers *how is this word painted?* Neither determines the other, and they are not
   merely different in principle: measured, they disagree on exactly the four word-spelled
   operators `and`, `or`, `not` and `mod`, which are `category: "keyword"` and painted `operator`.
   They also carry different profile semantics — `category` is unconditional
   (`spec/grammar.md:408`), while `tokenClass` is the class *while the entry's own profile is
   active*.

2. **The class is measured, not asserted.** The gate re-paints every name through `highlight()` in
   seven grammatical positions — a statement head, an argument, a list element, a `local` binder, a
   postfix field, an `export` operand and a `for` binder — and requires every occurrence in every
   position to come back as the declared class. The last four are exactly where a positional rule
   was refuted, so the manifest's `positionIndependence` claim is executed rather than assumed.
   Measured at 0.1.0: **148 names, 97 `primitive`, 47 `keyword`, 4 `operator`, and 148 of 148
   position-invariant.**

3. **The profile fallback is part of the comparison.** A name whose profile is not Core and whose
   class is `keyword` must paint `primitive` with that profile inactive (`spec/tooling.md:31`);
   every other name must be unmoved. Measured, exactly seven names move: `ask`, `each`, `tell`,
   `when`, `every`, `on_key`, `on_click`.

4. **The four contextual words are a declared exception set, not prose.** `empty`, `member`, `of`
   and `a` are painted `keyword` *by position* and are ordinary names elsewhere, so no flat value
   can express them — and they are not built-in names at all, so they are not rows in `names`.
   They get their own structure under `tokenClass.contextual`, carrying a **probe per declared
   position** and probes for the positions outside it. The probes are run, so a probe that does not
   put the word where it claims fails instead of passing vacuously.

5. **The exception set cannot pass by being empty** (issue #964). It is pinned from three sides that
   each measure the others: the `excluded` carve-outs with reason `contextual-keyword` (the same
   words' declaration axis, compared as a set *and* position-by-position), and the two prose
   statements of the set in `spec/tooling.md`, each read through a fail-closed anchor and compared
   word for word. Emptying any one of the three fails against the other two.

6. **The row states the exceptions and points at the declaration.** `spec/tooling.md:30` no longer
   enumerates the class. It must cite `built-in-names.json`, and the set of built-in names it names
   backticked must equal — in both directions — the set whose `tokenClass` differs from its
   `category`. Naming a class member re-creates the copy this replaced and fails; dropping an
   exception drops a normative statement and fails.

7. **The fingerprint is removed, not kept alongside.** A checksum beside a real comparison invites
   the same "green means correct" misreading this decision exists to close.

## Consequences

- A factually wrong token class can no longer be green. The mutation that proved the old mechanism
  hollow — invert the claim, recompute the digest — has no counterpart here, because there is
  nothing to recompute: the comparison's other side is the running highlighter.
- **Adding a primitive or keyword stays a two-file change** and now carries a third obligation: the
  new entry needs a `tokenClass`, and a wrong one fails rather than passing unexamined.
- The gate now depends on `@openlogo/parser`'s `highlight()`, not only on its name registries. It
  **fails closed** if no `highlight()` is exported, because a paint axis that silently checks
  nothing is worse than none.
- `spec/tooling.md:30` stays a single line, so the 39 citations pointing at it do not shift. The
  claims those citations quote are preserved; where the row's wording changed, the quoting comments
  were updated in the same change.
- The enumeration lives under `spec/`, so it stays maintainer-owned via `CODEOWNERS` exactly as the
  row was. What changed is that CI now has an opinion about whether it is true.
- This does not make the token class *derivable* — it makes it *declared*. `spec/grammar.md:378`'s
  independence is untouched, and nothing here infers a paint from reserved-list membership.
