---
name: author-a-language-design-record
description: >-
  How @documentation writes a Language Design Record (LDR) explaining *why* the OpenLogo language
  is shaped the way it is — Context → Decision → Rationale → How other languages do it →
  Consequences, always citing the normative spec/ section(s) it explains. Use for docs/design-notes/,
  language-design rationale, and cross-language comparisons for advanced readers. Reviewed by
  @language-designer and @interpreter.
created: 2026-07-23T00:00
updated: 2026-07-23T00:00
---

## Purpose

`docs/design-notes/` is OpenLogo's fourth doc surface: it answers **why the language itself is
shaped this way**, for advanced readers (contributors, "hackers", curious learners) — a layer none
of `docs/adr/` (toolchain/engineering choices), `docs/learn-how-its-built/` (how the implementation
is coded), or `spec/` (what is normatively true) cover. A **Language Design Record (LDR)** is one
Markdown file per language-design decision, mirroring the ADR pattern (`docs/adr/NNNN-title.md`)
but aimed at language rationale rather than engineering/toolchain rationale. See epic #445 for the
originating motivation and the full seed list of LDRs.

## Procedure

1. **Confirm the format exists.** `docs/design-notes/0000-record-language-design-decisions.md`
   (authored by issue #449) is the canonical LDR-0000 — it defines the format itself and is the
   reference example for every subsequent LDR. Read it first; do not restate or fork the format.
2. **Numbering + location:** one file per decision, `docs/design-notes/NNNN-kebab-title.md`,
   numbered sequentially starting after LDR-0000, consistent with the `docs/adr/` convention.
   Add the new entry to `docs/design-notes/README.md` (the index).
3. **Write the LDR using the five required sections, in this order:**
   - **Context** — what problem or tension in the language design prompted the decision.
   - **Decision** — the chosen design, stated precisely in canonical spec vocabulary
     (`shared/spec-fidelity`) — not classic-Logo or other-language terms.
   - **Rationale** — why this design over the alternatives that were considered.
   - **How other languages do it** — a concrete comparison (e.g. Python/JS/Ruby reference
     semantics, Rust/Swift/C++ value semantics, Scheme, classic Logo), only as relevant to the
     decision at hand.
   - **Consequences** — what the decision enables or forecloses, ending with the spec citation(s).
4. **Cite the normative spec section(s).** Every LDR is a rationale layer over `spec/`, never a
   replacement for it — it must cite the exact `spec/*.md` section(s) it explains (e.g.
   `spec/grammar.md`'s place grammar, `spec/execution-model.md`'s evaluation order). An LDR with no
   spec citation is incomplete: the doc must stay anchored to the contract, never drift from it.
5. **Cross-link, don't duplicate.** Where it helps a reader discover the rationale layer, a
   maintainer-reviewed `spec/` PR may add a single "see also" backlink line pointing at the new
   LDR (never inside an LDR PR itself, and never altering any normative text), and/or
   `docs/learn-how-its-built/` may link forward to it in the same PR that reviews that chapter.
   Never restate the spec's normative text inside the LDR — cite and reference it instead.
6. **Send for domain review.** `@language-designer` and `@interpreter` are both required domain
   reviewers for every LDR — they own the grammar/semantics the note explains — in addition to the
   standard `shared/review-gate` non-author review.

## Critical rules

- Never change `spec/` normative content from an LDR PR — LDRs explain the contract, they don't
  change it. (A separate, maintainer-reviewed `spec/` PR may later add a non-normative backlink
  line to a new LDR; that is not part of authoring the LDR itself.)
- Never write LDR content as part of the skill/tooling work itself (that's each seed issue under
  epic #445, starting with LDR-0000 in #449).
- Use canonical OpenLogo vocabulary throughout, even when describing "how other languages do it" —
  name OpenLogo's own concepts (places, value semantics, profiles) precisely.
- All five sections are required, in the Context → Decision → Rationale → How other languages do
  it → Consequences order; do not omit or reorder them.
- Every LDR cites at least one normative `spec/` section; add the citation in Consequences (and
  inline elsewhere if it aids the reader).

## Checklist

- [ ] File named `docs/design-notes/NNNN-kebab-title.md`, numbered after the existing highest LDR.
- [ ] All five sections present, in order: Context, Decision, Rationale, How other languages do it,
      Consequences.
- [ ] At least one normative `spec/` section cited.
- [ ] Added to `docs/design-notes/README.md` index.
- [ ] Cross-links added to/from `docs/learn-how-its-built/` where helpful; any `spec/` backlink is a
      separate, maintainer-reviewed `spec/` PR, never part of the LDR PR itself.
- [ ] Reviewed by both `@language-designer` and `@interpreter` as domain reviewers, plus
      `shared/review-gate`.
- [ ] No `spec/` changes; no unrelated LDR content authored in the same PR.
