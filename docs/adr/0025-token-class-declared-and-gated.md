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
`highlight()` output.**

The comparison is not one mechanism, and the three it is made of cover different amounts. Stated
plainly here because "in both directions" over-describes two of them:

- **Declared name → highlighter, measured.** Every entry's class is re-painted through `highlight()`
  in nine positions and over the profile sweep below. This is the strong half.
- **Highlighter → declaration, over the name *sources*.** The reverse direction reads
  `OL_WORD_OPERATORS`, `OL_KEYWORDS` and `OL_PROFILE_KEYWORDS` — the sets `highlight()` classifies
  from — and set-compares them against the declared classes. It is a comparison against enumerable
  sources, **not** against arbitrary `highlight()` output: a class the highlighter derived some
  other way would not appear in it.
- **The contextual four, declaration-first only.** Each declared word is probed in the positions it
  claims and outside them. Nothing enumerates the positional marking, so a contextual word the
  implementation started painting and this file does not declare would not be detected.

1. **Two axes, explicitly independent.** `category` answers *may a program declare this name?*
   `tokenClass` answers *how is this word painted?* Neither determines the other, and they are not
   merely different in principle: measured, they disagree on exactly the four word-spelled
   operators `and`, `or`, `not` and `mod`, which are `category: "keyword"` and painted `operator`.
   They also carry different profile semantics — `category` is unconditional
   (`spec/grammar.md:408`), while `tokenClass` is the class *while the entry's own profile is
   active*.

2. **The class is measured, not asserted.** The gate re-paints every name through `highlight()` in
   nine grammatical positions — a statement head, an argument, a list element, a `local` binder, a
   postfix field, an `export` operand, a `for … from` binder, a `for … in` binder and a `set … to`
   place — and requires **every position to yield at least one token** and every token in every
   position to carry the declared class. Both halves matter: unioning the classes let a position
   that painted nothing hide behind the others. The eight non-head positions are where the grammar
   admits a keyword as an ordinary name (`spec/grammar.md:386`), so the manifest's
   `positionIndependence` claim is executed rather than assumed. Measured at 0.1.0: **148 names, 97
   `primitive`, 47 `keyword`, 4 `operator`, and 148 of 148 position-invariant.**

3. **The profile rule is checked against the profile the entry names.** Every subset of the
   keyword-contributing profiles, each swept twice — once over Core Language alone, once with every
   non-keyword-contributing profile also active. A name painted `keyword` by a non-Core profile must
   be `keyword` exactly when its own profile is in the subset and `primitive` otherwise
   (`spec/tooling.md:31`); every other name must be unmoved by any of them, and every probe must
   paint the word every time. Comparing only "all profiles" against "Core alone" left *ownership*
   unchecked — gating `tell` on Interaction instead of Sprites answered identically at both
   endpoints — and holding the non-contributing profiles permanently active hid a highlighter that
   mispainted whenever Sound was absent. Measured, exactly seven names move:
   `ask`, `each`, `tell`, `when`, `every`, `on_key`, `on_click`.

4. **The implementation is compared to the file, not only the file to the implementation.** `names`
   is already compared against the *registries* both ways, but `highlight()` does not decide a class
   from the registries alone: `OL_WORD_OPERATORS` is a name source of its own, so a fifth word added
   there — painted `operator`, held by no registry, listed by no entry — escaped everything. Both
   keyword-class sources are now set-compared both ways: `tokenClass: "operator"` against
   `OL_WORD_OPERATORS`, and `tokenClass: "keyword"` against `OL_KEYWORDS` + `OL_PROFILE_KEYWORDS`
   minus those operators. It fails closed when a source stops being exported.

5. **The four contextual words are a declared exception set, not prose.** `empty`, `member`, `of`
   and `a` are painted `keyword` *by position* and are ordinary names elsewhere, so no flat value
   can express them — and they are not built-in names at all, so they are not rows in `names`.
   They get their own structure under `tokenClass.contextual`, carrying a **probe per declared
   position** and probes for the positions outside it. Each probe is run **and parsed**: it must
   build the AST node its position names (`IsPredicate`, `ValueOfKey`), because a label nothing
   verifies is decorative — `of`'s two probes could otherwise be swapped, leaving the Heritage
   reader unexercised while the position still read as checked.

6. **The exception set cannot pass by being empty** (issue #964). It is pinned from four sides:
   its own declared non-emptiness, the `excluded` carve-outs with reason `contextual-keyword` (the
   same words' declaration axis, compared as a set *and* position-by-position), and the two prose
   statements of the set — one in `spec/tooling.md`, one in `spec/grammar.md`, each read through a
   fail-closed anchor and compared word for word. Emptying one side fails against the others;
   emptying *every* side at once satisfies all the pairwise comparisons, which is why non-emptiness
   is checked on its own terms.

7. **The row's data-bearing sentences are generated from the declaration.** `spec/tooling.md:30` no
   longer enumerates the class. It must cite `built-in-names.json`; its two sentences that carry
   data — the two-axis exceptions and the contextual words — are **rendered from the declaration and
   required verbatim**; the profile sentence, which has no data to render, is a required literal;
   the set of built-in names it names backticked must equal the two-axis exception set in both
   directions; and a list of three or more built-in names in a row is rejected wherever it appears,
   which is how a bare comma-separated enumeration or a single multi-word code span is caught.

8. **The fingerprint is removed, not kept alongside.** A checksum beside a real comparison invites
   the same "green means correct" misreading this decision exists to close.

9. **The contextual words' *positional* marking is proven by a generated corpus, not by probes.**
   The nine probes above ask "is this word painted right *here*"; they cannot ask "in every shape
   the grammar permits". `packages/parser/src/contextual-shape-corpus.test.mjs` crosses the four
   words with the `is-predicate` production's own structure — the operand's **closing pattern** and
   opening whitespace, operand form, and a whitespace deviation at **every adjacency** — and
   asserts the whole set **agrees**, so a shape nobody enumerated joins the comparison
   automatically. It exists because two consecutive fixes to `markIsPredicateKeywords` each passed
   their author's own tests: both corpora were enumerations from the author's head, and so was the
   acceptance matrix written to catch the first miss.

   The **closing-pattern** axis is the round-9 correction and shows why a named shape list can
   never be enough. Each earlier revision replaced one sampled axis with another: `depth x
   interior-style` fixed every newline run at exactly one, and adding `placement`
   (innermost/outermost/every) still covered only 3 of the `2^depth - 1` level subsets. Both
   admitted a phased scanner that satisfied the entire corpus while painting a clean-parsing
   program `primitive` — measured directly, twice: under each mutant every shape the previous
   revision contained still painted `keyword`, and only the shapes it lacked failed.

   So the shape is now **one** axis, enumerated rather than named: a vector of how many newlines
   precede each `)`, innermost first. It subsumes tight (all zeros), every placement, and every run
   length, and `signatureOf` reads the tail back off the emitted text and compares it against the
   vector — a comparison a `depth`-only signature cannot make, since `\n))`, `)\n)` and `)\n))`
   share a depth and separate three different broken scanners. Exhaustive over runs `{0,1,2}` at
   depths 1-3, plus depth 4 over `{0,1}` to anchor the scan from above; runs of 3 or more and
   depths beyond 4 are outside the bound and stated as such.

   Measured at 0.1.0: **13,320 assertions over 111 operand shapes**, 9,324 distinct sources, 56
   distinct closing tails, all parsing. Load-bearing: removing the paren/newline skip fails
   **11,016** of them, and four separate broken scanners — three-phase, phased-pairs,
   single-newline, and a scan capped at three iterations — each fail two of the seven tests.

## What this decision knowingly leaves failing

- **A newline at four of the seven adjacencies** of the `is-predicate` production is still painted
  `primitive` — after `is` in all three forms, and between `member` and `of`. That is issue
  **#995**'s defect, not this slice's, and the two fixes are complementary halves of one defect in
  the same function. (#944 is a separate dict-literal spec issue; its session is carrying the #995
  fix, which is why earlier revisions of this file misattributed the axis to it.)

  The corpus generates the axis anyway and pins it as **five coordinates** whose expansion over the
  shape and operand axes is measured (2,220 assertions at 0.1.0), rather than excluding the axis or
  recording the individual failures. The pin is a **set comparison in both directions**: when #995
  is fixed and a coordinate starts passing, the test fails and forces the corpus to widen, and a
  newly broken adjacency fails it too. Excluding the axis — an earlier draft — left the newline
  handling this slice *did* fix (the gap *before* `is`, 0 failures) with no test at all, and
  credited it in prose to a deferred issue.

## What this does **not** check

Stated because the mechanism it replaces failed three times by claiming more than it verified.

- **The templates' own English.** The row's generated sentences take their *words* and *classes*
  from the declaration, but the prose around them is a template in `scripts/`. Co-editing the
  template and the row would pass. That is a change to `spec/**` and `scripts/**` in one pull
  request, which `CODEOWNERS` puts in front of the maintainer — unlike a digest, which one hand
  could recompute alone.
- **The rest of the row's prose.** Sentences carrying no data are not compared, beyond the
  three-names-in-a-row rule and the backticked-name set comparison. A false claim written in prose
  that names nothing is still maintainer-reviewed, not machine-checked. Measured: adding *"A
  conforming highlighter never paints a contextual word with this class"* to the row passes the
  whole Definition of Done.
- **The re-enumeration rule is a heuristic, not a proof.** It rejects a run of three or more
  built-in names joined by commas and/or `and`/`or`, in any case, with identifier-aware boundaries
  so a trailing `?` cannot slip past. It raises the cost of copying the enumeration back into prose;
  it does not establish that no enumeration can be expressed. What is *guaranteed* is the verbatim
  rendering of the two data-bearing sentences and the both-directions set comparison of the names
  the row backticks.
- **The narrative fields** of `spec/built-in-names.json`. `narrativeFindings` requires them to be
  present and non-blank; nothing verifies what they say. That was already true of every `about` in
  that file and is unchanged here.
- **The positional marking inside `highlight.ts`.** It is decided from parsed structure rather than
  from a set, so it cannot be enumerated from outside; the contextual probes measure it word by
  word instead, which covers the declared words and cannot prove the absence of an undeclared one.
  Concretely: the `keyword` token class is compared in both directions over the **flat** names, but
  a *contextual* word the implementation started painting and this file does not declare would not
  be detected.
- **A profile rule keyed on one profile *present* and two *absent*.** The sweep varies **eleven**
  profiles — the nine that contribute no keywords, plus `sprites` and `interaction-events`, which
  the mask loop sweeps across all four combinations — and builds **17** distinct profile sets. That
  covers every dependency on a **single** profile, and every two-profile conjunction as well:
  measured by recording the sets the sweep actually passes to the highlighter, **220 of 220**
  distinct two-literal conjunctions are caught (55 for each of the four polarity combinations),
  **0** escape. What escapes needs a second simultaneous absence that no set provides: of the
  **495** distinct rules of the form "A present, B and C absent", **99 are caught** — the mask loop
  reaches patterns with both keyword-contributing profiles absent — and **396 escape**.
  Enumerating the full product is not an option: twelve profiles is 4096 sets and the gate
  re-paints nine probes per set per name.

  An earlier revision of this bullet said "eleven presence-patterns over the nine profiles it
  varies", with 144 and 252. Those figures are right for the nine-profile **projection** but were
  stated as a property of the sweep, and the accompanying clause — "which none of the 11 has" — is
  false of the actual sets: `00111111111` has exactly two absences. Both review agents found it
  independently (issue #959 review round 8).
- **The gate's own position vocabulary.** `CONTEXTUAL_POSITION_NODE_KINDS` and
  `CONTEXTUAL_POSITIONS` are literals in `scripts/`; deleting a position from *both* of them and
  from both manifest axes leaves this gate quiet. What catches it is the unit suite, which pins
  `of`'s two positions against the shipped manifest — a pin that lives in `npm run test`, not in
  `npm run built-in-names`.

## Consequences

- A **declared** token class that is factually wrong can no longer be green. The mutation that
  proved the old mechanism hollow — invert the claim, recompute the digest — has no counterpart
  here, because there is nothing to recompute: the comparison's other side is the running
  highlighter. What that does **not** extend to is a class the highlighter derives from something no
  registry enumerates, or a contextual word it paints that this file never declares; those are in
  the limits above.
- **Adding a primitive stays a two-file change** — the registry and the list — and now carries a
  third obligation: the new entry needs a `tokenClass`, and a wrong one fails rather than passing
  unexamined. A **keyword** was already more than two files (`spec/grammar.md`'s normative block and
  `spec/tooling.md`'s C19 mirror), and this adds the same third obligation to it.
- The gate now depends on `@openlogo/parser`'s `highlight()`, not only on its name registries. It
  **fails closed** if no `highlight()` is exported, because a paint axis that silently checks
  nothing is worse than none.
- `spec/tooling.md:30` stays a single line, so the **39 pre-existing citations** pointing at it do
  not shift (this record adds two more of its own). The claims those citations quote are preserved;
  where the row's wording changed, the quoting comments were updated in the same change.
- The enumeration lives under `spec/`, so it stays maintainer-owned via `CODEOWNERS` exactly as the
  row was. What changed is that CI now has an opinion about whether it is true.
- This does not make the token class *derivable* — it makes it *declared*. `spec/grammar.md:378`'s
  independence is untouched, and nothing here infers a paint from reserved-list membership.
