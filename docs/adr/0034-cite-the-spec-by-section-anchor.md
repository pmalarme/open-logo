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
shifted 665 citations in a single edit. PR #1084 changed **4 spec files (+156/−19)** and then
touched **~74 more files solely to re-point citations** — 19 code files at **+46/−46**, where every
hunk was a line number moving and nothing else — and had to **redo the entire pass** when one
sentence was corrected later in review. That is the friction the maintainer named when filing
#1142: *"maybe we should rethink this entirely as it causes issues and a lot of changes each time."*

**The re-pointing pass is not a check.** Saga #811's review gate found **seven** citations that
resolved cleanly and were wrong anyway. The seventh is the one that decides this record: a citation
whose range was slid three lines down by a mechanical `+3` kept the gate green **while the claim
beside it stayed wrong** — it said 13 `ol-style-*` codes; there are 14. The line numbers were
re-derived; the sentence was not. A large mechanical pass is not merely tedious, it is the
*mechanism* by which a stale claim acquires a fresh, green-looking pointer.

Both forms already exist in this repository — the anchor form is simply the minority. The exact
totals are deliberately not restated here: #1180 recorded thousands of line citations against a
couple of hundred `#heading` references, measured by `npm run spec-citations` and a `git ls-files`
scan at the saga's tip, and a run days later already reports different figures. The gate prints the
live count on every run; a count copied into an immutable record cannot be corrected, which is why
ADR-0030 keeps its own out too. (#1142's independent scan reported different totals again, and
nothing in the repository could adjudicate the disagreement — itself an argument for a citation form
a gate can resolve.)

A heading does not move when text is inserted above it. It breaks only when the heading is
**renamed** — rarer, deliberate, and a change the renamer is already thinking about.

## Decision

**Cite the spec by section anchor: `spec/<file>.md#a-heading`.**

1. **The anchor is the citation form.** It names the section the claim rests on, and survives every
   edit that does not rename that section.
2. **A line number is permitted only where line precision is genuinely required** — pinning one
   production, one table row, one sentence — **and then it carries the anchor too**, so the durable
   half survives the next spec edit and re-pointing the line never loses the reference. A bare line
   citation is the legacy form: valid, accepted, no longer the default.

   Not everything after a `#` is stable. GitHub's **line fragment** — `#L30`, `#L28-L84`, live in
   four sites in `packages/parser/README.md` — is a line claim in anchor clothing: it names a
   position, not a section, and inherits exactly the drift this decision removes. #1181's gate
   resolves it as the line claim it is, and it is **not** the durable form.
3. **Carrying the quoted fragment you rely on is recommended.** A citation that quotes its words can
   be checked in a way a bare pointer never can. Say plainly what that buys: a quote check proves
   **the words are still present**, not that they mean what the citing sentence claims. Five of
   #811's seven instances would have survived one. It narrows the gap; it does not close it.
4. **Migration is incremental — never a mass edit.** New citations use the anchor form; the gate
   accepts both; a file converts its own citations when it is opened for other work. A one-shot
   rewrite of the whole corpus is *precisely* the move that produced instance 7, and PR #1084 showed
   what it costs when one sentence then changes. The remaining line-form count is reported by the
   gate and may fall, never rise (#1183).
5. **The convention lives in the surfaces an agent reads**, not only in this record: `AGENTS.md`,
   the always-on team instructions, `.github/agent-policy.md`, and `shared/spec-fidelity`, which
   owns the rule; the others link to it rather than restating it.

### What the gate proves — and what it does not

Slice #1181 of this saga makes `npm run spec-citations` resolve an anchor against the headings of
the file it names. That check answers exactly one question: **does this anchor name a real
heading?** A misspelled or renamed heading fails loudly, naming file, anchor and citing site,
instead of passing unseen as it does today.

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
  true, and manual re-pointing at least puts eyes on the prose. Once citations stop encoding line
  numbers there is nothing left for it to fix, so the issue dissolves rather than being built or
  argued about.
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

- **A spec edit that inserts text no longer drags a re-pointing pass behind it.** That removes both
  the busywork and the defect source the busywork carries.
- **Renaming a heading now breaks citations loudly.** That cost is real and it is the trade being
  made: it moves the breakage from *every* insertion (silent) to *heading renames only* (noisy).
  Renaming a section in `spec/` becomes a maintainer-visible event with a bounded fix, where the
  gate names every citing site.
- **The corpus stays mixed for a long time, on purpose.** Both forms resolve; neither is a defect.
  A green run does not mean the tree has converted, and the gate's reported line-form count is the
  only honest measure of where the migration stands.
- **Anchors are long, and a line wrap breaks one silently** — a citation split mid-anchor reads as a
  different, non-existent heading, which one live site already did. Keep a citation on one line even
  where the line runs long; the rule sits beside the convention in `shared/spec-fidelity`.
- **Anchors bring their own failure modes** — slug derivation, duplicate headings, headings that
  change wording without changing meaning. The slug rule is stated in the implementation and pinned
  by tests in #1181, not settled by this record.
- **Nothing here re-points a single existing citation.** The unresolved-citation manifest and the
  corpus sweep (#948) are untouched, as is every stale-citation issue already filed.
- **This record's own number is subject to ADR-0030's residual:** `npm run adr-numbering` reads one
  tree, so two branches can each take the same next-free number and only the second merge goes red.
  It was re-verified in-tree immediately before this commit, which is the only defence available.
