# 36. Cite the spec by section anchor only — no line numbers, no exceptions

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** OpenLogo maintainer (@pmalarme), on saga #1180, with `@orchestrator`, `@devops` and
  `@testing`
- **Related:** supersedes [ADR-0034](0034-cite-the-spec-by-section-anchor.md), whose two migration
  hedges this record removes; builds on
  [ADR-0035](0035-parse-markdown-to-resolve-spec-anchors.md), the parse that makes an anchor
  checkable, and [ADR-0022](0022-documentation-example-gate.md), a prose surface is only as true as
  the gate under it

## Context

[ADR-0034](0034-cite-the-spec-by-section-anchor.md) made the section anchor the **preferred** way to
cite `spec/`, then hedged it twice. Existing citations were to be converted only when a file was
opened for other work, and a line number stayed permitted "where line precision is genuinely
required", carrying its anchor beside it.

Both hedges were written **before the gate could check an anchor at all**, and both were reasonable
then. A mass edit to an unverified form would have been the same move that produced the defect
ADR-0034 itself cites: a mechanical re-point keeps the gate green while the claim beside it stays
wrong. So the incremental plan was the safe one available at the time.

It is no longer the safe one, for three reasons.

**A preference with carve-outs is not a convention.** It is a third thing to learn, and every agent
reading one surface rather than another resolves the ambiguity differently. This saga has already
spent several review rounds on which form a given sentence should teach.

**The hedges preserve exactly the cost the saga exists to remove.** Churn is proportional to the
line citations that remain, so converting a file only when someone happens to open it leaves the
majority form fragile indefinitely. Measured at this tree with `npm run spec-citations`: the gate
reports **2,861** line-form citations against **187** section anchors. Read the counters it prints
rather than these numbers, which are a snapshot.

**An exception file institutionalises the unresolvable.** `scripts/spec-citations-exceptions.json`
lets a citation that does not resolve stay in the tree, keyed by a hash and a tracking issue. That
was a concession to a corpus nobody could fix in one pass. It is also a standing invitation to
record a defect instead of repairing it.

## Decision

**Cite the spec as `spec/<file>.md#a-heading`. Only.**

1. **Never a line number.** Not alone, not beside an anchor, not "where precision is required".
2. **Never a line fragment.** GitHub's `#L30` form names a position, not a section, and drifts
   exactly the way a line number does. It is not an anchor.
3. **No exceptions and no grandfathering.** The legacy form is not "still valid" and is not
   deprecated-but-tolerated: it is **rejected**. There is no migration period to reason about, and
   no form a citation may fall back to.
4. **The corpus converts in one sweep**, rather than file by file as files are touched.
5. **The exception machinery is deleted outright** — the exceptions file and the code that reads it.
   Under an absolute rule there is nothing left for it to hold.

Where a claim genuinely rests on one production, one table row or one sentence, **quote the words it
relies on** next to the anchor. ADR-0034 already recommended this; it now carries the weight the
line number used to. A quotation is also checkable in a way a line number never was — the gate
verifies a quoted EBNF production against the document, and no gate could ever verify that a line
number meant what the sentence beside it claimed.

### What is true on the day this record lands

This rule binds authors **now**. The tooling has not caught up yet, and writing as though it had
would be the exact defect saga #1180 exists to remove — a document asserting a check that does not
run.

- `npm run spec-citations` still **accepts** a line citation. The gate change that rejects one is
  `@testing`'s, under saga #1180.
- The corpus is still overwhelmingly line-form. The counters the gate prints on every run are the
  live measure; the snapshot above is this record's date, not a claim about any later tree.
- `scripts/spec-citations-exceptions.json` still exists. Deleting it, and the code that reads it, is
  `@testing`'s under the same saga.

A reader on the merge date should therefore expect a tree that does not yet match this record. The
gap is deliberate and sequenced: the rule ships **first**, so sessions already in flight learn it in
time to correct their own work, and the sweep converts the corpus behind it.

### Why the sweep is safe now, and was not before

PR #1198 (issue #1181, recorded in [ADR-0035](0035-parse-markdown-to-resolve-spec-anchors.md)) made
the gate **resolve** anchors: it extracts the cited document's headings from a GFM parse, slugs them
the way GitHub slugs, and fails when the fragment names none of them.

That inverts the risk ADR-0034 was protecting against. A mass conversion to an **unchecked** form
propagates its own mistakes silently, which is why it was refused. A mass conversion to a **checked**
form cannot: every anchor the sweep writes is resolved on the next run, and one that lands on no
heading fails loudly, naming the file, the anchor and the citing site. The sweep's output is verified
by the same gate that verifies hand-written citations.

### The transform preserves correctness; it does not assert it

The conversion is **mechanically derivable**: a citation naming line *N* becomes the anchor of the
heading that encloses line *N*. The enclosing heading is a property of the document, not a judgement
about the claim.

This matters for what the sweep is allowed to be believed about. The section a citation lands on is
the one that already contained the line it named, so:

- a citation that pointed at the right passage still points at the right section;
- a citation that pointed at the **wrong** passage still points at the wrong section.

**The sweep changes the form, not the truth.** It repairs no stale citation and introduces no new
one. The wrong-passage and misstating-prose modes of issue #934 survive it untouched, exactly as
ADR-0034 and ADR-0035 say they survive an anchor. Nobody may read a green run after the sweep as
evidence that the corpus was audited — it was re-pointed, and that is a strictly smaller claim.

One real loss: a section is coarser than a line, so a citation that genuinely depended on line
precision now names a larger region. That is what the quotation rule above is for, and it is the
trade the maintainer chose knowingly — a coarser citation that stays true beats a precise one that
silently stops being true.

### Alternatives rejected

- **Keep ADR-0034's incremental migration.** Rejected: it is the status quo whose cost this saga was
  chartered to remove, and it keeps two forms alive for as long as any file goes untouched.
- **Keep a narrow precision carve-out.** Rejected: every carve-out is a judgement call at the point
  of writing, and "genuinely required" is not a decidable test. The quotation rule covers the same
  need without a second form.
- **Sweep, but keep the exceptions file for what will not convert.** Rejected: a citation that
  cannot be expressed as an anchor is a defect to route to the owning document, not a state to
  record. Keeping the file would reproduce the hedge this record removes.

## Consequences

- **The rule lives in the surfaces an agent reads before its first commit**, not only here:
  `AGENTS.md`, the always-on team instructions, `.github/agent-policy.md`, and
  [`shared/spec-fidelity`](../../.github/skills/shared/spec-fidelity/SKILL.md), which owns it. Those
  surfaces state the rule plainly and link here for the reasoning.
- **Sessions in flight when this lands will hold line citations written under the old rule.** That
  is why the memory surfaces ship ahead of the sweep: an agent that pulls should learn the rule in
  time to correct its own work rather than have it corrected underneath.
- **The gate becomes the enforcement**, not the documentation. Guidance is guidance; a rule nothing
  rejects is a preference. Until `@testing`'s gate change lands under saga #1180, this rule is
  carried by the memory surfaces alone — which is why they are worded as an absolute rather than a
  recommendation.
- **Anchors keep the failure modes ADR-0035 documented**, and this record claims nothing better:
  resolution proves a heading exists and nothing more, a rename that leaves the slug unclaimed fails
  loudly, a duplicate-slug collision retargets a citation **silently**, and four heading constructs
  are refused rather than answered.
- **ADR-0034 stays the record of *why* an anchor**, with its measured churn and its rejected
  alternatives intact. This record removes its hedges; it does not relitigate its reasoning.
- **This record's own number is subject to ADR-0030's residual:** `npm run adr-numbering` reads one
  tree, so two branches can each take the same next-free number and only the second merge goes red.
  It was verified against every `refs/remotes/origin/*` ref immediately before this commit, which is
  a wider check than the gate's but still not a guarantee against a branch created after it.
