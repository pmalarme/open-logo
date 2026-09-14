# 34. Cite the spec by section anchor, not by line number

- Status: Accepted
- Date: 2026-09-14
- Deciders: OpenLogo maintainer (@pmalarme) + `@devops`, on issue #1182 — saga #1180, recording the
  decision #1142 asked for
- Related: sits beside [ADR-0022](0022-documentation-example-gate.md) (a prose surface is only as
  true as the gate under it) and [ADR-0030](0030-adr-numbering-is-gated.md) (references between our
  own documents, and the same "one tree" trap that applies to this record's own number)

## Context

A citation is how a line of code says *the contract requires this*. They are written in comments,
tests, fixture prose and docs, in the thousands, and they are the mechanism binding this
implementation to `spec/`. Until issue #934's gate, nothing checked one.

We write them by **line**: `spec/<file>.md:<line>`. A line number is a position in a file, not a
reference to an idea, and it is invalidated by any edit above it. That has cost us twice.

**Churn on every spec edit.** Inserting a paragraph shifts every line number below it. Issue #846
exists because a single spec amendment shifted 113 citations across 68 files, and a measurement on
its own thread then put a later slice's impact several times higher again. PR #1084 corrected four
spec files and carried a dedicated commit for the consequences — `51cb3428`, *"re-point every spec
citation the #814 spec edit shifted"* — **139 files, 241 insertions and 241 deletions**. Most of
those pairs are a line number moving and nothing else. Not all: the pass also recomputed
exception-manifest fingerprints, rewrote rationale prose that quoted the text beside a cited line,
and re-split citation ranges into disjoint spans that no `+N` could have produced. How many fall in
each bucket is deliberately not stated here — two careful reviews of that single commit returned
different breakdowns, which is this record's argument in miniature. The pass then had to be
**redone** when one sentence was corrected later in review. (The stat re-derives from the commit;
#1142 and #1085 quote a smaller slicing of the same pass, so take the commit, not the prose.) That
is the friction the maintainer named when filing #1142: *"maybe we should rethink this entirely as
it causes issues and a lot of changes each time."*

**The re-pointing pass is not a check.** Saga #811's review gate found **seven** citations that
resolved cleanly and were wrong anyway. The seventh is the one that decides this record: a citation
whose range was slid three lines down by a mechanical `+3` kept the gate green **while the claim
beside it stayed wrong** — it said 13 `ol-style-*` codes; the registry it cited already held more,
and has grown again since. The line numbers were re-derived; the sentence was not. A large
mechanical pass is not merely tedious, it is the *mechanism* by which a stale claim acquires a
fresh, green-looking pointer.

Both forms already exist in this repository — the anchor form is simply the minority. The exact
totals are deliberately not restated here: #1180 recorded thousands of line citations against a
couple of hundred `#heading` references, measured by `npm run spec-citations` and a `git ls-files`
scan at the saga's tip, and a later run already reported different figures. The gate prints the
live count on every run; a count copied into an immutable record cannot be corrected, which is why
ADR-0030 keeps its own out too. (#1142's independent scan reported different totals again, and
nothing in the repository could adjudicate the disagreement — itself an argument for a citation form
a gate can resolve.)

A heading does not move when text is inserted above it. It breaks when that heading is **renamed or
removed**, or when a duplicate heading elsewhere in the file changes which slug the cited one gets —
all rarer and more deliberate than inserting a paragraph, and all things the editor doing them is
already thinking about.

## Decision

**Cite the spec by section anchor: `spec/<file>.md#a-heading`.**

1. **The anchor is the citation form.** It names the section the claim rests on, and survives the
   ordinary edit — text inserted, deleted or reflowed above and around it — that invalidates a line
   number. It does not survive renaming or removing that heading, nor a duplicate heading inserted
   ahead of it, which takes the plain slug and pushes the cited section onto a suffixed one. Those
   are the breakages this form trades for, and they differ in kind. Once #1181 lands, a rename or a
   removal is **loud whenever it leaves no heading answering to the cited slug**. Where duplicate
   headings are in play the slug is instead *inherited* — by one inserted ahead of the cited
   section, or by a later duplicate when an earlier one is renamed or removed — and the citation
   goes on resolving while landing somewhere else. **Slug reassignment is therefore silent**, and
   belongs to the wrong-passage class below, undiminished.
2. **A line number is permitted only where line precision is genuinely required** — pinning one
   production, one table row, one sentence — **and then it carries the anchor too**, so the durable
   half survives the next spec edit and re-pointing the line never loses the reference. A bare line
   citation is the legacy form: valid, accepted, no longer the default.

   Not everything after a `#` is stable. GitHub's **line fragment** — `#L30`, `#L28-L84`, a form
   this repository does use — is a line claim in anchor clothing: it names a position, not a
   section, and inherits exactly the drift this decision removes. How the gate should treat one is
   #1181's call, not this record's; either way it is **not** the durable form.
3. **Carrying the quoted fragment you rely on is recommended.** A citation that quotes its words can
   be checked in a way a bare pointer never can. Say plainly what that buys: a quote check proves
   **the words are still present**, not that they mean what the citing sentence claims. Five of
   #811's seven instances would have survived one. It narrows the gap; it does not close it.
4. **Migration is incremental — never a mass edit.** New citations use the anchor form; the gate
   accepts both; a file converts its own citations when it is opened for other work. A one-shot
   rewrite of the whole corpus is *precisely* the move that produced instance 7, and PR #1084 showed
   what it costs when one sentence then changes. The remaining line-form count the gate already
   prints — recounted by #1181 and ratcheted by #1183 — may fall, never rise.
5. **The convention lives in the surfaces an agent reads**, not only in this record: `AGENTS.md`,
   the always-on team instructions, `.github/agent-policy.md`, and `shared/spec-fidelity`, which
   owns the rule and its limits; the others state it in a line or two and link there for the
   mechanics.

### What the gate proves — and what it does not

Slice #1181 of this saga adds anchor resolution to `npm run spec-citations`: it reads the headings
of the file an anchor names and checks that one of them matches. **That check does not exist yet** —
until it lands, an anchor is enumerated as a mention and never resolved, and the gate's printed
coverage statement says so. When it lands, it will answer exactly one question: **does this anchor
name a real heading?** A misspelled heading, or a renamed one that leaves the slug unclaimed, then
fails loudly, naming file, anchor and citing site, instead of passing unseen. A slug another heading
has taken over resolves, and says nothing.

It answers nothing else — **it proves the heading exists, and nothing more.** The wrong-passage and
misstating-prose modes of #934 survive an anchor exactly as they survive a line number: a resolving
anchor no more supports the claim beside it
than a resolving line did, and the anchor is *coarser*, so a citation may now point at a section
that genuinely contains the answer while the sentence beside it still gets that answer wrong. Read
the gate's printed coverage statement, which says this in its own voice, and do not let "anchors are
checked now" be heard as "citations are right now". This repository builds gates to stop a green
signal certifying less than it appears to; a record announcing a new gate is the last place to
commit that offence.

### Alternatives rejected

- **An automatic `--fix` re-pointing mode (#1085).** It industrialises instance 7: it makes
  "resolves" cheap to restore at scale while saying nothing about whether the sentence is still
  true, and manual re-pointing at least puts eyes on the prose. Its premise is a corpus-wide
  mechanical pass; as the corpus converts to anchors that premise dissolves, and the line-precise
  citations this decision still permits are too few and too deliberate to justify automating.
- **A single mechanical rewrite of every existing citation.** Same objection, applied once and
  enormously: thousands of sites re-pointed by a tool nobody reads the output of, in a diff no
  reviewer can read either. The migration is incremental for the same reason the `--fix` mode is
  refused.
- **Mandating a quoted fragment on every citation.** Rejected as a *requirement* because it taxes
  every site for a check that proves presence, not support, and because a corpus-wide quoting
  mandate is the mass edit above under another name. Recommended, and checkable where it is used.
- **Leaving the convention as it is and absorbing the churn.** This is the status quo #1142 was
  filed against; it has already forced one re-pointing pass to be done twice, and it discourages
  correcting `spec/` forward — the opposite of what this repository says about `spec/`.

## Consequences

- **Each converted citation stops contributing to the re-pointing pass.** The burden declines as the
  corpus converts; it does not vanish at once, and a line-precise citation still has to be
  re-pointed when the text above it moves. What goes away with each conversion is both the busywork
  and the defect source the busywork carries.
- **Once #1181 lands, renaming or removing a heading breaks citations loudly** — when it leaves the
  cited slug unclaimed. That cost is real and it is the trade being made: it moves the breakage from
  *every* insertion (silent) to *renames and removals* (noisy). Renaming a section in `spec/`
  becomes a visible event with a bounded fix, where the gate names every citing site. **Duplicate
  headings are the exception, and they stay silent**: whenever another heading inherits the cited
  slug — one inserted ahead of the section, or a later duplicate promoted when an earlier one goes —
  resolution still succeeds. That is the wrong-passage class, not a case this decision closes.
- **The corpus stays mixed for a long time, on purpose.** Both forms are accepted; neither is a
  defect. A green run does not mean the tree has converted, and the line-form count the gate already
  prints — recounted by #1181, ratcheted by #1183 — is the honest measure of where the migration
  stands.
- **Anchors are long, and a line wrap breaks one** — a citation split mid-anchor reads as a
  different, non-existent heading, as one site in the tree already did. Today that passes unseen;
  after #1181 it fails. Keep a citation on one line even where the line runs long; the rule sits
  beside the convention in `shared/spec-fidelity`.
- **Anchors bring their own failure modes** — slug derivation, duplicate headings, headings that
  change wording without changing meaning. The slug rule is stated in the implementation and pinned
  by tests in #1181, not settled by this record.
- **Nothing here re-points a single existing citation.** The unresolved-citation manifest and the
  corpus sweep (#948) are untouched, as is every stale-citation issue already filed.
- **This record's own number is subject to ADR-0030's residual:** `npm run adr-numbering` reads one
  tree, so two branches can each take the same next-free number and only the second merge goes red.
  It was re-verified in-tree immediately before this commit, which is the only defence available.
